import { describe, expect, it } from 'vitest';

import {
  MemoryP2DecisionTraceService,
  buildMemoryP2RunningTrace,
  traceReferenceTargetId,
  type MemoryP2RunningTraceInput,
} from './memory-p2-decision-trace.service.js';
import {
  MemoryP2RuntimeError,
  type MemoryP2DecisionTraceWrite,
  type MemoryP2DecisionTraceWritePort,
  type MemoryP2ObservabilitySink,
  type MemoryP2TraceAuthorityPort,
  type MemoryP2TracePolicyAuthority,
  type MemoryP2TraceReference,
  type MemoryP2TraceReferenceAuthority,
} from './memory-p2-observability.types.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);
const IDS = {
  actor: '10000000-0000-4000-8000-000000000001',
  checkpoint: '10000000-0000-4000-8000-000000000002',
  evidence: '10000000-0000-4000-8000-000000000003',
  generation: '10000000-0000-4000-8000-000000000004',
  input: '10000000-0000-4000-8000-000000000005',
  job: '10000000-0000-4000-8000-000000000006',
  project: '10000000-0000-4000-8000-000000000007',
  request: '10000000-0000-4000-8000-000000000008',
  resolution: '10000000-0000-4000-8000-000000000009',
  session: '10000000-0000-4000-8000-000000000010',
  sourceJob: '10000000-0000-4000-8000-000000000011',
  trace: '10000000-0000-4000-8000-000000000012',
} as const;

