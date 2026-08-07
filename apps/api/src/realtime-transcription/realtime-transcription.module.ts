import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import {
  DeterministicStreamingAsrFake,
  StreamingAsrAdapter,
  UnavailableStreamingAsrAdapter,
} from './streaming-asr.js';
import { RealtimeAccessService } from './realtime-access.service.js';
import { RealtimeRuntimeService } from './realtime-runtime.service.js';
import { RealtimeTranscriptionGateway } from './realtime.gateway.js';

@Module({})
// Nest requires a module token for the dynamic module returned below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RealtimeTranscriptionModule {}

export function createRealtimeTranscriptionModule(
  config: ApiConfig,
  authModule: DynamicModule,
  transcriptionModule: DynamicModule,
): DynamicModule {
  const implementation = ['local', 'test'].includes(config.appEnv)
    ? DeterministicStreamingAsrFake
    : UnavailableStreamingAsrAdapter;
  return {
    exports: [RealtimeRuntimeService, StreamingAsrAdapter],
    imports: [authModule, transcriptionModule],
    module: RealtimeTranscriptionModule,
    providers: [
      RealtimeAccessService,
      RealtimeRuntimeService,
      implementation,
      { provide: StreamingAsrAdapter, useExisting: implementation },
      RealtimeTranscriptionGateway,
    ],
  };
}
