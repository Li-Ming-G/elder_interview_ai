import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import {
  CONFIGURED_DIRECTOR_FETCH,
  ConfiguredQuestionDirector,
  type ConfiguredDirectorFetch,
} from './configured-question-director.js';
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
      ? ConfiguredQuestionDirector
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
      { provide: CONFIGURED_DIRECTOR_FETCH, useValue: globalConfiguredDirectorFetch },
      director,
      {
        provide: QuestionDirector,
        useExisting: director,
      },
      QuestionOrchestrationService,
      {
        provide: QuestionDirectorContract,
        useFactory: () =>
          new QuestionDirectorContract({
            modelConfig: config.checkpointA,
            promptBundle: config.checkpointA.mode === 'checkpoint_a' ? 'checkpoint_a' : 'v1',
          }),
      },
      QuestionRequestActorService,
    ],
  };
}

const globalConfiguredDirectorFetch: ConfiguredDirectorFetch = (input, init) =>
  globalThis.fetch(input, init);
