import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { InterviewContextService } from './interview-context.service.js';
import { CurrentMemoryReader, MemoryService } from './memory.service.js';
import {
  MemoryContextAssemblyService,
  MemoryRetrievalService,
} from './memory-context-assembly.service.js';
import { MemoryAwareNextQuestionPipeline } from './memory-next-question.pipeline.js';
import {
  WorkingMemoryMaintainerService,
  WorkingMemoryOperationApplier,
} from './working-memory-maintainer.service.js';
import {
  LocalTestMemoryMaintainerProvider,
  MemoryMaintainerProvider,
  UnavailableMemoryMaintainerProvider,
} from './memory-maintainer.provider.js';
import {
  MEMORY_MAINTAINER_RUNTIME_CONFIG,
  MemoryMaintainerClock,
  MemoryMaintainerFailpoint,
  MemoryMaintainerRuntime,
  NoopMemoryMaintainerFailpoint,
  SystemMemoryMaintainerClock,
  type MemoryMaintainerRuntimeConfig,
} from './memory-maintainer.runtime.js';
import { MemoryMaintainerV12Validator } from './memory-maintainer.validator.js';
import { MemoryWorkingSnapshotReader } from './memory-working-snapshot.reader.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class MemoryModule {}

export function createMemoryModule(
  config: ApiConfig,
  aiRuntimeModule: DynamicModule,
  questionEvidenceModule: DynamicModule,
  realtimeModule: DynamicModule,
): DynamicModule {
  const localOrTest = ['local', 'test'].includes(config.appEnv);
  const p1Enabled = config.appEnv === 'local';
  const runtimeConfig: MemoryMaintainerRuntimeConfig = {
    batchThreshold: 6,
    contractMerged: true,
    contractReviewStatus: 'pass',
    enabled: p1Enabled,
    legacyMemoryExtractEnabled: !p1Enabled,
    loadedContractVersion: 'memory-maintainer-v1.2',
    minimumUsefulCharacters: 2,
    overlapSegments: 2,
    providerDeadlineMs: 8_000,
    postSessionMemoryLane: p1Enabled ? 'delegate_p1_final_flush' : 'legacy_memory_extract',
    scanIntervalMs: 5_000,
    staleJobMs: 30_000,
    timeThresholdMs: 30_000,
    unconsumedFinalAuthority: p1Enabled ? 'p1' : 'legacy_memory_extract',
  };
  return {
    exports: [
      CurrentMemoryReader,
      InterviewContextService,
      MemoryService,
      MemoryContextAssemblyService,
      MemoryRetrievalService,
      MemoryAwareNextQuestionPipeline,
      WorkingMemoryMaintainerService,
      WorkingMemoryOperationApplier,
      MemoryMaintainerRuntime,
      MemoryWorkingSnapshotReader,
    ],
    imports: [aiRuntimeModule, questionEvidenceModule, realtimeModule],
    module: MemoryModule,
    providers: [
      CurrentMemoryReader,
      InterviewContextService,
      MemoryService,
      MemoryContextAssemblyService,
      MemoryRetrievalService,
      MemoryAwareNextQuestionPipeline,
      WorkingMemoryMaintainerService,
      WorkingMemoryOperationApplier,
      { provide: MEMORY_MAINTAINER_RUNTIME_CONFIG, useValue: runtimeConfig },
      LocalTestMemoryMaintainerProvider,
      UnavailableMemoryMaintainerProvider,
      {
        provide: MemoryMaintainerProvider,
        useExisting: localOrTest
          ? LocalTestMemoryMaintainerProvider
          : UnavailableMemoryMaintainerProvider,
      },
      SystemMemoryMaintainerClock,
      { provide: MemoryMaintainerClock, useExisting: SystemMemoryMaintainerClock },
      NoopMemoryMaintainerFailpoint,
      { provide: MemoryMaintainerFailpoint, useExisting: NoopMemoryMaintainerFailpoint },
      MemoryMaintainerV12Validator,
      MemoryMaintainerRuntime,
      MemoryWorkingSnapshotReader,
    ],
  };
}
