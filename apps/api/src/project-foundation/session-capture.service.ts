import type {
  AbandonEmptyCaptureRequest,
  ConfirmCaptureActiveRequest,
  InterviewSessionResponse,
  ReportCaptureInterruptedRequest,
  ResumeCaptureRequest,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  InterviewSession,
  Prisma,
  SessionCaptureGeneration,
} from '../generated/prisma/client.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { SessionSnapshotService } from './session-snapshot.service.js';

@Injectable()
export class SessionCaptureService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: ResourceAuthorizationService,
    private readonly runtime: RealtimeRuntimeService,
    private readonly snapshots: SessionSnapshotService,
  ) {}

  public async confirmActive(
    actor: AuthPrincipal,
    sessionId: string,
    input: ConfirmCaptureActiveRequest,
  ): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockCapture(tx, input.request_id, sessionId);
      const replay = await this.replay(
        tx,
        input.request_id,
        'interview_session.capture.confirm',
        actor,
        sessionId,
      );
      if (replay !== null) {
        this.assertReplayMetadata(replay.metadata, {
          audio_stream_id: input.audio_stream_id,
          generation_no: input.generation_no,
        });
        return replay.snapshot;
      }
      await this.assertCurrentGate(tx, actor, locked.session.projectId);
      if (
        locked.capture.generationNo !== input.generation_no ||
        locked.capture.audioStreamId !== input.audio_stream_id
      ) {
        throw this.conflict('CAPTURE_GENERATION_CONFLICT');
      }
      if (locked.capture.status === 'preparing') {
        if (!['recording', 'reconnecting'].includes(locked.session.status)) {
          throw this.conflict('CAPTURE_NOT_CONFIRMABLE');
        }
        const now = new Date();
        await tx.sessionCaptureGeneration.update({
          data: { confirmedActiveAt: now, status: 'active' },
          where: { id: locked.capture.id },
        });
        if (locked.session.status === 'reconnecting') {
          await tx.interviewSession.update({
            data: { status: 'recording' },
            where: { id: sessionId },
          });
        }
      } else if (locked.capture.status !== 'active') {
        throw this.conflict('CAPTURE_NOT_CONFIRMABLE');
      }
      await this.audit(
        tx,
        'interview_session.capture.confirm',
        actor.id,
        sessionId,
        input.request_id,
        {
          audio_stream_id: input.audio_stream_id,
          generation_no: input.generation_no,
        },
      );
      const snapshot = await this.snapshots.read(sessionId, tx);
      await this.writeReplay(
        tx,
        input.request_id,
        'interview_session.capture.confirm',
        actor,
        sessionId,
        snapshot,
      );
      return snapshot;
    });
  }

  public async reportInterrupted(
    actor: AuthPrincipal,
    sessionId: string,
    input: ReportCaptureInterruptedRequest,
  ): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const snapshot = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockCapture(tx, input.request_id, sessionId);
      const replay = await this.replay(
        tx,
        input.request_id,
        'interview_session.capture.interrupted',
        actor,
        sessionId,
      );
      if (replay !== null) {
        this.assertReplayMetadata(replay.metadata, {
          audio_stream_id: input.audio_stream_id,
          generation_no: input.generation_no,
          reason: input.reason,
        });
        return replay.snapshot;
      }
      this.assertOriginalActor(actor, locked.session.createdBy);
      if (
        locked.capture.generationNo !== input.generation_no ||
        locked.capture.audioStreamId !== input.audio_stream_id
      ) {
        throw this.conflict('CAPTURE_GENERATION_CONFLICT');
      }
      const finalization = await tx.sessionFinalization.findUnique({ where: { sessionId } });
      const terminalOrFrozen =
        finalization !== null ||
        ['stopping', 'processing', 'completed', 'failed'].includes(locked.session.status);
      if (!terminalOrFrozen && ['preparing', 'active'].includes(locked.capture.status)) {
        const now = new Date();
        await tx.sessionCaptureGeneration.update({
          data: { interruptedAt: now, interruptionReason: input.reason, status: 'interrupted' },
          where: { id: locked.capture.id },
        });
        await tx.interviewSession.update({
          data: { status: 'interrupted' },
          where: { id: sessionId },
        });
      } else if (!terminalOrFrozen && locked.capture.status !== 'interrupted') {
        throw this.conflict('CAPTURE_NOT_INTERRUPTIBLE');
      }
      await this.audit(
        tx,
        'interview_session.capture.interrupted',
        actor.id,
        sessionId,
        input.request_id,
        {
          audio_stream_id: input.audio_stream_id,
          generation_no: input.generation_no,
          reason: input.reason,
        },
      );
      const current = await this.snapshots.read(sessionId, tx);
      await this.writeReplay(
        tx,
        input.request_id,
        'interview_session.capture.interrupted',
        actor,
        sessionId,
        current,
      );
      return current;
    });
    this.runtime.interruptCapture(sessionId, input.audio_stream_id);
    return snapshot;
  }

  public async abandonEmpty(
    actor: AuthPrincipal,
    sessionId: string,
    input: AbandonEmptyCaptureRequest,
  ): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const snapshot = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockCapture(tx, input.request_id, sessionId);
      const replay = await this.replay(
        tx,
        input.request_id,
        'interview_session.capture.abandon_empty',
        actor,
        sessionId,
      );
      if (replay !== null) {
        this.assertReplayMetadata(replay.metadata, {
          audio_stream_id: input.audio_stream_id,
          generation_no: input.generation_no,
          local_archive_chunk_count: input.local_archive_chunk_count,
        });
        return replay.snapshot;
      }
      await this.assertCurrentGate(tx, actor, locked.session.projectId);
      if (
        locked.session.status !== 'interrupted' ||
        locked.capture.status !== 'interrupted' ||
        locked.capture.generationNo !== input.generation_no ||
        locked.capture.audioStreamId !== input.audio_stream_id
      ) {
        throw this.conflict('CAPTURE_NOT_ABANDONABLE');
      }
      const [acceptedPcmGeneration, finalization, storedChunks] = await Promise.all([
        tx.sessionCaptureGeneration.findFirst({
          select: { id: true },
          where: { firstPcmAcceptedAt: { not: null }, sessionId },
        }),
        tx.sessionFinalization.findUnique({ where: { sessionId } }),
        tx.audioChunk.count({ where: { audioObjectId: locked.capture.audioObjectId } }),
      ]);
      if (acceptedPcmGeneration !== null || finalization !== null || storedChunks !== 0) {
        throw this.conflict('CAPTURE_EVIDENCE_EXISTS');
      }
      const now = new Date();
      await tx.sessionCaptureGeneration.update({
        data: { status: 'abandoned_empty', stoppedAt: now },
        where: { id: locked.capture.id },
      });
      await tx.audioObject.update({
        data: { status: 'failed' },
        where: { id: locked.capture.audioObjectId },
      });
      await tx.interviewSession.update({
        data: { captureFailureCode: 'NO_AUDIO_CAPTURED', status: 'failed' },
        where: { id: sessionId },
      });
      await this.audit(
        tx,
        'interview_session.capture.abandon_empty',
        actor.id,
        sessionId,
        input.request_id,
        {
          audio_stream_id: input.audio_stream_id,
          generation_no: input.generation_no,
          local_archive_chunk_count: input.local_archive_chunk_count,
        },
      );
      const current = await this.snapshots.read(sessionId, tx);
      await this.writeReplay(
        tx,
        input.request_id,
        'interview_session.capture.abandon_empty',
        actor,
        sessionId,
        current,
      );
      return current;
    });
    this.runtime.interruptCapture(sessionId, input.audio_stream_id);
    return snapshot;
  }

  public async resume(
    actor: AuthPrincipal,
    sessionId: string,
    input: ResumeCaptureRequest,
  ): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${input.request_id}`);
      const location = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (location === null) throw this.notFound();
      await this.lock(tx, `project:${location.projectId}`);
      await this.lock(tx, `session:${sessionId}`);
      const capture = await tx.sessionCaptureGeneration.findFirst({
        orderBy: { generationNo: 'desc' },
        where: { sessionId },
      });
      if (capture === null) throw this.conflict('SESSION_NOT_RECOVERABLE');
      await this.lock(tx, `audio:${capture.audioObjectId}`);
      const replay = await this.replay(
        tx,
        input.request_id,
        'interview_session.capture.resume',
        actor,
        sessionId,
      );
      if (replay !== null) {
        this.assertReplayMetadata(replay.metadata, {
          audio_stream_id: input.audio_stream_id,
          local_archive_chunk_count: input.local_archive_chunk_count,
          local_archive_timeline_high_water_ms: input.local_archive_timeline_high_water_ms,
        });
        return replay.snapshot;
      }
      const session = await tx.interviewSession.findUniqueOrThrow({ where: { id: sessionId } });
      const finalization = await tx.sessionFinalization.findUnique({ where: { sessionId } });
      if (
        finalization !== null ||
        session.status !== 'interrupted' ||
        capture.status !== 'interrupted'
      ) {
        throw this.conflict('SESSION_NOT_RECOVERABLE');
      }
      await this.assertCurrentGate(tx, actor, session.projectId);
      const uploaded = await tx.audioChunk.findMany({
        orderBy: { sequenceNo: 'asc' },
        where: { audioObjectId: capture.audioObjectId, uploadStatus: 'uploaded' },
      });
      const serverHighWater = uploaded.reduce(
        (highest, chunk) => Math.max(highest, chunk.endMs),
        0,
      );
      if (
        input.local_archive_chunk_count < uploaded.length ||
        input.local_archive_timeline_high_water_ms < serverHighWater ||
        input.local_archive_timeline_high_water_ms < capture.timelineOffsetMs
      ) {
        throw this.conflict('CAPTURE_ARCHIVE_CONFLICT');
      }
      const next = await tx.sessionCaptureGeneration.create({
        data: {
          audioObjectId: capture.audioObjectId,
          audioStreamId: input.audio_stream_id,
          generationNo: capture.generationNo + 1,
          sessionId,
          timelineOffsetMs: input.local_archive_timeline_high_water_ms,
        },
      });
      await tx.interviewSession.update({
        data: { status: 'reconnecting' },
        where: { id: sessionId },
      });
      await this.audit(
        tx,
        'interview_session.capture.resume',
        actor.id,
        sessionId,
        input.request_id,
        {
          audio_stream_id: input.audio_stream_id,
          generation_no: next.generationNo,
          local_archive_chunk_count: input.local_archive_chunk_count,
          local_archive_timeline_high_water_ms: input.local_archive_timeline_high_water_ms,
          timeline_offset_ms: next.timelineOffsetMs,
        },
      );
      const snapshot = await this.snapshots.read(sessionId, tx);
      await this.writeReplay(
        tx,
        input.request_id,
        'interview_session.capture.resume',
        actor,
        sessionId,
        snapshot,
      );
      return snapshot;
    });
  }

  private async lockCapture(
    tx: Prisma.TransactionClient,
    requestId: string,
    sessionId: string,
  ): Promise<{ capture: SessionCaptureGeneration; session: InterviewSession }> {
    await this.lock(tx, `request:${requestId}`);
    const session = await tx.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null) throw this.notFound();
    await this.lock(tx, `project:${session.projectId}`);
    await this.lock(tx, `session:${sessionId}`);
    const capture = await tx.sessionCaptureGeneration.findFirst({
      orderBy: { generationNo: 'desc' },
      where: { sessionId },
    });
    if (capture === null) throw this.conflict('CAPTURE_NOT_INITIALIZED');
    await this.lock(tx, `audio:${capture.audioObjectId}`);
    return { capture, session };
  }

  private async assertCurrentGate(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<void> {
    const [project, assignment, consent] = await Promise.all([
      tx.elderProject.findUnique({ where: { id: projectId } }),
      tx.projectAssignment.findFirst({ where: { projectId, revokedAt: null, userId: actor.id } }),
      tx.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId },
      }),
    ]);
    if (
      actor.status !== 'active' ||
      project === null ||
      project.deletedAt !== null ||
      !['ready', 'active'].includes(project.status) ||
      assignment === null ||
      consent?.status !== 'valid' ||
      consent.revokedAt !== null ||
      consent.consentTextVersion !== 'mvp-v1'
    ) {
      throw this.forbidden();
    }
  }

  private assertOriginalActor(actor: AuthPrincipal, createdBy: string): void {
    if (actor.status !== 'active' || actor.id !== createdBy) throw this.forbidden();
  }

  private async replay(
    tx: Prisma.TransactionClient,
    requestId: string,
    action: string,
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<{ metadata: Prisma.JsonValue; snapshot: InterviewSessionResponse } | null> {
    const record = await tx.idempotencyRecord.findUnique({ where: { requestId } });
    if (record === null) return null;
    if (
      record.action !== action ||
      record.actorId !== actor.id ||
      record.targetId !== sessionId ||
      record.targetType !== 'interview_session'
    ) {
      throw this.conflict('IDEMPOTENCY_KEY_REUSED');
    }
    const audit = await tx.auditLog.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { metadata: true },
      where: { action, entityId: sessionId, requestId },
    });
    if (audit === null) throw this.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
    return {
      metadata: audit.metadata,
      snapshot: record.responsePayload as unknown as InterviewSessionResponse,
    };
  }

  private assertReplayMetadata(
    metadata: Prisma.JsonValue,
    expected: Record<string, string | number>,
  ): void {
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata) ||
      Object.entries(expected).some(([key, value]) => metadata[key] !== value)
    ) {
      throw this.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
    }
  }

  private async writeReplay(
    tx: Prisma.TransactionClient,
    requestId: string,
    action: string,
    actor: AuthPrincipal,
    sessionId: string,
    snapshot: InterviewSessionResponse,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        action,
        actorId: actor.id,
        requestId,
        responsePayload: snapshot as unknown as Prisma.InputJsonValue,
        targetId: sessionId,
        targetType: 'interview_session',
      },
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    action: string,
    actorId: string,
    sessionId: string,
    requestId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action,
        actorId,
        actorType: 'user',
        entityId: sessionId,
        entityType: 'interview_session',
        metadata,
        requestId,
      },
    });
  }

  private async lock(tx: Prisma.TransactionClient, value: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))`;
  }

  private conflict(code: string): ConflictException {
    return new ConflictException({
      code,
      details: {},
      message: 'Capture state conflicts with request',
    });
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }
}
