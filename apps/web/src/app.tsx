import { useEffect, useState, type SyntheticEvent } from 'react';
import type { AuthUser, CsrfResponse, LoginResponse } from '@elder-interview/contracts';

export function App(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      setUser(null);
      setCsrfToken(null);
    } catch {
      setError('退出失败，当前会话仍然保留');
    }
  }

  async function sendLogout(token: string | null): Promise<Response> {
    return fetch('/api/v1/auth/logout', {
      credentials: 'same-origin',
      headers: token === null ? {} : { 'X-CSRF-Token': token },
      method: 'POST',
    });
  }

  return (
    <main>
      <p className="eyebrow">DEV-001B</p>
      <h1>身份与会话基础</h1>
      {loading ? (
        <p>正在检查会话…</p>
      ) : user === null ? (
        <form
          onSubmit={(event) => {
            void login(event);
          }}
        >
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
          <button type="submit">登录</button>
        </form>
      ) : (
        <section>
          <h2>已登录</h2>
          <p>{user.display_name}</p>
          <p>角色：{user.role}</p>
          <button
            onClick={() => {
              void logout();
            }}
            type="button"
          >
            退出登录
          </button>
        </section>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
      <p>当前仅提供最小登录会话外壳，不包含长者项目或访谈业务。</p>
    </main>
  );
}
