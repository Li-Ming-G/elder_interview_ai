import { Injectable } from '@nestjs/common';

export class AiPolicyUnavailableError extends Error {
  public constructor() {
    super('AI_POLICY_UNAVAILABLE');
    this.name = 'AiPolicyUnavailableError';
  }
}

export abstract class DeletionScopeReader {
  public abstract assertNoActiveScope(
    projectId: string,
    sessionIds: readonly string[],
  ): Promise<void>;
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
  ): Promise<void> {
    if (
      this.blockedProjects.has(projectId) ||
      sessionIds.some((sessionId) => this.blockedSessions.has(sessionId))
    ) {
      return Promise.reject(new AiPolicyUnavailableError());
    }
    return Promise.resolve();
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
