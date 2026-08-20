import { describe, expect, it } from 'vitest';

import { traceReferenceTargetId } from './memory-p2-decision-trace.service.js';
import { MemoryP2RecoveryService } from './memory-p2-recovery.service.js';
import {
  type MemoryP2ObservabilitySink,
  type MemoryP2RecoveryAuthority,
  type MemoryP2RecoveryCasResult,
  type MemoryP2RecoveryCommand,
  type MemoryP2RecoveryPort,
  type MemoryP2TraceReference,
} from './memory-p2-observability.types.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);
const IDS = {
  actor: '20000000-0000-4000-8000-000000000001',
  checkpoint: '20000000-0000-4000-8000-000000000002',
  evidence: '20000000-0000-4000-8000-000000000003',
  generation: '20000000-0000-4000-8000-000000000004',
  input: '20000000-0000-4000-8000-000000000005',
  job: '20000000-0000-4000-8000-000000000006',
  layerIdentity: '20000000-0000-4000-8000-000000000007',
  layerRevision: '20000000-0000-4000-8000-000000000008',
  project: '20000000-0000-4000-8000-000000000009',
  request: '20000000-0000-4000-8000-000000000010',
  resolution: '20000000-0000-4000-8000-000000000011',
  session: '20000000-0000-4000-8000-000000000012',
  trace: '20000000-0000-4000-8000-000000000013',
} as const;

