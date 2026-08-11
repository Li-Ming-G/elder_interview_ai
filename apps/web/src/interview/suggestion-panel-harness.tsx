import { useState } from 'react';
import type {
  SuggestionHistoryItem,
  SuggestionPresentationResponse,
  SuggestionRequestStatusResponse,
} from '@elder-interview/contracts';

import type { SuggestionApi } from './interview-api.js';
import { SuggestionPanel } from './suggestion-panel.js';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';

/** Browser-only synthetic fixture for DEV-007B visual verification. */
export function SuggestionPanelHarness(): React.JSX.Element {
  const [current, setCurrent] = useState<SuggestionPresentationResponse>(firstCurrent());
  const api: SuggestionApi = {
    getCurrentSuggestion: () => Promise.resolve(current),
    getSuggestionHistory: () =>
      Promise.resolve({
        anchor: 'synthetic-browser-anchor',
        items: [
          historyItem(current),
          {
            display_sequence: 1,
            displayed_at: '2026-08-10T09:59:00.000Z',
            kind: 'suggestion',
            newer_cursor: 'synthetic-browser-newer-cursor',
            older_cursor: null,
            question: '小时候最常陪伴您的东西是什么？',
            reason: '先前显示过的 synthetic fixture 问题。',
            snapshot_id: SECOND_SNAPSHOT_ID,
            withdrawal_reason: null,
          },
        ],
        next_cursor: null,
        session_id: SESSION_ID,
      }),
    getSuggestionHistoryItem: (_sessionId, snapshotId) => {
      const pageItem =
        snapshotId === SECOND_SNAPSHOT_ID
          ? {
              display_sequence: 1,
              displayed_at: '2026-08-10T09:59:00.000Z',
              kind: 'suggestion' as const,
              newer_cursor: 'synthetic-browser-newer-cursor',
              older_cursor: null,
              question: '小时候最常陪伴您的东西是什么？',
              reason: '先前显示过的 synthetic fixture 问题。',
              snapshot_id: SECOND_SNAPSHOT_ID,
              withdrawal_reason: null,
            }
          : historyItem(current);
      return Promise.resolve({
        anchor: 'synthetic-browser-anchor',
        item: pageItem,
        session_id: SESSION_ID,
      });
    },
    getSuggestionRequest: (_sessionId, requestId) => {
      const next = secondCurrent();
      setCurrent(next);
      return Promise.resolve({
        attempt_id: '55555555-5555-4555-8555-555555555555',
        current: next,
        error_code: null,
        publication_outcome: 'published',
        request_id: requestId,
        result_kind: 'suggestion',
        status: 'succeeded',
      } satisfies SuggestionRequestStatusResponse);
    },
    requestNextSuggestion: (_sessionId, input) =>
      Promise.resolve({
        accepted_presentation_revision: input.expected_presentation_revision,
        attempt_id: '55555555-5555-4555-8555-555555555555',
        request_id: input.request_id,
        retry_after_ms: 0,
        status: 'running',
      }),
  };
  return (
    <main className="workbench" data-testid="suggestion-panel-harness">
      <header className="workbench-bar">
        <div className="workbench-identity">
          <strong>虚构长者 · 内部演示</strong>
          <span>SYNTHETIC FIXTURE · NOT PRODUCT CONTENT</span>
        </div>
        <p className="workbench-safety">正在录音 · AI 问题建议不影响录音与转录</p>
        <button className="button button--secondary workbench-end" type="button">
          结束访谈
        </button>
      </header>
      <div className="workbench-content">
        <section className="transcript-stage" aria-labelledby="fixture-transcript-title">
          <div className="transcript-heading">
            <div>
              <p className="context-label">实时转录</p>
              <h1 id="fixture-transcript-title">正在倾听</h1>
            </div>
          </div>
          <div className="transcript-viewport" tabIndex={0}>
            <ol className="transcript-list">
              <li className="transcript-line transcript-line--elder">
                <div className="transcript-content">
                  <strong className="speaker-label">长者</strong>
                  <p>那时候我们住在河边，院子里有一棵很大的桂花树。</p>
                </div>
                <time>10:02</time>
              </li>
              <li className="transcript-line transcript-line--interviewer">
                <div className="transcript-content">
                  <strong className="speaker-label">倾听员</strong>
                  <p>您慢慢讲，我在听。</p>
                </div>
                <time>10:03</time>
              </li>
            </ol>
          </div>
        </section>
      </div>
      <SuggestionPanel api={api} notificationRevision={undefined} sessionId={SESSION_ID} />
    </main>
  );
}

function firstCurrent(): SuggestionPresentationResponse {
  return {
    display_sequence: 2,
    displayed_at: '2026-08-10T10:04:00.000Z',
    history: { has_previous: true },
    kind: 'suggestion',
    presentation_revision: 2,
    question: '如果您愿意，能从小时候住过的地方讲讲吗？',
    reason: '当前处于低压力破冰阶段，先顺着长者已经提到的生活场景展开。',
    session_id: SESSION_ID,
    snapshot_id: FIRST_SNAPSHOT_ID,
    withdrawal_reason: null,
  };
}

function secondCurrent(): SuggestionPresentationResponse {
  return {
    ...firstCurrent(),
    display_sequence: 3,
    presentation_revision: 3,
    question: '小时候最常陪伴您的东西是什么？',
    reason: '这是 active internal-demo bank 中另一道 eligible synthetic fixture。',
    snapshot_id: '66666666-6666-4666-8666-666666666666',
  };
}

function historyItem(current: SuggestionPresentationResponse): SuggestionHistoryItem {
  return {
    display_sequence: current.display_sequence ?? 0,
    displayed_at: current.displayed_at ?? '2026-08-10T10:04:00.000Z',
    kind: 'suggestion' as const,
    newer_cursor: null,
    older_cursor: null,
    question: current.question,
    reason: current.reason,
    snapshot_id: current.snapshot_id ?? FIRST_SNAPSHOT_ID,
    withdrawal_reason: null,
  };
}
