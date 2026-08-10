import type { AppEnvironment } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import {
  QUESTION_BANK_DEPLOYMENT_ENVIRONMENT,
  questionBankEnvironmentFromAppEnv,
} from './question-bank.environment.js';
import {
  InternalDemoQuestionSelector,
  QuestionBankImportService,
  QuestionBankReader,
} from './question-bank.service.js';
import { QuestionJourneyService } from './question-journey.service.js';

@Module({})
// Nest requires a stable module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class QuestionBankModule {}

export function createQuestionBankModule(
  databaseModule: DynamicModule,
  appEnvironment: AppEnvironment,
): DynamicModule {
  return {
    exports: [
      InternalDemoQuestionSelector,
      QuestionBankImportService,
      QuestionBankReader,
      QuestionJourneyService,
    ],
    imports: [databaseModule],
    module: QuestionBankModule,
    providers: [
      {
        provide: QUESTION_BANK_DEPLOYMENT_ENVIRONMENT,
        useValue: questionBankEnvironmentFromAppEnv(appEnvironment),
      },
      InternalDemoQuestionSelector,
      QuestionBankImportService,
      QuestionBankReader,
      QuestionJourneyService,
    ],
  };
}
