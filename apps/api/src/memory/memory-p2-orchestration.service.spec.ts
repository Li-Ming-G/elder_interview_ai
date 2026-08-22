import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
  base: { context: MemoryP2SemanticContext; proposal: MemoryP2SemanticProposal };
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json'),
    'utf8',
  ),
) as Fixture;
const adapter = new MemoryP2PlanAdapter();

describe('MemoryP2OrchestrationService', () => {
  it('coalesces duplicate execution and calls the provider once', async () => {
    const store = new FakeStore();
    const deferred = deferredValue<unknown>();
    const provider = new CountingProvider(() => deferred.promise);
    const service = createService(store, provider);
    const trigger = onlineTrigger();
    const first = service.run(trigger);
    const second = service.run(trigger);
    await waitFor(() => provider.calls === 1);
    deferred.resolve(structuredClone(fixture.base.proposal));
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(store.freezeCalls).toBe(1);
    expect(store.commitCalls).toBe(1);
  });

  it('replays a durable winner without calling the provider', async () => {
    const store = new FakeStore();
    store.replayOutcome = {
      commitProjection: { commit_digest: 'a'.repeat(64) },
      jobId: 'job:winner',
      status: 'succeeded',
    };
    const provider = new CountingProvider(() => Promise.resolve(fixture.base.proposal));
    const result = await createService(store, provider).run(onlineTrigger());
    expect(result).toMatchObject({ jobId: 'job:winner', outcome: 'succeeded', replayed: true });
    expect(provider.calls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });

  it('validates Context before provider and terminalizes source drift', async () => {
    const store = new FakeStore();
    store.context.source_manifest_hash = 'f'.repeat(64);
    const provider = new CountingProvider(() => Promise.resolve(fixture.base.proposal));
    const result = await createService(store, provider).run(onlineTrigger());
    expect(result).toMatchObject({
      errorCode: 'P2_SOURCE_DRIFT',
      outcome: 'terminal',
      status: 'cancelled',
    });
    expect(provider.calls).toBe(0);
    expect(store.terminalCalls).toBe(1);
  });

  it.each([
    ['P2_POLICY_DRIFT', 'cancelled'],
    ['P2_DELETION_SCOPE_DRIFT', 'cancelled'],
    ['P2_RETENTION_UNAVAILABLE', 'unavailable'],
  ] as const)('terminalizes a pre-provider %s gate', async (errorCode, status) => {
    const store = new FakeStore();
    store.gateResult = { errorCode, kind: 'blocked', status };
    const provider = new CountingProvider(() => Promise.resolve(fixture.base.proposal));
    const result = await createService(store, provider).run(onlineTrigger());
    expect(result).toMatchObject({ errorCode, outcome: 'terminal', status });
    expect(provider.calls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });

  it('aborts a late provider result before authority or commit', async () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    const store = new FakeStore();
    store.deadlineAt = now;
    const provider = new CountingProvider(() => Promise.resolve(fixture.base.proposal));
    const result = await createService(store, provider, { now: () => now }).run(onlineTrigger());
    expect(result).toMatchObject({
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(provider.calls).toBe(0);
    expect(store.readAuthorityCalls).toBe(0);
    expect(store.commitCalls).toBe(0);
  });

  it('does not turn provider unavailability into semantic success', async () => {
    const store = new FakeStore();
    const provider = new CountingProvider((context, signal) =>
      new UnavailableMemoryP2Provider().propose(context, signal),
    );
    const result = await createService(store, provider).run(onlineTrigger());
    expect(result).toMatchObject({
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      outcome: 'terminal',
      status: 'unavailable',
    });
    expect(store.commitCalls).toBe(0);
  });

  it('commits deterministic local/test output and schedules final follow-up only after commit', async () => {
    const store = new FakeStore();
    const provider = new CountingProvider((context, signal) =>
      new DeterministicMemoryP2Provider('test').propose(context, signal),
    );
    const result = await createService(store, provider).run(finalTrigger());
    expect(result).toMatchObject({ outcome: 'succeeded', followUp: 'registered' });
    expect(store.commitCalls).toBe(1);
    expect(store.scheduleCalls).toBe(1);
  });

  it('returns repair_required when terminal persistence fails honestly', async () => {
    const store = new FakeStore();
    store.terminalError = new Error('persistence unavailable');
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
  });

  it('requires rebase after source/target authority drift and performs no commit', async () => {
    const store = new FakeStore();
    store.authorityResult = {
      errorCode: 'P2_TARGET_DRIFT',
      kind: 'drifted',
      status: 'cancelled',
    };
    const provider = new CountingProvider(() => Promise.resolve(fixture.base.proposal));
    const result = await createService(store, provider).run(onlineTrigger());
    expect(result).toEqual({
      errorCode: 'P2_TARGET_DRIFT',
      jobId: 'job:1',
      outcome: 'rebase_required',
    });
    expect(store.commitCalls).toBe(0);
    expect(store.terminalCalls).toBe(1);
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

  public recordProgress(event: MemoryP2ProgressEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class FakeStore implements MemoryP2RuntimeStorePort {
  public authorityResult: MemoryP2AuthorityResult = {
    authorityToken: 'authority:current',
    kind: 'current',
  };
  public commitCalls = 0;
  public context = structuredClone(fixture.base.context);
  public deadlineAt = new Date(Date.now() + 60_000);
  public freezeCalls = 0;
  public gateResult: MemoryP2GateResult = { kind: 'allowed' };
  public longWakeRegistered = true;
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
    return Promise.resolve({
      commitProjection: { commit_digest: 'c'.repeat(64) },
      kind: 'committed',
    });
  }

  public freezeJobCheckpointAndRunningTrace(
    trigger: MemoryP2Trigger,
  ): Promise<MemoryP2FreezeResult> {
    this.freezeCalls += 1;
    if (this.replayOutcome !== null)
      return Promise.resolve({ kind: 'replay', outcome: this.replayOutcome });
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
    return Promise.resolve(this.gateResult);
  }

  public readAuthority(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2AuthorityResult> {
    void attempt;
    this.readAuthorityCalls += 1;
    return Promise.resolve(this.authorityResult);
  }

  public registerLongWakeAfterFinalMid(followUp: MemoryP2LongFollowUp): Promise<boolean> {
    void followUp;
    this.scheduleCalls += 1;
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
): MemoryP2OrchestrationService {
  return new MemoryP2OrchestrationService(store, provider, adapter, new FakeProgress(), clock);
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

function deferredValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}
