import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../database/prisma.service.js';
import {
  AiJobCoordinatorService,
  safeAiErrorCode,
  type FreezeAiJobRequest,
  type FrozenAiJob,
} from './ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import { AiPolicyService } from './ai-policy.service.js';

describe('question generation same-input retry budget', () => {
  it('preserves the safe deadline diagnostic when no provider call can start', async () => {
    const { coordinator, invoke, updateJob } = fixture();

    await expect(
      coordinator.callProviderWithSameInputRetry<unknown>(
        job(),
        invoke,
        (value: unknown): unknown => value,
        Date.now() - 1,
      ),
    ).rejects.toThrow('AI_PROVIDER_TIMEOUT');

    expect(invoke).not.toHaveBeenCalled();
    const updateInput = updateJob.mock.calls.at(-1)?.[0];
    const update =
      typeof updateInput === 'object' && updateInput !== null
        ? (updateInput as { data?: { failureCode?: string; status?: string } })
        : undefined;
    expect(update?.data?.failureCode).toBe('AI_PROVIDER_TIMEOUT');
    expect(update?.data?.status).toBe('failed');
  });

  it('never copies an arbitrary provider error body into durable diagnostics', () => {
    expect(safeAiErrorCode(new Error('provider body: transcript text'), 'PROVIDER_FAILED')).toBe(
      'PROVIDER_FAILED',
    );
    expect(safeAiErrorCode('MEMORY_TRIGGER_PROVENANCE_UNAVAILABLE', 'PROVIDER_FAILED')).toBe(
      'MEMORY_TRIGGER_PROVENANCE_UNAVAILABLE',
    );
    expect(safeAiErrorCode(new Error('EVIDENCE_TIMEOUT'), 'PROVIDER_FAILED')).toBe(
      'EVIDENCE_TIMEOUT',
    );
    expect(safeAiErrorCode(new Error('UPPERCASE_EXTERNAL_BODY'), 'PROVIDER_FAILED')).toBe(
      'PROVIDER_FAILED',
    );
  });

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

describe('system rejection replay identity', () => {
  it('allows a new request id for the same trigger but rejects changed source membership', async () => {
    const request = {
      actorId: '33333333-3333-4333-8333-333333333333',
      exactSegmentIds: ['55555555-5555-4555-8555-555555555555'],
      expiresAt: new Date('2030-01-02T00:00:00.000Z'),
      jobType: 'working_memory_maintain',
      projectId: '22222222-2222-4222-8222-222222222222',
      requestId: 'new-request-id',
      sessionIds: ['44444444-4444-4444-8444-444444444444'],
      triggerDedupeKey: 'memory-p1-v1.2:session:final-unjudged:0123456789abcdef0123456789abcdef',
      trustedRole: 'elder',
    } satisfies FreezeAiJobRequest;
    const transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const coordinator = new AiJobCoordinatorService(
      prisma,
      {} as AiPolicyService,
      {} as AiOutputEligibilityService,
    );
    const requestIdentityHash = (
      coordinator as unknown as {
        requestIdentityHash: (
          value: FreezeAiJobRequest,
          sessionIds: readonly string[],
          memoryIds: readonly string[],
          actualQuestionIds: readonly string[],
        ) => string;
      }
    ).requestIdentityHash(request, request.sessionIds, [], []);
    const existing = {
      contextBuilderVersion: 'system-rejection-v1',
      failureCode: 'MEMORY_UNJUDGED',
      id: '11111111-1111-4111-8111-111111111111',
      inputHash: 'a'.repeat(64),
      jobType: request.jobType,
      policyRevision: 0,
      promptVersion: 'system-rejection-v1',
      projectId: request.projectId,
      requestId: 'old-request-id',
      requestIdentityHash,
      requestedBy: request.actorId,
      retentionPolicyVersion: 1,
      schemaVersion: 'system-rejection-v1',
      status: 'cancelled',
      triggerDedupeKey: request.triggerDedupeKey,
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiJob: {
        findFirst: vi.fn().mockResolvedValue(existing),
        findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
      },
      aiJobInputActualQuestion: { findMany: vi.fn().mockResolvedValue([]) },
      aiJobSessionScope: {
        findMany: vi.fn().mockResolvedValue([{ sessionId: request.sessionIds[0] }]),
      },
    };

    await expect(
      coordinator.recordRejectedSystemJob(request, 'MEMORY_UNJUDGED'),
    ).resolves.toMatchObject({ id: existing.id, replayed: true });
    await expect(
      coordinator.recordRejectedSystemJob(
        { ...request, exactSegmentIds: ['66666666-6666-4666-8666-666666666666'] },
        'MEMORY_UNJUDGED',
      ),
    ).rejects.toThrow('AI_REQUEST_IDENTITY_CONFLICT');
  });

  it('keeps legacy hydration for a stale job created by the normal freeze path', async () => {
    const request = {
      actorId: '33333333-3333-4333-8333-333333333333',
      exactSegmentIds: ['55555555-5555-4555-8555-555555555555'],
      expiresAt: new Date('2030-01-02T00:00:00.000Z'),
      jobType: 'question_generate',
      projectId: '22222222-2222-4222-8222-222222222222',
      requestId: 'question-request-id',
      sessionIds: ['44444444-4444-4444-8444-444444444444'],
      triggerDedupeKey: 'question-opening:consumer-session',
      trustedRole: 'elder',
    } satisfies FreezeAiJobRequest;
    const existing = {
      contextBuilderVersion: 'interview-context-v1.1',
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      id: '11111111-1111-4111-8111-111111111112',
      inputHash: 'a'.repeat(64),
      jobType: request.jobType,
      policyRevision: 0,
      promptVersion: 'interview-director-prompt-v1',
      projectId: request.projectId,
      requestId: request.requestId,
      requestIdentityHash: 'b'.repeat(64),
      requestedBy: request.actorId,
      retentionPolicyVersion: 1,
      schemaVersion: 'question-director-output-v1',
      status: 'failed',
      triggerDedupeKey: request.triggerDedupeKey,
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiJob: {
        findFirst: vi.fn().mockResolvedValue(existing),
        findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
      },
      aiJobInputActualQuestion: { findMany: vi.fn().mockResolvedValue([]) },
      aiJobSessionScope: {
        findMany: vi.fn().mockResolvedValue([{ sessionId: request.sessionIds[0] }]),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const coordinator = new AiJobCoordinatorService(
      prisma,
      {} as AiPolicyService,
      {} as AiOutputEligibilityService,
    );

    await expect(
      coordinator.recordRejectedSystemJob(request, 'QUESTION_OPENING_UNAVAILABLE'),
    ).resolves.toMatchObject({ id: existing.id, replayed: true, status: 'failed' });
  });
});

function fixture(): {
  assertAllowed: ReturnType<typeof vi.fn<AiPolicyService['assertAllowed']>>;
  coordinator: AiJobCoordinatorService;
  invoke: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  updateJob: ReturnType<typeof vi.fn<(input: unknown) => unknown>>;
} {
  const updateJob = vi.fn<(input: unknown) => unknown>().mockResolvedValue({ count: 1 });
  const prisma = {
    aiJob: { updateMany: updateJob },
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
  return { assertAllowed, coordinator, invoke: vi.fn<() => Promise<unknown>>(), updateJob };
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
