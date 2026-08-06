import type { IncomingMessage } from 'node:http';
import type { AuthPrincipal } from '../auth/auth.types.js';

export const WS_AUTH = Symbol('WS_AUTH');

export interface WsUpgradeAuth {
  principal: AuthPrincipal;
  sessionToken: string;
}

export interface AuthenticatedUpgradeRequest extends IncomingMessage {
  [WS_AUTH]?: WsUpgradeAuth;
}
