import { describe, expect, it } from 'vitest';

import { traceReferenceTargetId } from '../../apps/api/src/memory/memory-p2-decision-trace.service.js';
import { MemoryP2RecoveryService } from '../../apps/api/src/memory/memory-p2-recovery.service.js';
import {
  type MemoryP2ObservabilitySink,
  type MemoryP2RecoveryAuthority,
  type MemoryP2RecoveryCasResult,
  type MemoryP2RecoveryCommand,
  type MemoryP2RecoveryPort,
  type MemoryP2TraceReference,
  type MemoryP2TraceStage,
} from '../../apps/api/src/memory/memory-p2-observability.types.js';

const DELETION = 'a'.repeat(64);
const INPUT = 'b'.repeat(64);
const SOURCE = 'c'.repeat(64);
const PROPOSAL = 'd'.repeat(64);
const PLAN = 'e'.repeat(64);
const COMMIT = 'f'.repeat(64);
const TARGET = '9'.repeat(64);
const ID = {
  actor: '30000000-0000-4000-8000-000000000001',
  checkpoint: '30000000-0000-4000-8000-000000000002',
  evidence: '30000000-0000-4000-8000-000000000003',
  generation: '30000000-0000-4000-8000-000000000004',
  job: '30000000-0000-4000-8000-000000000005',
  layer: '30000000-0000-4000-8000-000000000006',
  project: '30000000-0000-4000-8000-000000000007',
  request: '30000000-0000-4000-8000-000000000008',
  resolution: '30000000-0000-4000-8000-000000000009',
  revision: '30000000-0000-4000-8000-000000000010',
  session: '30000000-0000-4000-8000-000000000011',
  trace: '30000000-0000-4000-8000-000000000012',
} as const;

