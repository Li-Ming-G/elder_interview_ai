import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { createAiRuntimeModule } from '../ai-runtime/ai-runtime.module.js';
import { API_CONFIG } from '../api-config.js';
import {
  EvidenceDrilldownReader,
  PrismaEvidenceDrilldownReader,
} from './evidence-drilldown.reader.js';
import { EvidenceDrilldownService } from './evidence-drilldown.service.js';

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class EvidenceDrilldownModule {}

export function createEvidenceDrilldownModule(
  config: ApiConfig,
  authModule: DynamicModule,
  aiRuntimeModule = createAiRuntimeModule(config, authModule),
): DynamicModule {
  return {
    exports: [EvidenceDrilldownService],
    imports: [authModule, aiRuntimeModule],
    module: EvidenceDrilldownModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      PrismaEvidenceDrilldownReader,
      { provide: EvidenceDrilldownReader, useExisting: PrismaEvidenceDrilldownReader },
      EvidenceDrilldownService,
    ],
  };
}
