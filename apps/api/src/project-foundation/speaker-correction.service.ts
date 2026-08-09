import { createHash } from 'node:crypto';
import type {
  CorrectTranscriptSpeakerRoleRequest,
  ExecuteSpeakerRemapRequest,
  PreviewSpeakerRemapRequest,
  SpeakerRemapExecuteResponse,
  SpeakerRemapPreviewResponse,
  SpeakerRoleCorrectionResponse,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { mapTranscriptSegment } from '../transcription/transcription.mapper.js';
import { mapTranscriptResponse } from '../transcription/trusted-speaker-role.js';

const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const CORRECTABLE_SESSION_STATUSES = new Set([
  'recording',
  'reconnecting',
  'interrupted',
  'stopping',
  'processing',
  'completed',
  'failed',
]);
type Transaction = Prisma.TransactionClient;
interface CorrectionCandidate {
  id: string;
  sessionId: string;
  speakerProviderId: string | null;
  speakerRoleRevision: number;
  speakerStreamId: string;
  startMs: number;
  correctionMemberships: Array<{
    operation: { operationType: string; revisionAfter: number };
  }>;
}

@Injectable()
export class SpeakerCorrectionService {
  public constructor(private readonly prisma: PrismaService) {}

  public async correctOne(
    actor: AuthPrincipal,
    transcriptSegmentId: string,
    input: CorrectTranscriptSpeakerRoleRequest,
  ): Promise<SpeakerRoleCorrectionResponse> {
    const location = await this.prisma.transcriptSegment.findUnique({
      select: { sessionId: true },
      where: { id: transcriptSegmentId },
    });
    if (location === null) throw this.notFound();
    const action = actionIdentity('speaker.role.correct', input);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input.request_id, location.sessionId);
      await this.assertGate(tx, actor, location.sessionId);
      const replay = await this.replay<SpeakerRoleCorrectionResponse>(
        tx,
        actor,
        input.request_id,
        transcriptSegmentId,
        action,
      );
      if (replay !== null) return replay;
      const segment = await tx.transcriptSegment.findUnique({ where: { id: transcriptSegmentId } });
      if (segment === null || segment.sessionId !== location.sessionId) throw this.notFound();
      if (segment.speakerRoleRevision !== input.expected_speaker_role_revision) {
        throw this.conflict('SPEAKER_ROLE_VERSION_CONFLICT');
      }
      const session = await tx.interviewSession.findUnique({
        select: { speakerRoleRevision: true },
        where: { id: location.sessionId },
      });
      if (session === null) throw this.notFound();
      const revisionAfter = session.speakerRoleRevision + 1;
      const correctedAt = new Date();
      const updated = await tx.transcriptSegment.update({
        data: {
          correctedAt,
          correctedBy: actor.id,
          correctedSpeakerRole: input.corrected_speaker_role,
          speakerRoleRevision: revisionAfter,
        },
        where: { id: segment.id },
      });
      const operation = await tx.speakerCorrectionOperation.create({
        data: {
          createdBy: actor.id,
          operationType: 'single',
          requestId: input.request_id,
          revisionAfter,
          revisionBefore: session.speakerRoleRevision,
          sessionId: segment.sessionId,
          speakerStreamId: segment.speakerStreamId,
          targetRole: input.corrected_speaker_role,
        },
      });
      await tx.speakerCorrectionOperationSegment.create({
        data: {
          speakerCorrectionOperationId: operation.id,
          speakerRevisionAfter: revisionAfter,
          speakerRevisionBefore: segment.speakerRoleRevision,
          transcriptSegmentId: segment.id,
        },
      });
      await tx.interviewSession.update({
        data: { speakerRoleRevision: revisionAfter },
        where: { id: segment.sessionId },
      });
      const response: SpeakerRoleCorrectionResponse = {
        operation_id: operation.id,
        segment: mapTranscriptResponse(mapTranscriptSegment(updated)),
        speaker_role_revision: revisionAfter,
      };
      await this.persistSuccess(
        tx,
        actor,
        input.request_id,
        transcriptSegmentId,
        action,
        response,
        {
          operation_id: operation.id,
          revision_after: revisionAfter,
          revision_before: session.speakerRoleRevision,
          segment_count: 1,
          speaker_stream_id: segment.speakerStreamId,
          target_role: input.corrected_speaker_role,
        },
        'speaker_role.corrected',
        'transcript_segment',
      );
      return response;
    });
  }

  public async preview(
    actor: AuthPrincipal,
    sessionId: string,
    input: PreviewSpeakerRemapRequest,
  ): Promise<SpeakerRemapPreviewResponse> {
    const action = actionIdentity('speaker.remap.preview', input);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input.request_id, sessionId);
      await this.assertGate(tx, actor, sessionId);
      const replay = await this.replay<SpeakerRemapPreviewResponse>(
        tx,
        actor,
        input.request_id,
        sessionId,
        action,
      );
      if (replay !== null) return replay;
      const candidates = await this.readCandidates(tx, sessionId, input);
      const membership = candidates.map((segment) => ({
        excluded: isCurrentSingleCorrection(segment),
        id: segment.id,
        revision: segment.speakerRoleRevision,
      }));
      if (membership[0]?.excluded === true || membership.at(-1)?.excluded === true) {
        throw this.conflict('SPEAKER_REMAP_RANGE_INVALID');
      }
      const excludedCount = membership.filter(({ excluded }) => excluded).length;
      const segmentCount = membership.length - excludedCount;
      if (segmentCount < 1) throw this.conflict('SPEAKER_REMAP_RANGE_INVALID');
      const previewHash = remapHash(input, membership);
      const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
      const preview = await tx.speakerRemapPreview.create({
        data: {
          candidateSegmentCount: membership.length,
          createdBy: actor.id,
          excludeIndividualCorrections: true,
          excludedSegmentCount: excludedCount,
          expiresAt,
          previewHash,
          requestId: input.request_id,
          segmentCount,
          segmentEndId: input.segment_end_id,
          segmentStartId: input.segment_start_id,
          sessionId,
          speakerProviderId: input.speaker_provider_id,
          speakerStreamId: input.speaker_stream_id,
          targetRole: input.corrected_speaker_role,
        },
      });
      await tx.speakerRemapPreviewSegment.createMany({
        data: membership.map((member) => ({
          excludedIndividualCorrection: member.excluded,
          speakerRemapPreviewId: preview.id,
          speakerRevisionAtPreview: member.revision,
          transcriptSegmentId: member.id,
        })),
      });
      const response: SpeakerRemapPreviewResponse = {
        candidate_segment_count: membership.length,
        corrected_speaker_role: input.corrected_speaker_role,
        excluded_segment_count: excludedCount,
        expires_at: expiresAt.toISOString(),
        preview_hash: previewHash,
        preview_id: preview.id,
        segment_count: segmentCount,
        segment_end_id: input.segment_end_id,
        segment_start_id: input.segment_start_id,
      };
      await this.persistSuccess(
        tx,
        actor,
        input.request_id,
        sessionId,
        action,
        response,
        {
          candidate_segment_count: membership.length,
          excluded_segment_count: excludedCount,
          preview_hash: previewHash,
          preview_id: preview.id,
          segment_count: segmentCount,
          speaker_stream_id: input.speaker_stream_id,
          target_role: input.corrected_speaker_role,
        },
        'speaker_remap.previewed',
        'interview_session',
      );
      return response;
    });
  }

  public async execute(
    actor: AuthPrincipal,
    sessionId: string,
    input: ExecuteSpeakerRemapRequest,
  ): Promise<SpeakerRemapExecuteResponse> {
    const action = actionIdentity('speaker.remap.execute', input);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input.request_id, sessionId);
      await this.assertGate(tx, actor, sessionId);
      const replay = await this.replay<SpeakerRemapExecuteResponse>(
        tx,
        actor,
        input.request_id,
        sessionId,
        action,
      );
      if (replay !== null) return replay;
      const preview = await tx.speakerRemapPreview.findUnique({
        include: { memberships: { orderBy: { createdAt: 'asc' } } },
        where: { id: input.preview_id },
      });
      if (
        preview === null ||
        preview.sessionId !== sessionId ||
        preview.createdBy !== actor.id ||
        preview.status !== 'active' ||
        preview.expiresAt.getTime() <= Date.now() ||
        preview.previewHash !== input.preview_hash
      ) {
        throw this.stale();
      }
      const selector: PreviewSpeakerRemapRequest = {
        corrected_speaker_role: preview.targetRole,
        exclude_individual_corrections: true,
        request_id: preview.requestId,
        segment_end_id: preview.segmentEndId,
        segment_start_id: preview.segmentStartId,
        speaker_provider_id: preview.speakerProviderId,
        speaker_stream_id: preview.speakerStreamId,
      };
      const candidates = await this.readCandidates(tx, sessionId, selector, true);
      const current = candidates.map((segment) => ({
        excluded: isCurrentSingleCorrection(segment),
        id: segment.id,
        revision: segment.speakerRoleRevision,
      }));
      const saved = preview.memberships
        .map((member) => ({
          excluded: member.excludedIndividualCorrection,
          id: member.transcriptSegmentId,
          revision: member.speakerRevisionAtPreview,
        }))
        .sort(compareMembership);
      const currentSorted = [...current].sort(compareMembership);
      if (
        preview.candidateSegmentCount !== current.length ||
        preview.excludedSegmentCount !== current.filter(({ excluded }) => excluded).length ||
        preview.segmentCount !== current.filter(({ excluded }) => !excluded).length ||
        stableJson(saved) !== stableJson(currentSorted) ||
        remapHash(selector, current) !== preview.previewHash
      ) {
        throw this.stale();
      }
      const included = current.filter(({ excluded }) => !excluded);
      const session = await tx.interviewSession.findUnique({
        select: { speakerRoleRevision: true },
        where: { id: sessionId },
      });
      if (session === null) throw this.notFound();
      const revisionAfter = session.speakerRoleRevision + 1;
      const correctedAt = new Date();
      await tx.transcriptSegment.updateMany({
        data: {
          correctedAt,
          correctedBy: actor.id,
          correctedSpeakerRole: preview.targetRole,
          speakerRoleRevision: revisionAfter,
        },
        where: { id: { in: included.map(({ id }) => id) }, sessionId },
      });
      const operation = await tx.speakerCorrectionOperation.create({
        data: {
          createdBy: actor.id,
          operationType: 'batch',
          previewHash: preview.previewHash,
          previewId: preview.id,
          requestId: input.request_id,
          revisionAfter,
          revisionBefore: session.speakerRoleRevision,
          sessionId,
          speakerStreamId: preview.speakerStreamId,
          targetRole: preview.targetRole,
        },
      });
      await tx.speakerCorrectionOperationSegment.createMany({
        data: included.map((member) => ({
          speakerCorrectionOperationId: operation.id,
          speakerRevisionAfter: revisionAfter,
          speakerRevisionBefore: member.revision,
          transcriptSegmentId: member.id,
        })),
      });
      await tx.interviewSession.update({
        data: { speakerRoleRevision: revisionAfter },
        where: { id: sessionId },
      });
      await tx.speakerRemapPreview.update({
        data: { status: 'executed' },
        where: { id: preview.id },
      });
      const response: SpeakerRemapExecuteResponse = {
        operation_id: operation.id,
        preview_hash: preview.previewHash,
        preview_id: preview.id,
        segment_count: included.length,
        speaker_role_revision: revisionAfter,
      };
      await this.persistSuccess(
        tx,
        actor,
        input.request_id,
        sessionId,
        action,
        response,
        {
          operation_id: operation.id,
          preview_hash: preview.previewHash,
          preview_id: preview.id,
          revision_after: revisionAfter,
          revision_before: session.speakerRoleRevision,
          segment_count: included.length,
          speaker_stream_id: preview.speakerStreamId,
          target_role: preview.targetRole,
        },
        'speaker_remap.executed',
        'interview_session',
      );
      return response;
    });
  }

  private async readCandidates(
    tx: Transaction,
    sessionId: string,
    input: PreviewSpeakerRemapRequest,
    staleOnInvalid = false,
  ): Promise<CorrectionCandidate[]> {
    const endpoints = await tx.transcriptSegment.findMany({
      where: { id: { in: [input.segment_start_id, input.segment_end_id] } },
    });
    const start = endpoints.find(({ id }) => id === input.segment_start_id);
    const end = endpoints.find(({ id }) => id === input.segment_end_id);
    const valid = (segment: typeof start): segment is NonNullable<typeof start> =>
      segment !== undefined &&
      segment.sessionId === sessionId &&
      segment.speakerStreamId === input.speaker_stream_id &&
      segment.speakerProviderId === input.speaker_provider_id;
    if (!valid(start) || !valid(end) || compareSegment(start, end) > 0) {
      throw staleOnInvalid ? this.stale() : this.conflict('SPEAKER_REMAP_RANGE_INVALID');
    }
    const segments = await tx.transcriptSegment.findMany({
      include: {
        correctionMemberships: {
          include: { operation: { select: { operationType: true, revisionAfter: true } } },
        },
      },
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
      where: {
        sessionId,
        speakerProviderId: input.speaker_provider_id,
        speakerStreamId: input.speaker_stream_id,
        AND: [
          {
            OR: [
              { startMs: { gt: start.startMs } },
              { id: { gte: start.id }, startMs: start.startMs },
            ],
          },
          { OR: [{ startMs: { lt: end.startMs } }, { id: { lte: end.id }, startMs: end.startMs }] },
        ],
      },
    });
    if (segments.length === 0 || segments[0]?.id !== start.id || segments.at(-1)?.id !== end.id) {
      throw staleOnInvalid ? this.stale() : this.conflict('SPEAKER_REMAP_RANGE_INVALID');
    }
    return segments;
  }

  private async assertGate(
    tx: Transaction,
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<void> {
    const session = await tx.interviewSession.findUnique({
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
    if (
      session === null ||
      session.project.deletedAt !== null ||
      session.project.status === 'deleted'
    ) {
      throw this.notFound();
    }
    const consent = session.project.consents[0];
    if (
      !session.project.assignments.some(({ userId }) => userId === actor.id) ||
      session.project.status === 'restricted' ||
      consent?.status !== 'valid' ||
      consent.revokedAt !== null ||
      !CORRECTABLE_SESSION_STATUSES.has(session.status)
    ) {
      throw new ForbiddenException({
        code: 'SPEAKER_ROLE_UPDATE_FORBIDDEN',
        details: {},
        message: 'Speaker role update is forbidden',
      });
    }
  }

  private async lock(tx: Transaction, requestId: string, sessionId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`;
  }

  private async replay<T>(
    tx: Transaction,
    actor: AuthPrincipal,
    requestId: string,
    targetId: string,
    action: string,
  ): Promise<T | null> {
    const record = await tx.idempotencyRecord.findUnique({ where: { requestId } });
    if (record === null) return null;
    if (record.action !== action || record.actorId !== actor.id || record.targetId !== targetId) {
      throw this.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
    }
    return record.responsePayload as T;
  }

  private async persistSuccess(
    tx: Transaction,
    actor: AuthPrincipal,
    requestId: string,
    targetId: string,
    action: string,
    response: object,
    metadata: Prisma.InputJsonObject,
    auditAction: string,
    targetType: string,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        action,
        actorId: actor.id,
        requestId,
        responsePayload: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue,
        targetId,
        targetType,
      },
    });
    await tx.auditLog.create({
      data: {
        action: auditAction,
        actorId: actor.id,
        actorType: 'user',
        entityId: targetId,
        entityType: targetType,
        metadata,
        requestId,
      },
    });
  }

  private conflict(code: string): ConflictException {
    return new ConflictException({ code, details: {}, message: 'Speaker role update conflict' });
  }

  private stale(): ConflictException {
    return this.conflict('SPEAKER_REMAP_PREVIEW_STALE');
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }
}

function isCurrentSingleCorrection(segment: {
  speakerRoleRevision: number;
  correctionMemberships: Array<{
    operation: { operationType: string; revisionAfter: number };
  }>;
}): boolean {
  return segment.correctionMemberships.some(
    ({ operation }) =>
      operation.operationType === 'single' &&
      operation.revisionAfter === segment.speakerRoleRevision,
  );
}

function compareSegment(
  left: { id: string; startMs: number },
  right: { id: string; startMs: number },
): number {
  return left.startMs - right.startMs || left.id.localeCompare(right.id);
}

function compareMembership(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function remapHash(
  input: PreviewSpeakerRemapRequest,
  membership: Array<{ excluded: boolean; id: string; revision: number }>,
): string {
  return createHash('sha256')
    .update(
      stableJson({
        corrected_speaker_role: input.corrected_speaker_role,
        exclude_individual_corrections: true,
        membership,
        segment_end_id: input.segment_end_id,
        segment_start_id: input.segment_start_id,
        speaker_provider_id: input.speaker_provider_id,
        speaker_stream_id: input.speaker_stream_id,
      }),
    )
    .digest('hex');
}

function actionIdentity(prefix: string, input: object): string {
  return `${prefix}:${createHash('sha256').update(stableJson(input)).digest('hex')}`;
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
