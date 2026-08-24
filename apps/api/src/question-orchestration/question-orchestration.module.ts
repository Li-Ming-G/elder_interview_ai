import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import {
  OPENROUTER_FETCH,
  OpenRouterQuestionDirector,
  type OpenRouterFetch,
} from './openrouter-question-director.js';
import { QuestionDirectorContract } from './question-director-contract.js';
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
  evidenceDrilldownModule: DynamicModule,
): DynamicModule {
  const localOrTest = ['local', 'test'].includes(config.appEnv);
  const director =
    config.checkpointA.mode === 'checkpoint_a'
      ? OpenRouterQuestionDirector
      : localOrTest
        ? LocalTestQuestionDirector
        : UnavailableQuestionDirector;
  return {
    controllers: [QuestionController],
    exports: [QuestionOrchestrationService],
    imports: [
      authModule,
      aiRuntimeModule,
      evidenceDrilldownModule,
      memoryModule,
      questionBankModule,
      questionEvidenceModule,
      realtimeModule,
    ],
    module: QuestionOrchestrationModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      { provide: OPENROUTER_FETCH, useValue: globalOpenRouterFetch },
      director,
      {
        provide: QuestionDirector,
        useExisting: director,
      },
      QuestionOrchestrationService,
      QuestionDirectorContract,
      QuestionRequestActorService,
    ],
  };
}

const globalOpenRouterFetch: OpenRouterFetch = (input, init) => globalThis.fetch(input, init);
