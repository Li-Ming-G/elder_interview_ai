import { useEffect, useState, type ReactNode } from 'react';
import type {
  AuthUser,
  ProjectListOrdinaryProjection,
  ProjectListProjection,
  ProjectSessionListItem,
  ProjectSessionListResponse,
  SessionHomeState,
  SessionPrimaryAction,
} from '@elder-interview/contracts';

import type { HomeApi } from '../interview/interview-api.js';
import { InterviewApiError } from '../interview/interview-api.js';
import { preparationPath, reviewPath, saveFactsPath, workbenchPath } from '../interview/routes.js';

interface ProjectSessions {
  items: ProjectSessionListItem[];
  nextCursor: string | null;
}

export function HomeShell({
  api,
  errorMessage = null,
  navigate,
  onAuthLost,
  onLogout,
  user,
}: {
  api: HomeApi;
  errorMessage?: string | null;
  navigate: (path: string) => void;
  onAuthLost: () => void;
  onLogout: () => Promise<void>;
  user: AuthUser;
}): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectListProjection[] | null>(null);
  const [sessions, setSessions] = useState<Record<string, ProjectSessions>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
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
    };
  }, [api, onAuthLost]);

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
            onClick={() => {
              navigate('/interviews/new');
            }}
            type="button"
          >
            新建访谈
          </button>
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
              navigate={navigate}
              onLoadMore={() => void loadMore(project.id)}
              project={project}
              sessions={sessions[project.id] ?? { items: [], nextCursor: null }}
            />
          ),
        )}
      </section>
    </HomeFrame>
  );
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
  navigate,
  onLoadMore,
  project,
  sessions,
}: {
  navigate: (path: string) => void;
  onLoadMore: () => void;
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
        <StatusBadge tone={project.status === 'active' ? 'active' : 'neutral'}>
          {projectStatusLabel(project.status)}
        </StatusBadge>
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
