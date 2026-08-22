import { MemoryP2PlanAdapter, MemoryP2PlanError } from './memory-p2-plan-adapter.js';
import { MemoryP2ProviderError, type MemoryP2ProviderPort } from './memory-p2-provider.port.js';
import type {
  MemoryP2AuthorityResult,
  MemoryP2CommitResult,
  MemoryP2ErrorCode,
  MemoryP2FreezeResult,
  MemoryP2FrozenAttempt,
  MemoryP2GateResult,
  MemoryP2ProgressPort,
  MemoryP2RunResult,
  MemoryP2RuntimeStorePort,
  MemoryP2StoredOutcome,
  MemoryP2TerminalStatus,
  MemoryP2Trigger,
} from './memory-p2-runtime.types.js';

export interface MemoryP2Clock {
  now(): Date;
}

export class SystemMemoryP2Clock implements MemoryP2Clock {
  public now(): Date {
    return new Date();
  }
}

interface ProviderValue {
  kind: 'value';
  value: unknown;
}

interface ProviderFailure {
  error: unknown;
  kind: 'error';
}

interface ProviderAborted {
  cause: 'deadline' | 'external';
  kind: 'aborted';
}

type ProviderResult = ProviderValue | ProviderFailure | ProviderAborted;

type TerminalizeResult =
  { kind: 'stored'; outcome: MemoryP2StoredOutcome } | { kind: 'repair_required' };

export class MemoryP2OrchestrationService {
  private readonly active = new Map<string, Promise<MemoryP2RunResult>>();

  public constructor(
    private readonly store: MemoryP2RuntimeStorePort,
    private readonly provider: MemoryP2ProviderPort,
    private readonly planAdapter: MemoryP2PlanAdapter,
    private readonly progress: MemoryP2ProgressPort,
    private readonly clock: MemoryP2Clock = new SystemMemoryP2Clock(),
  ) {}

  /** Coalesces only the in-process duplicate; durable one-winner remains store-owned. */
  public run(trigger: MemoryP2Trigger, signal?: AbortSignal): Promise<MemoryP2RunResult> {
    const existing = this.active.get(trigger.requestIdentity);
    if (existing !== undefined) return existing;
    const running = this.execute(trigger, signal);
    this.active.set(trigger.requestIdentity, running);
    void running.finally(() => {
      if (this.active.get(trigger.requestIdentity) === running)
        this.active.delete(trigger.requestIdentity);
    });
    return running;
  }

  private async execute(
    trigger: MemoryP2Trigger,
    signal?: AbortSignal,
  ): Promise<MemoryP2RunResult> {
    let frozen: MemoryP2FreezeResult;
    try {
      frozen = await this.store.freezeJobCheckpointAndRunningTrace(trigger);
    } catch {
      return {
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        outcome: 'not_frozen',
        requestIdentity: trigger.requestIdentity,
      };
    }
    if (frozen.kind === 'in_progress')
      return { jobId: frozen.jobId, outcome: 'in_progress', status: frozen.status };
    if (frozen.kind === 'replay') return this.replay(trigger, frozen.outcome);
    try {
      return await this.executeAttempt(trigger, frozen.attempt, signal);
    } catch {
      return {
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        jobId: frozen.attempt.jobId,
        outcome: 'repair_required',
        persistedStatus: 'running',
        repair: 'startup_reconciliation',
      };
    }
  }

