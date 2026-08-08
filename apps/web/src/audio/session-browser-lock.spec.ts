// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { SessionBrowserLock } from './session-browser-lock.js';

describe('SessionBrowserLock', () => {
  it('holds one atomic exclusive browser-tab owner until release', async () => {
    let held = false;
    const locks = {
      async request(
        _name: string,
        _options: { ifAvailable: true; mode: 'exclusive' },
        callback: (lock: Lock | null) => Promise<void>,
      ): Promise<void> {
        if (held) return callback(null);
        held = true;
        try {
          await callback({} as Lock);
        } finally {
          held = false;
        }
      },
    };
    const first = new SessionBrowserLock('fictional-session', { locks });
    const second = new SessionBrowserLock('fictional-session', { locks });

    await expect(first.acquire()).resolves.toBe(true);
    await expect(second.acquire()).resolves.toBe(false);
    await first.release();
    await expect(second.acquire()).resolves.toBe(true);
    await second.release();
  });

  it('rejects without hanging when the browser lock request fails before callback', async () => {
    const failure = new Error('synthetic lock manager failure');
    const lock = new SessionBrowserLock('fictional-session', {
      locks: {
        request: (): Promise<void> => Promise.reject(failure),
      },
    });

    await expect(lock.acquire()).rejects.toBe(failure);
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
