import { ForbiddenException, Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { COOKIE_LOCAL, COOKIE_PRODUCTION, parseCookie } from './auth.utils.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Default-deny protection for every future authenticated state-changing browser route. */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly cookieName: string;

  public constructor(
    private readonly sessions: SessionService,
    @Inject(API_CONFIG) config: ApiConfigValue,
  ) {
    this.cookieName = config.appEnv === 'production' ? COOKIE_PRODUCTION : COOKIE_LOCAL;
  }

  public async use(
    request: AuthenticatedRequest,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const path = request.originalUrl.split('?')[0] ?? '';
    if (
      SAFE_METHODS.has(request.method.toUpperCase()) ||
      path.endsWith('/auth/login') ||
      path.endsWith('/auth/logout')
    ) {
      next();
      return;
    }
    const principal = await this.sessions.authenticate(
      parseCookie(request.headers.cookie, this.cookieName),
    );
    const valid = await this.sessions.verifyCsrf(
      principal.sessionId,
      request.header('x-csrf-token'),
    );
    if (!valid) {
      throw new ForbiddenException({
        code: 'INVALID_CSRF_TOKEN',
        details: {},
        message: 'Invalid CSRF token',
      });
    }
    request.auth = principal;
    next();
  }
}
