import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import { CapturePcmEvidenceService } from './capture-pcm-evidence.service.js';
import { StreamingAsrError } from './streaming-asr.js';

describe('CapturePcmEvidenceService', () => {
  it('uses the locked transaction once and keeps later frames on the adapter-only fast path', async () => {
    const fixture = fakePrisma(null);
    const service = new CapturePcmEvidenceService(fixture.prisma);
    let accepted = 0;
    const accept = (): Promise<readonly []> => {
      accepted += 1;
      return Promise.resolve([]);
    };

    await service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, accept);
    await service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, accept);
    await service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, accept);

    expect(accepted).toBe(3);
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.updateCalls()).toBe(1);
  });

  it('hydrates existing durable evidence once after restart, then skips further transactions', async () => {
    const fixture = fakePrisma(new Date());
    const service = new CapturePcmEvidenceService(fixture.prisma);

    await service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, () =>
      Promise.resolve([]),
    );
    await service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, () =>
      Promise.resolve([]),
    );

    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.updateCalls()).toBe(0);
  });

  it('times out an unresponsive first adapter attempt without persisting evidence', async () => {
    const fixture = fakePrisma(null);
    const service = new CapturePcmEvidenceService(fixture.prisma);
    let signal: AbortSignal | undefined;

    await expect(
      service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, (currentSignal) => {
        signal = currentSignal;
        return new Promise<never>(() => undefined);
      }),
    ).rejects.toMatchObject<Partial<StreamingAsrError>>({ safeCode: 'ASR_TIMEOUT' });

    expect(signal?.aborted).toBe(true);
    expect(fixture.updateCalls()).toBe(0);
  });

  it('does not return an accepted result when the evidence write fails', async () => {
    const fixture = fakePrisma(null, 0);
    const service = new CapturePcmEvidenceService(fixture.prisma);

    await expect(
      service.acceptAndPersist(fixture.sessionId, fixture.audioStreamId, () =>
        Promise.resolve(['accepted']),
      ),
    ).rejects.toThrow('Capture evidence was not persisted');
    expect(fixture.updateCalls()).toBe(1);
  });
});

function fakePrisma(
  firstPcmAcceptedAt: Date | null,
  persistedCount = 1,
): {
  audioStreamId: string;
  prisma: PrismaService;
  sessionId: string;
  transactionCalls: () => number;
  updateCalls: () => number;
} {
  const sessionId = randomUUID();
  const projectId = randomUUID();
  const audioStreamId = randomUUID();
  const capture = {
    audioObjectId: randomUUID(),
    audioStreamId,
    firstPcmAcceptedAt,
    id: randomUUID(),
    sessionId,
    status: 'active',
  };
  let transactions = 0;
  let updates = 0;
  const tx = {
    $executeRaw: (): Promise<number> => Promise.resolve(1),
    interviewSession: {
      findUnique: (): Promise<{ projectId: string }> => Promise.resolve({ projectId }),
    },
    sessionCaptureGeneration: {
      findUnique: ({
        where,
      }: {
        where: { audioStreamId?: string; id?: string };
      }): Promise<typeof capture | null> =>
        Promise.resolve(
          where.audioStreamId === audioStreamId || where.id === capture.id ? capture : null,
        ),
      updateMany: (): Promise<{ count: number }> => {
        updates += 1;
        return Promise.resolve({ count: persistedCount });
      },
    },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => {
      transactions += 1;
      return operation(tx);
    },
  } as unknown as PrismaService;
  return {
    audioStreamId,
    prisma,
    sessionId,
    transactionCalls: () => transactions,
    updateCalls: () => updates,
  };
}
