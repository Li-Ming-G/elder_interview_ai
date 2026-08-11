import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';

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
import {
  QuestionPresentationService,
  SuggestionPresentationNotifier,
} from './question-presentation.service.js';
import { RealtimeSuggestionNotifier } from './realtime-suggestion.notifier.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class QuestionEvidenceModule {}

export function createQuestionEvidenceModule(
  config: ApiConfig,
  aiRuntimeModule: DynamicModule,
  realtimeModule: DynamicModule,
): DynamicModule {
  const localOrTest = ['local', 'test'].includes(config.appEnv);
  return {
    exports: [
      ActualAskedReader,
      QuestionEvidenceService,
      QuestionEvidenceWriter,
      QuestionPresentationService,
      QuestionSimilarityMatcher,
    ],
    imports: [aiRuntimeModule, realtimeModule],
    module: QuestionEvidenceModule,
    providers: [
      ActualAskedReader,
      QuestionEvidenceService,
      { provide: API_CONFIG, useValue: config },
      RealtimeSuggestionNotifier,
      { provide: SuggestionPresentationNotifier, useExisting: RealtimeSuggestionNotifier },
      QuestionPresentationService,
      { provide: QuestionEvidenceWriter, useExisting: QuestionPresentationService },
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
