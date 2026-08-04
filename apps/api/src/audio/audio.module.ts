import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { ProjectRequestActorService } from '../project-foundation/project-request-actor.service.js';
import { AudioController } from './audio.controller.js';
import { AudioIntegrityService } from './audio-integrity.service.js';
import { AudioService } from './audio.service.js';
import { AudioStorageProvider } from './audio-storage.provider.js';
import { LocalAudioStorageAdapter } from './local-audio-storage.adapter.js';

@Module({})
// Nest requires a module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AudioModule {}

export function createAudioModule(config: ApiConfig, authModule: DynamicModule): DynamicModule {
  return {
    controllers: [AudioController],
    exports: [AudioIntegrityService],
    imports: [authModule],
    module: AudioModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      LocalAudioStorageAdapter,
      { provide: AudioStorageProvider, useExisting: LocalAudioStorageAdapter },
      AudioIntegrityService,
      AudioService,
      ProjectRequestActorService,
    ],
  };
}