  private async executeAttempt(
    trigger: MemoryP2Trigger,
    attempt: MemoryP2FrozenAttempt,
    signal?: AbortSignal,
  ): Promise<MemoryP2RunResult> {
    let context: MemoryP2FrozenAttempt['context'];
    try {
      context = this.planAdapter.validateContext(attempt.context);
    } catch (error) {
      const code = error instanceof MemoryP2PlanError ? error.errorCode : 'P2_SOURCE_DRIFT';
      return this.terminal(attempt, code, 'cancelled', false);
    }

    if (
      !(await this.recordProgress({
        jobId: attempt.jobId,
        sourceManifestHash: context.source_manifest_hash,
        stage: 'context_validated',
      }))
    )
      return this.terminal(attempt, 'P2_TRACE_UNAVAILABLE', 'unavailable', false);

    let gate: MemoryP2GateResult;
    try {
      gate = await this.store.preProviderGate(attempt);
    } catch {
      return this.terminal(attempt, 'P2_TERMINAL_UNAVAILABLE', 'unavailable', false);
    }
    if (gate.kind === 'blocked') return this.terminal(attempt, gate.errorCode, gate.status, false);

    const providerResult = await this.callProvider(attempt, signal);
    if (providerResult.kind === 'aborted') {
      return this.terminal(
        attempt,
        providerResult.cause === 'deadline' ? 'P2_PROVIDER_UNAVAILABLE' : 'P2_RESTART_RECOVERY',
        providerResult.cause === 'deadline' ? 'unavailable' : 'cancelled',
        false,
      );
    }
    if (providerResult.kind === 'error') {
      const unavailable =
        providerResult.error instanceof MemoryP2ProviderError ||
        !isAbortError(providerResult.error);
      return this.terminal(
        attempt,
        unavailable ? 'P2_PROVIDER_UNAVAILABLE' : 'P2_RESTART_RECOVERY',
        unavailable ? 'unavailable' : 'cancelled',
        false,
      );
    }
    if (this.isLate(attempt) || signal?.aborted === true)
      return this.terminal(
        attempt,
        this.isLate(attempt) ? 'P2_PROVIDER_UNAVAILABLE' : 'P2_RESTART_RECOVERY',
        this.isLate(attempt) ? 'unavailable' : 'cancelled',
        false,
      );

    if (
      !(await this.recordProgress({
        jobId: attempt.jobId,
        sourceManifestHash: context.source_manifest_hash,
        stage: 'proposal_received',
      }))
    )
      return this.terminal(attempt, 'P2_TRACE_UNAVAILABLE', 'unavailable', false);

    let validated;
    try {
      validated = this.planAdapter.build(context, providerResult.value);
    } catch (error) {
      const code = error instanceof MemoryP2PlanError ? error.errorCode : 'P2_TERMINAL_UNAVAILABLE';
      return this.terminal(attempt, code, 'failed', false);
    }

    if (
      !(await this.recordProgress({
        jobId: attempt.jobId,
        proposalDigest: validated.plan.proposal_digest,
        sourceManifestHash: validated.plan.source_manifest_hash,
        stage: 'proposal_validated',
      }))
    )
      return this.terminal(attempt, 'P2_TRACE_UNAVAILABLE', 'unavailable', false);
    if (
      !(await this.recordProgress({
        jobId: attempt.jobId,
        planDigest: validated.plan.plan_digest,
        proposalDigest: validated.plan.proposal_digest,
        sourceManifestHash: validated.plan.source_manifest_hash,
        stage: 'plan_built',
      }))
    )
      return this.terminal(attempt, 'P2_TRACE_UNAVAILABLE', 'unavailable', false);

    let authority: MemoryP2AuthorityResult;
    try {
      authority = await this.store.readAuthority(attempt);
    } catch {
      return this.terminal(attempt, 'P2_TERMINAL_UNAVAILABLE', 'unavailable', false);
    }
    if (authority.kind === 'drifted') {
      const terminalized = await this.terminal(
        attempt,
        authority.errorCode,
        authority.status,
        false,
      );
      return terminalized.outcome === 'terminal'
        ? { errorCode: authority.errorCode, jobId: attempt.jobId, outcome: 'rebase_required' }
        : terminalized;
    }
    if (
      !(await this.recordProgress({
        jobId: attempt.jobId,
        sourceManifestHash: context.source_manifest_hash,
        stage: 'authority_checked',
      }))
    )
      return this.terminal(attempt, 'P2_TRACE_UNAVAILABLE', 'unavailable', false);
    if (this.isLate(attempt) || isAborted(signal)) {
      const code = this.isLate(attempt) ? 'P2_PROVIDER_UNAVAILABLE' : 'P2_RESTART_RECOVERY';
      return this.terminal(
        attempt,
        code,
        this.isLate(attempt) ? 'unavailable' : 'cancelled',
        false,
      );
    }

    let committed: MemoryP2CommitResult;
    try {
      committed = await this.store.commitAuthorityAndTerminalTrace({
        attempt,
        authorityToken: authority.authorityToken,
        plan: validated.plan,
        proposal: validated.proposal,
      });
    } catch {
      return this.terminal(attempt, 'P2_TERMINAL_UNAVAILABLE', 'unavailable', false);
    }
    if (committed.kind === 'cas_lost') {
      const terminalized = await this.terminal(attempt, committed.errorCode, 'cancelled', false);
      return terminalized.outcome === 'terminal'
        ? { errorCode: committed.errorCode, jobId: attempt.jobId, outcome: 'rebase_required' }
        : terminalized;
    }
    return this.completeSucceeded(trigger, attempt.jobId, committed.commitProjection, false);
  }

  private async replay(
    trigger: MemoryP2Trigger,
    stored: MemoryP2StoredOutcome,
  ): Promise<MemoryP2RunResult> {
    if (stored.status === 'succeeded')
      return this.completeSucceeded(trigger, stored.jobId, stored.commitProjection, true);
    return {
      errorCode: stored.errorCode,
      jobId: stored.jobId,
      outcome: 'terminal',
      replayed: true,
      status: stored.status,
    };
  }

