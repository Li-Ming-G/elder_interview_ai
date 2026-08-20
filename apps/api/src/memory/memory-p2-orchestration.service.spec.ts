import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MemoryP2OrchestrationService,
  type MemoryP2Clock,
} from './memory-p2-orchestration.service.js';
import { MemoryP2PlanAdapter } from './memory-p2-plan-adapter.js';
import {
  DeterministicMemoryP2Provider,
  type MemoryP2ProviderPort,
  UnavailableMemoryP2Provider,
} from './memory-p2-provider.port.js';
import type {
  MemoryP2AuthorityResult,
  MemoryP2CommitRequest,
  MemoryP2CommitResult,
  MemoryP2FreezeResult,
  MemoryP2FrozenAttempt,
  MemoryP2GateResult,
  MemoryP2LongFollowUp,
  MemoryP2ProgressEvent,
  MemoryP2ProgressPort,
  MemoryP2RuntimeStorePort,
  MemoryP2SemanticContext,
  MemoryP2SemanticProposal,
  MemoryP2StoredOutcome,
  MemoryP2TerminalRequest,
  MemoryP2Trigger,
  MemoryP2TriggerRequest,
} from './memory-p2-runtime.types.js';
import { buildMemoryP2Trigger } from './memory-p2-trigger.js';

interface Fixture {
  base: {
    context: MemoryP2SemanticContext;
    proposal: MemoryP2SemanticProposal;
  };
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json'),
    'utf8',
  ),
) as Fixture;
const adapter = new MemoryP2PlanAdapter();

afterEach(() => {
  vi.useRealTimers();
});

