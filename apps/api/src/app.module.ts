import { type ApiConfig } from '@elder-interview/config';
import {
  type DynamicModule,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';

import { API_CONFIG } from './api-config.js';
import { createAudioModule } from './audio/audio.module.js';
import { createAuthModule } from './auth/auth.module.js';
import { CsrfMiddleware } from './auth/csrf.middleware.js';
import { OriginMiddleware } from './auth/origin.middleware.js';
import { HealthController } from './health/health.controller.js';
import { RequestIdMiddleware } from './http/request-id.middleware.js';
import { createProjectFoundationModule } from './project-foundation/project-foundation.module.js';
import { createTranscriptionModule } from './transcription/transcription.module.js';

@Module({})
export class AppModule implements NestModule {
  public static register(config: ApiConfig): DynamicModule {
    const authModule = createAuthModule(config);
    const audioModule = createAudioModule(config, authModule);
    return {
      controllers: [HealthController],
      global: true,
      imports: [
        authModule,
        audioModule,
        createProjectFoundationModule(config, authModule, audioModule),
        createTranscriptionModule(authModule),
      ],
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
