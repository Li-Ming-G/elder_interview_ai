import { createHash } from 'node:crypto';

import type {
  EvidenceFinalizationResponse,
  InterviewSessionResponse,
  RecoverSessionRequest,
  SessionChunkCommitment,
  StopSessionRequest,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { canonicalAudioManifestChecksum } from '../audio/audio-manifest.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AudioChunk,
  AudioObject,
  Prisma,
  SessionFinalizationChunk,
} from '../generated/prisma/client.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { mapAsrResultToSessionTimeline } from '../realtime-transcription/asr-timeline.js';
import { StreamingAsrAdapter } from '../realtime-transcription/streaming-asr.js';
import { TranscriptIngestionService } from '../transcription/transcript-ingestion.service.js';
import { SessionSnapshotService } from './session-snapshot.service.js';
import { PostSessionCoordinationService } from './post-session-coordination.service.js';

type FinalizationRecoveryRequest = Exclude<RecoverSessionRequest, { action: 'resume_capture' }>;

@Injectable()
export class SessionFinalizationService {
  private readonly advances = new Map<string, Promise<void>>();

  public constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: ResourceAuthorizationService,
    private readonly runtime: RealtimeRuntimeService,
    private readonly adapter: StreamingAsrAdapter,
    private readonly ingestion: TranscriptIngestionService,
    private readonly snapshots: SessionSnapshotService,
    @Optional() private readonly postSession?: PostSessionCoordinationService,
  ) {}

  public async stop(
    actor: AuthPrincipal,
    sessionId: string,
    input: StopSessionRequest,
  ): Promise<InterviewSessionResponse> {
    return this.freeze(actor, sessionId, input, false);
  }

  public async recover(
    actor: AuthPrincipal,
    sessionId: string,
    input: FinalizationRecoveryRequest,
  ): Promise<InterviewSessionResponse | EvidenceFinalizationResponse> {
    if (input.action === 'finalize_interrupted') return this.freeze(actor, sessionId, input, true);
    await this.authorization.assertRole(actor, ['interviewer']);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${input.request_id}`);
      const location = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (location === null) throw this.notFound();
      await this.lockResources(tx, location.projectId, sessionId);
      const replay = await tx.idempotencyRecord.findUnique({
        where: { requestId: input.request_id },
      });
      const action = `interview_session.recover:${input.action}`;
      const session = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (session === null) throw this.notFound();
      const finalization = await tx.sessionFinalization.findUnique({ where: { sessionId } });
      if (['recording', 'reconnecting'].includes(session.status))
        throw this.conflict('SESSION_RECOVERY_NOT_REQUIRED');
      if (finalization === null) throw this.conflict('SESSION_NOT_RECOVERABLE');
      const ordinaryAccess = await this.hasOrdinaryAccess(tx, actor.id, session.projectId);
      if (replay !== null) {
        if (
          replay.action !== action ||
          replay.actorId !== actor.id ||
          replay.targetId !== sessionId ||
          replay.targetType !== 'interview_session'
        )
          throw this.conflict('IDEMPOTENCY_KEY_REUSED');
        if (ordinaryAccess)
          return { snapshot: replay.responsePayload as unknown as InterviewSessionResponse };
        this.assertFinalizationActor(actor, finalization.createdBy);
        return { snapshot: await this.evidenceSnapshot(tx, actor, sessionId) };
      }
      this.assertFinalizationActor(actor, finalization.createdBy);
      return {
        action,
        finalizationId: finalization.id,
      };
    });
    if (!('finalizationId' in result)) return result.snapshot;
    await this.advance(result.finalizationId);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${input.request_id}`);
      const replay = await tx.idempotencyRecord.findUnique({
        where: { requestId: input.request_id },
      });
      const session = await tx.interviewSession.findUnique({
        select: { projectId: true },
        where: { id: sessionId },
      });
      if (session === null) throw this.notFound();
      const ordinaryAccess = await this.hasOrdinaryAccess(tx, actor.id, session.projectId);
      if (replay !== null) {
        if (
          replay.action !== `interview_session.recover:${input.action}` ||
          replay.actorId !== actor.id ||
          replay.targetId !== sessionId ||
          replay.targetType !== 'interview_session'
        ) {
          throw this.conflict('IDEMPOTENCY_KEY_REUSED');
        }
        return ordinaryAccess
          ? (replay.responsePayload as unknown as InterviewSessionResponse)
          : this.evidenceSnapshot(tx, actor, sessionId);
      }
      const snapshot = ordinaryAccess
        ? await this.snapshot(tx, sessionId)
        : await this.evidenceSnapshot(tx, actor, sessionId);
      await this.writeRecoveryIdempotency(
        tx,
        input.request_id,
        `interview_session.recover:${input.action}`,
        actor.id,
        sessionId,
        snapshot,
      );
      return snapshot;
    });
  }

  public async get(actor: AuthPrincipal, sessionId: string): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const session = await this.prisma.interviewSession.findUnique({
      include: { project: true },
      where: { id: sessionId },
    });
    if (session === null) throw this.notFound();
    if (session.project.deletedAt !== null || session.project.status === 'deleted')
      throw this.notFound();
    if (!(await this.hasOrdinaryAccess(this.prisma, actor.id, session.projectId)))
      throw this.forbidden();
    return this.snapshot(this.prisma, sessionId);
  }

  public async getEvidenceFinalization(
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<EvidenceFinalizationResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    return this.evidenceSnapshot(this.prisma, actor, sessionId);
  }

  private async freeze(
    actor: AuthPrincipal,
    sessionId: string,
    input: StopSessionRequest,
    interrupted: boolean,
  ): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    this.validateCommitments(input);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${input.request_id}`);
      const location = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (location === null) throw this.notFound();
      await this.lockResources(tx, location.projectId, sessionId, input.audio_object_id);
      const session = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (session === null) throw this.notFound();
      const existing = await tx.sessionFinalization.findUnique({
        include: { chunks: { orderBy: { sequenceNo: 'asc' } } },
        where: { sessionId },
      });
      const replay = await tx.idempotencyRecord.findUnique({
        where: { requestId: input.request_id },
      });
      if (replay !== null) {
        const expectedAction = interrupted
          ? 'interview_session.finalize_interrupted'
          : 'interview_session.stop';
        if (
          replay.action !== expectedAction ||
          replay.actorId !== actor.id ||
          replay.targetId !== sessionId ||
          replay.targetType !== 'interview_session'
        )
          throw this.conflict('IDEMPOTENCY_KEY_REUSED');
        if (
          existing === null ||
          existing.audioObjectId !== input.audio_object_id ||
          existing.expectedChunkCount !== input.expected_chunk_count ||
          existing.commitmentsChecksum !== commitmentChecksum(input.chunks)
        )
          throw this.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
        return {
          denied: false as const,
          snapshot: replay.responsePayload as unknown as InterviewSessionResponse,
        };
      }
      if (existing !== null) {
        this.assertFrozenMatches(
          existing.audioObjectId,
          existing.expectedChunkCount,
          existing.commitmentsChecksum,
          input,
        );
        this.assertFinalizationActor(actor, existing.createdBy);
        const snapshot = await this.snapshot(tx, sessionId);
        await this.writeStopIdempotency(
          tx,
          input.request_id,
          interrupted,
          actor.id,
          sessionId,
          snapshot,
        );
        return { denied: false as const, finalizationId: existing.id, snapshot };
      }
      const gate = await this.currentGate(tx, actor, session.projectId);
      if (!gate) {
        await tx.interviewSession.updateMany({
          data: { status: 'interrupted' },
          where: { id: sessionId, status: { in: ['recording', 'reconnecting'] } },
        });
        return { denied: true as const };
      }
      const legal = interrupted
        ? session.status === 'interrupted'
        : ['recording', 'reconnecting'].includes(session.status);
      if (!legal) throw this.conflict('SESSION_NOT_STOPPABLE');
      const object = await tx.audioObject.findUnique({ where: { id: input.audio_object_id } });
      if (
        object === null ||
        object.projectId !== session.projectId ||
        object.sessionId !== sessionId ||
        object.purpose !== 'interview' ||
        object.createdBy !== actor.id
      ) {
        return { denied: true as const };
      }
      const uploaded = await tx.audioChunk.findMany({ where: { audioObjectId: object.id } });
      for (const chunk of uploaded) {
        const commitment = input.chunks[chunk.sequenceNo];
        if (commitment === undefined || !sameChunk(chunk, commitment))
          throw this.conflict('AUDIO_COMMITMENT_CONFLICT');
      }
      const last = input.chunks.at(-1);
      if (last === undefined || session.startedAt === null)
        throw this.conflict('SESSION_NOT_STOPPABLE');
      const captureEndedAt = new Date(session.startedAt.getTime() + last.end_ms);
      const finalization = await tx.sessionFinalization.create({
        data: {
          asrLastAudioSequenceAccepted:
            this.runtime.find(sessionId)?.highestAudioSequenceAcked ?? null,
          audioObjectId: object.id,
          captureEndedAt,
          commitmentsChecksum: commitmentChecksum(input.chunks),
          createdBy: actor.id,
          expectedChunkCount: input.expected_chunk_count,
          sessionId,
          stopRequestId: input.request_id,
          chunks: {
            createMany: {
              data: input.chunks.map((chunk) => ({
                checksum: chunk.checksum,
                endMs: chunk.end_ms,
                mimeType: chunk.mime_type,
                sequenceNo: chunk.sequence_no,
                sizeBytes: chunk.size_bytes,
                startMs: chunk.start_ms,
              })),
            },
          },
        },
      });
      await tx.interviewSession.update({
        data: {
          durationSeconds: Math.ceil(last.end_ms / 1000),
          endedAt: captureEndedAt,
          status: 'stopping',
        },
        where: { id: sessionId },
      });
      await tx.sessionCaptureGeneration.updateMany({
        data: { status: 'stopped', stoppedAt: captureEndedAt },
        where: {
          audioObjectId: object.id,
          sessionId,
          status: { in: ['preparing', 'active'] },
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'interview_session.stop',
          actorId: actor.id,
          actorType: 'user',
          entityId: sessionId,
          entityType: 'interview_session',
          metadata: {
            audio_object_id: object.id,
            expected_chunk_count: input.expected_chunk_count,
          },
          requestId: input.request_id,
        },
      });
      const snapshot = await this.snapshot(tx, sessionId);
      await this.writeStopIdempotency(
        tx,
        input.request_id,
        interrupted,
        actor.id,
        sessionId,
        snapshot,
      );
      return { denied: false as const, finalizationId: finalization.id, snapshot };
    });
    if (outcome.denied) throw this.forbidden();
    this.runtime.interruptSession(sessionId);
    if ('finalizationId' in outcome) await this.advance(outcome.finalizationId);
    return outcome.snapshot;
  }

  public advance(finalizationId: string): Promise<void> {
    const existing = this.advances.get(finalizationId);
    if (existing !== undefined) return existing;
    const running = this.advanceOnce(finalizationId);
    this.advances.set(finalizationId, running);
    void running
      .finally(() => {
        this.postSession?.notifyFinalization(finalizationId);
        if (this.advances.get(finalizationId) === running) this.advances.delete(finalizationId);
      })
      .catch(() => undefined);
    return running;
  }

  private async advanceOnce(finalizationId: string): Promise<void> {
    const prepared = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.sessionFinalization.findUniqueOrThrow({
        where: { id: finalizationId },
      });
      const session = await tx.interviewSession.findUniqueOrThrow({
        where: { id: initial.sessionId },
      });
      await this.lockResources(tx, session.projectId, session.id, initial.audioObjectId);
      const f = await tx.sessionFinalization.findUniqueOrThrow({ where: { id: finalizationId } });
      const currentSession = await tx.interviewSession.findUniqueOrThrow({
        where: { id: f.sessionId },
      });
      if (currentSession.status === 'completed' || currentSession.status === 'failed') return null;
      const object = await tx.audioObject.findUniqueOrThrow({ where: { id: f.audioObjectId } });
      const [chunks, commitments] = await Promise.all([
        tx.audioChunk.findMany({
          orderBy: { sequenceNo: 'asc' },
          where: { audioObjectId: object.id },
        }),
        tx.sessionFinalizationChunk.findMany({
          orderBy: { sequenceNo: 'asc' },
          where: { sessionFinalizationId: f.id },
        }),
      ]);
      if (!this.completeManifestMatches(object, chunks, commitments, f.expectedChunkCount))
        return null;
      const now = new Date();
      const activeRuntime = this.runtime.find(f.sessionId);
      const runtimeAccepted = activeRuntime?.highestAudioSequenceAcked ?? null;
      const accepted = Math.max(runtimeAccepted ?? -1, f.asrLastAudioSequenceAccepted ?? -1);
      if (f.transcriptStatus !== 'pending' && f.transcriptStatus !== 'draining') {
        await this.completeTerminal(tx, f.id, f.sessionId, now);
        return null;
      }
      if (activeRuntime === null || runtimeAccepted === null || runtimeAccepted < 0) {
        await tx.sessionFinalization.update({
          data: {
            audioStatus: 'complete',
            asrLastAudioSequenceAccepted: accepted < 0 ? null : accepted,
            processingStartedAt: f.processingStartedAt ?? now,
            transcriptErrorCode: accepted < 0 ? null : 'ASR_DRAIN_INCOMPLETE',
            transcriptStatus: accepted < 0 ? 'not_started' : 'degraded',
          },
          where: { id: f.id },
        });
        await this.completeTerminal(tx, f.id, f.sessionId, now);
        return null;
      }
      await tx.sessionFinalization.update({
        data: {
          audioStatus: 'complete',
          asrLastAudioSequenceAccepted: accepted,
          processingStartedAt: f.processingStartedAt ?? now,
          transcriptErrorCode: null,
          transcriptStatus: 'draining',
        },
        where: { id: f.id },
      });
      await tx.interviewSession.update({
        data: { status: 'processing' },
        where: { id: f.sessionId },
      });
      return {
        accepted,
        sessionId: f.sessionId,
        speakerStreamId: activeRuntime.speakerStreamId,
        timelineOffsetMs: activeRuntime.timelineOffsetMs,
      };
    });
    if (prepared === null) return;

    let drained = false;
    try {
      await withTimeout(
        this.adapter.drainAndClose({
          ingestFinal: async (result) => {
            if (result.kind !== 'final' || result.sessionId !== prepared.sessionId)
              throw new Error('ASR_DRAIN_INVALID_FINAL');
            await this.ingestion.ingest({
              ...mapAsrResultToSessionTimeline(result, prepared.timelineOffsetMs),
              speakerStreamId: prepared.speakerStreamId,
            });
          },
          lastAudioSequenceAccepted: prepared.accepted,
          sessionId: prepared.sessionId,
        }),
        1_000,
      );
      drained = true;
    } catch {
      drained = false;
    }
    await this.prisma.$transaction(async (tx) => {
      const f = await tx.sessionFinalization.findUniqueOrThrow({ where: { id: finalizationId } });
      const session = await tx.interviewSession.findUniqueOrThrow({ where: { id: f.sessionId } });
      await this.lockResources(tx, session.projectId, session.id, f.audioObjectId);
      const current = await tx.interviewSession.findUniqueOrThrow({ where: { id: f.sessionId } });
      if (current.status === 'completed' || current.status === 'failed') return;
      const now = new Date();
      await tx.sessionFinalization.update({
        data: {
          asrDrainCompletedAt: drained ? now : null,
          transcriptErrorCode: drained ? null : 'ASR_DRAIN_INCOMPLETE',
          transcriptStatus: drained ? 'drained' : 'degraded',
        },
        where: { id: f.id },
      });
      await this.completeTerminal(tx, f.id, f.sessionId, now);
    });
  }

  private async snapshot(
    db: Prisma.TransactionClient | PrismaService,
    sessionId: string,
  ): Promise<InterviewSessionResponse> {
    return this.snapshots.read(sessionId, db);
  }

  private async hasOrdinaryAccess(
    db: Prisma.TransactionClient | PrismaService,
    actorId: string,
    projectId: string,
  ): Promise<boolean> {
    const [project, assignment] = await Promise.all([
      db.elderProject.findUnique({
        select: { deletedAt: true, status: true },
        where: { id: projectId },
      }),
      db.projectAssignment.findFirst({
        select: { id: true },
        where: { projectId, revokedAt: null, userId: actorId },
      }),
    ]);
    return (
      project !== null &&
      project.deletedAt === null &&
      !['restricted', 'deleted'].includes(project.status) &&
      assignment !== null
    );
  }

  private async evidenceSnapshot(
    db: Prisma.TransactionClient | PrismaService,
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<EvidenceFinalizationResponse> {
    const finalization = await db.sessionFinalization.findUnique({
      include: { audioObject: { select: { manifestChecksum: true } }, session: true },
      where: { sessionId },
    });
    if (
      finalization === null ||
      finalization.createdBy !== actor.id ||
      !['stopping', 'processing', 'completed', 'failed'].includes(finalization.session.status)
    ) {
      throw this.notFound();
    }
    const [uploadedChunkCount, capture] = await Promise.all([
      db.audioChunk.count({
        where: { audioObjectId: finalization.audioObjectId, uploadStatus: 'uploaded' },
      }),
      db.sessionCaptureGeneration.findFirst({
        orderBy: { generationNo: 'desc' },
        select: { status: true },
        where: { sessionId },
      }),
    ]);
    const response: EvidenceFinalizationResponse = {
      audio_object_id: finalization.audioObjectId,
      expected_chunk_count: finalization.expectedChunkCount,
      failure_code: evidenceFailureCode(finalization.failureCode),
      manifest_checksum:
        finalization.audioStatus === 'complete' ? finalization.audioObject.manifestChecksum : null,
      recording_status:
        capture?.status === 'interrupted'
          ? 'interrupted'
          : capture?.status === 'active'
            ? 'recording'
            : 'stopped',
      session_id: sessionId,
      session_status: finalization.session.status as EvidenceFinalizationResponse['session_status'],
      upload_status: finalization.audioStatus,
      uploaded_chunk_count: uploadedChunkCount,
    };
    await db.auditLog.create({
      data: {
        action: 'evidence_finalization.read',
        actorId: actor.id,
        actorType: 'user',
        entityId: sessionId,
        entityType: 'interview_session',
        metadata: {},
      },
    });
    return response;
  }

  private validateCommitments(input: StopSessionRequest): void {
    if (
      !Number.isSafeInteger(input.expected_chunk_count) ||
      input.expected_chunk_count <= 0 ||
      input.chunks.length !== input.expected_chunk_count
    )
      throw this.validationConflict();
    input.chunks.forEach((c, i) => {
      if (
        c.sequence_no !== i ||
        c.start_ms < 0 ||
        c.end_ms <= c.start_ms ||
        c.size_bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(c.checksum) ||
        c.mime_type.length === 0 ||
        (i === 0 ? c.start_ms !== 0 : c.start_ms !== input.chunks.at(i - 1)?.end_ms)
      )
        throw this.validationConflict();
    });
  }
  private assertFrozenMatches(
    audioId: string,
    count: number,
    checksum: string,
    input: StopSessionRequest,
  ): void {
    if (
      audioId !== input.audio_object_id ||
      count !== input.expected_chunk_count ||
      checksum !== commitmentChecksum(input.chunks)
    )
      throw this.conflict('SESSION_STOP_CONFLICT');
  }
  private async currentGate(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<boolean> {
    const [project, assignment, consent] = await Promise.all([
      tx.elderProject.findUnique({ where: { id: projectId } }),
      tx.projectAssignment.findFirst({ where: { projectId, revokedAt: null, userId: actor.id } }),
      tx.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId },
      }),
    ]);
    return (
      project !== null &&
      project.deletedAt === null &&
      !['restricted', 'deleted'].includes(project.status) &&
      assignment !== null &&
      consent?.status === 'valid' &&
      consent.revokedAt === null
    );
  }
  private async assertCurrentGate(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<void> {
    if (!(await this.currentGate(tx, actor, projectId))) throw this.forbidden();
  }
  private assertFinalizationActor(actor: AuthPrincipal, createdBy: string): void {
    if (actor.status !== 'active' || actor.id !== createdBy) throw this.forbidden();
  }
  private async lock(tx: Prisma.TransactionClient, value: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))`;
  }
  private async lockResources(
    tx: Prisma.TransactionClient,
    projectId: string,
    sessionId?: string,
    audioObjectId?: string,
  ): Promise<void> {
    await this.lock(tx, `project:${projectId}`);
    if (sessionId !== undefined) await this.lock(tx, `session:${sessionId}`);
    if (audioObjectId !== undefined) await this.lock(tx, `audio:${audioObjectId}`);
  }
  private completeManifestMatches(
    object: AudioObject,
    chunks: AudioChunk[],
    commitments: SessionFinalizationChunk[],
    expectedCount: number,
  ): boolean {
    return (
      object.status === 'complete' &&
      object.chunkCount === expectedCount &&
      object.manifestChecksum === canonicalAudioManifestChecksum(chunks) &&
      chunks.length === expectedCount &&
      commitments.length === expectedCount &&
      chunks.every(
        (chunk, index) =>
          chunk.uploadStatus === 'uploaded' &&
          commitments[index] !== undefined &&
          sameChunk(chunk, {
            checksum: commitments[index].checksum,
            end_ms: commitments[index].endMs,
            mime_type: commitments[index].mimeType,
            sequence_no: commitments[index].sequenceNo,
            size_bytes: commitments[index].sizeBytes,
            start_ms: commitments[index].startMs,
          }),
      )
    );
  }
  private async completeTerminal(
    tx: Prisma.TransactionClient,
    finalizationId: string,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await tx.sessionFinalization.updateMany({
      data: { completedAt: now },
      where: { completedAt: null, id: finalizationId },
    });
    await tx.interviewSession.updateMany({
      data: { status: 'completed' },
      where: { id: sessionId, status: { notIn: ['completed', 'failed'] } },
    });
  }
  private async writeStopIdempotency(
    tx: Prisma.TransactionClient,
    requestId: string,
    interrupted: boolean,
    actorId: string,
    sessionId: string,
    snapshot: InterviewSessionResponse,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        action: interrupted ? 'interview_session.finalize_interrupted' : 'interview_session.stop',
        actorId,
        requestId,
        responsePayload: snapshot as unknown as Prisma.InputJsonValue,
        targetId: sessionId,
        targetType: 'interview_session',
      },
    });
  }
  private async writeRecoveryIdempotency(
    tx: Prisma.TransactionClient,
    requestId: string,
    action: string,
    actorId: string,
    sessionId: string,
    snapshot: InterviewSessionResponse | EvidenceFinalizationResponse,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        action,
        actorId,
        requestId,
        responsePayload: snapshot as unknown as Prisma.InputJsonValue,
        targetId: sessionId,
        targetType: 'interview_session',
      },
    });
  }
  private forbidden(): ForbiddenException {
    return new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
  }
  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }
  private conflict(code: string): ConflictException {
    return new ConflictException({ code, details: {}, message: 'Session finalization conflict' });
  }
  private validationConflict(): ConflictException {
    return this.conflict('AUDIO_COMMITMENT_CONFLICT');
  }
}

