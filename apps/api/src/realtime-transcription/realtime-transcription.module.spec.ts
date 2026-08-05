import type { ApiConfig } from '@elder-interview/config';
import type { DynamicModule } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { createRealtimeTranscriptionModule } from './realtime-transcription.module.js';
import { DeterministicStreamingAsrFake, UnavailableStreamingAsrAdapter } from './streaming-asr.js';

describe('realtime composition root', () => {
  it('registers deterministic fake only in local/test', () => {
    expect(providerClasses(moduleFor('test'))).toContain(DeterministicStreamingAsrFake);
    expect(providerClasses(moduleFor('test'))).not.toContain(UnavailableStreamingAsrAdapter);
    expect(providerClasses(moduleFor('production'))).toContain(UnavailableStreamingAsrAdapter);
    expect(providerClasses(moduleFor('production'))).not.toContain(DeterministicStreamingAsrFake);
  });
});

function moduleFor(appEnv: ApiConfig['appEnv']): DynamicModule {
  const config = {
    appEnv,
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
