import { type DynamicModule, Module } from '@nestjs/common';

import {
  ActualAskedReader,
  QuestionEvidenceService,
  QuestionEvidenceWriter,
} from './question-evidence.service.js';
import {
  LocalTestQuestionSimilarityMatcher,
  QuestionSimilarityMatcher,
  UnavailableQuestionSimilarityMatcher,
} from './question-similarity.matcher.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class QuestionEvidenceModule {}

export function createQuestionEvidenceModule(
  aiRuntimeModule: DynamicModule,
  localOrTest = false,
): DynamicModule {
  return {
    exports: [
      ActualAskedReader,
      QuestionEvidenceService,
      QuestionEvidenceWriter,
      QuestionSimilarityMatcher,
    ],
    imports: [aiRuntimeModule],
    module: QuestionEvidenceModule,
    providers: [
      ActualAskedReader,
      QuestionEvidenceService,
      { provide: QuestionEvidenceWriter, useExisting: QuestionEvidenceService },
      localOrTest ? LocalTestQuestionSimilarityMatcher : UnavailableQuestionSimilarityMatcher,
      {
        provide: QuestionSimilarityMatcher,
        useExisting: localOrTest
          ? LocalTestQuestionSimilarityMatcher
          : UnavailableQuestionSimilarityMatcher,
      },
    ],
  };
}
