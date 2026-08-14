import type { ApiConfig } from '@elder-interview/config';
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { CapturePcmEvidenceService } from './capture-pcm-evidence.service.js';
import { DeterministicStreamingAsrFake, StreamingAsrAdapter } from './streaming-asr.js';
import { StreamingAsrMetrics } from './streaming-asr.metrics.js';
import { TencentRealtimeAsrV2Adapter } from './tencent-realtime-asr-v2.adapter.js';
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
  const implementation =
    config.asr.provider === 'deterministic_fixture'
      ? DeterministicStreamingAsrFake
      : TencentRealtimeAsrV2Adapter;
  return {
    exports: [RealtimeRuntimeService, StreamingAsrAdapter],
    imports: [authModule, transcriptionModule],
    module: RealtimeTranscriptionModule,
    providers: [
      { provide: API_CONFIG, useValue: config },
      CapturePcmEvidenceService,
      RealtimeAccessService,
      RealtimeRuntimeService,
      StreamingAsrMetrics,
      implementation,
      { provide: StreamingAsrAdapter, useExisting: implementation },
      RealtimeTranscriptionGateway,
    ],
  };
}