  private async terminal(
    attempt: MemoryP2FrozenAttempt,
    errorCode: MemoryP2ErrorCode,
    status: MemoryP2TerminalStatus,
    replayed: boolean,
  ): Promise<MemoryP2RunResult> {
    const terminalized = await this.safeTerminalize(attempt, errorCode, status);
    if (terminalized.kind === 'repair_required')
      return {
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        jobId: attempt.jobId,
        outcome: 'repair_required',
        persistedStatus: 'running',
        repair: 'terminalize',
      };
    const stored = terminalized.outcome;
    if (stored.status === 'succeeded')
      return this.completeSucceeded(
        attempt.trigger,
        stored.jobId,
        stored.commitProjection,
        replayed,
      );
    return {
      errorCode: stored.errorCode,
      jobId: stored.jobId,
      outcome: 'terminal',
      replayed,
      status: stored.status,
    };
  }

  private async safeTerminalize(
    attempt: MemoryP2FrozenAttempt,
    errorCode: MemoryP2ErrorCode,
    status: MemoryP2TerminalStatus,
  ): Promise<TerminalizeResult> {
    try {
      return {
        kind: 'stored',
        outcome: await this.store.terminalizeJobAndTrace({ attempt, errorCode, status }),
      };
    } catch {
      return { kind: 'repair_required' };
    }
  }

  private async completeSucceeded(
    trigger: MemoryP2Trigger,
    finalMidJobId: string,
    finalMidCommitProjection: unknown,
    replayed: boolean,
  ): Promise<MemoryP2RunResult> {
    if (trigger.jobKind !== 'mid_final' || trigger.finalTailManifestHash === undefined)
      return {
        commitProjection: finalMidCommitProjection,
        followUp: 'not_applicable',
        jobId: finalMidJobId,
        outcome: 'succeeded',
        replayed,
      };
    let registered: boolean;
    try {
      registered = await this.store.registerLongWakeAfterFinalMid({
        finalMidCommitProjection,
        finalMidJobId,
        finalTailManifestHash: trigger.finalTailManifestHash,
        projectId: trigger.projectId,
        sessionId: trigger.sessionId,
      });
    } catch {
      registered = false;
    }
    if (!registered)
      return {
        commitProjection: finalMidCommitProjection,
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        jobId: finalMidJobId,
        outcome: 'follow_up_pending',
        persistedStatus: 'succeeded',
        repair: 'long_wake_registration',
        replayed,
      };
    return {
      commitProjection: finalMidCommitProjection,
      followUp: 'registered',
      jobId: finalMidJobId,
      outcome: 'succeeded',
      replayed,
    };
  }

  private isLate(attempt: MemoryP2FrozenAttempt): boolean {
    return this.clock.now().getTime() >= attempt.deadlineAt.getTime();
  }

  private async recordProgress(
    event: Parameters<MemoryP2ProgressPort['recordProgress']>[0],
  ): Promise<boolean> {
    try {
      await this.progress.recordProgress(event);
      return true;
    } catch {
      return false;
    }
  }

  private async callProvider(
    attempt: MemoryP2FrozenAttempt,
    externalSignal?: AbortSignal,
  ): Promise<ProviderResult> {
    if (this.isLate(attempt)) return { cause: 'deadline', kind: 'aborted' };
    if (externalSignal?.aborted === true) return { cause: 'external', kind: 'aborted' };

    const controller = new AbortController();
    let resolveAbort: ((result: ProviderAborted) => void) | undefined;
    const aborted = new Promise<ProviderAborted>((resolve) => {
      resolveAbort = resolve;
    });
    const onExternalAbort = (): void => {
      controller.abort(externalSignal?.reason);
      resolveAbort?.({ cause: 'external', kind: 'aborted' });
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const remaining = Math.max(0, attempt.deadlineAt.getTime() - this.clock.now().getTime());
    const timer = setTimeout(() => {
      controller.abort(new DOMException('P2 provider deadline exceeded', 'TimeoutError'));
      resolveAbort?.({ cause: 'deadline', kind: 'aborted' });
    }, remaining);
    let provider: Promise<ProviderResult>;
    try {
      provider = this.provider
        .propose(attempt.context, controller.signal)
        .then<ProviderResult, ProviderResult>(
          (value) => ({ kind: 'value', value }),
          (error: unknown) => ({ error, kind: 'error' }),
        );
    } catch (error) {
      provider = Promise.resolve({ error, kind: 'error' });
    }
    try {
      return await Promise.race([provider, aborted]);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
