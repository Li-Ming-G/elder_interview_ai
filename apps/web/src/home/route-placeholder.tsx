import { useEffect, useState } from 'react';
import type { InterviewSessionResponse, ProjectSessionListItem } from '@elder-interview/contracts';

import type { HomeApi } from '../interview/interview-api.js';
import { InterviewApiError } from '../interview/interview-api.js';
import { ErrorState, HomeFrame, LoadingState } from './home-shell.js';

export function SessionSaveFactsRoute({
  api,
  navigate,
  projectId,
  sessionId,
}: {
  api: HomeApi & {
    getSession: (sessionId: string) => Promise<InterviewSessionResponse>;
  };
  navigate: (path: string) => void;
  projectId: string;
  sessionId: string;
}): React.JSX.Element {
  const [listItem, setListItem] = useState<ProjectSessionListItem | null>(null);
  const [session, setSession] = useState<InterviewSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    async function load(): Promise<void> {
      try {
        const authorized = await findAuthorizedSession(api, projectId, sessionId);
        if (authorized === null || authorized.primary_action !== 'view_save_facts') {
          throw new InterviewApiError('FORBIDDEN', '不可访问', 403);
        }
        const freshSession = await api.getSession(sessionId);
        if (freshSession.project_id !== projectId) {
          throw new InterviewApiError('SESSION_PROJECT_MISMATCH', '不可访问', 409);
        }
        if (!current) return;
        setListItem(authorized);
        setSession(freshSession);
      } catch (loadError) {
        if (!current) return;
        setError(
          loadError instanceof InterviewApiError && [401, 403, 404, 409].includes(loadError.status)
            ? '当前访谈不可访问'
            : '暂时无法加载保存事实',
        );
      }
    }
    void load();
    return function cleanup(): void {
      current = false;
    };
  }, [api, projectId, sessionId]);

  return (
    <HomeFrame>
      <section className="route-shell" aria-labelledby="save-facts-title">
        {listItem === null && session === null && error === null ? <LoadingState /> : null}
        {error === null ? null : <ErrorState message={error} />}
        {listItem === null || session === null ? null : (
          <>
            <p className="context-label">第 {listItem.sequence_no} 次访谈</p>
            <h1 id="save-facts-title">保存事实</h1>
            <p>
              以下内容来自管理服务的持久会话快照，仅供只读核对；此页不会继续录音、修改会话或删除任何证据。
            </p>
            <SessionSaveFacts session={session} />
          </>
        )}
        <button
          className="button button--secondary"
          onClick={() => {
            navigate('/');
          }}
          type="button"
        >
          返回工作区
        </button>
      </section>
    </HomeFrame>
  );
}

function SessionSaveFacts({ session }: { session: InterviewSessionResponse }): React.JSX.Element {
  const finalization = session.finalization ?? null;
  const capture = session.capture ?? null;
  const facts = [
    {
      detail: capture === null ? '未创建正式采集边界' : captureStatusText(capture.status),
      label: '采集',
      source: '管理服务持久 snapshot',
    },
    {
      detail:
        finalization === null
          ? `已接收 ${String(capture?.uploaded_chunk_count ?? 0)} 段，manifest 尚未冻结`
          : `${uploadText(finalization.upload_status)} · ${String(finalization.uploaded_chunk_count)}/${String(finalization.expected_chunk_count)} 段`,
      label: '分片与 manifest',
      source: '管理服务持久 snapshot',
    },
    {
      detail:
        finalization === null
          ? '尚未有结束转录状态'
          : transcriptStatusText(finalization.transcript_status),
      label: '转录',
      source: '管理服务持久 snapshot',
    },
    {
      detail: sessionStatusText(session),
      label: '会话',
      source: '管理服务持久 snapshot',
    },
  ];
  return (
    <section className="save-facts" aria-label="保存状态明细">
      {facts.map((fact) => (
        <div key={fact.label}>
          <strong>{fact.label}</strong>
          <p>{fact.detail}</p>
          <small>{fact.source}</small>
        </div>
      ))}
    </section>
  );
}

function captureStatusText(
  status: NonNullable<InterviewSessionResponse['capture']>['status'],
): string {
  return {
    abandoned_empty: '采集已结束，未发现可保存音频',
    active: '采集中',
    interrupted: '采集已中断',
    preparing: '正在准备采集',
    stopped: '采集已停止',
  }[status];
}

function sessionStatusText(session: InterviewSessionResponse): string {
  if (session.status === 'failed' && session.capture_failure_code === 'NO_AUDIO_CAPTURED') {
    return '无音频终结';
  }
  return {
    completed: '已完成',
    created: '待设备检查',
    device_check: '设备检查完成',
    failed: '需要人工处置',
    interrupted: '采集已中断',
    processing: '录音完整，正在处理转录',
    reconnecting: '采集正在恢复',
    recording: '采集中',
    stopping: '正在安全保存',
  }[session.status];
}

function uploadText(
  status: NonNullable<InterviewSessionResponse['finalization']>['upload_status'],
): string {
  return {
    awaiting_upload: '等待分片',
    complete: 'manifest 完整',
    unrecoverable: 'manifest 无法自动恢复',
    verifying: '正在核验 manifest',
  }[status];
}

function transcriptStatusText(
  status: NonNullable<InterviewSessionResponse['finalization']>['transcript_status'],
): string {
  return {
    degraded: '转录已降级，录音不受影响',
    drained: '转录已完整收束',
    draining: '正在收束最后转录',
    not_started: '未启动结束转录处理',
    pending: '等待转录收束',
  }[status];
}

async function findAuthorizedSession(
  api: HomeApi,
  projectId: string,
  sessionId: string,
): Promise<ProjectSessionListItem | null> {
  let cursor: string | null = null;
  do {
    const page = await api.listProjectSessions(projectId, { cursor, limit: 100 });
    const session = page.items.find((item) => item.id === sessionId);
    if (session !== undefined) return session;
    cursor = page.next_cursor;
  } while (cursor !== null);
  return null;
}