function evidenceFailureCode(value: string | null): EvidenceFinalizationResponse['failure_code'] {
  if (value === null) return null;
  if (value === 'AUDIO_COMMITMENT_CONFLICT' || value === 'AUDIO_MANIFEST_UNRECOVERABLE') {
    return value;
  }
  return 'FINALIZATION_INTERNAL_FAILURE';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('ASR_DRAIN_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function commitmentChecksum(chunks: SessionChunkCommitment[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        chunks.map((c) => ({
          checksum: c.checksum,
          end_ms: c.end_ms,
          mime_type: c.mime_type,
          sequence_no: c.sequence_no,
          size_bytes: c.size_bytes,
          start_ms: c.start_ms,
        })),
      ),
    )
    .digest('hex');
}
function sameChunk(
  chunk: {
    checksum: string;
    endMs: number;
    mimeType: string;
    sequenceNo: number;
    sizeBytes: number;
    startMs: number;
  },
  c: SessionChunkCommitment,
): boolean {
  return (
    chunk.checksum === c.checksum &&
    chunk.endMs === c.end_ms &&
    chunk.mimeType === c.mime_type &&
    chunk.sequenceNo === c.sequence_no &&
    chunk.sizeBytes === c.size_bytes &&
    chunk.startMs === c.start_ms
  );
}
