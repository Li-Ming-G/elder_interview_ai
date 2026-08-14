import { createHash } from 'node:crypto';
import type {
  BeginSpeakerCalibrationRequest,
  ResolveSpeakerCalibrationRequest,
  SpeakerCalibrationSnapshot,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  CausalQueueTimeoutError,
  CausalQueueUnavailableError,
  RealtimeRuntimeService,
  type SessionRuntime,
} from '../realtime-transcription/realtime-runtime.service.js';
import { SpeakerCalibrationSnapshotService } from '../transcription/speaker-calibration-snapshot.service.js';
import { PostSessionCoordinationService } from './post-session-coordination.service.js';

const MARKER_TIMEOUT_MS = 5_000;
type Transaction = Prisma.TransactionClient;

@Injectable()
export class SpeakerCalibrationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly runtimes: RealtimeRuntimeService,
    private readonly snapshots: SpeakerCalibrationSnapshotService,
    @Optional() private readonly postSession?: PostSessionCoordinationService,
  ) {}

  public async get(actor: AuthPrincipal, sessionId: string): Promise<SpeakerCalibrationSnapshot> {
    await this.assertGate(this.prisma, actor, sessionId);
    return this.snapshots.get(sessionId);
  }

  public async begin(
    actor: AuthPrincipal,
    sessionId: string,
    input: BeginSpeakerCalibrationRequest,
  ): Promise<SpeakerCalibrationSnapshot> {
    await this.assertGate(this.prisma, actor, sessionId);
    const action = actionIdentity('speaker.calibration.begin', input);
    const replay = await this.replay(actor, input.request_id, sessionId, action);
    if (replay !== null) return replay;
    try {
      const result = await this.runtimes.enqueueMarker(
        sessionId,
        input.speaker_stream_id,
        Date.now() + MARKER_TIMEOUT_MS,
        async (runtime, remainingMs) => {
          const marker = await this.prisma.$transaction(
            (transaction) => this.beginInTransaction(transaction, actor, runtime, input, action),
            { maxWait: remainingMs, timeout: remainingMs },
          );
          if (!marker.replayed) this.runtimes.publishCalibration(runtime, marker.snapshot);
          return marker;
        },
      );
      return result.snapshot;
    } catch (error) {
      throw this.mapMarkerError(error);
    }
  }

  public async resolve(
    actor: AuthPrincipal,
    attemptId: string,
    input: ResolveSpeakerCalibrationRequest,
  ): Promise<SpeakerCalibrationSnapshot> {
    const action = actionIdentity('speaker.calibration.resolve', input);
    const attempt = await this.prisma.speakerCalibrationAttempt.findUnique({
      select: { sessionId: true, speakerStreamId: true },
      where: { id: attemptId },
    });
    if (attempt === null) throw this.notFound();
    await this.assertGate(this.prisma, actor, attempt.sessionId);
    const replay = await this.replay(actor, input.request_id, attemptId, action);
    if (replay !== null) return replay;
    if (input.action === 'confirm') await this.assertObservedLabels(attemptId, input);
    try {
      const result = await this.runtimes.enqueueMarker(
        attempt.sessionId,
        attempt.speakerStreamId,
        Date.now() + MARKER_TIMEOUT_MS,
        async (runtime, remainingMs) => {
          const marker = await this.prisma.$transaction(
            (transaction) =>
              this.resolveInTransaction(transaction, actor, runtime, attemptId, input, action),
            { maxWait: remainingMs, timeout: remainingMs },
          );
          if (!marker.replayed) this.runtimes.publishCalibration(runtime, marker.snapshot);
          return marker;
        },
      );
      this.postSession?.notifyCalibration(attempt.sessionId);
      return result.snapshot;
    } catch (error) {
      throw this.mapMarkerError(error);
    }
  }

  private async beginInTransaction(
    transaction: Transaction,
    actor: AuthPrincipal,
    runtime: SessionRuntime,
    input: BeginSpeakerCalibrationRequest,
    action: string,
  ): Promise<MarkerResult> {
    await this.lock(transaction, input.request_id, runtime.sessionId);
    const replay = await this.replayInTransaction(
      transaction,
      actor,
      input.request_id,
      runtime.sessionId,
      action,
    );
    if (replay !== null) return { replayed: true, snapshot: replay };
    await this.assertGate(transaction, actor, runtime.sessionId);
    await this.assertCurrentStream(transaction, runtime);
    const latest = await transaction.speakerCalibrationAttempt.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { speakerStreamId: runtime.speakerStreamId },
    });
    if (latest === null || ['failed', 'skipped'].includes(latest.status)) {
      const sequence = runtime.nextAudioSequence;
      const attemptNo = await transaction.speakerCalibrationAttempt.count({
        where: { speakerStreamId: runtime.speakerStreamId },
      });
      await transaction.speakerCalibrationAttempt.create({
        data: {
          attemptNo: attemptNo + 1,
          audioStreamId: runtime.audioStreamId,
          captureGenerationId: runtime.captureGenerationId,
          sessionId: runtime.sessionId,
          speakerStreamId: runtime.speakerStreamId,
          startMs: runtime.timelineOffsetMs + sequence * 100,
          startSequenceNo: sequence,
          startedBy: actor.id,
          startedRequestId: input.request_id,
        },
      });
    }
    const snapshot = await this.snapshots.getWith(transaction, runtime.sessionId);
    await this.persistSuccess(
      transaction,
      actor,
      input.request_id,
      runtime.sessionId,
      action,
      snapshot,
      'speaker_calibration.begin',
    );
    return { replayed: false, snapshot };
  }

  private async resolveInTransaction(
    transaction: Transaction,
    actor: AuthPrincipal,
    runtime: SessionRuntime,
    attemptId: string,
    input: ResolveSpeakerCalibrationRequest,
    action: string,
  ): Promise<MarkerResult> {
    await this.lock(transaction, input.request_id, runtime.sessionId);
    const replay = await this.replayInTransaction(
      transaction,
      actor,
      input.request_id,
      attemptId,
      action,
    );
    if (replay !== null) return { replayed: true, snapshot: replay };
    await this.assertGate(transaction, actor, runtime.sessionId);
    await this.assertCurrentStream(transaction, runtime);
    const attempt = await transaction.speakerCalibrationAttempt.findUnique({
      where: { id: attemptId },
    });
    if (
      attempt === null ||
      attempt.sessionId !== runtime.sessionId ||
      attempt.speakerStreamId !== runtime.speakerStreamId ||
      attempt.status !== 'collecting'
    ) {
      throw this.conflict('SPEAKER_CALIBRATION_CONFLICT');
    }
    if (input.action === 'confirm') {
      await this.assertObservedLabels(attempt.id, input, transaction);
    }
    const endSequenceNo = runtime.nextAudioSequence;
    await transaction.speakerCalibrationAttempt.update({
      data: {
        endMs: runtime.timelineOffsetMs + endSequenceNo * 100,
        endSequenceNo,
        resolvedAt: new Date(),
        resolvedBy: actor.id,
        resolvedRequestId: input.request_id,
        status:
          input.action === 'confirm' ? 'confirmed' : input.action === 'fail' ? 'failed' : 'skipped',
      },
      where: { id: attempt.id },
    });
    if (input.action === 'confirm') {
      for (const mapping of input.mappings) {
        await transaction.speakerMapping.updateMany({
          data: { supersededAt: new Date() },
          where: {
            speakerProviderId: mapping.speaker_provider_id,
            speakerStreamId: runtime.speakerStreamId,
            supersededAt: null,
          },
        });
        await transaction.speakerMapping.create({
          data: {
            authority: 'user_confirmed',
            createdBy: actor.id,
            sessionId: runtime.sessionId,
            source: 'calibration',
            speakerProviderId: mapping.speaker_provider_id,
            speakerRole: mapping.speaker_role,
            speakerStreamId: runtime.speakerStreamId,
          },
        });
      }
      await transaction.interviewSession.update({
        data: { speakerRoleRevision: { increment: 1 } },
        where: { id: runtime.sessionId },
      });
    }
    const snapshot = await this.snapshots.getWith(transaction, runtime.sessionId);
    await this.persistSuccess(
      transaction,
      actor,
      input.request_id,
      attemptId,
      action,
      snapshot,
      `speaker_calibration.${input.action}`,
    );
    return { replayed: false, snapshot };
  }

  private async assertObservedLabels(
    attemptId: string,
    input: ResolveSpeakerCalibrationRequest,
    client: PrismaService | Transaction = this.prisma,
  ): Promise<void> {
    const mappings = input.mappings;
    const labels = new Set(mappings.map((mapping) => mapping.speaker_provider_id));
    const roles = new Set(mappings.map((mapping) => mapping.speaker_role));
    if (
      mappings.length !== 2 ||
      labels.size !== 2 ||
      roles.size !== 2 ||
      !roles.has('elder') ||
      !roles.has('interviewer')
    ) {
      throw this.conflict('SPEAKER_CALIBRATION_LABELS_INVALID');
    }
    const observed = await client.speakerCalibrationAttemptSegment.findMany({
      select: { transcriptSegment: { select: { speakerProviderId: true } } },
      where: { attemptId },
    });
    const observedLabels = new Set(
      observed.map(({ transcriptSegment }) => transcriptSegment.speakerProviderId),
    );
    if ([...labels].some((label) => !observedLabels.has(label))) {
      throw this.conflict('SPEAKER_CALIBRATION_LABELS_INVALID');
    }
  }

  private async assertGate(
    client: PrismaService | Transaction,
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<void> {
    const session = await client.interviewSession.findUnique({
      select: {
        status: true,
        project: {
          select: {
            assignments: { select: { userId: true }, where: { revokedAt: null } },
            consents: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { revokedAt: true, status: true },
              take: 1,
              where: { consentType: 'recording_transcription_ai' },
            },
            deletedAt: true,
            status: true,
          },
        },
      },
      where: { id: sessionId },
    });
    if (session === null || session.project.deletedAt !== null) throw this.notFound();
    const consent = session.project.consents[0];
    if (
      !session.project.assignments.some(({ userId }) => userId === actor.id) ||
      session.project.status !== 'active' ||
      consent?.status !== 'valid' ||
      consent.revokedAt !== null ||
      !['recording', 'reconnecting'].includes(session.status)
    ) {
      throw new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
    }
  }

  private async assertCurrentStream(
    transaction: Transaction,
    runtime: SessionRuntime,
  ): Promise<void> {
    const stream = await transaction.speakerStream.findFirst({
      select: { id: true },
      where: {
        id: runtime.speakerStreamId,
        sessionId: runtime.sessionId,
        status: 'active',
      },
    });
    if (stream === null) throw this.conflict('SPEAKER_STREAM_NOT_ACTIVE');
  }

  private async lock(
    transaction: Transaction,
    requestId: string,
    sessionId: string,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`;
  }

  private async replay(
    actor: AuthPrincipal,
    requestId: string,
    targetId: string,
    action: string,
  ): Promise<SpeakerCalibrationSnapshot | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({ where: { requestId } });
    return this.assertReplay(record, actor, targetId, action);
  }

  private async replayInTransaction(
    transaction: Transaction,
    actor: AuthPrincipal,
    requestId: string,
    targetId: string,
    action: string,
  ): Promise<SpeakerCalibrationSnapshot | null> {
    const record = await transaction.idempotencyRecord.findUnique({ where: { requestId } });
    return this.assertReplay(record, actor, targetId, action);
  }

  private assertReplay(
    record: {
      action: string;
      actorId: string;
      targetId: string | null;
      responsePayload: unknown;
    } | null,
    actor: AuthPrincipal,
    targetId: string,
    action: string,
  ): SpeakerCalibrationSnapshot | null {
    if (record === null) return null;
    if (record.action !== action || record.actorId !== actor.id || record.targetId !== targetId) {
      throw this.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
    }
    return record.responsePayload as SpeakerCalibrationSnapshot;
  }

  private async persistSuccess(
    transaction: Transaction,
    actor: AuthPrincipal,
    requestId: string,
    targetId: string,
    action: string,
    snapshot: SpeakerCalibrationSnapshot,
    auditAction: string,
  ): Promise<void> {
    await transaction.idempotencyRecord.create({
      data: {
        action,
        actorId: actor.id,
        requestId,
        responsePayload: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        targetId,
        targetType: 'speaker_calibration',
      },
    });
    await transaction.auditLog.create({
      data: {
        action: auditAction,
        actorId: actor.id,
        actorType: 'user',
        entityId: targetId,
        entityType: 'speaker_calibration',
        metadata: {
          speaker_stream_id: snapshot.speaker_stream?.id ?? null,
          status: snapshot.status,
        },
        requestId,
      },
    });
  }

  private mapMarkerError(error: unknown): Error {
    if (error instanceof CausalQueueTimeoutError || isTransactionTimeout(error)) {
      return this.conflict('SPEAKER_CALIBRATION_BOUNDARY_TIMEOUT');
    }
    if (error instanceof CausalQueueUnavailableError) {
      return this.conflict('SPEAKER_CALIBRATION_STREAM_UNAVAILABLE');
    }
    return error instanceof Error ? error : new Error('Speaker calibration failed');
  }

  private conflict(code: string): ConflictException {
    return new ConflictException({ code, details: {}, message: 'Speaker calibration conflict' });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }
}

interface MarkerResult {
  replayed: boolean;
  snapshot: SpeakerCalibrationSnapshot;
}

function actionIdentity(prefix: string, input: object): string {
  const canonical = stableJson(input);
  return `${prefix}:${createHash('sha256').update(canonical).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isTransactionTimeout(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
}
