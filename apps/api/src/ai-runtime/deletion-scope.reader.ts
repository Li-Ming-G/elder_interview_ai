import { Injectable } from '@nestjs/common';

export class AiPolicyUnavailableError extends Error {
  public constructor() {
    super('AI_POLICY_UNAVAILABLE');
    this.name = 'AiPolicyUnavailableError';
  }
}

/** Local/test-only signal used to verify the consumer's deletion-active projection. */
export class AiDeletionActiveFixtureError extends AiPolicyUnavailableError {
  public constructor() {
    super();
    this.name = 'AiDeletionActiveFixtureError';
  }
}

export interface DeletionScopeSnapshot {
  fenceRevision: number;
}

export abstract class DeletionScopeReader {
  public abstract assertNoActiveScope(
    projectId: string,
    sessionIds: readonly string[],
  ): Promise<DeletionScopeSnapshot>;
}

/** Production binding until DEV-008 provides the authoritative deletion producer. */
@Injectable()
export class UnavailableDeletionScopeReader extends DeletionScopeReader {
  public override assertNoActiveScope(): Promise<never> {
    return Promise.reject(new AiPolicyUnavailableError());
  }
}

/**
 * Local/test contract fixture only. It verifies fail-closed consumers; it is not
 * deletion runtime coverage and must stay reported as NOT IMPLEMENTED / NOT VERIFIED.
 */
@Injectable()
export class LocalTestDeletionScopeFixtureReader extends DeletionScopeReader {
  private readonly blockedProjects = new Set<string>();
  private readonly blockedSessions = new Set<string>();
  private fenceRevision = 1;

  public setFenceRevision(fenceRevision: number): void {
    if (!Number.isInteger(fenceRevision) || fenceRevision < 0) {
      throw new Error('invalid deletion fixture fence revision');
    }
    this.fenceRevision = fenceRevision;
  }

  public blockProject(projectId: string): void {
    this.blockedProjects.add(projectId);
  }

  public blockSession(sessionId: string): void {
    this.blockedSessions.add(sessionId);
  }

  public clear(): void {
    this.blockedProjects.clear();
    this.blockedSessions.clear();
  }

  public override assertNoActiveScope(
    projectId: string,
    sessionIds: readonly string[],
  ): Promise<DeletionScopeSnapshot> {
    if (
      this.blockedProjects.has(projectId) ||
      sessionIds.some((sessionId) => this.blockedSessions.has(sessionId))
    ) {
      return Promise.reject(new AiDeletionActiveFixtureError());
    }
    return Promise.resolve({ fenceRevision: this.fenceRevision });
  }
}

export interface BoundaryPolicySnapshot {
  policyRevision: number;
  blockedCanonicalKeys: readonly string[];
}

export abstract class BoundaryPolicyReader {
  public abstract read(projectId: string): Promise<BoundaryPolicySnapshot>;
}

/** Production binding until the authoritative boundary producer/read model exists. */
@Injectable()
export class UnavailableBoundaryPolicyReader extends BoundaryPolicyReader {
  public override read(): Promise<never> {
    return Promise.reject(new AiPolicyUnavailableError());
  }
}
