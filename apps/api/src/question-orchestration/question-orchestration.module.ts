import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import {
  LocalTestQuestionDirector,
  QuestionDirector,
  UnavailableQuestionDirector,
} from './question-director.js';
import { QuestionController } from './question.controller.js';
import { QuestionOrchestrationService } from './question-orchestration.service.js';
import { QuestionRequestActorService } from './question-request-actor.service.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class QuestionOrchestrationModule {}

export function createQuestionOrchestrationModule(
  config: ApiConfig,
  authModule: DynamicModule,
  aiRuntimeModule: DynamicModule,
  memoryModule: DynamicModule,
  questionBankModule: DynamicModule,
  questionEvidenceModule: DynamicModule,
  realtimeModule: DynamicModule,
): DynamicModule {
  const localOrTest = ['local', 'test'].includes(config.appEnv);
  return {
    controllers: [QuestionController],
    imports: [
      authModule,
      aiRuntimeModule,
      memoryModule,
      questionBankModule,
      questionEvidenceModule,
      realtimeModule,
    ],
    module: QuestionOrchestrationModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      localOrTest ? LocalTestQuestionDirector : UnavailableQuestionDirector,
      {
        provide: QuestionDirector,
        useExisting: localOrTest ? LocalTestQuestionDirector : UnavailableQuestionDirector,
      },
      QuestionOrchestrationService,
      QuestionRequestActorService,
    ],
  };
}
