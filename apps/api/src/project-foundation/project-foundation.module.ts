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
import { ProjectSessionListService } from './project-session-list.service.js';
import { SessionCaptureService } from './session-capture.service.js';
import { SessionFinalizationService } from './session-finalization.service.js';
import { SessionSnapshotService } from './session-snapshot.service.js';
import { SpeakerCalibrationService } from './speaker-calibration.service.js';
import { SpeakerCorrectionService } from './speaker-correction.service.js';
import {
  ConsentContinuationPolicyReader,
  UnavailableConsentContinuationPolicyReader,
} from './consent-continuation.policy.js';
import { RepeatInterviewDecisionService } from './repeat-interview-decision.service.js';

@Module({})
// Nest requires a module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ProjectFoundationModule {}

export function createProjectFoundationModule(
  config: ApiConfig,
  authModule: DynamicModule,
  aiRuntimeModule: DynamicModule,
  audioModule: DynamicModule,
  realtimeModule: DynamicModule,
  transcriptionModule: DynamicModule,
  consentContinuationPolicyReader?: ConsentContinuationPolicyReader,
): DynamicModule {
  return {
    controllers: [ProjectFoundationController],
    imports: [authModule, aiRuntimeModule, audioModule, realtimeModule, transcriptionModule],
    module: ProjectFoundationModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      PrismaProjectAccessReader,
      { provide: ProjectAccessReader, useExisting: PrismaProjectAccessReader },
      { provide: ResourceAccessAuthorizer, useExisting: ResourceAuthorizationService },
      ProjectAccessService,
      UnavailableConsentContinuationPolicyReader,
      consentContinuationPolicyReader === undefined
        ? {
            provide: ConsentContinuationPolicyReader,
            useExisting: UnavailableConsentContinuationPolicyReader,
          }
        : { provide: ConsentContinuationPolicyReader, useValue: consentContinuationPolicyReader },
      RepeatInterviewDecisionService,
      ProjectFoundationService,
      ProjectRequestActorService,
      ProjectSessionListService,
      SessionCaptureService,
      SessionFinalizationService,
      SessionSnapshotService,
      SpeakerCalibrationService,
      SpeakerCorrectionService,
    ],
  };
}
