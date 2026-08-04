import type { UserRole } from '@elder-interview/contracts';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { COOKIE_LOCAL, COOKIE_PRODUCTION, parseCookie } from './auth.utils.js';
import { ResourceAuthorizationService } from './resource-authorization.service.js';
import { AUTH_ROLES } from './roles.decorator.js';
import { SessionService } from './session.service.js';

@Injectable()
export class RoleGuard implements CanActivate {
  private readonly cookieName: string;

  public constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly authorization: ResourceAuthorizationService,
    @Inject(API_CONFIG) config: ApiConfigValue,
  ) {
    this.cookieName = config.appEnv === 'production' ? COOKIE_PRODUCTION : COOKIE_LOCAL;
  }

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<readonly UserRole[]>(AUTH_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = await this.sessions.authenticate(
      parseCookie(request.headers.cookie, this.cookieName),
    );
    await this.authorization.assertRole(actor, roles);
    request.auth = actor;
    return true;
  }
}
