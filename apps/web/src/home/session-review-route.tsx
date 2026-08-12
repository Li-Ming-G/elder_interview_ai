import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  InterviewSessionResponse,
  ProjectSessionListItem,
  TranscriptSegmentResponse,
} from '@elder-interview/contracts';

import {
  LocalAudioArchiveService,
  type LocalAudioArchiveProjection,
  type LocalPlayback,
} from '../audio/local-audio-archive.js';
import type { HomeApi, ReviewApi } from '../interview/interview-api.js';
import { InterviewApiError } from '../interview/interview-api.js';
import { ErrorState, HomeFrame, LoadingState, StatusBadge } from './home-shell.js';

type SessionReviewApi = HomeApi & ReviewApi;

export function SessionReviewRoute({
  api,
  archiveService,
  navigate,
  projectId,
  sessionId,
}: {
  api: SessionReviewApi;
  archiveService?: Pick<LocalAudioArchiveService, 'createPlayback' | 'delete' | 'project'>;
  navigate: (path: string) => void;
  projectId: string;
  sessionId: string;
}): React.JSX.Element {
  const archive = useMemo(
    () => archiveService ?? new LocalAudioArchiveService(api),
    [api, archiveService],
  );
  const [listItem, setListItem] = useState<ProjectSessionListItem | null>(null);
  const [session, setSession] = useState<InterviewSessionResponse | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptSegmentResponse[] | null>(null);
  const [projection, setProjection] = useState<LocalAudioArchiveProjection | null>(null);
  const [playback, setPlayback] = useState<LocalPlayback | null>(null);
  const playbackRef = useRef<LocalPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const focusAfterDialogRef = useRef<'notice' | 'trigger' | null>(null);

  useEffect(() => {
    if (confirmingDelete) {
      cancelDeleteRef.current?.focus();
      return;
    }
    const target = focusAfterDialogRef.current;
    focusAfterDialogRef.current = null;
    if (target === 'notice') noticeRef.current?.focus();
    if (target === 'trigger') deleteTriggerRef.current?.focus();
  }, [confirmingDelete]);

  useEffect(() => {
    let current = true;
    async function load(): Promise<void> {
      try {
        const authorized = await findAuthorizedReview(api, projectId, sessionId);
        if (authorized === null) throw new InterviewApiError('FORBIDDEN', '不可访问', 403);
        const [freshSession, transcriptItems, localProjection] = await Promise.all([
          api.getSession(sessionId),
          api.listSessionTranscripts(sessionId),
          archive.project(sessionId),
        ]);
        if (!current) return;
        if (freshSession.project_id !== projectId) {
          throw new InterviewApiError('SESSION_PROJECT_MISMATCH', '不可访问', 409);
        }
        setListItem(authorized);
        setSession(freshSession);
        setTranscripts(transcriptItems);
        setProjection(localProjection);
      } catch (loadError) {
        if (!current) return;
        setError(reviewErrorMessage(loadError));
      }
    }
    void load();
    return function cleanup(): void {
      current = false;
      playbackRef.current?.revoke();
      playbackRef.current = null;
    };
  }, [api, archive, projectId, sessionId]);

  async function startPlayback(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const freshPlayback = await archive.createPlayback(sessionId);
      playbackRef.current?.revoke();
      playbackRef.current = freshPlayback;
      setPlayback(freshPlayback);
      setProjection(await archive.project(sessionId));
      if (freshPlayback === null) setNotice('本机录音未通过完整性复核，未播放任何片段。');
    } catch {
      setNotice('暂时无法读取本机完整录音，未播放任何片段。');
    } finally {
      setBusy(false);
    }
  }

  async function deleteLocalCopy(): Promise<void> {
    setBusy(true);
    setNotice(null);
    let focusTarget: 'notice' | 'trigger' = 'trigger';
    try {
      const result = await archive.delete(sessionId);
      if (result.result === 'deleted' || result.result === 'already_deleted') {
        focusTarget = 'notice';
        playbackRef.current?.revoke();
        playbackRef.current = null;
        setPlayback(null);
        setNotice(
          result.result === 'deleted'
            ? '此浏览器中的录音副本已删除。服务器录音、转录、记忆和审计仍保留。'
            : '此浏览器中的录音副本此前已删除。服务器录音、转录、记忆和审计仍保留。',
        );
      } else {
        setNotice(deleteBlockedMessage(result.result));
      }
      setProjection(await archive.project(sessionId));
    } finally {
      setBusy(false);
      closeDeleteConfirmation(focusTarget);
    }
  }

  function closeDeleteConfirmation(target: 'notice' | 'trigger'): void {
    focusAfterDialogRef.current = target;
    setConfirmingDelete(false);
  }

  function handleDeleteDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      closeDeleteConfirmation('trigger');
      return;
    }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === confirmDeleteRef.current) {
      event.preventDefault();
      cancelDeleteRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === cancelDeleteRef.current) {
      event.preventDefault();
      confirmDeleteRef.current?.focus();
    }
  }

  const deleteAllowed =
    projection?.state === 'available_complete' &&
    (session?.status === 'processing' || session?.status === 'completed') &&
    session.capture?.status === 'stopped';

  return (
    <HomeFrame>
      <header className="review-header">
        <div>
          <p className="context-label">已结束访谈 · 只读回顾</p>
          <h1>{listItem === null ? '访谈回顾' : `第 ${String(listItem.sequence_no)} 次访谈`}</h1>
          <p>查看服务器转录与此浏览器保存的完整录音副本。</p>
        </div>
        <button
          className="button button--secondary"
          onClick={() => {
            navigate('/');
          }}
          type="button"
        >
          返回工作区
        </button>
      </header>

      {error === null ? null : <ErrorState message={error} />}
      {error === null && (session === null || transcripts === null || projection === null) ? (
        <LoadingState />
      ) : null}

      {session === null || transcripts === null || projection === null ? null : (
        <div className="review-layout">
          <section className="review-card review-card--audio" aria-labelledby="local-audio-title">
            <div className="review-card__heading">
              <div>
                <p className="context-label">本机副本</p>
                <h2 id="local-audio-title">此浏览器中的完整录音</h2>
              </div>
              <StatusBadge tone={projectionTone(projection.state)}>
                {projectionLabel(projection.state)}
              </StatusBadge>
            </div>
            <p className="privacy-boundary">
              此处只管理当前浏览器/此设备上的录音副本。服务器录音、转录、记忆和审计仍保留。
            </p>
            <dl className="review-facts">
              <div>
                <dt>本次访谈副本</dt>
                <dd>{formatBytes(projection.archive_bytes)}</dd>
              </div>
              <div>
                <dt>本机分片</dt>
                <dd>{projection.archive_chunk_count} 段</dd>
              </div>
              <div>
                <dt>此网站存储（近似）</dt>
                <dd>{formatNullableBytes(projection.origin_storage.usage_bytes)}</dd>
              </div>
              <div>
                <dt>此网站可用空间（近似）</dt>
                <dd>{formatNullableBytes(projection.origin_storage.available_bytes)}</dd>
              </div>
            </dl>

            <div className="review-actions">
              <button
                className="button button--primary"
                disabled={busy || !projection.playback_available}
                onClick={() => void startPlayback()}
                type="button"
              >
                载入完整录音
              </button>
              <button
                className="button button--danger"
                disabled={busy || !deleteAllowed}
                onClick={() => {
                  setConfirmingDelete(true);
                }}
                ref={deleteTriggerRef}
                type="button"
              >
                只删除此浏览器副本
              </button>
            </div>
            {session.status === 'failed' ? (
              <p className="review-note">
                服务器保存事实需要人工处理；可回顾和播放，但不能删除本机副本。
              </p>
            ) : null}
            {projection.state !== 'available_complete' ? (
              <p className="review-note">{projectionHelp(projection.state)}</p>
            ) : null}
            {playback === null ? null : (
              <audio className="review-player" controls preload="metadata" src={playback.url}>
                当前浏览器不支持音频播放控件。
              </audio>
            )}

            {confirmingDelete ? (
              <div
                className="delete-confirmation"
                role="alertdialog"
                aria-describedby="delete-description"
                aria-labelledby="delete-title"
                aria-modal="true"
                onKeyDown={handleDeleteDialogKeyDown}
              >
                <h3 id="delete-title">只删除此浏览器/此设备副本？</h3>
                <p id="delete-description">
                  这里只删除当前浏览器/此设备副本；服务器录音、转录、记忆和审计仍保留。如需正式隐私删除，需走独立删除申请流程；本页面不提供该流程。
                </p>
                <div className="review-actions">
                  <button
                    className="button button--danger"
                    disabled={busy}
                    onClick={() => void deleteLocalCopy()}
                    ref={confirmDeleteRef}
                    type="button"
                  >
                    确认删除本机副本
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      closeDeleteConfirmation('trigger');
                    }}
                    ref={cancelDeleteRef}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            <p className="review-live" aria-live="polite" ref={noticeRef} tabIndex={-1}>
              {notice}
            </p>
          </section>

          <section
            className="review-card review-card--transcript"
            aria-labelledby="transcript-title"
          >
            <div className="review-card__heading">
              <div>
                <p className="context-label">服务器事实 · 只读</p>
                <h2 id="transcript-title">原始与修订转录</h2>
              </div>
              <StatusBadge tone={session.status === 'completed' ? 'active' : 'warning'}>
                {sessionStatusLabel(session.status)}
              </StatusBadge>
            </div>
            {transcripts.length === 0 ? (
              <div className="home-state">
                <strong>暂时没有可显示的转录</strong>
                <p>录音仍保存在服务器；转录可能仍在处理或需要后续补转录。</p>
              </div>
            ) : (
              <ol className="review-transcript-list">
                {transcripts.map((segment) => (
                  <li key={segment.id} className="review-transcript-item">
                    <header>
                      <strong>{speakerLabel(segment.effective_speaker_role)}</strong>
                      <span>{formatTimeline(segment.start_ms)}</span>
                    </header>
                    <div>
                      <span className="transcript-label">原始</span>
                      <p>{segment.original_text}</p>
                    </div>
                    {segment.corrected_text === null ? null : (
                      <div className="transcript-revision">
                        <span className="transcript-label">修订</span>
                        <p>{segment.corrected_text}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </HomeFrame>
  );
}

async function findAuthorizedReview(
  api: HomeApi,
  projectId: string,
  sessionId: string,
): Promise<ProjectSessionListItem | null> {
  let cursor: string | null = null;
  do {
    const page = await api.listProjectSessions(projectId, { cursor, limit: 100 });
    const session = page.items.find((item) => item.id === sessionId);
    if (session !== undefined) {
      return session.primary_action === 'view_review' && session.review_access === 'read_only'
        ? session
        : null;
    }
    cursor = page.next_cursor;
  } while (cursor !== null);
  return null;
}

function reviewErrorMessage(error: unknown): string {
  return error instanceof InterviewApiError && [401, 403, 404, 409].includes(error.status)
    ? '当前访谈不可访问'
    : '暂时无法加载当前访谈回顾';
}

function projectionLabel(state: LocalAudioArchiveProjection['state']): string {
  return {
    available_complete: '完整可播放',
    available_incomplete: '本机副本不完整',
    blocked_active_or_dirty: '仍有采集恢复事实',
    blocked_pending_delivery: '仍有分片待保存',
    blocked_server_unverified: '未通过服务器核验',
    deleted_on_device: '已从此浏览器删除',
    missing_unknown: '此浏览器未找到副本',
  }[state];
}

function projectionHelp(state: LocalAudioArchiveProjection['state']): string {
  return {
    available_complete: '',
    available_incomplete: '本机分片缺失或不可读，不会播放部分录音。服务器转录仍可查看。',
    blocked_active_or_dirty: '检测到采集或恢复事实，当前不会读取、播放或删除本机录音。',
    blocked_pending_delivery: '仍有录音分片等待保存，当前不会播放或删除。',
    blocked_server_unverified: '暂时无法用最新服务器事实核验本机副本，当前不会播放或删除。',
    deleted_on_device: '本机删除回执已提交；服务器录音、转录、记忆和审计仍保留。',
    missing_unknown: '副本可能从未保存、已被浏览器清理或由用户清站；无法判断具体原因。',
  }[state];
}

function projectionTone(
  state: LocalAudioArchiveProjection['state'],
): 'active' | 'neutral' | 'warning' {
  if (state === 'available_complete') return 'active';
  if (state === 'deleted_on_device' || state === 'missing_unknown') return 'neutral';
  return 'warning';
}

function deleteBlockedMessage(result: string): string {
  return (
    {
      blocked_active_or_dirty: '检测到采集或恢复事实，未删除任何本机数据。',
      blocked_pending_delivery: '仍有分片待保存，未删除任何本机数据。',
      blocked_server_unverified: '最新服务器事实未通过核验，未删除任何本机数据。',
      lock_unavailable: '另一个页面正在使用本次访谈，未删除任何本机数据。',
      transaction_aborted: '本机删除事务未提交，原有副本和恢复事实保持不变。',
    }[result] ?? '未删除任何本机数据。'
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function formatNullableBytes(value: number | null): string {
  return value === null ? '浏览器未提供' : formatBytes(value);
}

function formatTimeline(value: number): string {
  const seconds = Math.floor(value / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function speakerLabel(value: TranscriptSegmentResponse['effective_speaker_role']): string {
  return { elder: '长者', interviewer: '倾听员', unknown: '说话人待确认' }[value];
}

function sessionStatusLabel(status: InterviewSessionResponse['status']): string {
  if (status === 'completed') return '转录已收束';
  if (status === 'processing') return '转录处理中';
  if (status === 'failed') return '保存需关注';
  return '只读';
}
