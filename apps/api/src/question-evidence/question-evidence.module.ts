import { type DynamicModule, Module } from '@nestjs/common';

import { ActualAskedReader, QuestionEvidenceService } from './question-evidence.service.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class QuestionEvidenceModule {}

export function createQuestionEvidenceModule(aiRuntimeModule: DynamicModule): DynamicModule {
  return {
    exports: [ActualAskedReader, QuestionEvidenceService],
    imports: [aiRuntimeModule],
    module: QuestionEvidenceModule,
    providers: [ActualAskedReader, QuestionEvidenceService],
  };
}
