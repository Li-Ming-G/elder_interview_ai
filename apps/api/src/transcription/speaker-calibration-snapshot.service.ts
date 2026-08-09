import { Injectable, NotFoundException } from '@nestjs/common';
import type { SpeakerCalibrationSnapshot } from '@elder-interview/contracts';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type SnapshotClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SpeakerCalibrationSnapshotService {
  public constructor(private readonly prisma: PrismaService) {}

  public async get(sessionId: string): Promise<SpeakerCalibrationSnapshot> {
    return this.getWith(this.prisma, sessionId);
  }

  public async getWith(
    client: SnapshotClient,
    sessionId: string,
  ): Promise<SpeakerCalibrationSnapshot> {
    const session = await client.interviewSession.findUnique({
      select: {
        id: true,
        speakerRoleRevision: true,
        updatedAt: true,
        speakerStreams: {
          orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          where: { status: 'active' },
          select: {
            id: true,
            captureGenerationId: true,
            updatedAt: true,
            captureGeneration: { select: { audioStreamId: true } },
            calibrationAttempts: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: {
                id: true,
                attemptNo: true,
                status: true,
                startSequenceNo: true,
                startMs: true,
                endSequenceNo: true,
                endMs: true,
                createdAt: true,
                startedAt: true,
                resolvedAt: true,
                updatedAt: true,
                memberships: {
                  orderBy: { transcriptSegment: { startMs: 'asc' } },
                  select: {
                    transcriptSegment: {
                      select: { id: true, speakerProviderId: true, startMs: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      where: { id: sessionId },
    });
    if (session === null) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        details: {},
        message: 'Resource not found',
      });
    }
    const stream = session.speakerStreams[0] ?? null;
    const attempt = stream?.calibrationAttempts[0] ?? null;
    const labels = attempt === null ? [] : stableLabels(attempt.memberships);
    const mappings =
      attempt?.status === 'confirmed' && stream !== null
        ? await client.speakerMapping.findMany({
            orderBy: [{ speakerProviderId: 'asc' }, { id: 'asc' }],
            select: { authority: true, speakerProviderId: true, speakerRole: true },
            where: {
              authority: 'user_confirmed',
              source: 'calibration',
              speakerStreamId: stream.id,
              supersededAt: null,
            },
          })
        : [];
    const updatedAt = [session.updatedAt, stream?.updatedAt, attempt?.updatedAt]
      .filter((value): value is Date => value instanceof Date)
      .reduce((latest, value) => (value > latest ? value : latest), session.updatedAt);
    return {
      attempt:
        attempt === null || stream === null
          ? null
          : {
              attempt_no: attempt.attemptNo,
              boundary: {
                end_sequence_no_exclusive: attempt.endSequenceNo,
                end_timeline_ms: attempt.endMs,
                start_sequence_no: attempt.startSequenceNo,
                start_timeline_ms: attempt.startMs,
              },
              confirmed_mappings: mappings.map((mapping) => ({
                authority: 'user_confirmed' as const,
                speaker_provider_id: mapping.speakerProviderId,
                speaker_role: mapping.speakerRole as 'elder' | 'interviewer',
              })),
              id: attempt.id,
              observed_provider_labels: labels,
              resolved_at: attempt.resolvedAt?.toISOString() ?? null,
              started_at: attempt.startedAt.toISOString(),
              status: attempt.status,
            },
      session_id: session.id,
      speaker_role_revision: session.speakerRoleRevision,
      speaker_stream:
        stream === null || stream.captureGenerationId === null || stream.captureGeneration === null
          ? null
          : {
              audio_stream_id: stream.captureGeneration.audioStreamId,
              capture_generation_id: stream.captureGenerationId,
              id: stream.id,
              status: 'active',
            },
      status: attempt?.status ?? 'not_started',
      updated_at: updatedAt.toISOString(),
    };
  }
}

function stableLabels(
  memberships: Array<{
    transcriptSegment: { id: string; speakerProviderId: string | null; startMs: number };
  }>,
): string[] {
  const first = new Map<string, { id: string; startMs: number }>();
  for (const { transcriptSegment } of memberships) {
    const label = transcriptSegment.speakerProviderId;
    if (label === null) continue;
    const existing = first.get(label);
    if (
      existing === undefined ||
      transcriptSegment.startMs < existing.startMs ||
      (transcriptSegment.startMs === existing.startMs && transcriptSegment.id < existing.id)
    ) {
      first.set(label, { id: transcriptSegment.id, startMs: transcriptSegment.startMs });
    }
  }
  return [...first.entries()]
    .sort((left, right) => left[1].startMs - right[1].startMs || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([label]) => label);
}
