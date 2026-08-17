import { type ApiConfig } from '@elder-interview/config';
import {
  type DynamicModule,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';

import { API_CONFIG } from './api-config.js';
import { createAiRuntimeModule } from './ai-runtime/ai-runtime.module.js';
import { createAudioModule } from './audio/audio.module.js';
import { createAuthModule } from './auth/auth.module.js';
import { CsrfMiddleware } from './auth/csrf.middleware.js';
import { OriginMiddleware } from './auth/origin.middleware.js';
import { HealthController } from './health/health.controller.js';
import { RequestIdMiddleware } from './http/request-id.middleware.js';
import { createMemoryModule } from './memory/memory.module.js';
import { createProjectFoundationModule } from './project-foundation/project-foundation.module.js';
import type { ConsentContinuationPolicyReader } from './project-foundation/consent-continuation.policy.js';
import { createQuestionEvidenceModule } from './question-evidence/question-evidence.module.js';
import { createQuestionBankModule } from './question-bank/question-bank.module.js';
import { createQuestionOrchestrationModule } from './question-orchestration/question-orchestration.module.js';
import { createRealtimeTranscriptionModule } from './realtime-transcription/realtime-transcription.module.js';
import { createTranscriptionModule } from './transcription/transcription.module.js';

@Module({})
export class AppModule implements NestModule {
  public static register(config: ApiConfig, overrides: AppRuntimeOverrides = {}): DynamicModule {
    const authModule = createAuthModule(config);
    const audioModule = createAudioModule(config, authModule);
    const transcriptionModule = createTranscriptionModule(config, authModule);
    const realtimeModule = createRealtimeTranscriptionModule(
      config,
      authModule,
      transcriptionModule,
    );
    const aiRuntimeModule = createAiRuntimeModule(config, authModule);
    const questionBankModule = createQuestionBankModule(authModule, config.appEnv);
    const questionEvidenceModule = createQuestionEvidenceModule(
      config,
      aiRuntimeModule,
      realtimeModule,
    );
    const memoryModule = createMemoryModule(
      config,
      aiRuntimeModule,
      questionEvidenceModule,
      realtimeModule,
    );
    const questionOrchestrationModule = createQuestionOrchestrationModule(
      config,
      authModule,
      aiRuntimeModule,
      memoryModule,
      questionBankModule,
      questionEvidenceModule,
      realtimeModule,
    );
    return {
      controllers: [HealthController],
      global: true,
      imports: [
        authModule,
        aiRuntimeModule,
        audioModule,
        memoryModule,
        createProjectFoundationModule(
          config,
          authModule,
          aiRuntimeModule,
          audioModule,
          realtimeModule,
          transcriptionModule,
          memoryModule,
          questionEvidenceModule,
          questionOrchestrationModule,
          overrides.consentContinuationPolicyReader,
        ),
        questionBankModule,
        transcriptionModule,
        questionEvidenceModule,
        questionOrchestrationModule,
        realtimeModule,
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

export interface AppRuntimeOverrides {
  consentContinuationPolicyReader?: ConsentContinuationPolicyReader;
}