describe('P2-C typed-fake crash/recovery adversarial matrix', () => {
  it('converges every named crash boundary from durable authority only', async () => {
    const cases: Array<{
      name: string;
      aggregate: MemoryP2RecoveryAuthority | null;
      expected:
        'not_found' | 'terminalized_uncommitted' | 'preserved_committed' | 'already_converged';
      expectedJob?: MemoryP2RecoveryAuthority['jobStatus'];
    }> = [
      { aggregate: null, expected: 'not_found', name: 'before freeze commit' },
      {
        aggregate: aggregate({ stage: 'frozen' }),
        expected: 'terminalized_uncommitted',
        expectedJob: 'unavailable',
        name: 'after freeze before provider call',
      },
      {
        aggregate: aggregate({ proposalDigest: PROPOSAL, stage: 'proposed' }),
        expected: 'terminalized_uncommitted',
        expectedJob: 'unavailable',
        name: 'after provider proposal',
      },
      {
        aggregate: aggregate({ proposalDigest: PROPOSAL, stage: 'validated' }),
        expected: 'terminalized_uncommitted',
        expectedJob: 'unavailable',
        name: 'after validation',
      },
      {
        aggregate: aggregate({ planDigest: PLAN, proposalDigest: PROPOSAL, stage: 'planned' }),
        expected: 'terminalized_uncommitted',
        expectedJob: 'unavailable',
        name: 'after transient plan',
      },
      {
        aggregate: aggregate({ planDigest: PLAN, proposalDigest: PROPOSAL, stage: 'planned' }),
        expected: 'terminalized_uncommitted',
        expectedJob: 'unavailable',
        name: 'during rolled-back atomic commit',
      },
      {
        aggregate: aggregate({ committed: committed(), jobStatus: 'running', stage: 'running' }),
        expected: 'preserved_committed',
        expectedJob: 'succeeded',
        name: 'target provenance filled by successful transaction',
      },
      {
        aggregate: aggregate({ committed: committed(), jobStatus: 'succeeded', stage: 'running' }),
        expected: 'preserved_committed',
        expectedJob: 'succeeded',
        name: 'commit response lost with running trace',
      },
      {
        aggregate: aggregate({
          committed: committed(),
          jobStatus: 'succeeded',
          stage: 'committed',
        }),
        expected: 'already_converged',
        expectedJob: 'succeeded',
        name: 'commit response lost after terminal trace',
      },
    ];

    for (const entry of cases) {
      const repository = new AdversarialPort(entry.aggregate);
      const service = new MemoryP2RecoveryService(repository, NOOP_OBSERVABILITY);
      await expect(service.reconcileJob(ID.job), entry.name).resolves.toBe(entry.expected);
      if (entry.expectedJob !== undefined)
        expect(repository.current?.jobStatus, entry.name).toBe(entry.expectedJob);
      for (const command of repository.commands) {
        const json = JSON.stringify(command);
        expect(json, entry.name).not.toMatch(
          /semanticValue|transcript|prompt|providerPayload|proposalPayload|planPayload/iu,
        );
      }
    }
  });

  it.each([
    ['hidden', 'hidden' as const, 'P2_RETENTION_UNAVAILABLE'],
    ['deleted', 'deleted' as const, 'P2_RETENTION_UNAVAILABLE'],
    ['expired', 'expired' as const, 'P2_RETENTION_UNAVAILABLE'],
  ])(
    'fails closed for a %s source and never downgrades a committed job',
    async (_name, state, code) => {
      const source = aggregate({
        committed: committed(),
        jobStatus: 'succeeded',
        stage: 'running',
      });
      const first = source.referenceAuthorities[0];
      if (first === undefined) throw new Error('fixture');
      source.referenceAuthorities = [
        { ...first, readability: state },
        ...source.referenceAuthorities.slice(1),
      ];
      const repository = new AdversarialPort(source);
      const observations: unknown[] = [];
      const service = new MemoryP2RecoveryService(repository, {
        record(observation): void {
          observations.push(observation);
        },
      });
      await expect(service.reconcileJob(ID.job)).resolves.toBe('preserved_succeeded_unreadable');
      expect(repository.commands).toHaveLength(0);
      expect(repository.current?.jobStatus).toBe('succeeded');
      expect(observations).toEqual([expect.objectContaining({ errorCode: code })]);
    },
  );

  it('fails closed for legacy NULL resolution authority and evidence drift', async () => {
    const legacy = aggregate({ committed: committed(), jobStatus: 'succeeded', stage: 'running' });
    legacy.legacyNullResolutionCount = 1;
    const legacyPort = new AdversarialPort(legacy);
    await expect(
      new MemoryP2RecoveryService(legacyPort, NOOP_OBSERVABILITY).reconcileJob(ID.job),
    ).resolves.toBe('preserved_succeeded_unreadable');
    expect(legacyPort.commands).toHaveLength(0);

    const drift = aggregate();
    const evidence = drift.referenceAuthorities.find(({ sourceKind }) => sourceKind === 'evidence');
    if (evidence === undefined) throw new Error('fixture');
    evidence.membershipDigest = '8'.repeat(64);
    const driftPort = new AdversarialPort(drift);
    await expect(
      new MemoryP2RecoveryService(driftPort, NOOP_OBSERVABILITY).reconcileJob(ID.job),
    ).resolves.toBe('terminalized_uncommitted');
    expect(driftPort.commands[0]?.errorCode).toBe('P2_SOURCE_DRIFT');
  });

  it('uses one CAS winner for concurrent scanners and fences the late provider callback', async () => {
    const repository = new AdversarialPort(aggregate());
    const first = new MemoryP2RecoveryService(repository, NOOP_OBSERVABILITY);
    const second = new MemoryP2RecoveryService(repository, NOOP_OBSERVABILITY);
    const outcomes = await Promise.all([first.reconcileJob(ID.job), second.reconcileJob(ID.job)]);
    expect(outcomes.sort()).toEqual(['cas_lost', 'terminalized_uncommitted']);
    expect(repository.appliedCount).toBe(1);
    await expect(first.createCommitFence(ID.job, 1)).rejects.toMatchObject({ code: 'P2_CAS_LOST' });
    expect(repository.businessWrites).toBe(0);
  });

  it('treats a partial target/commit boundary as inconsistent and never fabricates success or failure', async () => {
    const partial = { ...committed(), evidenceAuthorityIds: [] };
    const repository = new AdversarialPort(
      aggregate({ committed: partial, jobStatus: 'running', stage: 'running' }),
    );
    const service = new MemoryP2RecoveryService(repository, NOOP_OBSERVABILITY);
    await expect(service.reconcileJob(ID.job)).resolves.toBe('preserved_succeeded_unreadable');
    expect(repository.commands).toHaveLength(0);
    expect(repository.current?.jobStatus).toBe('running');
    expect(repository.businessWrites).toBe(0);
  });
});

interface AggregateOptions {
  committed?: MemoryP2RecoveryAuthority['committed'];
  jobStatus?: MemoryP2RecoveryAuthority['jobStatus'];
  planDigest?: string | null;
  proposalDigest?: string | null;
  stage?: MemoryP2TraceStage | 'running';
}

