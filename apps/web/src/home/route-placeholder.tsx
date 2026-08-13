import { useEffect, useState } from 'react';
import type { ProjectSessionListItem } from '@elder-interview/contracts';

import type { HomeApi } from '../interview/interview-api.js';
import { InterviewApiError } from '../interview/interview-api.js';
import { ErrorState, HomeFrame, LoadingState } from './home-shell.js';

export function ComingSoonRoute({
  navigate,
}: {
  navigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <HomeFrame>
      <section className="route-shell" aria-labelledby="route-title">
        <p className="context-label">新建访谈</p>
        <h1 id="route-title">即将可用</h1>
        <p>新建访谈的完整授权与设备准备流程正在建设中。此页不会创建草稿或开始录音。</p>
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

export function SessionPlaceholderRoute({
  api,
  kind,
  navigate,
  projectId,
  sessionId,
}: {
  api: HomeApi;
  kind: 'review' | 'save_facts';
  navigate: (path: string) => void;
  projectId: string;
  sessionId: string;
}): React.JSX.Element {
  const [session, setSession] = useState<ProjectSessionListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    findAuthorizedSession(api, projectId, sessionId)
      .then((value) => {
        const allowed =
          value !== null &&
          (kind === 'review'
            ? value.primary_action === 'view_review' && value.review_access === 'read_only'
            : value.primary_action === 'view_save_facts');
        if (current && allowed) setSession(value);
        else if (current) setError('当前访谈不可访问');
      })
      .catch((loadError: unknown) => {
        if (!current) return;
        setError(
          loadError instanceof InterviewApiError && [401, 403, 404].includes(loadError.status)
            ? '当前访谈不可访问'
            : '暂时无法加载当前访谈',
        );
      });
    return function cleanup(): void {
      current = false;
    };
  }, [api, kind, projectId, sessionId]);

  return (
    <HomeFrame>
      <section className="route-shell" aria-labelledby="route-title">
        {session === null && error === null ? <LoadingState /> : null}
        {error === null ? null : <ErrorState message={error} />}
        {session === null ? null : (
          <>
            <p className="context-label">第 {session.sequence_no} 次访谈</p>
            <h1 id="route-title">{kind === 'review' ? '回顾页即将可用' : '保存事实'}</h1>
            <p>
              {kind === 'review'
                ? 'A1 只提供受权路由壳，不在此显示转录、录音或本机副本操作。'
                : '当前会话没有可供回顾的完整录音事实，本页不提供播放或删除。'}
            </p>
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
