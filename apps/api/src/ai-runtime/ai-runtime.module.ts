import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { AiJobCoordinatorService } from './ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import { AiPolicyService, LocalTestBoundaryPolicyFixtureReader } from './ai-policy.service.js';
import { AiRetentionService } from './ai-retention.service.js';
import {
  BoundaryPolicyReader,
  DeletionScopeReader,
  LocalTestDeletionScopeFixtureReader,
  UnavailableBoundaryPolicyReader,
  UnavailableDeletionScopeReader,
} from './deletion-scope.reader.js';
import {
  LocalTestStructuredAiProvider,
  StructuredAiProvider,
  UnavailableStructuredAiProvider,
} from './structured-ai.provider.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AiRuntimeModule {}

export function createAiRuntimeModule(config: ApiConfig, authModule: DynamicModule): DynamicModule {
  const localOrTest = ['local', 'test'].includes(config.appEnv);
  return {
    exports: [
      authModule,
      AiJobCoordinatorService,
      AiOutputEligibilityService,
      AiPolicyService,
      AiRetentionService,
      BoundaryPolicyReader,
      DeletionScopeReader,
      StructuredAiProvider,
    ],
    imports: [authModule],
    module: AiRuntimeModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      AiJobCoordinatorService,
      AiOutputEligibilityService,
      AiPolicyService,
      AiRetentionService,
      localOrTest ? LocalTestBoundaryPolicyFixtureReader : UnavailableBoundaryPolicyReader,
      {
        provide: BoundaryPolicyReader,
        useExisting: localOrTest
          ? LocalTestBoundaryPolicyFixtureReader
          : UnavailableBoundaryPolicyReader,
      },
      localOrTest ? LocalTestDeletionScopeFixtureReader : UnavailableDeletionScopeReader,
      {
        provide: DeletionScopeReader,
        useExisting: localOrTest
          ? LocalTestDeletionScopeFixtureReader
          : UnavailableDeletionScopeReader,
      },
      localOrTest ? LocalTestStructuredAiProvider : UnavailableStructuredAiProvider,
      {
        provide: StructuredAiProvider,
        useExisting: localOrTest ? LocalTestStructuredAiProvider : UnavailableStructuredAiProvider,
      },
    ],
  };
}
