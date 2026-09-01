import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SuggestionHistoryItem,
  SuggestionPresentationResponse,
  SuggestionRequestStatusResponse,
} from '@elder-interview/contracts';

import type { SuggestionApi } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';

interface SuggestionPanelProps {
  api: Partial<SuggestionApi>;
  notificationRevision: number | undefined;
  sessionId: string;
}

type ViewState =
  | { kind: 'current' }
  | { anchor: string; index: number; items: SuggestionHistoryItem[]; kind: 'history' };

interface PendingSuggestionRequest {
  expectedPresentationRevision: number;
  expectedSnapshotId: string | null;
  requestId: string;
}

export function SuggestionPanel({
  api,
  notificationRevision,
  sessionId,
}: SuggestionPanelProps): React.JSX.Element {
  const [current, setCurrent] = useState<SuggestionPresentationResponse | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'current' });
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const readCurrent = useCallback(
    async (announce = false): Promise<SuggestionPresentationResponse | null> => {
      if (typeof api.getCurrentSuggestion !== 'function') return null;
      setLoading(true);
      try {
        const next = await api.getCurrentSuggestion(sessionId);
        if (!mounted.current) return null;
        setCurrent(next);
        setError(null);
        if (announce) setMessage('当前问题已更新');
        return next;
      } catch (caught) {
        if (mounted.current) setError(readableSuggestionError(caught));
        return null;
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [api, sessionId],
  );

  useEffect(() => {
    mounted.current = true;
    void readCurrent();
    return (): void => {
      mounted.current = false;
    };
  }, [readCurrent]);

  useEffect(() => {
    if (typeof api.getSuggestionHistoryItem !== 'function') return;
    const snapshotId = readHistorySnapshotId(sessionId);
    if (snapshotId === null) return;
    void api
      .getSuggestionHistoryItem(sessionId, snapshotId)
      .then(({ anchor, item }) => {
        if (!mounted.current) return;
        setView({ anchor, index: 0, items: [item], kind: 'history' });
        setMessage('已恢复先前浏览的问题');
      })
      .catch((caught: unknown) => {
        clearHistorySnapshotId(sessionId);
        if (caught instanceof InterviewApiError && caught.status === 410) return;
        if (mounted.current) setError(readableSuggestionError(caught));
      });
  }, [api, sessionId]);

  useEffect(() => {
    if (
      notificationRevision === undefined ||
      current === null ||
      notificationRevision <= current.presentation_revision
    ) {
      return;
    }
    if (view.kind === 'history') {
      setMessage('当前问题已更新，回到当前问题时可查看');
      return;
    }
    void readCurrent(true);
  }, [current, notificationRevision, readCurrent, view.kind]);

  async function showPrevious(): Promise<void> {
    if (historyLoading || current === null || typeof api.getSuggestionHistory !== 'function') {
      return;
    }
    setHistoryLoading(true);
    setError(null);
    try {
      const page = await api.getSuggestionHistory(sessionId, { limit: 50 });
      if (!mounted.current) return;
      const currentIndex = page.items.findIndex(
        ({ snapshot_id }) => snapshot_id === current.snapshot_id,
      );
      const previousIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
      if (previousIndex >= page.items.length) return;
      setView({ anchor: page.anchor, index: previousIndex, items: page.items, kind: 'history' });
      writeHistorySnapshotId(sessionId, page.items[previousIndex]?.snapshot_id ?? null);
      setMessage('正在浏览先前显示的问题');
    } catch (caught) {
      if (mounted.current) setError(readableSuggestionError(caught));
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }

  async function returnCurrent(): Promise<void> {
    clearHistorySnapshotId(sessionId);
    setView({ kind: 'current' });
    setMessage('已回到当前问题');
    await readCurrent();
  }

  async function navigateHistory(direction: 'older' | 'newer'): Promise<void> {
    if (view.kind !== 'history' || historyLoading) return;
    const adjacentIndex = direction === 'older' ? view.index + 1 : view.index - 1;
    if (adjacentIndex >= 0 && adjacentIndex < view.items.length) {
      const item = view.items[adjacentIndex];
      setView({ ...view, index: adjacentIndex });
      writeHistorySnapshotId(sessionId, item?.snapshot_id ?? null);
      return;
    }
    const currentItem = view.items[view.index];
    const cursor = direction === 'older' ? currentItem?.older_cursor : currentItem?.newer_cursor;
    if (cursor === null || cursor === undefined || typeof api.getSuggestionHistory !== 'function') {
      return;
    }
    setHistoryLoading(true);
    setError(null);
    try {
      const page = await api.getSuggestionHistory(sessionId, {
        anchor: view.anchor,
        cursor,
        limit: 20,
      });
      if (!mounted.current || page.items.length === 0) return;
      const nextIndex = direction === 'older' ? 0 : page.items.length - 1;
      setView({ anchor: page.anchor, index: nextIndex, items: page.items, kind: 'history' });
      writeHistorySnapshotId(sessionId, page.items[nextIndex]?.snapshot_id ?? null);
    } catch (caught) {
      if (caught instanceof InterviewApiError && caught.status === 410) {
        await returnCurrent();
      } else if (mounted.current) {
        setError(readableSuggestionError(caught));
      }
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }

  async function nextQuestion(): Promise<void> {
    if (
      manualBusy ||
      current === null ||
      typeof api.requestNextSuggestion !== 'function' ||
      typeof api.getSuggestionRequest !== 'function'
    ) {
      return;
    }
    setManualBusy(true);
    setError(null);
    setMessage('正在准备下一个问题');
    const key = `elder-interview:suggestion-request:${sessionId}`;
    const pending = readPendingRequest(key) ?? {
      expectedPresentationRevision: current.presentation_revision,
      expectedSnapshotId: current.snapshot_id,
      requestId: crypto.randomUUID(),
    };
    writePendingRequest(key, pending);
    try {
      await api.requestNextSuggestion(sessionId, {
        expected_presentation_revision: pending.expectedPresentationRevision,
        expected_snapshot_id: pending.expectedSnapshotId,
        request_id: pending.requestId,
      });
      const terminal = await pollRequest(
        { getSuggestionRequest: api.getSuggestionRequest },
        sessionId,
        pending.requestId,
      );
      if (!mounted.current) return;
      if (terminal.status === 'succeeded') {
        clearPendingRequest(key);
        setCurrent(terminal.current);
        setMessage(terminal.current.kind === 'suggestion' ? '下一个问题已准备好' : '建议继续倾听');
      } else {
        clearPendingRequest(key);
        setCurrent(terminal.current);
        setError(requestFailureText(terminal));
      }
    } catch (caught) {
      if (caught instanceof InterviewApiError && caught.code !== 'NETWORK_UNAVAILABLE') {
        clearPendingRequest(key);
      }
      if (mounted.current) setError(readableSuggestionError(caught));
    } finally {
      if (mounted.current) setManualBusy(false);
    }
  }

  if (typeof api.getCurrentSuggestion !== 'function') return <LegacySuggestionSeam />;
  const historyItem = view.kind === 'history' ? view.items[view.index] : null;
  const presentation = historyItem ?? current;
  const kind = presentation?.kind ?? 'continue_listening';
  const question = presentation?.question ?? null;
  const reason = presentation?.reason ?? null;
  const previousDisabled =
    loading || historyLoading || current === null || !current.history.has_previous;
  const canRetryCurrent =
    view.kind === 'current' && !loading && !manualBusy && (current === null || error !== null);

  return (
    <aside
      aria-busy={loading || manualBusy || historyLoading}
      aria-labelledby="suggestion-title"
      aria-live={kind === 'withdrawn' ? 'assertive' : 'off'}
      className={`suggestion-panel suggestion-panel--${kind}`}
      data-testid="suggestion-panel"
    >
      <div className="suggestion-panel__body">
        <p className="context-label">{view.kind === 'history' ? '先前显示的问题' : '下一步'}</p>
        <h2 id="suggestion-title">
          {kind === 'suggestion'
            ? question
            : kind === 'withdrawn'
              ? '问题建议已隐藏'
              : kind === 'unavailable'
                ? '问题建议暂不可用'
                : '继续倾听'}
        </h2>
        <p className="suggestion-panel__reason">
          {kind === 'suggestion'
            ? reason
            : kind === 'withdrawn'
              ? '当前授权或内容边界不允许显示问题正文。'
              : kind === 'unavailable'
                ? '建议服务暂时无法给出可靠问题，录音和转录仍会继续。'
                : '长者正在讲述时，不必急着追问。'}
        </p>
      </div>

      <div className="suggestion-panel__actions" aria-label="问题导航">
        {view.kind === 'current' ? (
          <>
            <button
              className="button button--secondary"
              disabled={previousDisabled}
              onClick={() => void showPrevious()}
              type="button"
            >
              上一个问题
            </button>
            <button
              className="button button--primary"
              disabled={loading || manualBusy || current?.kind === 'withdrawn'}
              onClick={() => void nextQuestion()}
              type="button"
            >
              {manualBusy ? '正在准备…' : '下一个问题'}
            </button>
            {canRetryCurrent ? (
              <button
                className="button button--secondary"
                onClick={() => void readCurrent()}
                type="button"
              >
                重新加载问题建议
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              className="button button--secondary"
              disabled={
                historyLoading ||
                (view.index >= view.items.length - 1 &&
                  view.items[view.index]?.older_cursor === null)
              }
              onClick={() => void navigateHistory('older')}
              type="button"
            >
              更早的问题
            </button>
            <button
              className="button button--secondary"
              disabled={
                historyLoading || (view.index <= 0 && view.items[view.index]?.newer_cursor === null)
              }
              onClick={() => void navigateHistory('newer')}
              type="button"
            >
              更新的问题
            </button>
            <button
              className="button button--primary"
              onClick={() => void returnCurrent()}
              type="button"
            >
              回到当前问题
            </button>
          </>
        )}
      </div>

      {error === null ? null : (
        <p className="suggestion-panel__error" role="alert">
          {error}
        </p>
      )}
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
    </aside>
  );
}

function LegacySuggestionSeam(): React.JSX.Element {
  return (
    <aside className="suggestion-panel suggestion-panel--continue_listening" aria-label="下一步">
      <div className="suggestion-panel__body">
        <p className="context-label">下一步</p>
        <h2>继续倾听</h2>
        <p className="suggestion-panel__reason">长者正在讲述时，不必急着追问。</p>
      </div>
    </aside>
  );
}

async function pollRequest(
  api: Pick<SuggestionApi, 'getSuggestionRequest'>,
  sessionId: string,
  requestId: string,
): Promise<SuggestionRequestStatusResponse> {
  const deadline = Date.now() + 8_500;
  while (Date.now() < deadline) {
    const status = await api.getSuggestionRequest(sessionId, requestId);
    if (['succeeded', 'failed', 'cancelled'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new InterviewApiError('AI_UNAVAILABLE', '问题建议暂不可用', 503);
}

function readPendingRequest(key: string): PendingSuggestionRequest | null {
  try {
    const raw = globalThis.sessionStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<PendingSuggestionRequest>;
    return typeof value.requestId === 'string' &&
      typeof value.expectedPresentationRevision === 'number' &&
      (typeof value.expectedSnapshotId === 'string' || value.expectedSnapshotId === null)
      ? (value as PendingSuggestionRequest)
      : null;
  } catch {
    return null;
  }
}

function writePendingRequest(key: string, value: PendingSuggestionRequest): void {
  try {
    globalThis.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory value is still stable for this mounted request.
  }
}

function clearPendingRequest(key: string): void {
  try {
    globalThis.sessionStorage.removeItem(key);
  } catch {
    // Storage is an optional recovery aid; canonical request status remains server-side.
  }
}

function historyStorageKey(sessionId: string): string {
  return `elder-interview:suggestion-history:${sessionId}`;
}

function readHistorySnapshotId(sessionId: string): string | null {
  try {
    return globalThis.sessionStorage.getItem(historyStorageKey(sessionId));
  } catch {
    return null;
  }
}

function writeHistorySnapshotId(sessionId: string, snapshotId: string | null): void {
  if (snapshotId === null) return;
  try {
    globalThis.sessionStorage.setItem(historyStorageKey(sessionId), snapshotId);
  } catch {
    // Canonical history remains recoverable through the server-side snapshot endpoint.
  }
}

function clearHistorySnapshotId(sessionId: string): void {
  try {
    globalThis.sessionStorage.removeItem(historyStorageKey(sessionId));
  } catch {
    // Storage is optional; returning to current is still an in-memory action.
  }
}

function requestFailureText(status: SuggestionRequestStatusResponse): string {
  if (status.error_code === 'AI_UNAVAILABLE') return '问题建议暂不可用，录音和转录仍会继续。';
  return '这次没有换出可靠的新问题，可以继续倾听或稍后再试。';
}

function readableSuggestionError(error: unknown): string {
  if (error instanceof InterviewApiError) {
    const byCode: Record<string, string> = {
      AI_SUGGESTION_THROTTLED: '操作有些频繁，请稍候再试。',
      AI_UNAVAILABLE: '问题建议暂不可用，录音和转录仍会继续。',
      SUGGESTION_CURRENT_CHANGED: '当前问题已经更新，请核对后再选择下一个。',
      SUGGESTION_REQUEST_IN_PROGRESS: '正在准备下一个问题，请稍候。',
    };
    return byCode[error.code] ?? error.message;
  }
  return '问题建议暂时无法加载，录音和转录仍会继续。';
}
