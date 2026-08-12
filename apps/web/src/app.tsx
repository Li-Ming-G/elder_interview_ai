import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import type { AuthUser, CsrfResponse, LoginResponse } from '@elder-interview/contracts';

import { createInterviewApi } from './interview/interview-api.js';
import { checkMicrophoneInput } from './interview/microphone-check.js';
import { PreparationPage } from './interview/preparation-page.js';
import { parseInterviewRoute } from './interview/routes.js';
import { WorkbenchShell } from './interview/workbench-shell.js';
import { NewInterviewPage } from './interview/new-interview-page.js';
import { createBrowserInterviewCaptureController } from './interview/browser-interview-capture-controller.js';
import type { InterviewCaptureController } from './interview/interview-capture-controller.js';
import { ErrorState, HomeFrame, HomeShell } from './home/home-shell.js';
import { SessionPlaceholderRoute } from './home/route-placeholder.js';
import { SessionReviewRoute } from './home/session-review-route.js';

export function App(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pathname, setPathname] = useState(globalThis.location.pathname);
  const captureControllers = useRef(new Map<string, InterviewCaptureController>());

  useEffect(() => {
    function onPopState(): void {
      setPathname(globalThis.location.pathname);
    }
    globalThis.addEventListener('popstate', onPopState);
    return function cleanupPopState(): void {
      globalThis.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    async function restoreSession(): Promise<void> {
      try {
        const me = await fetch('/api/v1/auth/me', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (me.status === 401) return;
        if (!me.ok) throw new Error('me_failed');
        const csrf = await fetch('/api/v1/auth/csrf', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!csrf.ok) throw new Error('csrf_failed');
        setUser((await me.json()) as AuthUser);
        setCsrfToken(((await csrf.json()) as CsrfResponse).csrf_token);
      } catch {
        setError('无法恢复已有会话，请稍后重试');
      } finally {
        setLoading(false);
      }
    }
    void restoreSession();
  }, []);

  const interviewApi = useMemo(
    () => (csrfToken === null ? null : createInterviewApi(csrfToken)),
    [csrfToken],
  );
  const captureController = useMemo(() => {
    if (interviewApi === null || csrfToken === null) return null;
    return (projectId: string, sessionId: string): InterviewCaptureController => {
      const existing = captureControllers.current.get(sessionId);
      if (existing !== undefined) return existing;
      const controller = createBrowserInterviewCaptureController({
        api: interviewApi,
        csrfToken,
        projectId,
        sessionId,
      });
      captureControllers.current.set(sessionId, controller);
      return controller;
    };
  }, [csrfToken, interviewApi]);

  async function login(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/login', {
        body: JSON.stringify({ email, password }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        setError('邮箱或密码不正确');
        return;
      }
      const payload = (await response.json()) as LoginResponse;
      setUser(payload.user);
      setCsrfToken(payload.csrf_token);
      setPassword('');
    } catch {
      setError('登录请求失败，请稍后重试');
    }
  }

  async function logout(): Promise<void> {
    setError(null);
    try {
      let token = csrfToken;
      let response = await sendLogout(token);
      if (response.status === 403) {
        const csrf = await fetch('/api/v1/auth/csrf', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!csrf.ok) throw new Error('csrf_refresh_failed');
        token = ((await csrf.json()) as CsrfResponse).csrf_token;
        setCsrfToken(token);
        response = await sendLogout(token);
      }
      if (!response.ok) throw new Error('logout_failed');
      captureControllers.current.clear();
      setUser(null);
      setCsrfToken(null);
    } catch {
      setError('退出失败，当前会话仍然保留');
    }
  }

  function navigate(path: string, replace = false): void {
    if (replace) globalThis.history.replaceState(null, '', path);
    else globalThis.history.pushState(null, '', path);
    setPathname(path);
  }

  function returnToLogin(): void {
    captureControllers.current.clear();
    setUser(null);
    setCsrfToken(null);
    setError(null);
    navigate('/', true);
  }

  if (loading) {
    return (
      <main className="auth-page" aria-busy="true">
        <div className="skeleton skeleton--label" />
        <div className="skeleton skeleton--title" />
        <span className="sr-only">正在检查登录状态</span>
      </main>
    );
  }

  if (user === null || csrfToken === null || interviewApi === null || captureController === null) {
    return (
      <main className="auth-page">
        <section className="auth-panel" aria-labelledby="login-title">
          <p className="context-label">拾光 · 倾听员工作区</p>
          <h1 id="login-title">欢迎回来</h1>
          <p className="auth-intro">登录后继续已分配的访谈准备。</p>
          <form onSubmit={(event) => void login(event)}>
            <label>
              邮箱
              <input
                autoComplete="username"
                name="email"
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                value={email}
              />
            </label>
            <label>
              密码
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                type="password"
                value={password}
              />
            </label>
            <button className="button button--primary" type="submit">
              登录
            </button>
          </form>
          {error === null ? null : (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  const route = parseInterviewRoute(pathname);
  if (route?.kind === 'preparation') {
    return (
      <PreparationPage
        actorId={user.id}
        api={interviewApi}
        captureController={(sessionId) => captureController(route.projectId, sessionId)}
        checkMicrophone={checkMicrophoneInput}
        initialSessionId={route.sessionId}
        navigate={navigate}
        projectId={route.projectId}
      />
    );
  }
  if (route?.kind === 'workbench') {
    return (
      <WorkbenchShell
        api={interviewApi}
        captureController={captureController(route.projectId, route.sessionId)}
        navigate={navigate}
        onReturnToLogin={returnToLogin}
        projectId={route.projectId}
        sessionId={route.sessionId}
      />
    );
  }

  if (route?.kind === 'new_interview') {
    return (
      <NewInterviewPage
        actorId={user.id}
        api={interviewApi}
        csrfToken={csrfToken}
        navigate={navigate}
      />
    );
  }

  if (route?.kind === 'review') {
    return (
      <SessionReviewRoute
        api={interviewApi}
        navigate={navigate}
        projectId={route.projectId}
        sessionId={route.sessionId}
      />
    );
  }

  if (route?.kind === 'save_facts') {
    return (
      <SessionPlaceholderRoute
        api={interviewApi}
        kind={route.kind}
        navigate={navigate}
        projectId={route.projectId}
        sessionId={route.sessionId}
      />
    );
  }

  if (pathname === '/') {
    return (
      <HomeShell
        api={interviewApi}
        errorMessage={error}
        navigate={navigate}
        onAuthLost={returnToLogin}
        onLogout={logout}
        user={user}
      />
    );
  }

  return (
    <HomeFrame>
      <section className="route-shell">
        <ErrorState message="这个页面不存在或已不可访问" />
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

async function sendLogout(token: string | null): Promise<Response> {
  return fetch('/api/v1/auth/logout', {
    credentials: 'same-origin',
    headers: token === null ? {} : { 'X-CSRF-Token': token },
    method: 'POST',
  });
}
