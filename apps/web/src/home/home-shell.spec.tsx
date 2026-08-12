// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('renders a restricted project only as the fixed neutral projection', async () => {
    const api = {
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
});
