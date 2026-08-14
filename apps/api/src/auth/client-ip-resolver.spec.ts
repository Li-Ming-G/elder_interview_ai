import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { DirectPeerClientIpResolver, normalizeDirectPeer } from './client-ip-resolver.js';

describe('direct-peer client IP boundary', () => {
  it('normalizes IPv4-mapped peers and rejects non-IP values', () => {
    expect(normalizeDirectPeer('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeDirectPeer('2001:DB8::1%eth0')).toBe('2001:db8::1');
    expect(normalizeDirectPeer('not-an-ip')).toBe('unavailable');
    expect(normalizeDirectPeer(undefined)).toBe('unavailable');
  });

  it('ignores all forwarded and Cloudflare headers', () => {
    const request = {
      headers: {
        'cf-connecting-ip': '198.51.100.10',
        forwarded: 'for=198.51.100.11',
        'x-forwarded-for': '198.51.100.12',
      },
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    } as unknown as Request;
    expect(new DirectPeerClientIpResolver().resolve(request)).toBe('127.0.0.1');
  });
});