function aggregate(options: AggregateOptions = {}): MemoryP2RecoveryAuthority {
  const references = refs();
  const committedAuthority = options.committed ?? null;
  const jobStatus = options.jobStatus ?? 'running';
  const traceStage = options.stage === 'running' ? 'frozen' : (options.stage ?? 'frozen');
  const traceStatus =
    options.stage === 'committed' && jobStatus === 'succeeded' ? 'succeeded' : 'running';
  return {
    attemptNo: 1,
    checkpoint: {
      checkpointId: ID.checkpoint,
      deletionScopeDigest: DELETION,
      p2PolicyRevision: 'p2-v1',
      p2RetentionPolicyVersion: 'ret-v1',
      projectId: ID.project,
      sessionId: ID.session,
      sourceManifestHash: SOURCE,
      status: 'committed',
    },
    committed: committedAuthority,
    identity: {
      aiJobId: ID.job,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      deletionScopeDigest: DELETION,
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      generationId: ID.generation,
      inputHash: INPUT,
      ownerActorId: ID.actor,
      projectId: ID.project,
      requestId: ID.request,
      sessionId: ID.session,
      sourceManifestHash: SOURCE,
      startedAt: new Date('2026-08-20T00:00:00.000Z'),
      traceId: ID.trace,
    },
    jobRevision: 5,
    jobStatus,
    legacyNullResolutionCount: 0,
    migrationStatus: 'completed',
    p2PolicyRevision: 'p2-v1',
    p2RetentionPolicyVersion: 'ret-v1',
    referenceAuthorities: references.map((reference) => ({
      deletionScopeDigest: reference.deletionScopeDigest,
      membershipDigest: reference.membershipDigest,
      projectId: ID.project,
      readability: 'active',
      sessionId: ID.session,
      sourceKind: reference.sourceKind,
      sourceRevision: reference.sourceRevision,
      targetId: traceReferenceTargetId(reference),
    })),
    references,
    retentionState: 'active',
    trace: {
      commitDigest: traceStatus === 'succeeded' ? (committedAuthority?.commitDigest ?? null) : null,
      deletionScopeDigest: DELETION,
      errorCode: null,
      planDigest:
        traceStatus === 'succeeded'
          ? (committedAuthority?.planDigest ?? null)
          : (options.planDigest ?? null),
      proposalDigest:
        traceStatus === 'succeeded'
          ? (committedAuthority?.proposalDigest ?? null)
          : (options.proposalDigest ?? null),
      sourceManifestHash: SOURCE,
      stage: traceStage,
      status: traceStatus,
      traceId: ID.trace,
    },
  };
}

function committed(): NonNullable<MemoryP2RecoveryAuthority['committed']> {
  return {
    commitDigest: COMMIT,
    evidenceAuthorityIds: [ID.evidence],
    planDigest: PLAN,
    proposalDigest: PROPOSAL,
    resolutionAuthorityIds: [ID.resolution],
    targetLayer: 'mid',
    targetLayerIdentityId: ID.layer,
    targetLayerRevisionId: ID.revision,
    targetRevision: 1,
    targetRevisionDigest: TARGET,
  };
}

function refs(): MemoryP2TraceReference[] {
  return [
    {
      deletionScopeDigest: DELETION,
      inputOrder: 0,
      membershipDigest: '1'.repeat(64),
      sourceCheckpointId: ID.checkpoint,
      sourceKind: 'checkpoint',
      sourceRevision: 1,
    },
    {
      deletionScopeDigest: DELETION,
      inputOrder: 1,
      membershipDigest: '2'.repeat(64),
      sourceJobId: ID.job,
      sourceKind: 'job',
      sourceRevision: 5,
    },
    {
      deletionScopeDigest: DELETION,
      evidenceId: ID.evidence,
      inputOrder: 2,
      membershipDigest: '3'.repeat(64),
      sourceKind: 'evidence',
      sourceRevision: 1,
    },
    {
      deletionScopeDigest: DELETION,
      inputOrder: 3,
      membershipDigest: '4'.repeat(64),
      resolutionAuthorityId: ID.resolution,
      sourceKind: 'resolution',
      sourceRevision: 1,
    },
  ];
}

class AdversarialPort implements MemoryP2RecoveryPort {
  public readonly transactionOwnership = 'existing_ai_job_coordinator';
  public commands: MemoryP2RecoveryCommand[] = [];
  public appliedCount = 0;
  public businessWrites = 0;

  public constructor(public current: MemoryP2RecoveryAuthority | null) {}

  public scanCandidateJobIds(): Promise<readonly string[]> {
    return Promise.resolve(this.current === null ? [] : [ID.job]);
  }

  public readRecoveryAuthority(jobId: string): Promise<MemoryP2RecoveryAuthority | null> {
    return Promise.resolve(jobId === ID.job ? this.current : null);
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

const NOOP_OBSERVABILITY: MemoryP2ObservabilitySink = {
  record(): void {},
};
