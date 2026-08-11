import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../database/prisma.service.js';
import { AiJobCoordinatorService, type FrozenAiJob } from './ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import { AiPolicyService } from './ai-policy.service.js';

describe('question generation same-input retry budget', () => {
  it('shares one absolute deadline across primary and retry', async () => {
    const { coordinator, invoke } = fixture();
    invoke
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve({ invalid: true });
            }, 30),
          ),
      )
      .mockImplementationOnce(() => new Promise(() => undefined));
    const startedAt = Date.now();

    await expect(
      coordinator.callProviderWithSameInputRetry(
        job(),
        invoke,
        () => {
          throw new Error('AI_OUTPUT_SCHEMA_INVALID');
        },
        startedAt + 50,
      ),
    ).rejects.toThrow('AI_PROVIDER_TIMEOUT');

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeLessThan(80);
  });

  it('rechecks policy before retry and never invokes again after deletion becomes active', async () => {
    const { assertAllowed, coordinator, invoke } = fixture();
    assertAllowed
      .mockResolvedValueOnce({
        blockedCanonicalKeys: [],
        policyRevision: 0,
        retentionPolicyVersion: 1,
      })
      .mockRejectedValueOnce(new Error('DELETION_REQUEST_ACTIVE'));
    invoke.mockResolvedValue({ invalid: true });

    await expect(
      coordinator.callProviderWithSameInputRetry(
        job(),
        invoke,
        () => {
          throw new Error('AI_OUTPUT_SCHEMA_INVALID');
        },
        Date.now() + 1_000,
      ),
    ).rejects.toThrow('DELETION_REQUEST_ACTIVE');

    expect(assertAllowed).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

function fixture(): {
  assertAllowed: ReturnType<typeof vi.fn<AiPolicyService['assertAllowed']>>;
  coordinator: AiJobCoordinatorService;
  invoke: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
} {
  const prisma = {
    aiJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    aiProviderCall: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const assertAllowed = vi.fn<AiPolicyService['assertAllowed']>().mockResolvedValue({
    blockedCanonicalKeys: [],
    policyRevision: 0,
    retentionPolicyVersion: 1,
  });
  const policy = { assertAllowed } as unknown as AiPolicyService;
  const coordinator = new AiJobCoordinatorService(prisma, policy, {} as AiOutputEligibilityService);
  return { assertAllowed, coordinator, invoke: vi.fn<() => Promise<unknown>>() };
}

function job(): FrozenAiJob {
  return {
    actualQuestions: [],
    id: '11111111-1111-4111-8111-111111111111',
    inputHash: 'a'.repeat(64),
    memories: [],
    policyRevision: 0,
    projectId: '22222222-2222-4222-8222-222222222222',
    replayed: false,
    requestedBy: '33333333-3333-4333-8333-333333333333',
    retentionPolicyVersion: 1,
    segments: [],
    sessionIds: ['44444444-4444-4444-8444-444444444444'],
    status: 'running',
  };
}
