import { type ApiConfig } from '@elder-interview/config';
import {
  type DynamicModule,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';

import { API_CONFIG } from './api-config.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { RequestIdMiddleware } from './http/request-id.middleware.js';

@Module({})
export class AppModule implements NestModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      controllers: [HealthController],
      module: AppModule,
      providers: [
        PrismaService,
        {
          provide: API_CONFIG,
          useValue: config,
        },
      ],
    };
  }

  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*splat', method: RequestMethod.ALL });
  }
}
