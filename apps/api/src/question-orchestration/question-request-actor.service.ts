import { Inject, Injectable } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { parseCookie, sessionCookieName } from '../auth/auth.utils.js';
import type { AuthenticatedRequest, AuthPrincipal } from '../auth/auth.types.js';
import { SessionService } from '../auth/session.service.js';

@Injectable()
export class QuestionRequestActorService {
  private readonly cookieName: string;

  public constructor(
    private readonly sessions: SessionService,
    @Inject(API_CONFIG) config: ApiConfigValue,
  ) {
    this.cookieName = sessionCookieName(config.appEnv);
  }

  public async from(request: AuthenticatedRequest): Promise<AuthPrincipal> {
    if (request.auth !== undefined) return request.auth;
    return this.sessions.authenticate(parseCookie(request.headers.cookie, this.cookieName));
  }
}
