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
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
      projectAssignment: { findFirst: vi.fn().mockResolvedValue({ projectId: 'project' }) },
      interviewSession: { findUnique: vi.fn().mockResolvedValue({ projectId: 'project' }) },
    } as never;
    const policy = { assertAllowed: vi.fn().mockResolvedValue({}) } as never;
    await expect(
      new DecisionTraceReader(prisma, policy).read('actor', 'trace'),
    ).resolves.toMatchObject({
      trace: base,
      providerProvenance: null,
    });
  });

  it('fails closed for hidden/expired or unassigned traces', async () => {
    const hidden = { ...base, retentionState: 'hidden' };
    const prisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(hidden) },
      user: { findUnique: vi.fn() },
      projectAssignment: { findFirst: vi.fn() },
      interviewSession: { findUnique: vi.fn() },
    } as never;
    const policy = { assertAllowed: vi.fn() } as never;
    await expect(new DecisionTraceReader(prisma, policy).read('actor', 'trace')).rejects.toThrow(
      'DECISION_TRACE_UNAVAILABLE',
    );
    const allowedPolicy = { assertAllowed: vi.fn().mockResolvedValue({}) } as never;
    await expect(
      new DecisionTraceReader(prisma, allowedPolicy).read('actor', 'trace'),
    ).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  it('fails closed when the source AiJob retention is hidden or consent/deletion policy is denied', async () => {
    const prisma = {
      decisionTrace: { findUnique: vi.fn().mockResolvedValue({ ...base, aiJobId: 'job' }) },
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({
          retentionState: 'hidden',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      user: { findUnique: vi.fn() },
      projectAssignment: { findFirst: vi.fn() },
      interviewSession: { findUnique: vi.fn() },
    } as never;
    const policy = {
      assertAllowed: vi.fn().mockRejectedValue(new Error('AI_POLICY_BLOCKED')),
    } as never;
    await expect(new DecisionTraceReader(prisma, policy).read('actor', 'trace')).rejects.toThrow(
      'DECISION_TRACE_UNAVAILABLE',
    );
  });
});
