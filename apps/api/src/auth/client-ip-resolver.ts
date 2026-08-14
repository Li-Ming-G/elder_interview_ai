import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isIP } from 'node:net';

export const CLIENT_IP_RESOLVER = Symbol('CLIENT_IP_RESOLVER');

export interface ClientIpResolver {
  resolve(request: Request): string;
}

/**
 * Fail-closed default until the deployment contract freezes a trusted ingress,
 * direct-origin blocking, proxy set, one client-IP header, and hop semantics.
 */
@Injectable()
export class DirectPeerClientIpResolver implements ClientIpResolver {
  public resolve(request: Request): string {
    return normalizeDirectPeer(request.socket.remoteAddress);
  }
}

export function normalizeDirectPeer(value: string | undefined): string {
  if (value === undefined) return 'unavailable';
  const withoutZone = value.split('%', 1)[0] ?? value;
  if (withoutZone.startsWith('::ffff:')) {
    const mapped = withoutZone.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return mapped;
  }
  return isIP(withoutZone) === 0 ? 'unavailable' : withoutZone.toLowerCase();
}
