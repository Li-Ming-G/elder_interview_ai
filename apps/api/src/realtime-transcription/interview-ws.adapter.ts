import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';

import type { ApiConfigValue } from '../api-config.js';
import { parseCookie, sessionCookieName } from '../auth/auth.utils.js';
import { SessionService } from '../auth/session.service.js';
import { WS_AUTH, type AuthenticatedUpgradeRequest } from './realtime-auth.js';

interface VerifyInfo {
  origin: string;
  req: AuthenticatedUpgradeRequest;
  secure: boolean;
}

type VerifyDone = (result: boolean, code?: number, message?: string) => void;

export class InterviewWsAdapter extends WsAdapter {
  private readonly sessions: SessionService;

  public constructor(
    application: INestApplicationContext,
    private readonly config: ApiConfigValue,
  ) {
    super(application);
    this.sessions = application.get(SessionService);
  }

  public override create(port: number, options: Record<string, unknown> = {}): unknown {
    return super.create(port, {
      ...options,
      // Keep a transport-level abuse ceiling above the 8 KiB business limit so
      // ordinary over-limit messages receive the protocol's controlled 4400 error.
      maxPayload: 64 * 1024,
      verifyClient: (info: VerifyInfo, done: VerifyDone) => void this.verify(info, done),
    });
  }

  private async verify(info: VerifyInfo, done: VerifyDone): Promise<void> {
    if (!this.config.authAllowedOrigins.includes(info.origin)) {
      done(false, 403, 'Forbidden');
      return;
    }
    const cookieName = sessionCookieName(this.config.appEnv);
    let token: string | null;
    try {
      token = parseCookie(info.req.headers.cookie, cookieName);
    } catch {
      done(false, 401, 'Unauthorized');
      return;
    }
    try {
      const principal = await this.sessions.authenticate(token);
      if (token === null) throw new Error('Missing session');
      info.req[WS_AUTH] = { principal, sessionToken: token };
      done(true);
    } catch {
      done(false, 401, 'Unauthorized');
    }
  }
}
