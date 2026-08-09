// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './app.js';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.history.replaceState(null, '', '/');
  });

  it('shows login after an unauthenticated session check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    render(<App />);
    expect(await screen.findByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.getByText(/登录后继续已分配的访谈准备/)).toBeTruthy();
  });

  it('restores an authenticated session and keeps the root as a deep-link entry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            display_name: '虚构倾听员 A',
            id: 'u',
            role: 'interviewer',
            status: 'active',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrf_token: 'opaque' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '已登录' })).toBeTruthy();
    expect(screen.getByText(/正式访谈深链/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports restore errors without claiming an authenticated state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('无法恢复已有会话');
    expect(screen.queryByRole('heading', { name: '已登录' })).toBeNull();
  });

  it('clears the cached authenticated app state when a workbench load returns 401', async () => {
    globalThis.history.replaceState(
      null,
      '',
      '/projects/11111111-1111-4111-8111-111111111111/interview/22222222-2222-4222-8222-222222222222/workbench',
    );
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const requestUrl =
        input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const path = new URL(requestUrl, globalThis.location.origin).pathname;
      if (path === '/api/v1/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              display_name: '虚构倾听员 A',
              id: 'u',
              role: 'interviewer',
              status: 'active',
            }),
            { status: 200 },
          ),
        );
      }
      if (path === '/api/v1/auth/csrf') {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: 'expired-token' }), { status: 200 }),
        );
      }
      if (path.includes('/sessions/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const returnToLogin = await screen.findByRole('button', { name: '返回登录' });
    fireEvent.click(returnToLogin);
    expect(await screen.findByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '已登录' })).toBeNull();
    expect(globalThis.location.pathname).toBe('/');
  });
});
