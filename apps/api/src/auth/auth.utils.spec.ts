import { describe, expect, it } from 'vitest';

import {
  COOKIE_LOCAL,
  COOKIE_PRODUCTION,
  cookieHeader,
  parseCookie,
  sessionCookieName,
  usesSecureBrowserCookie,
} from './auth.utils.js';

describe('public browser session cookie profile', () => {
  it.each(['staging', 'production'] as const)(
    'uses the Secure __Host- profile in %s',
    (environment) => {
      expect(usesSecureBrowserCookie(environment)).toBe(true);
      expect(sessionCookieName(environment)).toBe(COOKIE_PRODUCTION);
      const header = cookieHeader(sessionCookieName(environment), 'opaque', true);
      expect(header).toContain('__Host-elder_interview_session=opaque');
      expect(header).toContain('Path=/');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Secure');
      expect(header).toContain('SameSite=Strict');
      expect(header).not.toContain('Domain=');
    },
  );

  it.each(['local', 'test'] as const)('keeps the HTTP-only local profile in %s', (environment) => {
    expect(usesSecureBrowserCookie(environment)).toBe(false);
    expect(sessionCookieName(environment)).toBe(COOKIE_LOCAL);
    expect(cookieHeader(sessionCookieName(environment), 'opaque', false)).not.toContain('Secure');
  });

  it('treats malformed percent encoding as no usable session instead of throwing', () => {
    expect(parseCookie('elder_interview_session=%E0%A4%A', COOKIE_LOCAL)).toBeNull();
  });
});
