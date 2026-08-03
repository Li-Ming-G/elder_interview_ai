import { describe, expect, it, vi } from 'vitest';

import type { AuthPrincipal } from '../auth/auth.types.js';
import {
  ProjectAccessService,
  type ProjectAccessReader,
  type ProjectAccessSnapshot,
  type ResourceAccessAuthorizer,
} from './project-access.service.js';

const ACTOR: AuthPrincipal = {
  displayName: '虚构倾听员 A',
  id: '00000000-0000-4000-8000-000000000001',
  role: 'interviewer',
  sessionId: '00000000-0000-4000-8000-000000000002',
  sessionTokenHash: 'test-only-token-hash',
  status: 'active',
};

const PROJECT: ProjectAccessSnapshot = {
  assignedUserIds: [ACTOR.id],
  createdBy: ACTOR.id,
  deletedAt: null,
  projectId: '00000000-0000-4000-8000-000000000003',
  status: 'draft',
};

describe('ProjectAccessService', () => {
  it('derives authorization only from the persisted project snapshot', async () => {
    const reader: ProjectAccessReader = {
      findAccessSnapshot: vi.fn(() => Promise.resolve(PROJECT)),
    };
    const assertResourceAccess = vi.fn(() => Promise.resolve());
    const authorization: ResourceAccessAuthorizer = { assertResourceAccess };

    await expect(
      new ProjectAccessService(reader, authorization).assertCanAccess(ACTOR, PROJECT.projectId),
    ).resolves.toBe(PROJECT);
    expect(assertResourceAccess).toHaveBeenCalledWith(ACTOR, {
      assignedUserIds: [ACTOR.id],
      ownerUserId: null,
    });
  });

  it('does not treat the project creator as an owner when no active assignment exists', async () => {
    const projectWithoutAssignment: ProjectAccessSnapshot = {
      ...PROJECT,
      assignedUserIds: [],
      createdBy: ACTOR.id,
    };
    const reader: ProjectAccessReader = {
      findAccessSnapshot: vi.fn(() => Promise.resolve(projectWithoutAssignment)),
    };
    const denial = new Error('forbidden');
    const assertResourceAccess = vi.fn(
      (_actor: AuthPrincipal, context: { assignedUserIds: readonly string[] }) =>
        context.assignedUserIds.includes(ACTOR.id) ? Promise.resolve() : Promise.reject(denial),
    );
    const authorization: ResourceAccessAuthorizer = { assertResourceAccess };

    await expect(
      new ProjectAccessService(reader, authorization).assertCanAccess(ACTOR, PROJECT.projectId),
    ).rejects.toBe(denial);
    expect(assertResourceAccess).toHaveBeenCalledWith(ACTOR, {
      assignedUserIds: [],
      ownerUserId: null,
    });
  });

  it.each([
    ['missing', null],
    ['soft-deleted', { ...PROJECT, deletedAt: new Date('2026-08-03T00:00:00Z') }],
    ['privacy-deleted', { ...PROJECT, status: 'deleted' as const }],
  ])('does not authorize a %s project', async (_caseName, snapshot) => {
    const reader: ProjectAccessReader = {
      findAccessSnapshot: vi.fn(() => Promise.resolve(snapshot)),
    };
    const assertResourceAccess = vi.fn(() => Promise.resolve());
    const authorization: ResourceAccessAuthorizer = { assertResourceAccess };

    await expect(
      new ProjectAccessService(reader, authorization).assertCanAccess(ACTOR, PROJECT.projectId),
    ).rejects.toMatchObject({ status: 404 });
    expect(assertResourceAccess).not.toHaveBeenCalled();
  });

  it('propagates the identity seam denial for an unassigned actor', async () => {
    const reader: ProjectAccessReader = {
      findAccessSnapshot: vi.fn(() => Promise.resolve(PROJECT)),
    };
    const denial = new Error('forbidden');
    const authorization: ResourceAccessAuthorizer = {
      assertResourceAccess: vi.fn(() => Promise.reject(denial)),
    };

    await expect(
      new ProjectAccessService(reader, authorization).assertCanAccess(ACTOR, PROJECT.projectId),
    ).rejects.toBe(denial);
  });
});
