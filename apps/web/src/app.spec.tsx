// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './app.js';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows login after an unauthenticated session check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    render(<App />);
    expect(await screen.findByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.getByText(/不包含长者项目或访谈业务/)).toBeTruthy();
  });

  it('restores an authenticated session and rotates CSRF in memory', async () => {
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports restore errors without claiming an authenticated state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('无法恢复已有会话');
    expect(screen.queryByRole('heading', { name: '已登录' })).toBeNull();
  });
});
