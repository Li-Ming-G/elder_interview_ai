import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaProjectAccessReader } from './prisma-project-access.reader.js';
import {
  ProjectAccessReader,
  ProjectAccessService,
  ResourceAccessAuthorizer,
} from './project-access.service.js';
import { ProjectFoundationController } from './project-foundation.controller.js';
import { ProjectFoundationService } from './project-foundation.service.js';
import { ProjectRequestActorService } from './project-request-actor.service.js';

@Module({})
// Nest requires a module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ProjectFoundationModule {}

export function createProjectFoundationModule(
  config: ApiConfig,
  authModule: DynamicModule,
  audioModule: DynamicModule,
): DynamicModule {
  return {
    controllers: [ProjectFoundationController],
    imports: [authModule, audioModule],
    module: ProjectFoundationModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      PrismaProjectAccessReader,
      { provide: ProjectAccessReader, useExisting: PrismaProjectAccessReader },
      { provide: ResourceAccessAuthorizer, useExisting: ResourceAuthorizationService },
      ProjectAccessService,
      ProjectFoundationService,
      ProjectRequestActorService,
    ],
  };
}
