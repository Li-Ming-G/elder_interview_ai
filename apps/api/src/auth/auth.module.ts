import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { ResourceAuthorizationService } from './resource-authorization.service.js';
import { RoleGuard } from './role.guard.js';
import { SessionService } from './session.service.js';

@Module({})
// Nest requires a module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}

export function createAuthModule(config: ApiConfig): DynamicModule {
  return {
    controllers: [AuthController],
    exports: [PrismaService, ResourceAuthorizationService, SessionService],
    module: AuthModule,
    providers: [
      PrismaService,
      AuthService,
      LoginThrottleService,
      PasswordService,
      ResourceAuthorizationService,
      RoleGuard,
      SessionService,
      { provide: API_CONFIG, useValue: config },
    ],
  };
}