describe('MemoryP2RecoveryService', () => {
  it('terminalizes a durable running attempt without reconstructing transient proposal or plan', async () => {
    const repository = new FakeRecoveryRepository(authority({ trace: null }));
    const { service, observations } = harness(repository);

    await expect(service.reconcileJob(IDS.job)).resolves.toBe('terminalized_uncommitted');

    expect(repository.commands).toHaveLength(1);
    expect(repository.commands[0]).toMatchObject({
      errorCode: 'P2_RESTART_RECOVERY',
      expectedJobStatuses: ['pending', 'running'],
      expectedTraceStatuses: ['missing', 'running'],
      kind: 'terminalize_uncommitted',
      terminalStatus: 'unavailable',
      trace: {
        parent: { stage: 'recovered', status: 'unavailable' },
        semantic: { commitDigest: null, planDigest: null, proposalDigest: null },
      },
    });
    expect(repository.current?.committed).toBeNull();
    expect(observations).toEqual([
      expect.objectContaining({ errorCode: 'P2_RESTART_RECOVERY', status: 'unavailable' }),
    ]);
  });

  it('repairs a missing/running trace from complete committed authority without downgrading success', async () => {
    for (const trace of [null, runningTrace()] as const) {
      const repository = new FakeRecoveryRepository(
        authority({ committed: committedAuthority(), jobStatus: 'succeeded', trace }),
      );
      const { service } = harness(repository);
      await expect(service.reconcileJob(IDS.job)).resolves.toBe('preserved_committed');
      expect(repository.commands[0]).toMatchObject({
        errorCode: null,
        expectedJobStatuses: ['succeeded'],
        kind: 'preserve_committed',
        terminalStatus: 'succeeded',
        trace: {
          parent: { memoryOutcome: 'checkpoint_committed', status: 'succeeded' },
          semantic: { commitDigest: D, planDigest: C, proposalDigest: B },
        },
      });
      expect(repository.current?.jobStatus).toBe('succeeded');
    }
  });

  it('promotes complete commit proof left behind a running job instead of terminalizing it', async () => {
    const repository = new FakeRecoveryRepository(
      authority({ committed: committedAuthority(), jobStatus: 'running', trace: runningTrace() }),
    );
    const { service } = harness(repository);
    await expect(service.reconcileJob(IDS.job)).resolves.toBe('preserved_committed');
    expect(repository.current).toMatchObject({ jobStatus: 'succeeded' });
    expect(repository.commands[0]?.kind).toBe('preserve_committed');
  });

  it('does not overwrite a terminal succeeded trace whose committed digest authority drifts', async () => {
    const committed = committedAuthority();
    const trace = committedTrace(committed);
    trace.commitDigest = E;
    const repository = new FakeRecoveryRepository(
      authority({ committed, jobStatus: 'succeeded', trace }),
    );
    const { service, observations } = harness(repository);
    await expect(service.reconcileJob(IDS.job)).resolves.toBe('preserved_succeeded_unreadable');
    expect(repository.commands).toHaveLength(0);
    expect(observations).toEqual([expect.objectContaining({ errorCode: 'P2_TRACE_UNAVAILABLE' })]);
  });

  it.each([
    ['hidden source', { authorityReadability: 'hidden' as const }, 'P2_RETENTION_UNAVAILABLE'],
    ['deleted source', { authorityReadability: 'deleted' as const }, 'P2_RETENTION_UNAVAILABLE'],
    ['expired source', { authorityReadability: 'expired' as const }, 'P2_RETENTION_UNAVAILABLE'],
    ['legacy NULL authority', { legacyNullResolutionCount: 1 }, 'P2_SOURCE_DRIFT'],
    ['evidence revision drift', { evidenceRevisionDrift: true }, 'P2_SOURCE_DRIFT'],
    ['policy drift', { policyDrift: true }, 'P2_POLICY_DRIFT'],
    [
      'migration interrupted',
      { migrationStatus: 'interrupted' as const },
      'P2_MIGRATION_UNAVAILABLE',
    ],
  ])(
    'preserves succeeded business authority when %s makes the trace unreadable',
    async (_name, mutation, code) => {
      const repository = new FakeRecoveryRepository(
        authority(
          { committed: committedAuthority(), jobStatus: 'succeeded', trace: null },
          mutation,
        ),
      );
      const { service, observations } = harness(repository);
      await expect(service.reconcileJob(IDS.job)).resolves.toBe('preserved_succeeded_unreadable');
      expect(repository.commands).toHaveLength(0);
      expect(repository.current?.jobStatus).toBe('succeeded');
      expect(observations).toEqual([expect.objectContaining({ errorCode: code })]);
    },
  );

  it('does not downgrade partial commit evidence at a transaction boundary', async () => {
    const partial = { ...committedAuthority(), commitDigest: '' };
    const repository = new FakeRecoveryRepository(
      authority({ committed: partial, jobStatus: 'running', trace: runningTrace() }),
    );
    const { service } = harness(repository);
    await expect(service.reconcileJob(IDS.job)).resolves.toBe('preserved_succeeded_unreadable');
    expect(repository.commands).toHaveLength(0);
    expect(repository.current?.jobStatus).toBe('running');
  });

  it('repairs a missing trace for an already terminal non-success job without changing the job', async () => {
    const repository = new FakeRecoveryRepository(authority({ jobStatus: 'failed', trace: null }));
    const { service } = harness(repository);
    await expect(service.reconcileJob(IDS.job)).resolves.toBe('repaired_terminal_trace');
    expect(repository.commands[0]).toMatchObject({
      expectedJobStatuses: ['failed'],
      kind: 'repair_terminal_trace',
      terminalStatus: 'failed',
    });
    expect(repository.current?.jobStatus).toBe('failed');
  });

  it('lets exactly one concurrent scanner win the recovery CAS', async () => {
    const repository = new FakeRecoveryRepository(authority({ trace: null }));
    const first = harness(repository).service;
    const second = harness(repository).service;

    const outcomes = await Promise.all([first.reconcileJob(IDS.job), second.reconcileJob(IDS.job)]);

    expect(outcomes.sort()).toEqual(['cas_lost', 'terminalized_uncommitted']);
    expect(repository.commands).toHaveLength(2);
    expect(repository.appliedCount).toBe(1);
    expect(repository.current).toMatchObject({ jobStatus: 'unavailable' });
  });

  it('issues a commit fence only for the same durable running attempt and rejects a late callback', async () => {
    const repository = new FakeRecoveryRepository(authority());
    const { service } = harness(repository);
    await expect(service.createCommitFence(IDS.job, 1)).resolves.toMatchObject({
      attemptNo: 1,
      checkpointId: IDS.checkpoint,
      jobRevision: 7,
      sourceManifestHash: C,
    });
    await service.reconcileJob(IDS.job);
    await expect(service.createCommitFence(IDS.job, 1)).rejects.toMatchObject({
      code: 'P2_CAS_LOST',
    });
    await expect(service.createCommitFence(IDS.job, 2)).rejects.toMatchObject({
      code: 'P2_CAS_LOST',
    });
  });

  it('deduplicates scanner candidates and keeps an already committed trace idempotent', async () => {
    const committed = committedAuthority();
    const repository = new FakeRecoveryRepository(
      authority({ committed, jobStatus: 'succeeded', trace: committedTrace(committed) }),
    );
    repository.scanIds = [IDS.job, IDS.job];
    const { service } = harness(repository);
    await expect(service.reconcilePersistedState()).resolves.toEqual([
      { jobId: IDS.job, outcome: 'already_converged' },
    ]);
    expect(repository.commands).toHaveLength(0);
  });
});

