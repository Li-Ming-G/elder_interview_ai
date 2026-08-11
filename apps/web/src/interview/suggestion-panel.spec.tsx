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
