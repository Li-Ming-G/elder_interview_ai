import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaProjectAccessReader } from '../project-foundation/prisma-project-access.reader.js';
import {
  ProjectAccessReader,
  ProjectAccessService,
  ResourceAccessAuthorizer,
} from '../project-foundation/project-access.service.js';
import { SpeakerMappingService } from './speaker-mapping.service.js';
import { TranscriptIngestionService } from './transcript-ingestion.service.js';
import { TranscriptQueryService } from './transcript-query.service.js';

@Module({})
// Nest requires a module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class TranscriptionModule {}

export function createTranscriptionModule(
  config: ApiConfig,
  authModule: DynamicModule,
): DynamicModule {
  return {
    exports: [SpeakerMappingService, TranscriptIngestionService, TranscriptQueryService],
    imports: [authModule],
    module: TranscriptionModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      PrismaProjectAccessReader,
      { provide: ProjectAccessReader, useExisting: PrismaProjectAccessReader },
      { provide: ResourceAccessAuthorizer, useExisting: ResourceAuthorizationService },
      ProjectAccessService,
      SpeakerMappingService,
      TranscriptIngestionService,
      TranscriptQueryService,
    ],
  };
}
