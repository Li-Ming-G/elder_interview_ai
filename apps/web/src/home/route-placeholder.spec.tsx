// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSessionListItem } from '@elder-interview/contracts';

import { SessionPlaceholderRoute } from './route-placeholder.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('SessionPlaceholderRoute', () => {
  afterEach(cleanup);

  it('rejects a typed review deep link when the server projection does not allow review', async () => {
    const api = {
      listProjects: vi.fn(),
      listProjectSessions: vi.fn().mockResolvedValue({
        items: [sessionItem('continue_preparation', 'unavailable')],
        next_cursor: null,
      }),
    };
    render(
      <SessionPlaceholderRoute
        api={api}
        kind="review"
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('当前访谈不可访问');
    expect(screen.queryByRole('heading', { name: '回顾页即将可用' })).toBeNull();
  });

  it('allows the review shell only from the read-only server projection', async () => {
    const api = {
      listProjects: vi.fn(),
      listProjectSessions: vi.fn().mockResolvedValue({
        items: [sessionItem('view_review', 'read_only')],
        next_cursor: null,
      }),
    };
    render(
      <SessionPlaceholderRoute
        api={api}
        kind="review"
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );
    expect(await screen.findByRole('heading', { name: '回顾页即将可用' })).toBeTruthy();
    expect(screen.getByText(/A1 只提供受权路由壳/)).toBeTruthy();
  });
});

function sessionItem(
  primaryAction: 'continue_preparation' | 'view_review',
  reviewAccess: 'read_only' | 'unavailable',
): ProjectSessionListItem {
  return {
    capture: null,
    capture_failure_code: null,
    created_at: '2026-08-12T08:00:00.000Z',
    duration_seconds: null,
    ended_at: null,
    finalization: null,
    home_state: primaryAction === 'view_review' ? 'review_ready' : 'preparation_required',
    id: SESSION_ID,
    primary_action: primaryAction,
    project_id: PROJECT_ID,
    review_access: reviewAccess,
    sequence_no: 1,
    started_at: null,
    status: primaryAction === 'view_review' ? 'completed' : 'created',
  };
}
