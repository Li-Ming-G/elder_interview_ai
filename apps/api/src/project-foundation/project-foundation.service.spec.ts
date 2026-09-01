import { describe, expect, it, vi } from 'vitest';

import { ProjectFoundationService } from './project-foundation.service.js';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_SESSION_ID = '30000000-0000-4000-8000-000000000002';

describe('ProjectFoundationService prestart discard', () => {
  it.each([
    ['draft', null],
    ['ready', 'created'],
    ['ready', 'device_check'],
  ] as const)('allows a pre-formal %s/%s target', async (projectStatus, sessionStatus) => {
    const harness = createHarness(projectStatus, sessionStatus);

    const response = await harness.service.discardPrestartInterview(
      harness.actor,
      PROJECT_ID,
      request(sessionStatus === null ? null : SESSION_ID),
    );

    expect(response).toMatchObject({
      project_id: PROJECT_ID,
      result: 'discarded',
      session_id: sessionStatus === null ? null : SESSION_ID,
    });
    const updateCall = harness.project.update.mock.calls[0] as
      [{ data: { deletedAt: unknown; status: string }; where: { id: string } }] | undefined;
    expect(updateCall?.[0]).toMatchObject({
      data: { status: 'deleted' },
      where: { id: PROJECT_ID },
    });
    expect(updateCall?.[0].data.deletedAt).toBeInstanceOf(Date);
    expect(harness.session.delete).not.toHaveBeenCalled();
  });

  it.each(['recording', 'interrupted', 'processing', 'completed'] as const)(
    'denies %s even when the target has no newly listed capture row',
    async (status) => {
      const harness = createHarness('ready', status);

      await expect(
        harness.service.discardPrestartInterview(harness.actor, PROJECT_ID, request(SESSION_ID)),
      ).rejects.toMatchObject({ response: { code: 'PRESTART_DISCARD_UNAVAILABLE' } });
      expect(harness.project.update).not.toHaveBeenCalled();
    },
  );

  it('denies the evidence boundary even if the session still says created', async () => {
    const harness = createHarness('ready', 'created', { audioObject: true });

    await expect(
      harness.service.discardPrestartInterview(harness.actor, PROJECT_ID, request(SESSION_ID)),
    ).rejects.toMatchObject({ response: { code: 'PRESTART_DISCARD_UNAVAILABLE' } });
    expect(harness.project.update).not.toHaveBeenCalled();
    expect(harness.session.delete).not.toHaveBeenCalled();
  });

  it('replays an identical discard without changing the server result', async () => {
    const harness = createHarness('ready', 'device_check');
    const input = request(SESSION_ID);

    const first = await harness.service.discardPrestartInterview(harness.actor, PROJECT_ID, input);
    const second = await harness.service.discardPrestartInterview(harness.actor, PROJECT_ID, input);

    expect(second).toEqual(first);
    expect(harness.project.update).toHaveBeenCalledTimes(1);
    expect(harness.idempotency.create).toHaveBeenCalledTimes(1);
  });

  it('does not silently target another session when the local identity is stale', async () => {
    const harness = createHarness('ready', 'created');

    await expect(
      harness.service.discardPrestartInterview(
        harness.actor,
        PROJECT_ID,
        request(OTHER_SESSION_ID),
      ),
    ).rejects.toMatchObject({ response: { code: 'PRESTART_DISCARD_TARGET_STALE' } });
    expect(harness.project.update).not.toHaveBeenCalled();
  });

  it('soft-deletes the old project while preserving its session identity', async () => {
    const harness = createHarness('ready', 'created');

    const discarded = await harness.service.discardPrestartInterview(
      harness.actor,
      PROJECT_ID,
      request(null),
    );
    harness.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      status: 'deleted',
      deletedAt: new Date(),
    });
    const alreadyDiscarded = await harness.service.discardPrestartInterview(
      harness.actor,
      PROJECT_ID,
      request(null),
    );

    expect(discarded.session_id).toBe(SESSION_ID);
    expect(alreadyDiscarded).toMatchObject({
      project_id: PROJECT_ID,
      result: 'already_discarded',
      session_id: SESSION_ID,
    });
    expect(harness.session.delete).not.toHaveBeenCalled();
  });

  it('requires the authenticated actor to retain the active assignment', async () => {
    const harness = createHarness('ready', 'created');
    harness.assignment.findFirst.mockResolvedValue(null);

    await expect(
      harness.service.discardPrestartInterview(harness.actor, PROJECT_ID, request(SESSION_ID)),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(harness.project.update).not.toHaveBeenCalled();
  });
});

function request(sessionId: string | null): {
  request_id: string;
  session_id: string | null;
  workflow_version: 'prestart-discard-v1';
} {
  return {
    request_id: globalThis.crypto.randomUUID(),
    session_id: sessionId,
    workflow_version: 'prestart-discard-v1',
  };
}

type MockFunction = ReturnType<typeof vi.fn>;

type Harness = {
  actor: Parameters<ProjectFoundationService['discardPrestartInterview']>[0];
  assignment: { findFirst: MockFunction };
  idempotency: { create: MockFunction; findUnique: MockFunction };
  project: { findUnique: MockFunction; update: MockFunction };
  service: ProjectFoundationService;
  session: { delete: MockFunction; findMany: MockFunction };
};

function createHarness(
  projectStatus: string,
  sessionStatus: string | null,
  evidence: { audioObject?: boolean; captureGeneration?: boolean } = {},
): Harness {
  const idempotency = {
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      idempotencyRecords.set(data.requestId as string, {
        ...data,
        id: globalThis.crypto.randomUUID(),
      });
    }),
    findUnique: vi.fn(
      ({ where }: { where: { requestId: string } }) =>
        idempotencyRecords.get(where.requestId) ?? null,
    ),
  };
  const idempotencyRecords = new Map<string, Record<string, unknown>>();
  const project = {
    findUnique: vi
      .fn()
      .mockResolvedValue({ id: PROJECT_ID, status: projectStatus, deletedAt: null }),
    update: vi.fn(),
  };
  const session = {
    delete: vi.fn(),
    findMany: vi.fn().mockResolvedValue(
      sessionStatus === null
        ? []
        : [
            {
              id: SESSION_ID,
              status: sessionStatus,
              audioObjects: evidence.audioObject ? [{ id: 'audio' }] : [],
              captureGenerations: evidence.captureGeneration ? [{ id: 'capture' }] : [],
            },
          ],
    ),
  };
  const assignment = { findFirst: vi.fn().mockResolvedValue({ id: 'assignment' }) };
  const transaction = {
    $executeRaw: vi.fn(),
    auditLog: { create: vi.fn() },
    elderProject: project,
    idempotencyRecord: idempotency,
    interviewSession: session,
    projectAssignment: assignment,
  };
  const prisma = {
    $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    idempotencyRecord: idempotency,
  };
  const service = new ProjectFoundationService(
    prisma as never,
    { assertCanReadOrdinary: vi.fn() } as never,
    { assertRole: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    actor: {
      id: ACTOR_ID,
      displayName: '虚构倾听员',
      role: 'interviewer' as const,
      status: 'active' as const,
      sessionId: 'session-token',
      sessionTokenHash: 'hash',
    },
    assignment,
    idempotency,
    project,
    service,
    session,
  };
}
