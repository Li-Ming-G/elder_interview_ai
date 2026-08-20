import { MemoryP2PlanAdapter, MemoryP2PlanError } from './memory-p2-plan-adapter.js';
import { MemoryP2ProviderError, type MemoryP2ProviderPort } from './memory-p2-provider.port.js';
import type {
  MemoryP2AuthorityResult,
  MemoryP2CommitResult,
  MemoryP2ErrorCode,
  MemoryP2FrozenAttempt,
  MemoryP2GateResult,
  MemoryP2RunResult,
  MemoryP2RuntimeStorePort,
  MemoryP2StoredOutcome,
  MemoryP2TerminalStatus,
  MemoryP2TracePort,
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

export class MemoryP2OrchestrationService {
  private readonly active = new Map<string, Promise<MemoryP2RunResult>>();

  public constructor(
    private readonly store: MemoryP2RuntimeStorePort,
    private readonly provider: MemoryP2ProviderPort,
    private readonly planAdapter: MemoryP2PlanAdapter,
    private readonly traces: MemoryP2TracePort,
    private readonly clock: MemoryP2Clock = new SystemMemoryP2Clock(),
  ) {}

  public run(trigger: MemoryP2Trigger, signal?: AbortSignal): Promise<MemoryP2RunResult> {
    const existing = this.active.get(trigger.requestIdentity);
    if (existing !== undefined) return existing;
    const running = this.execute(trigger, signal).catch((): MemoryP2RunResult => ({
      errorCode: 'P2_TERMINAL_UNAVAILABLE',
      jobId: trigger.requestIdentity,
      outcome: 'terminal',
      replayed: false,
      status: 'unavailable',
    }));
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
    const frozen = await this.store.freezeJobCheckpointAndRunningTrace(trigger);
    if (frozen.kind === 'in_progress')
      return { jobId: frozen.jobId, outcome: 'in_progress', status: frozen.status };
    if (frozen.kind === 'replay') return this.replay(trigger, frozen.outcome);
    const { attempt } = frozen;

    let gate: MemoryP2GateResult;
    try {
      gate = await this.store.preProviderGate(attempt);
    } catch {
      return this.terminal(attempt, 'P2_TERMINAL_UNAVAILABLE', 'unavailable', false);
    }
    if (gate.kind === 'blocked') return this.terminal(attempt, gate.errorCode, gate.status, false);

    try {
      this.planAdapter.validateContext(attempt.context);
    } catch (error) {
      const code = error instanceof MemoryP2PlanError ? error.errorCode : 'P2_SOURCE_DRIFT';
      return this.terminal(attempt, code, 'cancelled', false);
    }

    if (
      !(await this.recordStage({
        attemptNo: attempt.attemptNo,
        jobId: attempt.jobId,
        sourceManifestHash: attempt.context.source_manifest_hash,
        stage: 'provider_started',
      }))
    )
      return this.terminal(attempt, 'P2_TRACE_UNAVAILABLE', 'unavailable', false);

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

    let validated;
    try {
      validated = this.planAdapter.build(attempt.context, providerResult.value);
    } catch (error) {
      const code = error instanceof MemoryP2PlanError ? error.errorCode : 'P2_TERMINAL_UNAVAILABLE';
      return this.terminal(attempt, code, 'failed', false);
    }

    if (
      !(await this.recordStage({
        jobId: attempt.jobId,
        planDigest: validated.plan.plan_digest,
        proposalDigest: validated.plan.proposal_digest,
        sourceManifestHash: validated.plan.source_manifest_hash,
        stage: 'plan_validated',
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
      await this.safeTerminalize(attempt, authority.errorCode, authority.status);
      return { errorCode: authority.errorCode, jobId: attempt.jobId, outcome: 'rebase_required' };
    }
    if (
      !(await this.recordStage({
        authorityToken: authority.authorityToken,
        jobId: attempt.jobId,
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
      await this.safeTerminalize(attempt, committed.errorCode, 'cancelled');
      return { errorCode: committed.errorCode, jobId: attempt.jobId, outcome: 'rebase_required' };
    }
    const longFollowUpScheduled = await this.scheduleLong(
      trigger,
      attempt.jobId,
      committed.commitProjection,
    );
    return {
      commitProjection: committed.commitProjection,
      jobId: attempt.jobId,
      longFollowUpScheduled,
      outcome: 'succeeded',
      replayed: false,
    };
  }

  private async replay(
    trigger: MemoryP2Trigger,
    stored: MemoryP2StoredOutcome,
  ): Promise<MemoryP2RunResult> {
    if (stored.status === 'succeeded') {
      const longFollowUpScheduled = await this.scheduleLong(
        trigger,
        stored.jobId,
        stored.commitProjection,
      );
      return {
        commitProjection: stored.commitProjection,
        jobId: stored.jobId,
        longFollowUpScheduled,
        outcome: 'succeeded',
        replayed: true,
      };
    }
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
    const stored = await this.safeTerminalize(attempt, errorCode, status);
    if (stored.status === 'succeeded') {
      return {
        commitProjection: stored.commitProjection,
        jobId: stored.jobId,
        longFollowUpScheduled: false,
        outcome: 'succeeded',
        replayed,
      };
    }
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
  ): Promise<MemoryP2StoredOutcome> {
    try {
      return await this.store.terminalizeJobAndTrace({ attempt, errorCode, status });
    } catch {
      return {
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        jobId: attempt.jobId,
        status: 'unavailable',
      };
    }
  }

  private async scheduleLong(
    trigger: MemoryP2Trigger,
    finalMidJobId: string,
    finalMidCommitProjection: unknown,
  ): Promise<boolean> {
    if (trigger.jobKind !== 'mid_final' || trigger.finalTailManifestHash === undefined)
      return false;
    try {
      await this.store.scheduleLongAfterFinalMid({
        finalMidCommitProjection,
        finalMidJobId,
        finalTailManifestHash: trigger.finalTailManifestHash,
        projectId: trigger.projectId,
        sessionId: trigger.sessionId,
      });
      return true;
    } catch {
      return false;
    }
  }

  private isLate(attempt: MemoryP2FrozenAttempt): boolean {
    return this.clock.now().getTime() >= attempt.deadlineAt.getTime();
  }

  private async recordStage(
    stage: Parameters<MemoryP2TracePort['recordStage']>[0],
  ): Promise<boolean> {
    try {
      await this.traces.recordStage(stage);
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
    let abortCause: ProviderAborted['cause'] = 'deadline';
    let resolveAbort: ((result: ProviderAborted) => void) | undefined;
    const aborted = new Promise<ProviderAborted>((resolve) => {
      resolveAbort = resolve;
    });
    const onExternalAbort = (): void => {
      abortCause = 'external';
      controller.abort(externalSignal?.reason);
      resolveAbort?.({ cause: abortCause, kind: 'aborted' });
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const remaining = Math.max(0, attempt.deadlineAt.getTime() - this.clock.now().getTime());
    const timer = setTimeout(() => {
      abortCause = 'deadline';
      controller.abort(new DOMException('P2 provider deadline exceeded', 'TimeoutError'));
      resolveAbort?.({ cause: abortCause, kind: 'aborted' });
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
