import type {
  AuthUser,
  CsrfResponse,
  LoginResponse,
  LogoutResponse,
} from '@elder-interview/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { AuthService } from './auth.service.js';
import type { AuthPrincipal } from './auth.types.js';
import {
  cookieHeader,
  normalizeEmail,
  parseCookie,
  sessionCookieName,
  usesSecureBrowserCookie,
  validatePassword,
} from './auth.utils.js';
import { CLIENT_IP_RESOLVER, type ClientIpResolver } from './client-ip-resolver.js';
import { SessionService } from './session.service.js';
import { RoleGuard } from './role.guard.js';
import { Roles } from './roles.decorator.js';

@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly secureBrowserCookie: boolean;

  public constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(CLIENT_IP_RESOLVER) private readonly clientIps: ClientIpResolver,
    @Inject(API_CONFIG) config: ApiConfigValue,
  ) {
    this.secureBrowserCookie = usesSecureBrowserCookie(config.appEnv);
    this.cookieName = sessionCookieName(config.appEnv);
  }

  @Post('login')
  @HttpCode(200)
  public async login(
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(
      normalizeEmail(body.email),
      validatePassword(body.password),
      this.clientIps.resolve(request),
      String(response.locals.requestId ?? '00000000-0000-0000-0000-000000000000'),
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Set-Cookie',
      cookieHeader(this.cookieName, result.sessionToken, this.secureBrowserCookie),
    );
    return { csrf_token: result.csrfToken, user: result.user };
  }

  @Get('me')
  public async me(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUser> {
    const principal = await this.principal(request);
    response.setHeader('Cache-Control', 'no-store');
    return this.user(principal);
  }

  @Get('csrf')
  public async csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CsrfResponse> {
    const principal = await this.principal(request);
    const csrfToken = await this.sessions.rotateCsrf(principal.sessionId);
    response.setHeader('Cache-Control', 'no-store');
    return { csrf_token: csrfToken };
  }

  @Get('admin-proof')
  @UseGuards(RoleGuard)
  @Roles('admin')
  public adminProof(): { allowed: true } {
    return { allowed: true };
  }

  @Post('logout')
  @HttpCode(200)
  public async logout(
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutResponse> {
    const token = parseCookie(request.headers.cookie, this.cookieName);
    if (token !== null) {
      const principal = await this.sessions.authenticate(token).catch(() => null);
      if (principal !== null) {
        const validCsrf = await this.sessions.verifyCsrf(principal.sessionId, csrfToken);
        if (!validCsrf) {
          throw new ForbiddenException({
            code: 'INVALID_CSRF_TOKEN',
            details: {},
            message: 'Invalid CSRF token',
          });
        }
        await this.sessions.revoke(principal.sessionId, 'logout');
      }
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Set-Cookie',
      cookieHeader(this.cookieName, '', this.secureBrowserCookie, true),
    );
    return { logged_out: true };
  }

  private async principal(request: Request): Promise<AuthPrincipal> {
    return this.sessions.authenticate(parseCookie(request.headers.cookie, this.cookieName));
  }

  private user(principal: AuthPrincipal): AuthUser {
    return {
      display_name: principal.displayName,
      id: principal.id,
      role: principal.role,
      status: principal.status,
    };
  }
}
