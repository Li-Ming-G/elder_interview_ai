import { type ApiConfig } from '@elder-interview/config';
import {
  type DynamicModule,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';

import { API_CONFIG } from './api-config.js';
import { createAuthModule } from './auth/auth.module.js';
import { CsrfMiddleware } from './auth/csrf.middleware.js';
import { OriginMiddleware } from './auth/origin.middleware.js';
import { HealthController } from './health/health.controller.js';
import { RequestIdMiddleware } from './http/request-id.middleware.js';

@Module({})
export class AppModule implements NestModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      controllers: [HealthController],
      global: true,
      imports: [createAuthModule(config)],
      module: AppModule,
      providers: [
        {
          provide: API_CONFIG,
          useValue: config,
        },
      ],
    };
  }

  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, OriginMiddleware, CsrfMiddleware)
      .forRoutes({ path: '*splat', method: RequestMethod.ALL });
  }
}
