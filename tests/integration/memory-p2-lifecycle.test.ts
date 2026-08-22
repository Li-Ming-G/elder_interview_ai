import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  MemoryP2OrchestrationService,
  type MemoryP2Clock,
} from '../../apps/api/src/memory/memory-p2-orchestration.service.js';
import { MemoryP2PlanAdapter } from '../../apps/api/src/memory/memory-p2-plan-adapter.js';
import {
  DeterministicMemoryP2Provider,
  type MemoryP2ProviderPort,
  UnavailableMemoryP2Provider,
} from '../../apps/api/src/memory/memory-p2-provider.port.js';
import {
  semanticSourceKindManifestHash,
  semanticSourceManifestHash,
} from '../../apps/api/src/memory/memory-semantic-envelope-contract.js';
import type {
  MemoryP2AuthorityResult,
  MemoryP2CommitRequest,
  MemoryP2CommitResult,
  MemoryP2FreezeResult,
  MemoryP2GateResult,
  MemoryP2LongFollowUp,
  MemoryP2ProgressEvent,
  MemoryP2ProgressPort,
  MemoryP2RuntimeStorePort,
  MemoryP2SemanticContext,
  MemoryP2StoredOutcome,
  MemoryP2TerminalRequest,
  MemoryP2Trigger,
  MemoryP2TriggerRequest,
} from '../../apps/api/src/memory/memory-p2-runtime.types.js';
import { buildMemoryP2Trigger } from '../../apps/api/src/memory/memory-p2-trigger.js';

interface EnvelopeFixture {
  base: {
    context: MemoryP2SemanticContext;
  };
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json'),
    'utf8',
  ),
) as EnvelopeFixture;
const adapter = new MemoryP2PlanAdapter();

