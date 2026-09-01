// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SuggestionApi } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import { SuggestionPanel } from './suggestion-panel.js';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  cleanup();
  globalThis.sessionStorage.clear();
});

describe('SuggestionPanel', () => {
  it('browses immutable history without writes and does not jump on an automatic update', async () => {
    const api = suggestionApi();
    const requestNext = vi.mocked(api.requestNextSuggestion);
    const requestStatus = vi.mocked(api.getSuggestionRequest);
    const { rerender } = render(
      <SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />,
    );
    expect(await screen.findByText('当前问题')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一个问题' }));
    expect(await screen.findByRole('heading', { name: '更早的问题' })).toBeTruthy();
    const returnButton = screen.getByRole('button', { name: '回到当前问题' });
    returnButton.focus();

    rerender(<SuggestionPanel api={api} notificationRevision={3} sessionId={SESSION_ID} />);
    expect(await screen.findByRole('heading', { name: '更早的问题' })).toBeTruthy();
    expect(document.activeElement).toBe(returnButton);
    expect(screen.getByText(/当前问题已更新，回到当前问题时可查看/)).toBeTruthy();
    expect(requestNext).not.toHaveBeenCalled();
    expect(requestStatus).not.toHaveBeenCalled();
  });

  it('uses disabled semantics at history boundaries and returns to canonical current', async () => {
    const api = suggestionApi();
    const history = vi.mocked(api.getSuggestionHistory);
    render(<SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />);
    await screen.findByText('当前问题');
    fireEvent.click(screen.getByRole('button', { name: '上一个问题' }));
    await screen.findByRole('heading', { name: '更早的问题' });
    expect(screen.getByRole('button', { name: '更早的问题' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '更新的问题' }));
    expect(screen.getByText('当前问题')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '回到当前问题' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '下一个问题' })).toBeTruthy();
    });
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('follows server cursors beyond the first history page', async () => {
    const getSuggestionHistory = vi.fn<SuggestionApi['getSuggestionHistory']>((_sessionId, input) =>
      Promise.resolve(
        input?.cursor === 'page-2-cursor'
          ? {
              anchor: 'signed-anchor',
              items: [historyFixture(1, '最早的问题', null, 'back-to-page-1')],
              next_cursor: null,
              session_id: SESSION_ID,
            }
          : {
              anchor: 'signed-anchor',
              items: [
                historyFixture(3, '当前问题', 'page-1-older', null),
                historyFixture(2, '较早的问题', 'page-2-cursor', 'page-1-newer'),
              ],
              next_cursor: 'page-2-cursor',
              session_id: SESSION_ID,
            },
      ),
    );
    render(
      <SuggestionPanel
        api={suggestionApi({ getSuggestionHistory })}
        notificationRevision={undefined}
        sessionId={SESSION_ID}
      />,
    );
    await screen.findByText('当前问题');
    fireEvent.click(screen.getByRole('button', { name: '上一个问题' }));
    await screen.findByRole('heading', { name: '较早的问题' });
    fireEvent.click(screen.getByRole('button', { name: '更早的问题' }));
    expect(await screen.findByRole('heading', { name: '最早的问题' })).toBeTruthy();
    expect(getSuggestionHistory).toHaveBeenCalledTimes(2);
  });

  it('restores a persisted history snapshot after refresh without moving canonical current', async () => {
    globalThis.sessionStorage.setItem(
      `elder-interview:suggestion-history:${SESSION_ID}`,
      '44444444-4444-4444-8444-444444444444',
    );
    const api = suggestionApi();
    render(<SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />);
    expect(await screen.findByRole('heading', { name: '更早的问题' })).toBeTruthy();
    expect(api.requestNextSuggestion).not.toHaveBeenCalled();
  });

  it('persists the manual request id before the first call and reuses it after a network-unknown result', async () => {
    const requestNextSuggestion = vi
      .fn<NonNullable<SuggestionApi['requestNextSuggestion']>>()
      .mockRejectedValue(new InterviewApiError('NETWORK_UNAVAILABLE', 'network', 0));
    const api = suggestionApi({ requestNextSuggestion });
    render(<SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />);
    await screen.findByText('当前问题');
    fireEvent.click(screen.getByRole('button', { name: '下一个问题' }));
    await screen.findByRole('alert');
    const firstId = requestNextSuggestion.mock.calls[0]?.[1].request_id;
    expect(firstId).toBeTruthy();
    const persisted = JSON.parse(
      globalThis.sessionStorage.getItem(`elder-interview:suggestion-request:${SESSION_ID}`) ?? '{}',
    ) as Record<string, unknown>;
    expect(persisted).toEqual({
      expectedPresentationRevision: 2,
      expectedSnapshotId: '33333333-3333-4333-8333-333333333333',
      requestId: firstId,
    });

    fireEvent.click(screen.getByRole('button', { name: '下一个问题' }));
    await waitFor(() => {
      expect(requestNextSuggestion).toHaveBeenCalledTimes(2);
    });
    expect(requestNextSuggestion.mock.calls[1]?.[1].request_id).toBe(firstId);
  });

  it('keeps focus while a newer REST current replaces the visible copy', async () => {
    const api = suggestionApi();
    const currentReader = vi.mocked(api.getCurrentSuggestion);
    const { rerender } = render(
      <SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />,
    );
    await screen.findByText('当前问题');
    const next = screen.getByRole('button', { name: '下一个问题' });
    next.focus();
    currentReader.mockResolvedValueOnce({
      ...currentSuggestion(),
      presentation_revision: 3,
      question: '自动更新后的问题',
      snapshot_id: '55555555-5555-4555-8555-555555555555',
    });
    act(() => {
      rerender(<SuggestionPanel api={api} notificationRevision={3} sessionId={SESSION_ID} />);
    });
    expect(await screen.findByText('自动更新后的问题')).toBeTruthy();
    expect(document.activeElement).toBe(next);
  });

  it('offers a retry after the initial current read fails and keeps manual next separate', async () => {
    const getCurrentSuggestion = vi
      .fn<SuggestionApi['getCurrentSuggestion']>()
      .mockRejectedValueOnce(new InterviewApiError('AI_UNAVAILABLE', 'unavailable', 503))
      .mockRejectedValueOnce(new InterviewApiError('AI_UNAVAILABLE', 'unavailable', 503))
      .mockResolvedValueOnce(currentSuggestion());
    const requestNextSuggestion = vi.fn<SuggestionApi['requestNextSuggestion']>();
    const api = suggestionApi({ getCurrentSuggestion, requestNextSuggestion });

    render(<SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />);

    expect((await screen.findByRole('alert')).textContent).toContain('录音和转录仍会继续');
    fireEvent.click(screen.getByRole('button', { name: '重新加载问题建议' }));
    expect(await screen.findByRole('button', { name: '重新加载问题建议' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载问题建议' }));
    expect(await screen.findByText('当前问题')).toBeTruthy();
    expect(getCurrentSuggestion).toHaveBeenCalledTimes(3);
    expect(requestNextSuggestion).not.toHaveBeenCalled();
  });

  it('preserves the fenced manual-next request after current suggestion recovery', async () => {
    const getCurrentSuggestion = vi
      .fn<SuggestionApi['getCurrentSuggestion']>()
      .mockRejectedValueOnce(new InterviewApiError('AI_UNAVAILABLE', 'unavailable', 503))
      .mockResolvedValueOnce(currentSuggestion());
    const requestNextSuggestion = vi.fn<SuggestionApi['requestNextSuggestion']>(() =>
      Promise.resolve({
        accepted_presentation_revision: 2,
        attempt_id: '66666666-6666-4666-8666-666666666666',
        request_id: '77777777-7777-4777-8777-777777777777',
        retry_after_ms: 0,
        status: 'pending',
      }),
    );
    const api = suggestionApi({
      getCurrentSuggestion,
      getSuggestionRequest: vi.fn<SuggestionApi['getSuggestionRequest']>(() =>
        Promise.resolve({
          attempt_id: '66666666-6666-4666-8666-666666666666',
          current: { ...currentSuggestion(), presentation_revision: 3 },
          error_code: null,
          publication_outcome: 'published' as const,
          request_id: '77777777-7777-4777-8777-777777777777',
          result_kind: 'suggestion' as const,
          status: 'succeeded' as const,
        }),
      ),
      requestNextSuggestion,
    });

    render(<SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: '重新加载问题建议' }));
    await screen.findByText('当前问题');
    fireEvent.click(screen.getByRole('button', { name: '下一个问题' }));

    await waitFor(() => {
      expect(requestNextSuggestion).toHaveBeenCalledTimes(1);
    });
    const request = requestNextSuggestion.mock.calls[0]?.[1];
    expect(request?.expected_presentation_revision).toBe(2);
    expect(request?.expected_snapshot_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(typeof request?.request_id).toBe('string');
  });

  it.each([
    ['continue_listening', '继续倾听'],
    ['unavailable', '问题建议暂不可用'],
  ] as const)('renders the accepted %s presentation state', async (kind, heading) => {
    const current: Awaited<ReturnType<SuggestionApi['getCurrentSuggestion']>> =
      kind === 'continue_listening'
        ? {
            ...currentSuggestion(),
            kind,
            question: null,
            reason: '当前信息还不足以提出自然且有帮助的新问题。',
          }
        : {
            ...currentSuggestion(),
            kind,
            question: null,
            reason: null,
            withdrawal_reason: 'policy_unavailable',
          };
    const api = suggestionApi({ getCurrentSuggestion: vi.fn(() => Promise.resolve(current)) });

    render(<SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />);

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  });
});

function suggestionApi(overrides: Partial<SuggestionApi> = {}): SuggestionApi {
  return {
    getCurrentSuggestion: vi.fn(() => Promise.resolve(currentSuggestion())),
    getSuggestionHistory: vi.fn(() =>
      Promise.resolve({
        anchor: 'signed-anchor',
        items: [
          {
            display_sequence: 2,
            displayed_at: '2026-08-10T10:00:00.000Z',
            kind: 'suggestion' as const,
            newer_cursor: null,
            older_cursor: 'signed-older-cursor',
            question: '当前问题',
            reason: '当前原因',
            snapshot_id: '33333333-3333-4333-8333-333333333333',
            withdrawal_reason: null,
          },
          {
            display_sequence: 1,
            displayed_at: '2026-08-10T09:59:00.000Z',
            kind: 'suggestion' as const,
            newer_cursor: 'signed-newer-cursor',
            older_cursor: null,
            question: '更早的问题',
            reason: '更早原因',
            snapshot_id: '44444444-4444-4444-8444-444444444444',
            withdrawal_reason: null,
          },
        ],
        next_cursor: null,
        session_id: SESSION_ID,
      }),
    ),
    getSuggestionHistoryItem: vi.fn((_sessionId: string, snapshotId: string) =>
      Promise.resolve({
        anchor: 'signed-anchor',
        item: {
          display_sequence: 1,
          displayed_at: '2026-08-10T09:59:00.000Z',
          kind: 'suggestion' as const,
          newer_cursor: 'signed-newer-cursor',
          older_cursor: null,
          question: '更早的问题',
          reason: '更早原因',
          snapshot_id: snapshotId,
          withdrawal_reason: null,
        },
        session_id: SESSION_ID,
      }),
    ),
    getSuggestionRequest: vi.fn(),
    requestNextSuggestion: vi.fn(),
    ...overrides,
  };
}

function currentSuggestion(): Awaited<ReturnType<SuggestionApi['getCurrentSuggestion']>> {
  return {
    display_sequence: 2,
    displayed_at: '2026-08-10T10:00:00.000Z',
    history: { has_previous: true },
    kind: 'suggestion' as const,
    presentation_revision: 2,
    question: '当前问题',
    reason: '当前原因',
    session_id: SESSION_ID,
    snapshot_id: '33333333-3333-4333-8333-333333333333',
    withdrawal_reason: null,
  };
}

function historyFixture(
  sequence: number,
  question: string,
  olderCursor: string | null,
  newerCursor: string | null,
): Awaited<ReturnType<SuggestionApi['getSuggestionHistory']>>['items'][number] {
  return {
    display_sequence: sequence,
    displayed_at: `2026-08-10T10:0${String(sequence)}:00.000Z`,
    kind: 'suggestion',
    newer_cursor: newerCursor,
    older_cursor: olderCursor,
    question,
    reason: `${question}的原因`,
    snapshot_id: `${String(sequence).repeat(8)}-${String(sequence).repeat(4)}-4${String(sequence).repeat(3)}-8${String(sequence).repeat(3)}-${String(sequence).repeat(12)}`,
    withdrawal_reason: null,
  };
}