interface AuthorityMutation {
  authorityReadability?: 'hidden' | 'deleted' | 'expired';
  evidenceRevisionDrift?: boolean;
  legacyNullResolutionCount?: number;
  migrationStatus?: MemoryP2RecoveryAuthority['migrationStatus'];
  policyDrift?: boolean;
}

function authority(
  overrides: Partial<MemoryP2RecoveryAuthority> = {},
  mutation: AuthorityMutation = {},
): MemoryP2RecoveryAuthority {
  const references = traceReferences();
  const referenceAuthorities = references.map((reference) => ({
    deletionScopeDigest: reference.deletionScopeDigest,
    membershipDigest: reference.membershipDigest,
    projectId: IDS.project,
    readability: 'active' as const,
    sessionId: IDS.session,
    sourceKind: reference.sourceKind,
    sourceRevision: reference.sourceRevision,
    targetId: traceReferenceTargetId(reference),
  }));
  if (mutation.authorityReadability !== undefined && referenceAuthorities[0] !== undefined)
    referenceAuthorities[0] = {
      ...referenceAuthorities[0],
      readability: mutation.authorityReadability,
    };
  if (mutation.evidenceRevisionDrift && referenceAuthorities[2] !== undefined)
    referenceAuthorities[2] = {
      ...referenceAuthorities[2],
      sourceRevision: referenceAuthorities[2].sourceRevision + 1,
    };
  const policy = mutation.policyDrift ? 'p2-other' : 'p2-v1';
  return {
    attemptNo: 1,
    checkpoint: {
      checkpointId: IDS.checkpoint,
      deletionScopeDigest: A,
      p2PolicyRevision: 'p2-v1',
      p2RetentionPolicyVersion: 'ret-v1',
      projectId: IDS.project,
      sessionId: IDS.session,
      sourceManifestHash: C,
      status: 'committed',
    },
    committed: null,
    identity: {
      aiJobId: IDS.job,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      deletionScopeDigest: A,
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      generationId: IDS.generation,
      inputHash: B,
      ownerActorId: IDS.actor,
      projectId: IDS.project,
      requestId: IDS.request,
      sessionId: IDS.session,
      sourceManifestHash: C,
      startedAt: new Date('2026-08-20T00:00:00.000Z'),
      traceId: IDS.trace,
    },
    jobRevision: 7,
    jobStatus: 'running',
    legacyNullResolutionCount: mutation.legacyNullResolutionCount ?? 0,
    migrationStatus: mutation.migrationStatus ?? 'completed',
    p2PolicyRevision: policy,
    p2RetentionPolicyVersion: 'ret-v1',
    referenceAuthorities,
    references,
    retentionState: 'active',
    trace: runningTrace(),
    ...overrides,
  };
}

function traceReferences(): MemoryP2TraceReference[] {
  return [
    {
      deletionScopeDigest: A,
      inputOrder: 0,
      membershipDigest: '1'.repeat(64),
      sourceCheckpointId: IDS.checkpoint,
      sourceKind: 'checkpoint',
      sourceRevision: 1,
    },
    {
      deletionScopeDigest: A,
      inputOrder: 1,
      membershipDigest: '2'.repeat(64),
      sourceJobId: IDS.job,
      sourceKind: 'job',
      sourceRevision: 7,
    },
    {
      deletionScopeDigest: A,
      evidenceId: IDS.evidence,
      inputOrder: 2,
      membershipDigest: '3'.repeat(64),
      sourceKind: 'evidence',
      sourceRevision: 1,
    },
    {
      deletionScopeDigest: A,
      inputOrder: 3,
      membershipDigest: '4'.repeat(64),
      resolutionAuthorityId: IDS.resolution,
      sourceKind: 'resolution',
      sourceRevision: 1,
    },
  ];
}

