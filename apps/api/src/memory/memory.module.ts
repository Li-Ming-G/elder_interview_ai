import { type DynamicModule, Module } from '@nestjs/common';

import { InterviewContextService } from './interview-context.service.js';
import { CurrentMemoryReader, MemoryService } from './memory.service.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class MemoryModule {}

export function createMemoryModule(
  aiRuntimeModule: DynamicModule,
  questionEvidenceModule: DynamicModule,
): DynamicModule {
  return {
    exports: [CurrentMemoryReader, InterviewContextService, MemoryService],
    imports: [aiRuntimeModule, questionEvidenceModule],
    module: MemoryModule,
    providers: [CurrentMemoryReader, InterviewContextService, MemoryService],
  };
}