describe('P2-C synthetic lifecycle wiring', () => {
  let store: SyntheticRuntimeStore;
  let progress: RecordingProgress;

  beforeEach(() => {
    store = new SyntheticRuntimeStore();
    progress = new RecordingProgress();
  });

  it('runs ONLINE Working -> Mid, FINAL Mid, Long wake, and deterministic replay', async () => {
    const provider = new CountingProvider(new DeterministicMemoryP2Provider('test'));
    const service = createService(store, provider, progress);

    const online = buildMemoryP2Trigger(onlineRequest());
    const onlineResult = await service.run(online);
    expect(onlineResult).toMatchObject({
      outcome: 'succeeded',
      followUp: 'not_applicable',
      replayed: false,
    });
    expect(store.commits).toHaveLength(1);
    expect(store.commits[0]?.targetLayer).toBe('mid');
    expect(progress.stagesFor()).toEqual([
      'context_validated',
      'proposal_received',
      'proposal_validated',
      'plan_built',
      'authority_checked',
    ]);

    const onlineReplay = await service.run(online);
    expect(onlineReplay).toMatchObject({ outcome: 'succeeded', replayed: true });
    expect(provider.calls).toBe(1);
    expect(store.commits).toHaveLength(1);

    const final = buildMemoryP2Trigger(finalRequest());
    const finalResult = await service.run(final);
    expect(finalResult).toMatchObject({
      outcome: 'succeeded',
      followUp: 'registered',
      replayed: false,
    });
    expect(store.commits).toHaveLength(2);
    expect(store.commits[1]?.targetLayer).toBe('mid');
    expect(store.longWake).toMatchObject({ finalMidJobId: `job:${String(final.attemptNo)}` });

    const long = store.takeLongTrigger();
    const longResult = await service.run(long);
    expect(longResult).toMatchObject({
      outcome: 'succeeded',
      followUp: 'not_applicable',
      replayed: false,
    });
    expect(store.commits).toHaveLength(3);
    expect(store.commits[2]?.targetLayer).toBe('long');
    expect(store.p1LongRetrievals).toBe(0);

    const longReplay = await service.run(long);
    expect(longReplay).toMatchObject({ outcome: 'succeeded', replayed: true });
    expect(provider.calls).toBe(3);
    expect(store.commits).toHaveLength(3);
  });

  it('keeps duplicate/concurrent work single-winner and supports retry after a terminal attempt', async () => {
    const provider = new DeferredProvider(new DeterministicMemoryP2Provider('test'));
    const firstService = createService(store, provider, progress);
    const secondService = createService(store, provider, progress);
    const trigger = buildMemoryP2Trigger(onlineRequest());

    const first = firstService.run(trigger);
    await provider.waitUntilCalled();
    const concurrent = await secondService.run(trigger);
    expect(concurrent).toMatchObject({ outcome: 'in_progress', status: 'running' });
    provider.resolve();
    expect(await first).toMatchObject({ outcome: 'succeeded' });
    expect(provider.calls).toBe(1);
    expect(store.commits).toHaveLength(1);

    const unavailableStore = new SyntheticRuntimeStore({
      gateResult: { errorCode: 'P2_POLICY_DRIFT', kind: 'blocked', status: 'cancelled' },
    });
    const unavailableService = createService(
      unavailableStore,
      new UnavailableMemoryP2Provider(),
      new RecordingProgress(),
    );
    const failedTrigger = buildMemoryP2Trigger(onlineRequest());
    const failed = await unavailableService.run(failedTrigger);
    expect(failed).toMatchObject({
      errorCode: 'P2_POLICY_DRIFT',
      outcome: 'terminal',
      status: 'cancelled',
    });

    unavailableStore.gateResult = { kind: 'allowed' };
    const retry = buildMemoryP2Trigger({
      ...onlineRequest(),
      retryOf: { attemptNo: failedTrigger.attemptNo, jobId: 'job:1', status: 'cancelled' },
    });
    const retried = await createService(
      unavailableStore,
      new DeterministicMemoryP2Provider('test'),
      new RecordingProgress(),
    ).run(retry);
    expect(retried).toMatchObject({ outcome: 'succeeded', replayed: false });
    expect(unavailableStore.commits).toHaveLength(1);
  });

  it.each([
    ['source drift', 'source', 'P2_SOURCE_DRIFT', 'cancelled'],
    ['policy drift', 'policy', 'P2_POLICY_DRIFT', 'cancelled'],
    ['deletion-scope drift', 'deletion', 'P2_DELETION_SCOPE_DRIFT', 'cancelled'],
    ['retention drift', 'retention', 'P2_RETENTION_UNAVAILABLE', 'unavailable'],
  ] as const)('fails closed for %s before commit', async (_label, fault, errorCode, status) => {
    const faultStore = new SyntheticRuntimeStore({ fault });
    const provider = new CountingProvider(new DeterministicMemoryP2Provider('test'));
    const result = await createService(faultStore, provider, new RecordingProgress()).run(
      buildMemoryP2Trigger(onlineRequest()),
    );

    expect(result).toMatchObject({ errorCode, outcome: 'terminal', status });
    expect(provider.calls).toBe(0);
    expect(faultStore.commits).toHaveLength(0);
  });

  it('keeps provider unavailable, stale callbacks, rollback, and follow-up failure non-successful', async () => {
    const unavailableStore = new SyntheticRuntimeStore();
    const unavailable = await createService(
      unavailableStore,
      new UnavailableMemoryP2Provider(),
      new RecordingProgress(),
    ).run(buildMemoryP2Trigger(onlineRequest()));
    expect(unavailable).toMatchObject({
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(unavailableStore.commits).toHaveLength(0);

    const staleStore = new SyntheticRuntimeStore();
    let staleNow = new Date();
    const staleClock: MemoryP2Clock = { now: () => staleNow };
    const lateProvider: MemoryP2ProviderPort = {
      propose: (context, signal) => {
        staleNow = new Date('2031-01-01T00:00:00.000Z');
        return new DeterministicMemoryP2Provider('test').propose(context, signal);
      },
    };
    const stale = await createService(
      staleStore,
      lateProvider,
      new RecordingProgress(),
      staleClock,
    ).run(buildMemoryP2Trigger(onlineRequest()));
    expect(stale).toMatchObject({
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(staleStore.commits).toHaveLength(0);

    const rollbackStore = new SyntheticRuntimeStore({
      commitResult: { errorCode: 'P2_CAS_LOST', kind: 'cas_lost' },
    });
    const rollback = await createService(
      rollbackStore,
      new DeterministicMemoryP2Provider('test'),
      new RecordingProgress(),
    ).run(buildMemoryP2Trigger(onlineRequest()));
    expect(rollback).toMatchObject({ errorCode: 'P2_CAS_LOST', outcome: 'rebase_required' });
    expect(rollbackStore.commits).toHaveLength(0);
    expect(rollbackStore.targetWrites).toBe(0);

    const followUpStore = new SyntheticRuntimeStore({ longWakeRegistered: false });
    const final = await createService(
      followUpStore,
      new DeterministicMemoryP2Provider('test'),
      new RecordingProgress(),
    ).run(buildMemoryP2Trigger(finalRequest()));
    expect(final).toMatchObject({
      errorCode: 'P2_TERMINAL_UNAVAILABLE',
      outcome: 'follow_up_pending',
      persistedStatus: 'succeeded',
    });
    expect(followUpStore.commits).toHaveLength(1);
    expect(followUpStore.longWakeAttempts).toBe(1);
  });

  it('survives a terminalization crash by leaving the attempt for restart reconciliation', async () => {
    const crashingStore = new SyntheticRuntimeStore({ terminalizationFails: true });
    const trigger = buildMemoryP2Trigger(onlineRequest());
    const first = await createService(
      crashingStore,
      new UnavailableMemoryP2Provider(),
      new RecordingProgress(),
    ).run(trigger);
    expect(first).toMatchObject({
      errorCode: 'P2_TERMINAL_UNAVAILABLE',
      outcome: 'repair_required',
      persistedStatus: 'running',
      repair: 'terminalize',
    });

    const restarted = await createService(
      crashingStore,
      new DeterministicMemoryP2Provider('test'),
      new RecordingProgress(),
    ).run(trigger);
    expect(restarted).toMatchObject({ outcome: 'in_progress', status: 'running' });
    expect(crashingStore.commits).toHaveLength(0);
  });
});

class RecordingProgress implements MemoryP2ProgressPort {
  public readonly events: MemoryP2ProgressEvent[] = [];

  public recordProgress(event: MemoryP2ProgressEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  public stagesFor(): MemoryP2ProgressEvent['stage'][] {
    return this.events.map((event) => event.stage);
  }
}

class CountingProvider implements MemoryP2ProviderPort {
  public calls = 0;

  public constructor(private readonly provider: MemoryP2ProviderPort) {}

  public propose(context: MemoryP2SemanticContext, signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    return this.provider.propose(context, signal);
  }
}

class DeferredProvider implements MemoryP2ProviderPort {
  public calls = 0;
  private deferred: { resolve: () => void; promise: Promise<void> } | null = null;

  public constructor(private readonly provider: MemoryP2ProviderPort) {}

  public propose(context: MemoryP2SemanticContext, signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    const deferred = deferredValue<boolean>();
    this.deferred = deferred;
    return deferred.promise.then(() => this.provider.propose(context, signal));
  }

  public async waitUntilCalled(): Promise<void> {
    for (let attempt = 0; attempt < 100 && this.deferred === null; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }

  public resolve(): void {
    this.deferred?.resolve(true);
  }
}

interface SyntheticRuntimeOptions {
  commitResult?: MemoryP2CommitResult;
  fault?: 'source' | 'policy' | 'deletion' | 'retention';
  gateResult?: MemoryP2GateResult;
  longWakeRegistered?: boolean;
  terminalizationFails?: boolean;
}

interface SyntheticCommit {
  planDigest: string;
  proposalDigest: string;
  targetLayer: 'mid' | 'long';
}

class SyntheticRuntimeStore implements MemoryP2RuntimeStorePort {
  public commits: SyntheticCommit[] = [];
  public gateResult: MemoryP2GateResult = { kind: 'allowed' };
  public longWake: MemoryP2LongFollowUp | null = null;
  public longWakeAttempts = 0;
  public p1LongRetrievals = 0;
  public targetWrites = 0;

  private readonly active = new Map<string, string>();
  private readonly contexts = new Map<string, MemoryP2SemanticContext>();
  private readonly outcomes = new Map<string, MemoryP2StoredOutcome>();
  private readonly options: SyntheticRuntimeOptions;

  public constructor(options: SyntheticRuntimeOptions = {}) {
    this.options = options;
    this.gateResult = options.gateResult ?? { kind: 'allowed' };
  }

  public freezeJobCheckpointAndRunningTrace(
    trigger: MemoryP2Trigger,
  ): Promise<MemoryP2FreezeResult> {
    const stored = this.outcomes.get(trigger.requestIdentity);
    if (stored !== undefined) return Promise.resolve({ kind: 'replay', outcome: stored });
    const activeJob = this.active.get(trigger.requestIdentity);
    if (activeJob !== undefined)
      return Promise.resolve({ kind: 'in_progress', jobId: activeJob, status: 'running' });

    const context = this.contextFor(trigger);
    const jobId = `job:${String(trigger.attemptNo)}`;
    this.active.set(trigger.requestIdentity, jobId);
    this.contexts.set(trigger.requestIdentity, context);
    return Promise.resolve({
      attempt: {
        attemptNo: trigger.attemptNo,
        context,
        deadlineAt: new Date(Date.now() + 60_000),
        jobId,
        trigger,
      },
      kind: 'claimed',
    });
  }

  public preProviderGate(): Promise<MemoryP2GateResult> {
    if (this.options.fault === 'policy')
      return Promise.resolve({
        errorCode: 'P2_POLICY_DRIFT',
        kind: 'blocked',
        status: 'cancelled',
      });
    if (this.options.fault === 'deletion')
      return Promise.resolve({
        errorCode: 'P2_DELETION_SCOPE_DRIFT',
        kind: 'blocked',
        status: 'cancelled',
      });
    if (this.options.fault === 'retention')
      return Promise.resolve({
        errorCode: 'P2_RETENTION_UNAVAILABLE',
        kind: 'blocked',
        status: 'unavailable',
      });
    return Promise.resolve(this.gateResult);
  }

  public readAuthority(): Promise<MemoryP2AuthorityResult> {
    return Promise.resolve({ authorityToken: 'synthetic-authority', kind: 'current' });
  }

  public commitAuthorityAndTerminalTrace(
    request: MemoryP2CommitRequest,
  ): Promise<MemoryP2CommitResult> {
    if (this.options.commitResult?.kind === 'cas_lost')
      return Promise.resolve(this.options.commitResult);
    const targetLayer = request.attempt.context.mode === 'session_end_to_long' ? 'long' : 'mid';
    this.targetWrites += 1;
    const commit = {
      planDigest: request.plan.plan_digest,
      proposalDigest: request.plan.proposal_digest,
      targetLayer,
    } satisfies SyntheticCommit;
    this.commits.push(commit);
    const projection = {
      commit_digest: `synthetic-commit:${String(this.commits.length)}`,
      plan_digest: commit.planDigest,
      proposal_digest: commit.proposalDigest,
      target_layer: targetLayer,
    };
    this.active.delete(request.attempt.trigger.requestIdentity);
    this.outcomes.set(request.attempt.trigger.requestIdentity, {
      commitProjection: projection,
      jobId: request.attempt.jobId,
      status: 'succeeded',
    });
    return Promise.resolve({ commitProjection: projection, kind: 'committed' });
  }

  public registerLongWakeAfterFinalMid(followUp: MemoryP2LongFollowUp): Promise<boolean> {
    this.longWakeAttempts += 1;
    if (this.options.longWakeRegistered === false) return Promise.resolve(false);
    this.longWake = structuredClone(followUp);
    return Promise.resolve(true);
  }

  public terminalizeJobAndTrace(request: MemoryP2TerminalRequest): Promise<MemoryP2StoredOutcome> {
    if (this.options.terminalizationFails) return Promise.reject(new Error('synthetic crash'));
    const outcome: MemoryP2StoredOutcome = {
      errorCode: request.errorCode,
      jobId: request.attempt.jobId,
      status: request.status,
    };
    this.active.delete(request.attempt.trigger.requestIdentity);
    this.outcomes.set(request.attempt.trigger.requestIdentity, outcome);
    return Promise.resolve(outcome);
  }

  public takeLongTrigger(): MemoryP2Trigger {
    if (this.longWake === null) throw new Error('LONG_WAKE_NOT_REGISTERED');
    return buildMemoryP2Trigger({
      ...onlineRequest(),
      kind: 'capacity_checkpoint',
      sessionId: longContext().source_session_id,
      sourceManifestHash: longContext().source_manifest_hash,
      sourceSnapshotId: 'long-source-snapshot',
      targetLayerRootIdentity: 'd'.repeat(64),
    });
  }

  private contextFor(trigger: MemoryP2Trigger): MemoryP2SemanticContext {
    if (trigger.targetLayerRootIdentity === 'd'.repeat(64)) return longContext();
    if (trigger.kind === 'session_final_flush') return finalContext();
    if (this.options.fault === 'source') {
      const context = structuredClone(fixture.base.context);
      context.source_manifest_hash = 'f'.repeat(64);
      return context;
    }
    return structuredClone(fixture.base.context);
  }
}

function createService(
  store: SyntheticRuntimeStore,
  provider: MemoryP2ProviderPort,
  progress: MemoryP2ProgressPort,
  clock?: MemoryP2Clock,
): MemoryP2OrchestrationService {
  return new MemoryP2OrchestrationService(store, provider, adapter, progress, clock);
}

function onlineRequest(): MemoryP2TriggerRequest {
  const context = fixture.base.context;
  return {
    kind: 'capacity_checkpoint',
    p1SourceContractVersion: 'memory-maintainer-v1.2',
    p1TerminalJobId: null,
    policy: {
      aiPolicyRevision: 1,
      deletionScopeDigest: context.policy.deletion_scope_digest,
      p2PolicyRevision: context.policy.policy_revision,
      p2RetentionPolicyVersion: context.policy.retention_policy_version,
      retentionPolicyVersion: 1,
    },
    projectId: context.project_id,
    sessionId: context.source_session_id,
    sourceCheckpointRootIdentity: context.source_checkpoint.root_identity as string,
    sourceManifestHash: context.source_manifest_hash,
    sourceSnapshotId: context.source_checkpoint.checkpoint_id as string,
    sourceSnapshotRevision: 1,
    targetLayerRootIdentity: 'b'.repeat(64),
    targetRevision: 1,
  };
}

function finalRequest(): MemoryP2TriggerRequest {
  return {
    ...onlineRequest(),
    finalTailManifestHash: 'e'.repeat(64),
    kind: 'session_final_flush',
    p1TerminalJobId: 'p1:terminal-success',
  };
}

function finalContext(): MemoryP2SemanticContext {
  return structuredClone(fixture.base.context);
}

function longContext(): MemoryP2SemanticContext {
  const currentSessionId = '99999999-9999-4999-8999-999999999999';
  const context = structuredClone(fixture.base.context);
  const sourceMembers = context.source_members.map((member, index) => ({
    ...member,
    resolution_id:
      index === 0 ? '88888888-8888-4888-8888-888888888891' : '88888888-8888-4888-8888-888888888892',
    session_id: index === 0 ? context.source_session_id : currentSessionId,
    source_kind: index === 0 ? ('mid_resolution' as const) : ('current_resolution' as const),
    source_ref_id: `src:long:${String(index)}`,
  }));
  const sourceSessionIds = [context.source_session_id, currentSessionId];
  context.mode = 'session_end_to_long';
  context.source_session_id = currentSessionId;
  context.source_session_ids = sourceSessionIds;
  context.source_members = sourceMembers;
  context.source_manifest_hash = semanticSourceManifestHash(
    sourceMembers,
    context.evidence_membership,
  );
  context.source_checkpoint = {
    ...context.source_checkpoint,
    source_session_ids: sourceSessionIds,
    expected_member_count: sourceMembers.length,
    member_manifest_hash: context.source_manifest_hash,
    source_set: {
      kind: 'final_mid_and_current',
      mid_expected_count: 1,
      mid_manifest_hash: semanticSourceKindManifestHash('mid_resolution', sourceMembers),
      current_expected_count: 1,
      current_manifest_hash: semanticSourceKindManifestHash('current_resolution', sourceMembers),
    },
  };
  return context;
}

function deferredValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
