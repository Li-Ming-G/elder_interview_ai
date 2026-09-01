// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InterviewApiError } from '../interview/interview-api.js';
import {
  IndexedDbNewInterviewWorkflowStore,
  type NextSessionAttempt,
} from '../interview/new-interview-workflow-store.js';
import { HomeShell } from './home-shell.js';

const USER = {
  display_name: '虚构倾听员 A',
  id: 'actor',
  role: 'interviewer',
  status: 'active',
} as const;
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('HomeShell', () => {
  afterEach(cleanup);

  it('keeps fresh-new unavailable while exposing explicit resume for an unfinished local creation', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    await workflowStore.create(USER.id);
    const navigate = vi.fn();
    const api = {
      createNextSession: vi.fn(),
      listProjectSessions: vi.fn(),
      listProjects: vi.fn().mockResolvedValue({ items: [] }),
    };

    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={workflowStore}
      />,
    );

    const resume = await screen.findByRole('button', { name: '继续未完成访谈' });
    const freshNew = screen.getByRole('button', { name: '放弃未完成访谈并新建' });
    expect((freshNew as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(freshNew);
    expect(navigate).toHaveBeenCalledWith('/interviews/new?mode=new');
    expect(await workflowStore.getActive(USER.id)).not.toBeNull();

    fireEvent.click(resume);
    expect(navigate).toHaveBeenCalledWith('/interviews/new?mode=resume');
  });

  it('fails closed when unfinished-workflow reconciliation is unavailable', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(USER.id);
    await workflowStore.put({
      ...workflow,
      projectAttempt: {
        payload: {
          approximate_age: null,
          birth_year: null,
          current_city: null,
          display_name: '虚构待核对项目',
          native_place: null,
          request_id: '33333333-3333-4333-8333-333333333333',
        },
        requestId: '33333333-3333-4333-8333-333333333333',
        response: {
          approximate_age: null,
          birth_year: null,
          created_at: '2026-08-12T00:00:00.000Z',
          created_by: USER.id,
          current_city: null,
          display_name: '虚构待核对项目',
          id: PROJECT_ID,
          native_place: null,
          status: 'draft',
          updated_at: '2026-08-12T00:00:00.000Z',
        },
        state: 'acknowledged',
      },
    });
    const navigate = vi.fn();
    const api = {
      createNextSession: vi.fn(),
      listProjectSessions: vi.fn().mockRejectedValue(new Error('authority unavailable')),
      listProjects: vi.fn().mockResolvedValue({ items: [] }),
    };

    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={workflowStore}
      />,
    );

    const newButton = await screen.findByRole('button', { name: '暂时无法安全新建访谈' });
    expect((newButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '继续未完成访谈' })).toBeNull();
    expect(screen.getByText(/暂时无法核对未完成的新建访谈；新建访谈暂不可用/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('blocks new formal capture while an accessible session still needs handling', async () => {
    const navigate = vi.fn();
    const api = {
      createNextSession: vi.fn(),
      listProjectSessions: vi.fn().mockResolvedValue({
        items: [
          {
            capture: { status: 'active' },
            capture_failure_code: null,
            created_at: '2026-08-12T08:00:00.000Z',
            duration_seconds: null,
            ended_at: null,
            finalization: null,
            home_state: 'interview_active',
            id: SESSION_ID,
            primary_action: 'return_to_interview',
            project_id: PROJECT_ID,
            review_access: 'unavailable',
            sequence_no: 1,
            started_at: '2026-08-12T08:00:00.000Z',
            status: 'recording',
          },
        ],
        next_cursor: null,
      }),
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            approximate_age: null,
            birth_year: null,
            created_at: '2026-08-12T08:00:00.000Z',
            created_by: USER.id,
            current_city: null,
            display_name: '虚构长者',
            id: PROJECT_ID,
            native_place: null,
            projection: 'ordinary',
            status: 'active',
            updated_at: '2026-08-12T08:00:00.000Z',
          },
        ],
      }),
    };
    const workflowStore = {
      getActive: vi.fn().mockResolvedValue(null),
      listNextSessionAttempts: vi.fn().mockResolvedValue([]),
    };

    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={workflowStore as never}
      />,
    );

    const newButton = await screen.findByRole('button', { name: '请先处理进行中的访谈' });
    expect((newButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '处理进行中的访谈' }));
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/interview/${SESSION_ID}/workbench`,
    );
  });

  it('exposes both explicit choices for a server-backed prestart session when local recovery lacks its session response', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(USER.id);
    await workflowStore.put({
      ...workflow,
      projectAttempt: {
        payload: {
          approximate_age: null,
          birth_year: null,
          current_city: null,
          display_name: '虚构待核对项目',
          native_place: null,
          request_id: '33333333-3333-4333-8333-333333333333',
        },
        requestId: '33333333-3333-4333-8333-333333333333',
        response: {
          approximate_age: null,
          birth_year: null,
          created_at: '2026-08-12T00:00:00.000Z',
          created_by: USER.id,
          current_city: null,
          display_name: '虚构待核对项目',
          id: PROJECT_ID,
          native_place: null,
          status: 'draft',
          updated_at: '2026-08-12T00:00:00.000Z',
        },
        state: 'acknowledged',
      },
      sessionAttempt: null,
      step: 'session',
    });
    const api = {
      createNextSession: vi.fn(),
      listProjectSessions: vi.fn().mockResolvedValue({
        items: [
          {
            capture: null,
            capture_failure_code: null,
            created_at: '2026-08-12T00:00:00.000Z',
            duration_seconds: null,
            ended_at: null,
            finalization: null,
            home_state: 'preparation_required',
            id: SESSION_ID,
            primary_action: 'continue_preparation',
            project_id: PROJECT_ID,
            review_access: 'unavailable',
            sequence_no: 1,
            started_at: null,
            status: 'device_check',
          },
        ],
        next_cursor: null,
      }),
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            approximate_age: null,
            birth_year: null,
            created_at: '2026-08-12T00:00:00.000Z',
            created_by: USER.id,
            current_city: null,
            display_name: '虚构待核对项目',
            id: PROJECT_ID,
            native_place: null,
            projection: 'ordinary',
            status: 'draft',
            updated_at: '2026-08-12T00:00:00.000Z',
          },
        ],
      }),
    };

    render(
      <HomeShell
        api={api}
        navigate={vi.fn()}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={workflowStore}
      />,
    );

    expect(await screen.findByRole('button', { name: '放弃未完成访谈并新建' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '继续未完成访谈' })).toBeTruthy();
    expect((await workflowStore.getActive(USER.id))?.workflowId).toBe(workflow.workflowId);
  });

  it('renders a restricted project only as the fixed neutral projection', async () => {
    const api = {
      createNextSession: vi.fn(),
      listProjectSessions: vi.fn(),
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            display_label: '受限项目',
            project_id: PROJECT_ID,
            projection: 'restricted',
            status: 'restricted',
            status_label: '当前不可访问',
          },
        ],
      }),
    };
    render(
      <HomeShell
        api={api}
        navigate={vi.fn()}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
      />,
    );
    expect(await screen.findByText('受限项目')).toBeTruthy();
    expect(screen.getByText('当前不可访问')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /继续|查看|返回/ })).toBeNull();
    expect(api.listProjectSessions).not.toHaveBeenCalled();
  });

  it('uses the server primary action instead of inferring from status', async () => {
    const navigate = vi.fn();
    const api = {
      createNextSession: vi.fn(),
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            approximate_age: null,
            birth_year: null,
            created_at: '2026-08-12T08:00:00.000Z',
            created_by: 'actor',
            current_city: null,
            display_name: '虚构长者',
            id: PROJECT_ID,
            native_place: null,
            projection: 'ordinary',
            status: 'active',
            updated_at: '2026-08-12T08:00:00.000Z',
          },
        ],
      }),
      listProjectSessions: vi.fn().mockResolvedValue({
        items: [
          {
            capture: null,
            capture_failure_code: null,
            created_at: '2026-08-12T08:00:00.000Z',
            duration_seconds: null,
            ended_at: null,
            finalization: null,
            home_state: 'save_failed',
            id: SESSION_ID,
            primary_action: 'view_save_facts',
            project_id: PROJECT_ID,
            review_access: 'unavailable',
            sequence_no: 1,
            started_at: null,
            status: 'completed',
          },
        ],
        next_cursor: null,
      }),
    };
    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '查看保存事实' }));
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/interview/${SESSION_ID}/save-facts`,
    );
  });

  it('shows the project action only for the complete eligible server projection', async () => {
    const navigate = vi.fn();
    const store = {
      acknowledgeNextSession: vi.fn(),
      getOrCreateNextSessionAttempt: vi.fn().mockResolvedValue({
        actorId: USER.id,
        key: `${USER.id}:${PROJECT_ID}`,
        payload: {
          basis_session_id: SESSION_ID,
          expected_basis_sequence_no: 1,
          request_id: '33333333-3333-4333-8333-333333333333',
          workflow_version: 'repeat-interview-v1',
        },
        projectId: PROJECT_ID,
        state: 'prepared',
      }),
      listNextSessionAttempts: vi.fn().mockResolvedValue([]),
      markNextSessionUnknown: vi.fn(),
    };
    const project = {
      approximate_age: null,
      birth_year: null,
      created_at: '2026-08-12T08:00:00.000Z',
      created_by: 'actor',
      current_city: null,
      display_name: '虚构长者',
      id: PROJECT_ID,
      native_place: null,
      projection: 'ordinary',
      repeat_interview: {
        basis_sequence_no: 1,
        basis_session_id: SESSION_ID,
        consent_continuation: {
          basis_consent_record_id: 'consent',
          basis_consent_text_version: 'fictional-test-continuing-consent-v1',
          reason: 'same_project_planned_interviews_covered',
          required_action: 'show_recording_reminder',
          required_consent_text_version: 'fictional-test-continuing-consent-v1',
          status: 'covered',
          workflow_version: 'continuing-consent-v1',
        },
        next_sequence_no: 2,
        primary_action: 'start_next_session',
        reason: 'eligible',
        workflow_version: 'repeat-interview-v1',
      },
      status: 'active',
      updated_at: '2026-08-12T08:00:00.000Z',
    } as const;
    const api = {
      createNextSession: vi.fn().mockResolvedValue({
        basis_sequence_no: 1,
        basis_session_id: SESSION_ID,
        project_id: PROJECT_ID,
        request_id: '33333333-3333-4333-8333-333333333333',
        session: {
          capture_failure_code: null,
          created_at: '2026-08-14T00:00:00.000Z',
          created_by: USER.id,
          duration_seconds: null,
          ended_at: null,
          id: '44444444-4444-4444-8444-444444444444',
          project_id: PROJECT_ID,
          sequence_no: 2,
          started_at: null,
          status: 'created',
          updated_at: '2026-08-14T00:00:00.000Z',
        },
      }),
      listProjectSessions: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
      listProjects: vi.fn().mockResolvedValue({ items: [project] }),
    };
    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={store as never}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '开始下一次访谈' }));
    await screen.findByText(/正在恢复上次创建下一次访谈/);
    expect(store.getOrCreateNextSessionAttempt).toHaveBeenCalledWith(
      USER.id,
      PROJECT_ID,
      SESSION_ID,
      1,
    );
  });

  it('fails closed when repeat_interview is absent', async () => {
    const api = {
      createNextSession: vi.fn(),
      listProjectSessions: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            approximate_age: null,
            birth_year: null,
            created_at: '2026-08-12T08:00:00.000Z',
            created_by: 'actor',
            current_city: null,
            display_name: '虚构长者',
            id: PROJECT_ID,
            native_place: null,
            projection: 'ordinary',
            status: 'active',
            updated_at: '2026-08-12T08:00:00.000Z',
          },
        ],
      }),
    };
    render(
      <HomeShell
        api={api}
        navigate={vi.fn()}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
      />,
    );
    expect(await screen.findByText('虚构长者')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始下一次访谈' })).toBeNull();
  });

  it('replays the frozen next-session attempt when the same page comes back online', async () => {
    const attempt = {
      actorId: USER.id,
      key: `${USER.id}:${PROJECT_ID}`,
      payload: {
        basis_session_id: SESSION_ID,
        expected_basis_sequence_no: 1,
        request_id: '33333333-3333-4333-8333-333333333333',
        workflow_version: 'repeat-interview-v1' as const,
      },
      projectId: PROJECT_ID,
      state: 'unknown_response' as const,
    };
    const store = {
      acknowledgeNextSession: vi.fn(),
      getOrCreateNextSessionAttempt: vi.fn(),
      listNextSessionAttempts: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([attempt]),
      markNextSessionUnknown: vi.fn(),
    };
    const api = {
      createNextSession: vi.fn().mockResolvedValue({
        basis_sequence_no: 1,
        basis_session_id: SESSION_ID,
        project_id: PROJECT_ID,
        request_id: attempt.payload.request_id,
        session: {
          capture: null,
          created_at: '2026-08-14T00:00:00.000Z',
          created_by: USER.id,
          ended_at: null,
          id: '44444444-4444-4444-8444-444444444444',
          project_id: PROJECT_ID,
          sequence_no: 2,
          started_at: null,
          status: 'created',
          updated_at: '2026-08-14T00:00:00.000Z',
        },
      }),
      listProjectSessions: vi.fn(),
      listProjects: vi.fn().mockResolvedValue({ items: [] }),
    };
    const navigate = vi.fn();
    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={store as never}
      />,
    );
    await screen.findByText(/还没有已分配的项目/);

    window.dispatchEvent(new Event('online'));

    await waitFor(() => {
      expect(api.createNextSession).toHaveBeenCalledWith(PROJECT_ID, attempt.payload);
    });
    expect(store.acknowledgeNextSession).toHaveBeenCalledWith(USER.id, PROJECT_ID);
  });

  it('recovers a stale unknown attempt only from the authoritative current session pointer', async () => {
    const newerSessionId = '55555555-5555-4555-8555-555555555555';
    const attempt = unknownAttempt();
    const store = unknownAttemptStore(attempt);
    const api = {
      createNextSession: vi
        .fn()
        .mockRejectedValue(
          new InterviewApiError(
            'NEXT_SESSION_ALREADY_EXISTS',
            '操作未能完成，请核对当前状态后重试',
            409,
            { sequence_no: 3, session_id: newerSessionId },
          ),
        ),
      listProjectSessions: vi.fn(),
      listProjects: vi.fn().mockResolvedValue({ items: [] }),
    };
    const navigate = vi.fn();
    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={store as never}
      />,
    );
    await screen.findByText(/还没有已分配的项目/);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/interview/${newerSessionId}/prepare`,
      );
    });
    expect(api.listProjectSessions).not.toHaveBeenCalled();
    expect(store.acknowledgeNextSession).toHaveBeenCalledWith(USER.id, PROJECT_ID);
  });

  it('rejects malformed or expanded current-session details without navigating or leaking them', async () => {
    const attempt = unknownAttempt();
    const store = unknownAttemptStore(attempt);
    const api = {
      createNextSession: vi.fn().mockRejectedValue(
        new InterviewApiError('NEXT_SESSION_ALREADY_EXISTS', 'secret server message', 409, {
          sequence_no: '3',
          session_id: 'not-a-uuid',
          secret: 'must-not-render',
        }),
      ),
      listProjectSessions: vi.fn(),
      listProjects: vi.fn().mockResolvedValue({ items: [] }),
    };
    const navigate = vi.fn();
    render(
      <HomeShell
        api={api}
        navigate={navigate}
        onAuthLost={vi.fn()}
        onLogout={vi.fn()}
        user={USER}
        workflowStore={store as never}
      />,
    );
    await screen.findByText(/还没有已分配的项目/);
    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText(/服务端返回的会话指针无法安全核对/)).toBeTruthy();
    expect(screen.queryByText(/secret|must-not-render/)).toBeNull();
    expect(api.listProjectSessions).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.acknowledgeNextSession).not.toHaveBeenCalled();
    expect(store.markNextSessionUnknown).toHaveBeenCalledWith(attempt);
  });
});

function unknownAttempt(): NextSessionAttempt {
  return {
    actorId: USER.id,
    key: `${USER.id}:${PROJECT_ID}`,
    payload: {
      basis_session_id: SESSION_ID,
      expected_basis_sequence_no: 1,
      request_id: '33333333-3333-4333-8333-333333333333',
      workflow_version: 'repeat-interview-v1' as const,
    },
    projectId: PROJECT_ID,
    state: 'unknown_response' as const,
  };
}

function unknownAttemptStore(attempt: ReturnType<typeof unknownAttempt>): {
  acknowledgeNextSession: ReturnType<typeof vi.fn>;
  getOrCreateNextSessionAttempt: ReturnType<typeof vi.fn>;
  listNextSessionAttempts: ReturnType<typeof vi.fn>;
  markNextSessionUnknown: ReturnType<typeof vi.fn>;
} {
  return {
    acknowledgeNextSession: vi.fn(),
    getOrCreateNextSessionAttempt: vi.fn(),
    listNextSessionAttempts: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([attempt]),
    markNextSessionUnknown: vi.fn(),
  };
}
