import { describe, expect, it, vi } from 'vitest';

import { DecisionTraceReader } from './decision-trace.reader.js';

const base = {
  id: 'trace',
  aiJobId: null,
  projectId: 'project',
  sessionId: 'session',
  retentionState: 'active',
  expiresAt: new Date(Date.now() + 60_000),
  transcriptMemberships: [],
  memoryMemberships: [],
  p3Candidates: [],
  p4Memberships: [],
  evidenceCalls: [],
};

describe('DecisionTraceReader', () => {
  it('returns references only for an active assigned actor', async () => {
    const prisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue({ ...base, aiJobId: null }) },
      interviewSession: { findMany: vi.fn().mockResolvedValue([{ id: 'session' }]) },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    } as never;
    const policy = { assertAllowed: vi.fn().mockResolvedValue({}) } as never;
    const eligibility = {} as never;
    await expect(
      new DecisionTraceReader(prisma, policy, eligibility).read('actor', 'trace'),
    ).resolves.toMatchObject({
      trace: base,
      providerProvenance: null,
    });
  });

  it('fails closed for hidden/expired or unassigned traces', async () => {
    const hidden = { ...base, retentionState: 'hidden' };
    const prisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(hidden) },
      interviewSession: { findMany: vi.fn() },
      user: { findUnique: vi.fn() },
    } as never;
    const policy = { assertAllowed: vi.fn() } as never;
    const eligibility = {} as never;
    await expect(
      new DecisionTraceReader(prisma, policy, eligibility).read('actor', 'trace'),
    ).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
    const allowedPolicy = { assertAllowed: vi.fn().mockResolvedValue({}) } as never;
    await expect(
      new DecisionTraceReader(prisma, allowedPolicy, eligibility).read('actor', 'trace'),
    ).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  it('fails closed when the source AiJob retention is hidden or consent/deletion policy is denied', async () => {
    const prisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue({ ...base, aiJobId: 'job' }) },
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({
          projectId: 'project',
          retentionState: 'hidden',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      aiJobSessionScope: { findMany: vi.fn().mockResolvedValue([{ sessionId: 'session' }]) },
      interviewSession: { findMany: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    } as never;
    const policy = {
      assertAllowed: vi.fn().mockRejectedValue(new Error('AI_POLICY_BLOCKED')),
    } as never;
    await expect(
      new DecisionTraceReader(prisma, policy, {} as never).read('actor', 'trace'),
    ).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  it('reads basis-session actual-question references from the complete frozen job scope', async () => {
    const scopedTrace = {
      ...base,
      aiJobId: 'job',
      p4Memberships: [
        {
          membershipDigest: 'd'.repeat(64),
          revision: 3,
          revisionStatus: 'available',
          sourceId: 'actual',
          sourceType: 'actual_question',
        },
      ],
    };
    const prisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(scopedTrace) },
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({
          expiresAt: new Date(Date.now() + 60_000),
          projectId: 'project',
          retentionState: 'active',
        }),
      },
      aiJobSessionScope: {
        findMany: vi.fn().mockResolvedValue([{ sessionId: 'basis' }, { sessionId: 'session' }]),
      },
      interviewSession: {
        findMany: vi.fn().mockResolvedValue([{ id: 'basis' }, { id: 'session' }]),
      },
      actualQuestion: {
        findUnique: vi.fn().mockResolvedValue({
          actualQuestionAnalysisId: 'analysis',
          id: 'actual',
          normalizedDigest: 'd'.repeat(64),
          sessionId: 'basis',
        }),
      },
      actualQuestionAnalysis: {
        findUnique: vi.fn().mockResolvedValue({ analysisRevision: 3 }),
      },
      aiProviderCall: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    } as never;
    const policy = { assertAllowed: vi.fn().mockResolvedValue({}) } as never;
    const eligibility = { isActualQuestionEligible: vi.fn().mockResolvedValue(true) } as never;
    await expect(
      new DecisionTraceReader(prisma, policy, eligibility).read('actor', 'trace'),
    ).resolves.toMatchObject({ trace: { id: 'trace' } });
    expect(policy.assertAllowed).toHaveBeenCalledWith('actor', 'project', ['basis', 'session']);
  });

  it('fails closed when automatic memory or actual-analysis eligibility is invalidated', async () => {
    const memoryTrace = {
      ...base,
      memoryMemberships: [{ memoryId: 'memory', revision: 2 }],
    };
    const memoryPrisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(memoryTrace) },
      interviewSession: { findMany: vi.fn().mockResolvedValue([{ id: 'session' }]) },
      memoryResolution: { findUnique: vi.fn().mockResolvedValue({ resolutionRevision: 2 }) },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    } as never;
    const policy = { assertAllowed: vi.fn().mockResolvedValue({}) } as never;
    const invalidMemory = {
      isMemoryResolutionEligible: vi.fn().mockResolvedValue(false),
    } as never;
    await expect(
      new DecisionTraceReader(memoryPrisma, policy, invalidMemory).read('actor', 'trace'),
    ).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');

    const actualTrace = {
      ...base,
      p4Memberships: [
        {
          membershipDigest: 'e'.repeat(64),
          revision: 4,
          revisionStatus: 'available',
          sourceId: 'actual',
          sourceType: 'actual_question',
        },
      ],
    };
    const actualPrisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(actualTrace) },
      interviewSession: { findMany: vi.fn().mockResolvedValue([{ id: 'session' }]) },
      actualQuestion: {
        findUnique: vi.fn().mockResolvedValue({
          actualQuestionAnalysisId: 'analysis',
          normalizedDigest: 'e'.repeat(64),
          sessionId: 'session',
        }),
      },
      actualQuestionAnalysis: {
        findUnique: vi.fn().mockResolvedValue({ analysisRevision: 4 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    } as never;
    const invalidActual = {
      isActualQuestionEligible: vi.fn().mockResolvedValue(false),
    } as never;
    await expect(
      new DecisionTraceReader(actualPrisma, policy, invalidActual).read('actor', 'trace'),
    ).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });
});
