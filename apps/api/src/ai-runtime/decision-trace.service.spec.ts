import { describe, expect, it, vi } from 'vitest';

import { DecisionTraceService } from './decision-trace.service.js';

const trace = {
  id: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  startedAt: new Date('2026-08-16T00:00:00.000Z'),
  status: 'running',
};

function input() {
  return {
    contextRevision: 1,
    decisionOutcome: 'unavailable' as const,
    directorInvoked: false,
    inputHash: 'a'.repeat(64),
    ownerActorId: '00000000-0000-4000-8000-000000000003',
    projectId: '00000000-0000-4000-8000-000000000004',
    requestId: trace.requestId,
    sessionId: '00000000-0000-4000-8000-000000000005',
    triggerType: 'manual_next',
    workingRevision: null,
    memoryMemberships: [
      {
        inputOrder: 0,
        layer: 'unknown',
        memoryId: 'memory-ref',
        membershipRole: 'unavailable',
        revision: null,
      },
    ],
  };
}

describe('DecisionTraceService', () => {
  it('is idempotent by request and terminalizes exactly once', async () => {
    const create = vi.fn().mockResolvedValue(trace);
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(trace);
    const txFindUnique = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      decisionTrace: { findUnique, create, updateMany },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ decisionTrace: { findUnique: txFindUnique, create } }),
      ),
    } as never;
    const service = new DecisionTraceService(prisma);
    await expect(service.begin(input())).resolves.toBe(trace);
    await expect(service.begin(input())).resolves.toBe(trace);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(
      service.finalize(trace.id, { status: 'succeeded', decisionOutcome: 'continue_listening' }),
    ).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: trace.id, status: 'running' } }),
    );
  });

  it('rejects late finalization and reference attachment after terminal state', async () => {
    const prisma = {
      decisionTrace: {
        findUnique: vi.fn().mockResolvedValue({ ...trace, status: 'succeeded' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          decisionTrace: {
            findUnique: vi.fn().mockResolvedValue({ ...trace, status: 'succeeded' }),
          },
        }),
      ),
    } as never;
    const service = new DecisionTraceService(prisma);
    await expect(service.finalize(trace.id, { status: 'failed' })).rejects.toThrow(
      'DECISION_TRACE_TERMINAL_OR_MISSING',
    );
    await expect(service.attachReferences(trace.id, { p4Memberships: [] })).rejects.toThrow(
      'DECISION_TRACE_TERMINAL_OR_MISSING',
    );
  });
});
