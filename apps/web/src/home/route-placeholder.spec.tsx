// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSessionListItem } from '@elder-interview/contracts';

import { SessionPlaceholderRoute, SessionSaveFactsRoute } from './route-placeholder.js';

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

  it('renders save facts from the server session projection as a read-only surface', async () => {
    const api = {
      getSession: vi.fn().mockResolvedValue(saveFactsSession()),
      listProjects: vi.fn(),
      listProjectSessions: vi.fn().mockResolvedValue({
        items: [sessionItem('view_save_facts', 'unavailable')],
        next_cursor: null,
      }),
    };
    render(
      <SessionSaveFactsRoute
        api={api}
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );

    expect(await screen.findByRole('heading', { name: '保存事实' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '保存状态明细' }).textContent).toContain(
      'manifest 完整',
    );
    expect(screen.getByText(/仅供只读核对/)).toBeTruthy();
    expect(screen.queryByText(/即将可用/)).toBeNull();
    expect(api.getSession).toHaveBeenCalledWith(SESSION_ID);
  });
});

function sessionItem(
  primaryAction: 'continue_preparation' | 'view_review' | 'view_save_facts',
  reviewAccess: 'read_only' | 'unavailable',
): ProjectSessionListItem {
  return {
    capture: null,
    capture_failure_code: null,
    created_at: '2026-08-12T08:00:00.000Z',
    duration_seconds: null,
    ended_at: null,
    finalization: null,
    home_state:
      primaryAction === 'view_review'
        ? 'review_ready'
        : primaryAction === 'view_save_facts'
          ? 'save_failed'
          : 'preparation_required',
    id: SESSION_ID,
    primary_action: primaryAction,
    project_id: PROJECT_ID,
    review_access: reviewAccess,
    sequence_no: 1,
    started_at: null,
    status:
      primaryAction === 'view_review' || primaryAction === 'view_save_facts'
        ? 'completed'
        : 'created',
  };
}

function saveFactsSession(): import('@elder-interview/contracts').InterviewSessionResponse {
  return {
    capture: {
      audio_object_id: 'audio',
      audio_stream_id: 'stream',
      generation_no: 1,
      interrupted_at: null,
      interruption_reason: null,
      status: 'stopped',
      timeline_offset_ms: 0,
      uploaded_chunk_count: 2,
    },
    created_at: '2026-08-12T08:00:00.000Z',
    created_by: 'actor',
    ended_at: '2026-08-12T08:00:02.000Z',
    finalization: {
      audio_object_id: 'audio',
      completed_at: '2026-08-12T08:00:03.000Z',
      expected_chunk_count: 2,
      failure_code: null,
      manifest_checksum: 'manifest',
      processing_started_at: '2026-08-12T08:00:02.000Z',
      recording_status: 'stopped',
      total_size_bytes: 10,
      transcript_error_code: null,
      transcript_status: 'drained',
      upload_status: 'complete',
      uploaded_chunk_count: 2,
    },
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: '2026-08-12T08:00:00.000Z',
    status: 'completed',
    updated_at: '2026-08-12T08:00:03.000Z',
  };
}
