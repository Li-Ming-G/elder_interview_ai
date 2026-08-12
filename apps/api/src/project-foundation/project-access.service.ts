import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthPrincipal, DerivedResourceContext } from '../auth/auth.types.js';

export interface ProjectAccessSnapshot {
  assignedUserIds: readonly string[];
  createdBy: string | null;
  deletedAt: Date | null;
  projectId: string;
  status: 'draft' | 'ready' | 'active' | 'completed' | 'restricted' | 'deleted';
}

export abstract class ProjectAccessReader {
  public abstract findAccessSnapshot(projectId: string): Promise<ProjectAccessSnapshot | null>;
}

export abstract class ResourceAccessAuthorizer {
  public abstract assertResourceAccess(
    actor: AuthPrincipal,
    context: DerivedResourceContext,
  ): Promise<void>;
}

/**
 * Resolves the resource context used by the identity-domain authorization seam.
 *
 * The persistence adapter is intentionally deferred until the project and assignment
 * schema contract is complete. Access is derived only from persisted active assignments;
 * `createdBy` is provenance and never grants ownership access. Controllers must not
 * derive assignment access from request data.
 */
@Injectable()
export class ProjectAccessService {
  public constructor(
    private readonly projects: ProjectAccessReader,
    private readonly authorization: ResourceAccessAuthorizer,
  ) {}

  public async assertCanAccess(
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<ProjectAccessSnapshot> {
    const project = await this.projects.findAccessSnapshot(projectId);
    if (project === null || project.deletedAt !== null || project.status === 'deleted') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        details: {},
        message: 'Resource not found',
      });
    }
    await this.authorization.assertResourceAccess(actor, {
      assignedUserIds: project.assignedUserIds,
      ownerUserId: null,
    });
    return project;
  }

  public async assertCanReadOrdinary(
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<ProjectAccessSnapshot> {
    const project = await this.assertCanAccess(actor, projectId);
    if (project.status === 'restricted') {
      throw new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
    }
    return project;
  }
}