function committedAuthority(): NonNullable<MemoryP2RecoveryAuthority['committed']> {
  return {
    commitDigest: D,
    evidenceAuthorityIds: [IDS.evidence],
    planDigest: C,
    proposalDigest: B,
    resolutionAuthorityIds: [IDS.resolution],
    targetLayer: 'mid',
    targetLayerIdentityId: IDS.layerIdentity,
    targetLayerRevisionId: IDS.layerRevision,
    targetRevision: 1,
    targetRevisionDigest: E,
  };
}

function runningTrace(): NonNullable<MemoryP2RecoveryAuthority['trace']> {
  return {
    commitDigest: null,
    deletionScopeDigest: A,
    errorCode: null,
    planDigest: null,
    proposalDigest: null,
    sourceManifestHash: C,
    stage: 'frozen',
    status: 'running',
    traceId: IDS.trace,
  };
}

function committedTrace(
  committed: NonNullable<MemoryP2RecoveryAuthority['committed']>,
): NonNullable<MemoryP2RecoveryAuthority['trace']> {
  return {
    commitDigest: committed.commitDigest,
    deletionScopeDigest: A,
    errorCode: null,
    planDigest: committed.planDigest,
    proposalDigest: committed.proposalDigest,
    sourceManifestHash: C,
    stage: 'committed',
    status: 'succeeded',
    traceId: IDS.trace,
  };
}

class FakeRecoveryRepository implements MemoryP2RecoveryPort {
  public readonly transactionOwnership = 'existing_ai_job_coordinator';
  public commands: MemoryP2RecoveryCommand[] = [];
  public appliedCount = 0;
  public scanIds: string[] = [IDS.job];

  public constructor(public current: MemoryP2RecoveryAuthority | null) {}

  public scanCandidateJobIds(): Promise<readonly string[]> {
    return Promise.resolve(this.scanIds);
  }

  public readRecoveryAuthority(jobId: string): Promise<MemoryP2RecoveryAuthority | null> {
    return Promise.resolve(jobId === IDS.job ? this.current : null);
  }

  public applyRecovery(command: MemoryP2RecoveryCommand): Promise<MemoryP2RecoveryCasResult> {
    this.commands.push(command);
    const current = this.current;
    if (
      current === null ||
      current.jobRevision !== command.expectedJobRevision ||
      current.attemptNo !== command.expectedAttemptNo ||
      (current.checkpoint?.checkpointId ?? null) !== command.expectedCheckpointId ||
      current.identity.sourceManifestHash !== command.expectedSourceManifestHash ||
      current.identity.deletionScopeDigest !== command.expectedDeletionScopeDigest ||
      current.p2PolicyRevision !== command.expectedP2PolicyRevision ||
      current.p2RetentionPolicyVersion !== command.expectedP2RetentionPolicyVersion ||
      (current.committed?.targetLayerRevisionId ?? null) !==
        command.expectedTargetLayerRevisionId ||
      (current.committed?.targetRevision ?? null) !== command.expectedTargetRevision ||
      (current.committed?.targetRevisionDigest ?? null) !== command.expectedTargetRevisionDigest ||
      (current.committed?.commitDigest ?? null) !== command.expectedCommitDigest ||
      !command.expectedJobStatuses.includes(current.jobStatus) ||
      !command.expectedTraceStatuses.includes(current.trace?.status ?? 'missing')
    )
      return Promise.resolve({ outcome: 'cas_lost' });
    this.appliedCount += 1;
    this.current = {
      ...current,
      jobRevision: current.jobRevision + 1,
      jobStatus:
        command.kind === 'repair_terminal_trace' ? current.jobStatus : command.terminalStatus,
      trace: {
        commitDigest: command.trace.semantic.commitDigest,
        deletionScopeDigest: command.trace.semantic.deletionScopeDigest,
        errorCode: command.trace.parent.errorCode,
        planDigest: command.trace.semantic.planDigest,
        proposalDigest: command.trace.semantic.proposalDigest,
        sourceManifestHash: command.trace.semantic.sourceManifestHash,
        stage: command.trace.parent.stage,
        status: command.trace.parent.status,
        traceId: command.trace.parent.traceId,
      },
    };
    return Promise.resolve({ outcome: 'applied' });
  }
}

function harness(repository: MemoryP2RecoveryPort): {
  service: MemoryP2RecoveryService;
  observations: unknown[];
} {
  const observations: unknown[] = [];
  const sink: MemoryP2ObservabilitySink = {
    record(observation): void {
      observations.push(observation);
    },
  };
  return { observations, service: new MemoryP2RecoveryService(repository, sink) };
}