describe('MemoryP2DecisionTraceService', () => {
  it('builds the required neutral parent and a reference-only semantic child', async () => {
    const input = runningInput();
    const { createdWrites, service, observations } = harness(input.references);

    const result = await service.createRunning(input);

    expect(result.outcome).toBe('created');
    const write = createdWrites[0];
    expect(write?.parent).toMatchObject({
      contextDigest: null,
      contextRevision: 0,
      decisionOutcome: 'unavailable',
      directorInvoked: false,
      errorCode: null,
      gateReason: null,
      memoryOutcome: 'unjudged',
      publicationOutcome: null,
      stage: 'frozen',
      stageTimingsMs: {},
      status: 'running',
      traceKind: 'memory_layer_evolve',
      triggerType: 'memory_layer_evolve',
      workingRevision: null,
    });
    expect(Object.keys(write?.semantic ?? {}).sort()).toEqual(
      [
        'aiJobId',
        'commitDigest',
        'createdAt',
        'deletionScopeDigest',
        'planDigest',
        'proposalDigest',
        'sourceManifestHash',
        'traceId',
      ].sort(),
    );
    expect(write?.references.map(traceReferenceTargetId)).toEqual([
      IDS.checkpoint,
      IDS.sourceJob,
      IDS.input,
      IDS.evidence,
      IDS.resolution,
    ]);
    expect(observations).toEqual([
      expect.objectContaining({
        commitDigest: null,
        jobId: IDS.job,
        sourceCount: 5,
        status: 'running',
      }),
    ]);
  });

  it('requires all success digests and records a committed terminal lifecycle', async () => {
    const input = runningInput();
    const { service, terminalWrites } = harness(input.references);
    await service.terminalize({
      commitDigest: DIGEST_D,
      completedAt: new Date('2026-08-20T00:00:01.000Z'),
      errorCode: null,
      expectedJobStatuses: ['succeeded'],
      expectedTraceStatuses: ['running', 'missing'],
      identity: input.identity,
      memoryOutcome: 'checkpoint_committed',
      p2PolicyRevision: 'p2-v1',
      p2RetentionPolicyVersion: 'ret-v1',
      planDigest: DIGEST_C,
      proposalDigest: DIGEST_B,
      references: input.references,
      retentionState: 'active',
      stage: 'committed',
      status: 'succeeded',
    });
    const write = terminalWrites[0];
    expect(write?.parent).toMatchObject({
      durationMs: 1_000,
      errorCode: null,
      memoryOutcome: 'checkpoint_committed',
      stage: 'committed',
      status: 'succeeded',
    });
    expect(write?.semantic).toMatchObject({
      commitDigest: DIGEST_D,
      planDigest: DIGEST_C,
      proposalDigest: DIGEST_B,
    });
  });

  it.each([
    ['zero typed refs', { sourceKind: 'job', sourceJobId: undefined }],
    [
      'multiple typed refs',
      { sourceCheckpointId: IDS.checkpoint, sourceJobId: IDS.sourceJob, sourceKind: 'checkpoint' },
    ],
    [
      'kind mismatch',
      { sourceCheckpointId: IDS.checkpoint, sourceJobId: undefined, sourceKind: 'job' },
    ],
    ['unknown kind', { sourceJobId: IDS.sourceJob, sourceKind: 'unknown' }],
  ])('fails closed for %s', (_name, mutation) => {
    const input = runningInput();
    const references = input.references.map((reference, index) =>
      index === 1
        ? ({ ...reference, ...mutation } as unknown as MemoryP2TraceReference)
        : reference,
    );
    expect(() => buildMemoryP2RunningTrace({ ...input, references })).toThrow(
      expect.objectContaining({ code: 'P2_TRACE_UNAVAILABLE' }),
    );
  });

  it.each(['hidden', 'deleted', 'expired', 'cleanup_failed'] as const)(
    'rejects a %s source authority',
    async (readability) => {
      const input = runningInput();
      const authorities = referenceAuthorities(input.references);
      const first = authorities[0];
      if (first === undefined) throw new Error('fixture');
      authorities[0] = { ...first, readability };
      const { service } = harness(input.references, authorities);
      await expect(service.createRunning(input)).rejects.toMatchObject({
        code: 'P2_RETENTION_UNAVAILABLE',
      });
    },
  );

  it('rejects evidence revision drift and deletion-scope drift', async () => {
    const input = runningInput();
    const drifted = referenceAuthorities(input.references);
    const evidence = drifted[3];
    if (evidence === undefined) throw new Error('fixture');
    drifted[3] = { ...evidence, sourceRevision: evidence.sourceRevision + 1 };
    await expect(
      harness(input.references, drifted).service.createRunning(input),
    ).rejects.toMatchObject({ code: 'P2_SOURCE_DRIFT' });

    const deletionDrift = referenceAuthorities(input.references);
    const resolution = deletionDrift[4];
    if (resolution === undefined) throw new Error('fixture');
    deletionDrift[4] = { ...resolution, deletionScopeDigest: DIGEST_D };
    await expect(
      harness(input.references, deletionDrift).service.createRunning(input),
    ).rejects.toMatchObject({ code: 'P2_DELETION_SCOPE_DRIFT' });
  });

  it('reads projection-only policy/retention authority before writing the trace', async () => {
    const input = runningInput();
    const driftedPolicy = policyAuthority();
    driftedPolicy.p2PolicyRevision = 'p2-other';
    await expect(
      harness(input.references, undefined, driftedPolicy).service.createRunning(input),
    ).rejects.toMatchObject({ code: 'P2_POLICY_DRIFT' });

    const expired = policyAuthority();
    expired.retentionState = 'expired';
    await expect(
      harness(input.references, undefined, expired).service.createRunning(input),
    ).rejects.toMatchObject({ code: 'P2_RETENTION_UNAVAILABLE' });
  });

  it('rejects durable Context, semantic values, Proposal/Plan and provider payloads', async () => {
    const input = {
      ...runningInput(),
      providerPayload: { transcript: 'forbidden' },
    } as unknown as MemoryP2RunningTraceInput;
    const { service } = harness(input.references);
    await expect(service.createRunning(input)).rejects.toBeInstanceOf(MemoryP2RuntimeError);
    await expect(service.createRunning(input)).rejects.toMatchObject({
      code: 'P2_TRACE_UNAVAILABLE',
    });
  });

  it('rejects a success without proposal/plan/commit digest parity', async () => {
    const input = runningInput();
    const { service } = harness(input.references);
    await expect(
      service.terminalize({
        commitDigest: null,
        completedAt: new Date('2026-08-20T00:00:01.000Z'),
        errorCode: null,
        expectedJobStatuses: ['succeeded'],
        expectedTraceStatuses: ['running'],
        identity: input.identity,
        memoryOutcome: 'checkpoint_committed',
        p2PolicyRevision: 'p2-v1',
        p2RetentionPolicyVersion: 'ret-v1',
        planDigest: DIGEST_C,
        proposalDigest: DIGEST_B,
        references: input.references,
        retentionState: 'active',
        stage: 'committed',
        status: 'succeeded',
      }),
    ).rejects.toMatchObject({ code: 'P2_TRACE_UNAVAILABLE' });
  });
});

