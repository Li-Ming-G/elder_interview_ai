import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { Prisma, type TranscriptSegment } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { mapTranscriptSegment } from './transcription.mapper.js';
import type { NormalizedAsrResult, TranscriptIngestionResult } from './transcription.types.js';
import {
  canonicalProviderPayload,
  serializedProviderPayload,
  validateNormalizedResult,
} from './transcription.validation.js';

const INGESTIBLE_SESSION_STATUSES = new Set([
  'processing',
  'reconnecting',
  'recording',
  'stopping',
]);

@Injectable()
export class TranscriptIngestionService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfigValue,
  ) {}

  public async ingest(result: NormalizedAsrResult): Promise<TranscriptIngestionResult> {
    validateNormalizedResult(result);
    if (result.source === 'fixture' && !['local', 'test'].includes(this.config.appEnv)) {
      throw new ConflictException({
        code: 'ASR_FIXTURE_DISABLED',
        details: {},
        message: 'ASR fixture input is disabled',
      });
    }
    if (result.kind === 'interim') {
      await this.assertInterimAllowed(result.sessionId);
      return { kind: 'interim', persisted: false };
    }

    const serializedPayload = serializedProviderPayload(result.providerPayload);
    try {
      const segment = await this.prisma.$transaction(async (transaction) => {
        // C2 corrections and final ingestion share the session lock. Whichever commits first
        // defines the facts the other operation must reread; this closes late-final phantoms.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${result.sessionId}, 0))`;
        const session = await transaction.interviewSession.findUnique({
          select: {
            project: {
              select: {
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
            status: true,
            speakerRoleRevision: true,
          },
          where: { id: result.sessionId },
        });
        if (session === null) throw this.notFound();
        if (result.speakerStreamId === undefined) throw this.ingestionNotAllowed();
        const stream = await transaction.speakerStream.findFirst({
          select: { id: true, status: true },
          where: { id: result.speakerStreamId, sessionId: result.sessionId },
        });
        if (stream === null || (result.source === 'realtime' && stream.status !== 'active')) {
          throw this.ingestionNotAllowed();
        }
        const latestConsent = session.project.consents[0];
        if (
          !INGESTIBLE_SESSION_STATUSES.has(session.status) ||
          session.project.deletedAt !== null ||
          session.project.status !== 'active' ||
          latestConsent?.status !== 'valid' ||
          latestConsent.revokedAt !== null
        ) {
          throw this.ingestionNotAllowed();
        }

        const existing = await transaction.transcriptSegment.findUnique({
          where: {
            sessionId_ingestKey: { ingestKey: result.ingestKey, sessionId: result.sessionId },
          },
        });
        if (existing !== null) return this.assertReplay(existing, result);

        const mapping =
          result.speakerProviderId === undefined || result.speakerProviderId === null
            ? null
            : await transaction.speakerMapping.findFirst({
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: { authority: true, speakerRole: true },
                where: {
                  speakerStreamId: result.speakerStreamId,
                  speakerProviderId: result.speakerProviderId,
                  supersededAt: null,
                },
              });
        const attempt = await transaction.speakerCalibrationAttempt.findFirst({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
          where: {
            speakerStreamId: result.speakerStreamId,
            startMs: { lt: result.endMs },
            OR: [{ endMs: null }, { endMs: { gt: result.startMs } }],
          },
        });
        const segment = await transaction.transcriptSegment.create({
          data: {
            contentKind: attempt === null ? 'conversation' : 'speaker_calibration',
            endMs: result.endMs,
            ingestKey: result.ingestKey,
            originalRoleAuthority: mapping?.authority ?? 'unconfirmed',
            originalSpeakerRole: mapping?.speakerRole ?? 'unknown',
            originalText: result.text,
            ...(serializedPayload === null
              ? {}
              : {
                  providerPayload: JSON.parse(serializedPayload) as Prisma.InputJsonValue,
                }),
            providerSegmentId: result.providerSegmentId ?? null,
            sessionId: result.sessionId,
            speakerRoleRevision: session.speakerRoleRevision,
            speakerStreamId: result.speakerStreamId,
            source: result.source,
            speakerProviderId: result.speakerProviderId ?? null,
            startMs: result.startMs,
          },
        });
        if (attempt !== null) {
          await transaction.speakerCalibrationAttemptSegment.create({
            data: { attemptId: attempt.id, transcriptSegmentId: segment.id },
          });
        }
        return segment;
      });
      return { kind: 'final', persisted: true, segment: mapTranscriptSegment(segment) };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.transcriptSegment.findUnique({
          where: {
            sessionId_ingestKey: { ingestKey: result.ingestKey, sessionId: result.sessionId },
          },
        });
        if (existing !== null) {
          const segment = this.assertReplay(existing, result);
          return { kind: 'final', persisted: true, segment: mapTranscriptSegment(segment) };
        }
      }
      throw error;
    }
  }

  private assertReplay(
    existing: TranscriptSegment,
    result: NormalizedAsrResult,
  ): TranscriptSegment {
    if (
      existing.providerSegmentId !== (result.providerSegmentId ?? null) ||
      existing.speakerStreamId !== result.speakerStreamId ||
      existing.speakerProviderId !== (result.speakerProviderId ?? null) ||
      existing.startMs !== result.startMs ||
      existing.endMs !== result.endMs ||
      existing.originalText !== result.text ||
      existing.source !== result.source ||
      canonicalProviderPayload(existing.providerPayload) !==
        canonicalProviderPayload(result.providerPayload)
    ) {
      throw new ConflictException({
        code: 'TRANSCRIPT_INGEST_CONFLICT',
        details: {},
        message: 'Transcript ingest identity conflicts with immutable evidence',
      });
    }
    return existing;
  }

  private async assertInterimAllowed(sessionId: string): Promise<void> {
    const session = await this.prisma.interviewSession.findUnique({
      select: {
        project: {
          select: {
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
        status: true,
      },
      where: { id: sessionId },
    });
    if (session === null) throw this.notFound();
    const latestConsent = session.project.consents[0];
    if (
      !INGESTIBLE_SESSION_STATUSES.has(session.status) ||
      session.project.deletedAt !== null ||
      session.project.status !== 'active' ||
      latestConsent?.status !== 'valid' ||
      latestConsent.revokedAt !== null
    ) {
      throw this.ingestionNotAllowed();
    }
  }

  private ingestionNotAllowed(): ConflictException {
    return new ConflictException({
      code: 'ASR_INGESTION_NOT_ALLOWED',
      details: {},
      message: 'ASR ingestion is not allowed for the current session',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }
}
