import { createHash } from 'node:crypto';

import type {
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
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { mapInterviewSessionSnapshot } from './project.mapper.js';

@Injectable()
export class SessionFinalizationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: ResourceAuthorizationService,
    private readonly runtime: RealtimeRuntimeService,
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
    input: RecoverSessionRequest,
  ): Promise<InterviewSessionResponse> {
    if (input.action === 'finalize_interrupted') return this.freeze(actor, sessionId, input, true);
    await this.authorization.assertRole(actor, ['interviewer']);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${input.request_id}`);
      await this.lock(tx, `session:${sessionId}`);
      const replay = await tx.idempotencyRecord.findUnique({
        where: { requestId: input.request_id },
      });
      const action = `interview_session.recover:${input.action}`;
      if (replay !== null) {
        if (
          replay.action !== action ||
          replay.actorId !== actor.id ||
          replay.targetId !== sessionId ||
          replay.targetType !== 'interview_session'
        )
          throw this.conflict('IDEMPOTENCY_KEY_REUSED');
        return replay.responsePayload as unknown as InterviewSessionResponse;
      }
      const session = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (session === null) throw this.notFound();
      const finalization = await tx.sessionFinalization.findUnique({ where: { sessionId } });
      if (input.action === 'resume_capture') {
        if (finalization !== null || session.status !== 'interrupted')
          throw this.conflict('SESSION_NOT_RECOVERABLE');
        await this.assertCurrentGate(tx, actor, session.projectId);
        const updated = await tx.interviewSession.update({
          data: { status: 'reconnecting' },
          where: { id: sessionId },
        });
        const snapshot = await this.snapshot(tx, updated.id);
        await this.writeRecoveryIdempotency(
          tx,
          input.request_id,
          action,
          actor.id,
          sessionId,
          snapshot,
        );
        return snapshot;
      }
      if (['recording', 'reconnecting'].includes(session.status))
        throw this.conflict('SESSION_RECOVERY_NOT_REQUIRED');
      if (finalization === null) throw this.conflict('SESSION_NOT_RECOVERABLE');
      this.assertFinalizationActor(actor, finalization.createdBy);
      await this.advance(tx, finalization.id);
      const snapshot = await this.snapshot(tx, sessionId);
      await this.writeRecoveryIdempotency(
        tx,
        input.request_id,
        action,
        actor.id,
        sessionId,
        snapshot,
      );
      return snapshot;
    });
    return result;
  }

  public async get(actor: AuthPrincipal, sessionId: string): Promise<InterviewSessionResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null) throw this.notFound();
    const assignment = await this.prisma.projectAssignment.findFirst({
      where: { projectId: session.projectId, revokedAt: null, userId: actor.id },
    });
    const finalization = await this.prisma.sessionFinalization.findUnique({ where: { sessionId } });
    if (assignment === null && finalization?.createdBy !== actor.id) throw this.forbidden();
    return this.snapshot(this.prisma, sessionId);
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
      await this.lock(tx, `session:${sessionId}`);
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
        await this.advance(tx, existing.id);
        return { denied: false as const, snapshot: await this.snapshot(tx, sessionId) };
      }
      const legal = interrupted
        ? session.status === 'interrupted'
        : ['recording', 'reconnecting'].includes(session.status);
      if (!legal) throw this.conflict('SESSION_NOT_STOPPABLE');
      const gate = await this.currentGate(tx, actor, session.projectId);
      const object = await tx.audioObject.findUnique({ where: { id: input.audio_object_id } });
      if (
        !gate ||
        object === null ||
        object.projectId !== session.projectId ||
        object.sessionId !== sessionId ||
        object.purpose !== 'interview' ||
        object.createdBy !== actor.id
      ) {
        await tx.interviewSession.update({
          data: { status: 'interrupted' },
          where: { id: sessionId },
        });
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
      await this.advance(tx, finalization.id);
      const snapshot = await this.snapshot(tx, sessionId);
      await tx.idempotencyRecord.create({
        data: {
          action: interrupted ? 'interview_session.finalize_interrupted' : 'interview_session.stop',
          actorId: actor.id,
          requestId: input.request_id,
          responsePayload: snapshot as unknown as Prisma.InputJsonValue,
          targetId: sessionId,
          targetType: 'interview_session',
        },
      });
      return { denied: false as const, snapshot };
    });
    if (outcome.denied) throw this.forbidden();
    return outcome.snapshot;
  }

  private async advance(tx: Prisma.TransactionClient, finalizationId: string): Promise<void> {
    const f = await tx.sessionFinalization.findUniqueOrThrow({ where: { id: finalizationId } });
    const object = await tx.audioObject.findUniqueOrThrow({ where: { id: f.audioObjectId } });
    if (
      object.status !== 'complete' ||
      object.chunkCount !== f.expectedChunkCount ||
      object.manifestChecksum === null
    )
      return;
    const now = new Date();
    const activeRuntime = this.runtime.find(f.sessionId);
    const transcriptStatus =
      f.transcriptStatus === 'pending'
        ? activeRuntime === null
          ? 'not_started'
          : 'degraded'
        : f.transcriptStatus;
    await tx.sessionFinalization.update({
      data: {
        audioStatus: 'complete',
        completedAt: now,
        processingStartedAt: f.processingStartedAt ?? now,
        transcriptErrorCode: activeRuntime === null ? null : 'ASR_DRAIN_INCOMPLETE',
        asrLastAudioSequenceAccepted:
          activeRuntime?.highestAudioSequenceAcked ?? f.asrLastAudioSequenceAccepted,
        transcriptStatus,
      },
      where: { id: f.id },
    });
    await tx.interviewSession.update({ data: { status: 'completed' }, where: { id: f.sessionId } });
  }

  private async snapshot(
    db: Prisma.TransactionClient | PrismaService,
    sessionId: string,
  ): Promise<InterviewSessionResponse> {
    const session = await db.interviewSession.findUniqueOrThrow({ where: { id: sessionId } });
    const finalization = await db.sessionFinalization.findUnique({
      include: { audioObject: true },
      where: { sessionId },
    });
    const uploaded =
      finalization === null
        ? 0
        : await db.audioChunk.count({
            where: { audioObjectId: finalization.audioObjectId, uploadStatus: 'uploaded' },
          });
    return mapInterviewSessionSnapshot(session, finalization, uploaded);
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
  private async writeRecoveryIdempotency(
    tx: Prisma.TransactionClient,
    requestId: string,
    action: string,
    actorId: string,
    sessionId: string,
    snapshot: InterviewSessionResponse,
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