function runningInput(): MemoryP2RunningTraceInput {
  return {
    identity: {
      aiJobId: IDS.job,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      deletionScopeDigest: DIGEST_A,
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      generationId: IDS.generation,
      inputHash: DIGEST_B,
      ownerActorId: IDS.actor,
      projectId: IDS.project,
      requestId: IDS.request,
      sessionId: IDS.session,
      sourceManifestHash: DIGEST_C,
      startedAt: new Date('2026-08-20T00:00:00.000Z'),
      traceId: IDS.trace,
    },
    memoryOutcome: 'unjudged',
    p2PolicyRevision: 'p2-v1',
    p2RetentionPolicyVersion: 'ret-v1',
    references: traceReferences(),
    retentionState: 'active',
  };
}

function traceReferences(): MemoryP2TraceReference[] {
  const common = (
    inputOrder: number,
  ): {
    deletionScopeDigest: string;
    inputOrder: number;
    membershipDigest: string;
    sourceRevision: number;
  } => ({
    deletionScopeDigest: DIGEST_A,
    inputOrder,
    membershipDigest: String(inputOrder + 1).repeat(64),
    sourceRevision: inputOrder === 2 ? 0 : 1,
  });
  return [
    { ...common(0), sourceCheckpointId: IDS.checkpoint, sourceKind: 'checkpoint' },
    { ...common(1), sourceJobId: IDS.sourceJob, sourceKind: 'job' },
    { ...common(2), aiJobInputSegmentId: IDS.input, sourceKind: 'input_segment' },
    { ...common(3), evidenceId: IDS.evidence, sourceKind: 'evidence' },
    { ...common(4), resolutionAuthorityId: IDS.resolution, sourceKind: 'resolution' },
  ];
}

function referenceAuthorities(
  references: readonly MemoryP2TraceReference[],
): MemoryP2TraceReferenceAuthority[] {
  return references.map((reference) => ({
    deletionScopeDigest: reference.deletionScopeDigest,
    membershipDigest: reference.membershipDigest,
    projectId: IDS.project,
    readability: 'active',
    sessionId: IDS.session,
    sourceKind: reference.sourceKind,
    sourceRevision: reference.sourceRevision,
    targetId: traceReferenceTargetId(reference),
  }));
}

function harness(
  references: readonly MemoryP2TraceReference[],
  authorityRows = referenceAuthorities(references),
  policy = policyAuthority(),
): {
  createdWrites: MemoryP2DecisionTraceWrite[];
  service: MemoryP2DecisionTraceService;
  observations: unknown[];
  terminalWrites: MemoryP2DecisionTraceWrite[];
} {
  const createdWrites: MemoryP2DecisionTraceWrite[] = [];
  const observations: unknown[] = [];
  const terminalWrites: MemoryP2DecisionTraceWrite[] = [];
  const writes: MemoryP2DecisionTraceWritePort = {
    transactionOwnership: 'existing_ai_job_coordinator',
    createRunning({ write }): Promise<{ outcome: 'created'; trace: MemoryP2DecisionTraceWrite }> {
      createdWrites.push(write);
      return Promise.resolve({ outcome: 'created', trace: write });
    },
    writeTerminal({ write }): Promise<{ outcome: 'updated'; trace: MemoryP2DecisionTraceWrite }> {
      terminalWrites.push(write);
      return Promise.resolve({ outcome: 'updated', trace: write });
    },
  };
  const authorities: MemoryP2TraceAuthorityPort = {
    readPolicyAuthority(): Promise<MemoryP2TracePolicyAuthority> {
      return Promise.resolve(policy);
    },
    readReferenceAuthorities(): Promise<readonly MemoryP2TraceReferenceAuthority[]> {
      return Promise.resolve(authorityRows);
    },
  };
  const sink: MemoryP2ObservabilitySink = {
    record(observation): void {
      observations.push(observation);
    },
  };
  return {
    createdWrites,
    observations,
    service: new MemoryP2DecisionTraceService(writes, authorities, sink),
    terminalWrites,
  };
}

function policyAuthority(): MemoryP2TracePolicyAuthority {
  return {
    aiJobId: IDS.job,
    deletionScopeDigest: DIGEST_A,
    expiresAt: new Date('2026-09-20T00:00:00.000Z'),
    p2PolicyRevision: 'p2-v1',
    p2RetentionPolicyVersion: 'ret-v1',
    retentionState: 'active',
  };
}
