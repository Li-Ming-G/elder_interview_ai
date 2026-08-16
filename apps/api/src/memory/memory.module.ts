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

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class MemoryModule {}

export function createMemoryModule(
  aiRuntimeModule: DynamicModule,
  questionEvidenceModule: DynamicModule,
): DynamicModule {
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
    ],
    imports: [aiRuntimeModule, questionEvidenceModule],
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
    ],
  };
}
