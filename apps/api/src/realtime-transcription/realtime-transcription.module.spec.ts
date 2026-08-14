import type { ApiConfig } from '@elder-interview/config';
import type { DynamicModule } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { createRealtimeTranscriptionModule } from './realtime-transcription.module.js';
import { DeterministicStreamingAsrFake } from './streaming-asr.js';
import { TencentRealtimeAsrV2Adapter } from './tencent-realtime-asr-v2.adapter.js';
import { API_CONFIG } from '../api-config.js';

describe('realtime composition root', () => {
  it('registers deterministic fake only in local/test', () => {
    expect(providerClasses(moduleFor('test'))).toContain(DeterministicStreamingAsrFake);
    expect(providerClasses(moduleFor('test'))).not.toContain(TencentRealtimeAsrV2Adapter);
    expect(providerClasses(moduleFor('production'))).toContain(TencentRealtimeAsrV2Adapter);
    expect(providerClasses(moduleFor('production'))).not.toContain(DeterministicStreamingAsrFake);
  });

  it('provides the API config in the realtime module scope for the real adapter', () => {
    const module = moduleFor('production');
    expect(
      module.providers?.some(
        (provider) =>
          typeof provider === 'object' &&
          'provide' in provider &&
          provider.provide === API_CONFIG &&
          'useValue' in provider &&
          typeof provider.useValue === 'object',
      ),
    ).toBe(true);
  });
});

function moduleFor(appEnv: ApiConfig['appEnv']): DynamicModule {
  const config = {
    appEnv,
    asr:
      appEnv === 'production'
        ? {
            appId: 'fictional-app',
            connectTimeoutMs: 5_000,
            dailyBilledSeconds: 7_200,
            dailyBudgetCny: 5,
            diarizationRequired: true,
            drainTimeoutMs: 10_000,
            enableSpeakerContext: 0,
            engineModelType: '16k_zh_en_speaker_2.0',
            maxConcurrency: 2,
            optionalTrainingOptimization: false,
            provider: 'tencent_realtime_asr_v2',
            readyTimeoutMs: 5_000,
            reconnectMaxAttempts: 2,
            region: 'cn_mainland',
            secretId: 'fictional-secret-id',
            secretKey: 'fictional-secret-key',
          }
        : { provider: 'deterministic_fixture' },
  } as ApiConfig;
  const dependency = {
    module: class TestDependency {
      public readonly marker = true;
    },
  };
  return createRealtimeTranscriptionModule(config, dependency, dependency);
}

function providerClasses(module: DynamicModule): unknown[] {
  return (module.providers ?? []).filter((provider) => typeof provider === 'function');
}
