import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AuthUser,
  ProjectListOrdinaryProjection,
  ProjectListProjection,
  ProjectSessionListItem,
  ProjectSessionListResponse,
  SessionHomeState,
  SessionPrimaryAction,
} from '@elder-interview/contracts';

import type { HomeApi, NextSessionApi } from '../interview/interview-api.js';
import { InterviewApiError } from '../interview/interview-api.js';
import {
  preparationPath,
  reauthorizationPath,
  reviewPath,
  saveFactsPath,
  workbenchPath,
} from '../interview/routes.js';
import {
  IndexedDbNewInterviewWorkflowStore,
  type NextSessionAttempt,
  type NewInterviewWorkflow,
} from '../interview/new-interview-workflow-store.js';
import { reconcileNewInterviewWorkflow } from '../interview/new-interview-recovery.js';

interface ProjectSessions {
  items: ProjectSessionListItem[];
  nextCursor: string | null;
}

type NewInterviewRecoveryState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'active'; workflow: NewInterviewWorkflow }
  | { kind: 'unavailable' };

export function HomeShell({
  api,
  errorMessage = null,
  navigate,
  onAuthLost,
  onLogout,
  workflowStore,
  user,
}: {
  api: HomeApi & NextSessionApi;
  errorMessage?: string | null;
  navigate: (path: string) => void;
  onAuthLost: () => void;
  onLogout: () => Promise<void>;
  workflowStore?: IndexedDbNewInterviewWorkflowStore;
  user: AuthUser;
}): React.JSX.Element {
  const store = useMemo(
    () => workflowStore ?? new IndexedDbNewInterviewWorkflowStore(),
    [workflowStore],
  );
  const [projects, setProjects] = useState<ProjectListProjection[] | null>(null);
  const [sessions, setSessions] = useState<Record<string, ProjectSessions>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [newInterviewRecovery, setNewInterviewRecovery] = useState<NewInterviewRecoveryState>({
    kind: 'checking',
  });

  useEffect(() => {
    let current = true;
    const resumeWhenOnline = (): void => {
      void (async (): Promise<void> => {
        try {
          const pending = await store.listNextSessionAttempts(user.id);
          if (!current || pending.length === 0) return;
          await resumeNextSessionAttempt(pending[0] as NextSessionAttempt);
        } catch {
          if (current) {
            setActionMessage('浏览器暂时无法恢复上次创建操作，请刷新后重试。');
          }
        }
      })();
    };
    window.addEventListener('online', resumeWhenOnline);
    async function load(): Promise<void> {
      setError(null);
      try {
        const projectPage = await api.listProjects();
        const ordinary = projectPage.items.filter(
          (project): project is ProjectListOrdinaryProjection => project.projection === 'ordinary',
        );
        const pages = await Promise.all(
          ordinary.map(
            async (project) => [project.id, await api.listProjectSessions(project.id)] as const,
          ),
        );
        if (!current) return;
        setProjects(projectPage.items);
        setSessions(
          Object.fromEntries(
            pages.map(([projectId, page]) => [
              projectId,
              { items: page.items, nextCursor: page.next_cursor },
            ]),
          ),
        );
        await loadNewInterviewRecovery();
        const pending = await store.listNextSessionAttempts(user.id);
        if (pending.length === 0) return;
        await resumeNextSessionAttempt(pending[0] as NextSessionAttempt);
      } catch (loadError) {
        if (!current) return;
        if (loadError instanceof InterviewApiError && loadError.status === 401) {
          onAuthLost();
          return;
        }
        setError('暂时无法加载工作区，请稍后重试');
      }
    }
    void load();
    return function cleanup(): void {
      current = false;
      window.removeEventListener('online', resumeWhenOnline);
    };
  }, [api, navigate, onAuthLost, store, user.id]);

  async function loadNewInterviewRecovery(): Promise<void> {
    try {
      const workflow = await store.getActive(user.id);
      if (workflow === null) {
        setNewInterviewRecovery({ kind: 'none' });
        return;
      }
      const result = await reconcileNewInterviewWorkflow(workflow, api);
      if (result.kind === 'retired') {
        await store.retire(result.workflow);
        setNewInterviewRecovery({ kind: 'none' });
      } else if (result.kind === 'active') {
        await store.put(result.workflow);
        setNewInterviewRecovery({ kind: 'active', workflow: result.workflow });
      } else {
        setNewInterviewRecovery({ kind: 'unavailable' });
        setActionMessage('暂时无法核对未完成的新建访谈，请选择新建访谈或稍后刷新重试。');
      }
    } catch {
      setNewInterviewRecovery({ kind: 'unavailable' });
      setActionMessage('暂时无法核对未完成的新建访谈，请选择新建访谈或稍后刷新重试。');
    }
  }

  async function resumeNextSessionAttempt(attempt: NextSessionAttempt): Promise<void> {
    setBusyProjectId(attempt.projectId);
    setActionMessage('正在恢复上次创建下一次访谈的操作，不会重复创建会话。');
    try {
      const response = await api.createNextSession(attempt.projectId, attempt.payload);
      assertNextSessionAck(attempt, response);
      await store.acknowledgeNextSession(user.id, attempt.projectId);
      navigate(preparationPath(attempt.projectId, response.session.id));
    } catch (attemptError) {
      if (attemptError instanceof InterviewApiError && attemptError.status === 401) {
        onAuthLost();
      } else if (attemptError instanceof InterviewApiError && attemptError.status === 0) {
        await store.markNextSessionUnknown(attempt);
        setActionMessage('暂时无法确认创建结果；网络恢复后会用同一操作继续核对。');
      } else if (
        attemptError instanceof Error &&
        attemptError.message === 'NEXT_SESSION_ACK_MISMATCH'
      ) {
        await store.markNextSessionUnknown(attempt);
        setActionMessage('服务端结果无法安全核对；已保留原操作，刷新后会继续权威重放。');
      } else if (
        attemptError instanceof InterviewApiError &&
        attemptError.code === 'NEXT_SESSION_ALREADY_EXISTS'
      ) {
        const existing = parseCurrentSessionPointer(attemptError.details);
        if (existing !== null) {
          await store.acknowledgeNextSession(user.id, attempt.projectId);
          navigate(preparationPath(attempt.projectId, existing.sessionId));
        } else {
          await store.markNextSessionUnknown(attempt);
          setActionMessage('服务端返回的会话指针无法安全核对；已保留原操作，请刷新后重试。');
        }
      } else {
        await store.acknowledgeNextSession(user.id, attempt.projectId);
        setActionMessage('当前无法创建下一次访谈，请刷新权威项目状态后再试。');
      }
    } finally {
      setBusyProjectId(null);
    }
  }

  async function startNextSession(project: ProjectListOrdinaryProjection): Promise<void> {
    const action = project.repeat_interview;
    if (action?.primary_action !== 'start_next_session') {
      return;
    }
    try {
      const attempt = await store.getOrCreateNextSessionAttempt(
        user.id,
        project.id,
        action.basis_session_id,
        action.basis_sequence_no,
      );
      await resumeNextSessionAttempt(attempt);
    } catch {
      setActionMessage('浏览器无法可靠保存本次创建操作，尚未向服务端发起请求。');
    }
  }

  async function loadMore(projectId: string): Promise<void> {
    const current = sessions[projectId];
    if (current?.nextCursor === null || current === undefined) return;
    try {
      const page: ProjectSessionListResponse = await api.listProjectSessions(projectId, {
        cursor: current.nextCursor,
      });
      setSessions((value) => ({
        ...value,
        [projectId]: {
          items: [...(value[projectId]?.items ?? []), ...page.items],
          nextCursor: page.next_cursor,
        },
      }));
    } catch (loadError) {
      if (loadError instanceof InterviewApiError && loadError.status === 401) onAuthLost();
      else setError('无法加载更多访谈，请刷新后重试');
    }
  }

  return (
    <HomeFrame>
      <header className="home-header">
        <div>
          <p className="context-label">拾光 · 倾听员工作区</p>
          <h1>今天好，{user.display_name}</h1>
          <p className="home-intro">从已分配的项目继续访谈，或查看服务端确认的保存状态。</p>
        </div>
        <div className="home-header__actions">
          <button
            className="button button--primary"
            disabled={
              newInterviewRecovery.kind === 'checking' ||
              newInterviewRecovery.kind === 'unavailable'
            }
            onClick={() => {
              navigate('/interviews/new');
            }}
            type="button"
          >
            {newInterviewRecovery.kind === 'checking'
              ? '正在核对未完成访谈…'
              : newInterviewRecovery.kind === 'unavailable'
                ? '暂时无法安全新建访谈'
                : newInterviewRecovery.kind === 'active'
                  ? '开始新的访谈'
                  : '新建访谈'}
          </button>
          {newInterviewRecovery.kind !== 'active' ? null : (
            <button
              className="button button--secondary"
              onClick={() => {
                navigate('/interviews/new?mode=resume');
              }}
              type="button"
            >
              继续未完成访谈
            </button>
          )}
          <button
            className="button button--secondary"
            onClick={() => void onLogout()}
            type="button"
          >
            退出登录
          </button>
        </div>
      </header>
      {errorMessage === null ? null : <ErrorState message={errorMessage} />}
      {actionMessage === null ? null : (
        <p className="workflow-message" role="status">
          {actionMessage}
        </p>
      )}
      <section className="home-section" aria-labelledby="assigned-heading" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="context-label">已分配工作</p>
            <h2 id="assigned-heading">项目与访谈</h2>
          </div>
        </div>
        {error === null ? null : <ErrorState message={error} />}
        {projects === null && error === null ? <LoadingState /> : null}
        {projects?.length === 0 ? <EmptyState /> : null}
        {projects?.map((project) =>
          project.projection === 'restricted' ? (
            <ListRow key={project.project_id} restricted>
              <div className="list-row__main">
                <strong>{project.display_label}</strong>
                <span>{project.status_label}</span>
              </div>
              <StatusBadge tone="restricted">受限</StatusBadge>
            </ListRow>
          ) : (
            <ProjectGroup
              key={project.id}
              busy={busyProjectId === project.id}
              navigate={navigate}
              onLoadMore={() => void loadMore(project.id)}
              onStartNext={() => void startNextSession(project)}
              project={project}
              sessions={sessions[project.id] ?? { items: [], nextCursor: null }}
            />
          ),
        )}
      </section>
    </HomeFrame>
  );
}