describe('MemoryP2OrchestrationService', () => {
  it('replays a durable duplicate without another provider call', async () => {
    const store = new FakeStore();
    store.replayOutcome = {
      commitProjection: { commit_digest: 'a'.repeat(64) },
      jobId: 'job:winner',
      status: 'succeeded',
    };
    const provider = new CountingProvider(() =>
      Promise.resolve(structuredClone(fixture.base.proposal)),
    );
    const service = createService(store, provider);

    const result = await service.run(onlineTrigger());

    expect(result).toMatchObject({ jobId: 'job:winner', outcome: 'succeeded', replayed: true });
    expect(provider.calls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });

  it('returns not_frozen without inventing a durable job identity when freeze fails', async () => {
    const store = new FakeStore();
    store.freezeError = new Error('database temporarily unavailable');
    const provider = new CountingProvider(() =>
      Promise.resolve(structuredClone(fixture.base.proposal)),
    );
    const trigger = onlineTrigger();

    await expect(createService(store, provider).run(trigger)).resolves.toEqual({
      errorCode: 'P2_TERMINAL_UNAVAILABLE',
      outcome: 'not_frozen',
      requestIdentity: trigger.requestIdentity,
    });
    expect(provider.calls).toBe(0);
  });

  it('reports repair_required rather than a fabricated terminal when terminalize fails', async () => {
    const store = new FakeStore();
    store.terminalError = new Error('terminal write failed');
    const provider = new CountingProvider((context, signal) =>
      new UnavailableMemoryP2Provider().propose(context, signal),
    );

    const result = await createService(store, provider).run(onlineTrigger());

    expect(result).toEqual({
      errorCode: 'P2_TERMINAL_UNAVAILABLE',
      jobId: 'job:1',
      outcome: 'repair_required',
      persistedStatus: 'running',
      repair: 'terminalize',
    });
    expect(provider.calls).toBe(1);
    expect(store.terminalCalls).toBe(1);
  });

  it('pure-validates Context closure before provider invocation and persists the real failure', async () => {
    const store = new FakeStore();
    store.context.source_manifest_hash = 'f'.repeat(64);
    const provider = new CountingProvider(() =>
      Promise.resolve(structuredClone(fixture.base.proposal)),
    );

    const result = await createService(store, provider).run(onlineTrigger());

    expect(result).toMatchObject({
      errorCode: 'P2_SOURCE_DRIFT',
      jobId: 'job:1',
      outcome: 'terminal',
      status: 'cancelled',
    });
    expect(provider.calls).toBe(0);
    expect(store.terminalCalls).toBe(1);
  });

  it('coalesces concurrent one-winner execution and calls the provider exactly once', async () => {
    const store = new FakeStore();
    const deferred = promiseWithResolvers<unknown>();
    const provider = new CountingProvider(() => deferred.promise);
    const service = createService(store, provider);
    const trigger = onlineTrigger();

    const first = service.run(trigger);
    const second = service.run(trigger);
    await vi.waitFor(() => {
      expect(provider.calls).toBe(1);
    });
    deferred.resolve(structuredClone(fixture.base.proposal));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(provider.calls).toBe(1);
    expect(store.freezeCalls).toBe(1);
    expect(store.commitCalls).toBe(1);
  });

  it('creates a new direct-predecessor retry attempt without reviving the failed job', async () => {
    const store = new FakeStore();
    let invocation = 0;
    const provider = new CountingProvider(() => {
      invocation += 1;
      if (invocation === 1) return Promise.reject(new Error('temporary provider failure'));
      return Promise.resolve(structuredClone(fixture.base.proposal));
    });
    const service = createService(store, provider);
    const firstTrigger = onlineTrigger();
    const first = await service.run(firstTrigger);
    const retry = buildMemoryP2Trigger({
      ...onlineRequest(),
      retryOf: { attemptNo: 1, jobId: 'job:1', status: 'unavailable' },
    });
    const retried = await service.run(retry);

    expect(first).toMatchObject({ outcome: 'terminal', status: 'unavailable' });
    expect(retried).toMatchObject({ jobId: 'job:2', outcome: 'succeeded' });
    expect(provider.calls).toBe(2);
    expect(store.frozenAttempts).toEqual([1, 2]);
    expect(store.commitCalls).toBe(1);
  });

  it('terminalizes a drifted proposal and requires rebase before any CAS write', async () => {
    const store = new FakeStore();
    store.authorityResult = {
      errorCode: 'P2_TARGET_DRIFT',
      kind: 'drifted',
      status: 'cancelled',
    };
    const provider = new CountingProvider(() =>
      Promise.resolve(structuredClone(fixture.base.proposal)),
    );
    const result = await createService(store, provider).run(onlineTrigger());

    expect(result).toEqual({
      errorCode: 'P2_TARGET_DRIFT',
      jobId: 'job:1',
      outcome: 'rebase_required',
    });
    expect(provider.calls).toBe(1);
    expect(store.commitCalls).toBe(0);
    expect(store.terminalCalls).toBe(1);
  });

  it('fences an already-expired deadline before calling the provider', async () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    const store = new FakeStore();
    store.deadlineAt = now;
    const provider = new CountingProvider(() =>
      Promise.resolve(structuredClone(fixture.base.proposal)),
    );
    const result = await createService(store, provider, { now: () => now }).run(onlineTrigger());

    expect(result).toMatchObject({
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(provider.calls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });

  it('propagates AbortSignal and returns a non-blocking cancelled terminal result', async () => {
    const store = new FakeStore();
    let observedSignal: AbortSignal | undefined;
    const provider = new CountingProvider((_context, signal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    });
    const controller = new AbortController();
    const running = createService(store, provider).run(onlineTrigger(), controller.signal);
    await vi.waitFor(() => {
      expect(provider.calls).toBe(1);
    });
    controller.abort();
    const result = await running;

    expect(result).toMatchObject({
      errorCode: 'P2_RESTART_RECOVERY',
      outcome: 'terminal',
      status: 'cancelled',
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(provider.calls).toBe(1);
    expect(store.commitCalls).toBe(0);
  });

  it('ignores a provider that resolves after the late-result fence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));
    const store = new FakeStore();
    store.deadlineAt = new Date(Date.now() + 100);
    const deferred = promiseWithResolvers<unknown>();
    const provider = new CountingProvider(() => deferred.promise);
    const running = createService(store, provider).run(onlineTrigger());
    await vi.advanceTimersByTimeAsync(101);
    const result = await running;
    deferred.resolve(structuredClone(fixture.base.proposal));
    vi.runAllTicks();

    expect(result).toMatchObject({
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(provider.calls).toBe(1);
    expect(store.readAuthorityCalls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });

  it('schedules the final tail once after successful final Mid and never before it', async () => {
    const store = new FakeStore();
    const deferred = promiseWithResolvers<unknown>();
    const provider = new CountingProvider(() => deferred.promise);
    const service = createService(store, provider);
    const trigger = finalTrigger();
    const first = service.run(trigger);
    const concurrent = service.run(trigger);
    await vi.waitFor(() => {
      expect(provider.calls).toBe(1);
    });
    deferred.resolve(structuredClone(fixture.base.proposal));
    const results = await Promise.all([first, concurrent]);

    expect(results[0]).toMatchObject({ followUp: 'registered', outcome: 'succeeded' });
    expect(provider.calls).toBe(1);
    expect(store.scheduleCalls).toBe(1);
    expect(store.longRows.size).toBe(1);

    store.replayOutcome = {
      commitProjection: store.commitProjection,
      jobId: 'job:1',
      status: 'succeeded',
    };
    await service.run(trigger);
    expect(provider.calls).toBe(1);
    expect(store.scheduleCalls).toBe(2);
    expect(store.longRows.size).toBe(1);
  });

  it.each(['false', 'throw'] as const)(
    'keeps final Mid succeeded but exposes follow_up_pending when Long registration returns %s',
    async (failureMode) => {
      const store = new FakeStore();
      if (failureMode === 'false') store.longWakeRegistered = false;
      else store.longWakeError = new Error('wake registration failed');
      const provider = new CountingProvider(() =>
        Promise.resolve(structuredClone(fixture.base.proposal)),
      );

      const result = await createService(store, provider).run(finalTrigger());

      expect(result).toMatchObject({
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        jobId: 'job:1',
        outcome: 'follow_up_pending',
        persistedStatus: 'succeeded',
        repair: 'long_wake_registration',
      });
      expect(provider.calls).toBe(1);
      expect(store.commitCalls).toBe(1);
      expect(store.terminalCalls).toBe(0);
      expect(store.longRows.size).toBe(0);
    },
  );

  it('runs deterministic and unavailable adapters through the same pre-provider gates', async () => {
    const deterministicStore = new FakeStore();
    const deterministicProvider = new CountingProvider((context, signal) =>
      new DeterministicMemoryP2Provider('test').propose(context, signal),
    );
    const deterministicProgress = new FakeProgress();
    const succeeded = await createService(
      deterministicStore,
      deterministicProvider,
      undefined,
      deterministicProgress,
    ).run(onlineTrigger());

    const unavailableStore = new FakeStore();
    const unavailableProvider = new CountingProvider((context, signal) =>
      new UnavailableMemoryP2Provider().propose(context, signal),
    );
    const unavailableProgress = new FakeProgress();
    const unavailable = await createService(
      unavailableStore,
      unavailableProvider,
      undefined,
      unavailableProgress,
    ).run(finalTrigger());

    expect(succeeded.outcome).toBe('succeeded');
    expect(unavailable).toMatchObject({ outcome: 'terminal', status: 'unavailable' });
    expect(deterministicProvider.calls).toBe(1);
    expect(unavailableProvider.calls).toBe(1);
    expect(deterministicStore.preProviderCalls).toBe(1);
    expect(unavailableStore.preProviderCalls).toBe(1);
    expect(deterministicProgress.events.map(({ stage }) => stage)).toEqual([
      'context_validated',
      'proposal_received',
      'proposal_validated',
      'plan_built',
      'authority_checked',
    ]);
    expect(
      deterministicProgress.events.find(({ stage }) => stage === 'authority_checked'),
    ).not.toHaveProperty('authorityToken');
    expect(unavailableProgress.events.map(({ stage }) => stage)).toEqual(['context_validated']);
    expect(unavailableStore.commitCalls).toBe(0);
    expect(unavailableStore.scheduleCalls).toBe(0);
  });

  it('fails closed before CAS when the non-authoritative progress port is unavailable', async () => {
    const store = new FakeStore();
    const provider = new CountingProvider(() =>
      Promise.resolve(structuredClone(fixture.base.proposal)),
    );
    const progress = new FakeProgress();
    progress.failAt = 'plan_built';
    const result = await createService(store, provider, undefined, progress).run(onlineTrigger());

    expect(result).toMatchObject({
      errorCode: 'P2_TRACE_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(provider.calls).toBe(1);
    expect(store.readAuthorityCalls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });
});

class CountingProvider implements MemoryP2ProviderPort {
  public calls = 0;

  public constructor(
    private readonly handler: (
      context: MemoryP2SemanticContext,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {}

  public propose(context: MemoryP2SemanticContext, signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    return this.handler(context, signal);
  }
}

class FakeProgress implements MemoryP2ProgressPort {
  public readonly events: MemoryP2ProgressEvent[] = [];
  public failAt: MemoryP2ProgressEvent['stage'] | null = null;

  public recordProgress(event: MemoryP2ProgressEvent): Promise<void> {
    this.events.push(event);
    return event.stage === this.failAt
      ? Promise.reject(new Error('trace unavailable'))
      : Promise.resolve();
  }
}

class FakeStore implements MemoryP2RuntimeStorePort {
  public authorityResult: MemoryP2AuthorityResult = {
    authorityToken: 'authority:current',
    kind: 'current',
  };
  public commitCalls = 0;
  public commitProjection: unknown = { commit_digest: 'c'.repeat(64) };
  public context = structuredClone(fixture.base.context);
  public deadlineAt = new Date(Date.now() + 60_000);
  public freezeCalls = 0;
  public freezeError: Error | null = null;
  public readonly frozenAttempts: number[] = [];
  public gateResult: MemoryP2GateResult = { kind: 'allowed' };
  public readonly longRows = new Set<string>();
  public longWakeError: Error | null = null;
  public longWakeRegistered = true;
  public preProviderCalls = 0;
  public readAuthorityCalls = 0;
  public replayOutcome: MemoryP2StoredOutcome | null = null;
  public scheduleCalls = 0;
  public terminalCalls = 0;
  public terminalError: Error | null = null;

  public commitAuthorityAndTerminalTrace(
    request: MemoryP2CommitRequest,
  ): Promise<MemoryP2CommitResult> {
    void request;
    this.commitCalls += 1;
    return Promise.resolve({ commitProjection: this.commitProjection, kind: 'committed' });
  }

  public freezeJobCheckpointAndRunningTrace(
    trigger: MemoryP2Trigger,
  ): Promise<MemoryP2FreezeResult> {
    this.freezeCalls += 1;
    if (this.freezeError !== null) return Promise.reject(this.freezeError);
    if (this.replayOutcome !== null)
      return Promise.resolve({ kind: 'replay', outcome: this.replayOutcome });
    this.frozenAttempts.push(trigger.attemptNo);
    return Promise.resolve({
      attempt: {
        attemptNo: trigger.attemptNo,
        context: structuredClone(this.context),
        deadlineAt: this.deadlineAt,
        jobId: `job:${String(trigger.attemptNo)}`,
        trigger,
      },
      kind: 'claimed',
    });
  }

  public preProviderGate(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2GateResult> {
    void attempt;
    this.preProviderCalls += 1;
    return Promise.resolve(this.gateResult);
  }

  public readAuthority(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2AuthorityResult> {
    void attempt;
    this.readAuthorityCalls += 1;
    return Promise.resolve(this.authorityResult);
  }

  public registerLongWakeAfterFinalMid(followUp: MemoryP2LongFollowUp): Promise<boolean> {
    this.scheduleCalls += 1;
    if (this.longWakeError !== null) return Promise.reject(this.longWakeError);
    if (this.longWakeRegistered)
      this.longRows.add(`${followUp.finalMidJobId}:${followUp.finalTailManifestHash}`);
    return Promise.resolve(this.longWakeRegistered);
  }

  public terminalizeJobAndTrace(request: MemoryP2TerminalRequest): Promise<MemoryP2StoredOutcome> {
    this.terminalCalls += 1;
    if (this.terminalError !== null) return Promise.reject(this.terminalError);
    return Promise.resolve({
      errorCode: request.errorCode,
      jobId: request.attempt.jobId,
      status: request.status,
    });
  }
}

function createService(
  store: MemoryP2RuntimeStorePort,
  provider: MemoryP2ProviderPort,
  clock: MemoryP2Clock = { now: () => new Date() },
  progress: MemoryP2ProgressPort = new FakeProgress(),
): MemoryP2OrchestrationService {
  return new MemoryP2OrchestrationService(store, provider, adapter, progress, clock);
}

function onlineTrigger(): MemoryP2Trigger {
  return buildMemoryP2Trigger(onlineRequest());
}

function finalTrigger(): MemoryP2Trigger {
  return buildMemoryP2Trigger({
    ...onlineRequest(),
    finalTailManifestHash: 'f'.repeat(64),
    kind: 'session_final_flush',
    p1TerminalJobId: 'p1:terminal',
  });
}

function onlineRequest(): MemoryP2TriggerRequest {
  return {
    kind: 'capacity_checkpoint',
    p1SourceContractVersion: 'memory-maintainer-v1.2',
    p1TerminalJobId: null,
    policy: {
      aiPolicyRevision: 2,
      deletionScopeDigest: fixture.base.context.policy.deletion_scope_digest,
      p2PolicyRevision: fixture.base.context.policy.policy_revision,
      p2RetentionPolicyVersion: fixture.base.context.policy.retention_policy_version,
      retentionPolicyVersion: 4,
    },
    projectId: fixture.base.context.project_id,
    sessionId: fixture.base.context.source_session_id,
    sourceCheckpointRootIdentity: 'c'.repeat(64),
    sourceManifestHash: fixture.base.context.source_manifest_hash,
    sourceSnapshotId: 'snapshot:one',
    sourceSnapshotRevision: 2,
    targetLayerRootIdentity: 'b'.repeat(64),
    targetRevision: 1,
  };
}

function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
