// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterviewSessionResponse, ProjectSessionListItem } from '@elder-interview/contracts';

import type {
  LocalAudioDeleteResult,
  LocalAudioArchiveProjection,
  LocalAudioArchiveService,
} from '../audio/local-audio-archive.js';
import type { HomeApi, ReviewApi } from '../interview/interview-api.js';
import type { TranscriptSegmentResponse } from '@elder-interview/contracts';
import { SessionReviewRoute } from './session-review-route.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000008';
const PROJECT_ID = '00000000-0000-4000-8000-000000000009';

afterEach(cleanup);

describe('SessionReviewRoute', () => {
  it('shows original and corrected transcripts with one local-only privacy boundary', async () => {
    const { api, archive } = fixture();
    render(
      <SessionReviewRoute
        api={api}
        archiveService={archive}
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );

    expect(await screen.findByRole('heading', { name: '第 2 次访谈' })).toBeTruthy();
    expect(screen.getByText('原始文字')).toBeTruthy();
    expect(screen.getByText('修订文字')).toBeTruthy();
    expect(screen.getByText('原始', { selector: '.transcript-label' })).toBeTruthy();
    expect(screen.getByText('修订', { selector: '.transcript-label' })).toBeTruthy();
    expect(
      screen.getByText(
        '此处只管理当前浏览器/此设备上的录音副本。服务器录音、转录、记忆和审计仍保留。',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/导出|问题历史|记忆详情/u)).toBeNull();
  });

  it('never offers partial playback for an incomplete local archive', async () => {
    const { api, archive, projection } = fixture();
    projection.state = 'available_incomplete';
    projection.playback_available = false;
    projection.state_basis.local_archive_complete = false;
    vi.mocked(archive.project).mockResolvedValue(projection);

    render(
      <SessionReviewRoute
        api={api}
        archiveService={archive}
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );

    const play = await screen.findByRole('button', { name: '载入完整录音' });
    expect((play as HTMLButtonElement).disabled).toBe(true);
    expect(asButton(screen.getByRole('button', { name: '只删除此浏览器副本' })).disabled).toBe(
      true,
    );
    expect(screen.getByText(/不会播放部分录音/u)).toBeTruthy();
    fireEvent.click(play);
    expect(archive.createPlayback).not.toHaveBeenCalled();
  });

  it('requires explicit danger confirmation and reports only local deletion', async () => {
    const { api, archive } = fixture();
    render(
      <SessionReviewRoute
        api={api}
        archiveService={archive}
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '只删除此浏览器副本' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(dialog.textContent).toContain('这里只删除当前浏览器/此设备副本');
    expect(dialog.textContent).toContain('服务器录音、转录、记忆和审计仍保留');
    expect(dialog.textContent).toContain('需走独立删除申请流程；本页面不提供该流程');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    });
    fireEvent.click(screen.getByRole('button', { name: '确认删除本机副本' }));
    await waitFor(() => {
      expect(vi.mocked(archive.delete).mock.calls).toEqual([[SESSION_ID]]);
    });
    expect((await screen.findByText(/此浏览器中的录音副本已删除/u)).textContent).toContain(
      '服务器录音、转录、记忆和审计仍保留',
    );
    expect(document.activeElement).toBe(screen.getByText(/此浏览器中的录音副本已删除/u));
  });

  it('moves focus into the danger confirmation and restores it on cancel', async () => {
    const { api, archive } = fixture();
    render(
      <SessionReviewRoute
        api={api}
        archiveService={archive}
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );

    const trigger = await screen.findByRole('button', { name: '只删除此浏览器副本' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    });
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('keeps failed complete sessions playable while disabling local deletion', async () => {
    const { api, archive, session } = fixture();
    session.status = 'failed';
    api.getSession = vi.fn((): Promise<InterviewSessionResponse> => Promise.resolve(session));
    render(
      <SessionReviewRoute
        api={api}
        archiveService={archive}
        navigate={vi.fn()}
        projectId={PROJECT_ID}
        sessionId={SESSION_ID}
      />,
    );

    expect(asButton(await screen.findByRole('button', { name: '载入完整录音' })).disabled).toBe(
      false,
    );
    expect(asButton(screen.getByRole('button', { name: '只删除此浏览器副本' })).disabled).toBe(
      true,
    );
    expect(screen.getByText(/可回顾和播放，但不能删除本机副本/u)).toBeTruthy();
  });
});

function asButton(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error('expected a button element');
  return element;
}

function fixture(): {
  api: HomeApi & ReviewApi;
  archive: Pick<LocalAudioArchiveService, 'createPlayback' | 'delete' | 'project'>;
  projection: LocalAudioArchiveProjection;
  session: InterviewSessionResponse;
} {
  const listItem = sessionListItem();
  const session = sessionResponse();
  const projection = completeProjection();
  const api: HomeApi & ReviewApi = {
    getAudioManifest: vi.fn(),
    getSession: vi.fn((): Promise<InterviewSessionResponse> => Promise.resolve(session)),
    listProjects: vi.fn(),
    listProjectSessions: vi.fn(() => Promise.resolve({ items: [listItem], next_cursor: null })),
    listSessionTranscripts: vi.fn((): Promise<TranscriptSegmentResponse[]> =>
      Promise.resolve([
        {
          content_kind: 'conversation',
          corrected_speaker_role: null,
          corrected_text: '修订文字',
          effective_speaker_role: 'elder',
          end_ms: 1_000,
          id: 'segment',
          original_speaker_role: 'elder',
          original_speaker_role_authority: 'user_confirmed',
          original_text: '原始文字',
          speaker_provider_id: 'speaker',
          speaker_role_revision: 1,
          speaker_stream_id: 'stream',
          start_ms: 0,
          trusted_effective_speaker_role: 'elder',
        },
      ]),
    ),
  };
  const archive: Pick<LocalAudioArchiveService, 'createPlayback' | 'delete' | 'project'> = {
    createPlayback: vi.fn(() => Promise.resolve(null)),
    delete: vi.fn((): Promise<LocalAudioDeleteResult> =>
      Promise.resolve({
        contract_version: 'local-audio-archive-v1',
        deleted_at: '2026-08-12T08:00:00.000Z',
        kind: 'delete_result',
        result: 'deleted',
        server_audio_retained: true,
        server_memory_retained: true,
        server_transcript_retained: true,
        session_id: SESSION_ID,
      }),
    ),
    project: vi
      .fn()
      .mockResolvedValueOnce(projection)
      .mockResolvedValue({
        ...projection,
        archive_bytes: 0,
        archive_chunk_count: 0,
        playback_available: false,
        state: 'deleted_on_device',
        state_basis: {
          ...projection.state_basis,
          deletion_receipt_present: true,
          local_archive_complete: false,
        },
      }),
  };
  return { api, archive, projection, session };
}

function sessionListItem(): ProjectSessionListItem {
  return {
    capture: { status: 'stopped' },
    capture_failure_code: null,
    created_at: '2026-08-12T00:00:00.000Z',
    duration_seconds: 1,
    ended_at: '2026-08-12T00:00:01.000Z',
    finalization: {
      failure_code: null,
      manifest_checksum: 'manifest',
      recording_status: 'stopped',
      transcript_status: 'drained',
      upload_status: 'complete',
    },
    home_state: 'review_ready',
    id: SESSION_ID,
    primary_action: 'view_review',
    project_id: PROJECT_ID,
    review_access: 'read_only',
    sequence_no: 2,
    started_at: '2026-08-12T00:00:00.000Z',
    status: 'completed',
  };
}

function sessionResponse(): InterviewSessionResponse {
  return {
    capture: {
      audio_object_id: 'audio',
      audio_stream_id: 'stream',
      generation_no: 1,
      interrupted_at: null,
      interruption_reason: null,
      status: 'stopped',
      timeline_offset_ms: 0,
      uploaded_chunk_count: 1,
    },
    created_at: '2026-08-12T00:00:00.000Z',
    created_by: 'actor',
    finalization: {
      audio_object_id: 'audio',
      completed_at: '2026-08-12T00:00:02.000Z',
      expected_chunk_count: 1,
      failure_code: null,
      manifest_checksum: 'manifest',
      processing_started_at: '2026-08-12T00:00:01.500Z',
      recording_status: 'stopped',
      total_size_bytes: 5,
      transcript_error_code: null,
      transcript_status: 'drained',
      upload_status: 'complete',
      uploaded_chunk_count: 1,
    },
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 2,
    started_at: '2026-08-12T00:00:00.000Z',
    status: 'completed',
    updated_at: '2026-08-12T00:00:02.000Z',
  };
}

function completeProjection(): LocalAudioArchiveProjection {
  return {
    archive_bytes: 5,
    archive_chunk_count: 1,
    contract_version: 'local-audio-archive-v1',
    kind: 'projection',
    origin_storage: {
      accuracy: 'origin_wide_approximate',
      available_bytes: 900,
      quota_bytes: 1_000,
      usage_bytes: 100,
    },
    pending_delivery_count: 0,
    playback_available: true,
    server_audio_retained: true,
    session_id: SESSION_ID,
    state: 'available_complete',
    state_basis: {
      active_or_dirty: false,
      deletion_receipt_present: false,
      local_archive_complete: true,
      server_manifest_verified: true,
    },
  };
}