function parseCurrentSessionPointer(
  details: Readonly<Record<string, unknown>>,
): { sequenceNo: number; sessionId: string } | null {
  const keys = Object.keys(details).sort();
  if (keys.length !== 2 || keys[0] !== 'sequence_no' || keys[1] !== 'session_id') return null;
  const sequenceNo = details.sequence_no;
  const sessionId = details.session_id;
  if (!Number.isSafeInteger(sequenceNo) || (sequenceNo as number) < 1) return null;
  if (
    typeof sessionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sessionId)
  ) {
    return null;
  }
  return { sequenceNo: sequenceNo as number, sessionId };
}

export function HomeFrame({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="home-shell">{children}</main>;
}

export function ListRow({
  children,
  restricted = false,
}: {
  children: ReactNode;
  restricted?: boolean;
}): React.JSX.Element {
  return <div className={`list-row${restricted ? ' list-row--restricted' : ''}`}>{children}</div>;
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'active' | 'neutral' | 'restricted' | 'warning';
}): React.JSX.Element {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function LoadingState(): React.JSX.Element {
  return (
    <div className="home-state" aria-busy="true">
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--copy" />
      <span className="sr-only">正在加载已分配项目和访谈</span>
    </div>
  );
}

export function EmptyState(): React.JSX.Element {
  return (
    <div className="home-state">
      <strong>还没有已分配的项目</strong>
      <p>新建访谈功能即将可用；已有项目被分配后会显示在这里。</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="home-state home-state--error" role="alert">
      <strong>加载遇到问题</strong>
      <p>{message}</p>
    </div>
  );
}

function ProjectGroup({
  busy,
  navigate,
  onLoadMore,
  onStartNext,
  project,
  sessions,
}: {
  busy: boolean;
  navigate: (path: string) => void;
  onLoadMore: () => void;
  onStartNext: () => void;
  project: ProjectListOrdinaryProjection;
  sessions: ProjectSessions;
}): React.JSX.Element {
  return (
    <article className="project-group">
      <header className="project-group__header">
        <div>
          <h3>{project.display_name}</h3>
          <span>项目状态：{projectStatusLabel(project.status)}</span>
        </div>
        <div className="project-group__actions">
          <StatusBadge tone={project.status === 'active' ? 'active' : 'neutral'}>
            {projectStatusLabel(project.status)}
          </StatusBadge>
          {project.repeat_interview?.primary_action === 'start_next_session' ? (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={onStartNext}
              type="button"
            >
              {busy ? '正在建立…' : '开始下一次访谈'}
            </button>
          ) : null}
          {project.repeat_interview?.primary_action === 'record_formal_consent' ? (
            <button
              className="button button--secondary"
              onClick={() => {
                navigate(reauthorizationPath(project.id));
              }}
              type="button"
            >
              重新取得正式授权
            </button>
          ) : null}
        </div>
      </header>
      {sessions.items.length === 0 ? (
        <div className="project-empty">这个项目还没有访谈会话。</div>
      ) : (
        <div className="session-list">
          {sessions.items.map((session) => (
            <SessionRow key={session.id} navigate={navigate} session={session} />
          ))}
        </div>
      )}
      {sessions.nextCursor === null ? null : (
        <button className="text-button project-group__more" onClick={onLoadMore} type="button">
          加载更多访谈
        </button>
      )}
    </article>
  );
}

function SessionRow({
  navigate,
  session,
}: {
  navigate: (path: string) => void;
  session: ProjectSessionListItem;
}): React.JSX.Element {
  return (
    <ListRow>
      <div className="list-row__main">
        <strong>第 {session.sequence_no} 次访谈</strong>
        <span>{homeStateLabel(session.home_state)}</span>
        <small>
          {session.started_at === null
            ? formatDate(session.created_at)
            : formatDate(session.started_at)}
        </small>
      </div>
      <StatusBadge tone={statusTone(session.home_state)}>
        {homeStateLabel(session.home_state)}
      </StatusBadge>
      <button
        className="button button--secondary list-row__action"
        onClick={() => {
          navigate(actionPath(session));
        }}
        type="button"
      >
        {actionLabel(session.primary_action)}
      </button>
    </ListRow>
  );
}

function actionPath(session: ProjectSessionListItem): string {
  switch (session.primary_action) {
    case 'continue_preparation':
      return preparationPath(session.project_id, session.id);
    case 'return_to_interview':
    case 'resolve_interruption':
    case 'view_save_progress':
      return workbenchPath(session.project_id, session.id);
    case 'view_review':
      return reviewPath(session.project_id, session.id);
    case 'view_save_facts':
      return saveFactsPath(session.project_id, session.id);
  }
}

const HOME_LABELS: Record<SessionHomeState, string> = {
  interview_active: '访谈进行中',
  interview_interrupted: '访谈已中断',
  no_audio_captured: '未录到可保存内容',
  preparation_required: '准备尚未完成',
  review_ready: '访谈已结束',
  save_failed: '保存未完成',
  saved_with_warning: '录音已保存，处理需要关注',
  saving_audio: '正在安全保存录音',
  transcript_processing: '录音已安全保存 · 转录处理中',
};

const ACTION_LABELS: Record<SessionPrimaryAction, string> = {
  continue_preparation: '继续准备',
  resolve_interruption: '处理访谈中断',
  return_to_interview: '返回访谈',
  view_review: '查看回顾',
  view_save_facts: '查看保存事实',
  view_save_progress: '查看保存进度',
};

function homeStateLabel(state: SessionHomeState): string {
  return HOME_LABELS[state];
}

function actionLabel(action: SessionPrimaryAction): string {
  return ACTION_LABELS[action];
}

function projectStatusLabel(status: ProjectListOrdinaryProjection['status']): string {
  return { active: '进行中', completed: '已完成', draft: '待完善', ready: '已就绪' }[status];
}

function statusTone(state: SessionHomeState): 'active' | 'neutral' | 'warning' {
  if (state === 'interview_active' || state === 'review_ready') return 'active';
  if (
    state === 'save_failed' ||
    state === 'saved_with_warning' ||
    state === 'interview_interrupted'
  )
    return 'warning';
  return 'neutral';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function assertNextSessionAck(
  attempt: NextSessionAttempt,
  response: Awaited<ReturnType<NextSessionApi['createNextSession']>>,
): void {
  if (
    response.request_id !== attempt.payload.request_id ||
    response.project_id !== attempt.projectId ||
    response.basis_session_id !== attempt.payload.basis_session_id ||
    response.basis_sequence_no !== attempt.payload.expected_basis_sequence_no ||
    response.session.project_id !== attempt.projectId ||
    response.session.sequence_no !== attempt.payload.expected_basis_sequence_no + 1
  ) {
    throw new Error('NEXT_SESSION_ACK_MISMATCH');
  }
}
