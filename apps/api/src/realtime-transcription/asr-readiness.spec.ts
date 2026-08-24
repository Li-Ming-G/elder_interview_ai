import { describe, expect, it } from 'vitest';
import type { AsrConfig } from '@elder-interview/config';

import { evaluateAsrLiveEvidence, inspectAsrReadiness } from './asr-readiness.js';

describe('Checkpoint A ASR readiness', () => {
  it('rejects deterministic fixture configuration as live checkpoint evidence', () => {
    const report = inspectAsrReadiness({
      appEnv: 'local',
      asr: { provider: 'deterministic_fixture' },
    });

    expect(report).toEqual({
      appEnv: 'local',
      configurationStatus: 'rejected',
      liveEvidenceStatus: 'not_proven',
      mode: 'deterministic_fixture',
      provider: 'deterministic_fixture',
      reason: 'DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE',
      safeSecretRefs: [],
    });
  });

  it('accepts only local configuration for the existing real Tencent binding', () => {
    const report = inspectAsrReadiness({ appEnv: 'local', asr: tencentConfig() });

    expect(report).toMatchObject({
      appEnv: 'local',
      configurationStatus: 'configuration_ready',
      liveEvidenceStatus: 'not_proven',
      mode: 'real_tencent',
      provider: 'tencent_realtime_asr_v2',
      reason: 'REAL_TENCENT_ASR_CONFIGURED',
      safeSecretRefs: ['TENCENT_ASR_APP_ID', 'TENCENT_ASR_SECRET_ID', 'TENCENT_ASR_SECRET_KEY'],
    });
  });

  it('keeps non-local real ASR fail-closed for the local checkpoint', () => {
    expect(inspectAsrReadiness({ appEnv: 'production', asr: tencentConfig() })).toMatchObject({
      configurationStatus: 'rejected',
      reason: 'REAL_ASR_REQUIRES_LOCAL_APP_ENV',
    });
  });

  it('requires forwarded audio and a realtime finalized source', () => {
    expect(
      evaluateAsrLiveEvidence({
        audioFramesForwarded: 0,
        finalizedSources: [],
        provider: 'tencent_realtime_asr_v2',
      }),
    ).toEqual({ reason: 'NO_AUDIO_FRAMES_FORWARDED', status: 'not_proven' });
    expect(
      evaluateAsrLiveEvidence({
        audioFramesForwarded: 1,
        finalizedSources: ['fixture'],
        provider: 'tencent_realtime_asr_v2',
      }),
    ).toEqual({ reason: 'NO_REALTIME_FINALIZED_TRANSCRIPT', status: 'not_proven' });
    expect(
      evaluateAsrLiveEvidence({
        audioFramesForwarded: 1,
        finalizedSources: ['realtime'],
        provider: 'tencent_realtime_asr_v2',
      }),
    ).toEqual({ reason: 'REALTIME_FINALIZED_TRANSCRIPT_OBSERVED', status: 'proven' });
  });

  it('rejects fixture events even when audio frames were forwarded', () => {
    expect(
      evaluateAsrLiveEvidence({
        audioFramesForwarded: 1,
        finalizedSources: ['fixture'],
        provider: 'deterministic_fixture',
      }),
    ).toEqual({
      reason: 'DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE',
      status: 'rejected',
    });
  });
});

function tencentConfig(): Extract<AsrConfig, { provider: 'tencent_realtime_asr_v2' }> {
  return {
    appId: '1250000000',
    connectTimeoutMs: 5_000,
    dailyBilledSeconds: 7_200,
    dailyBudgetCny: 5,
    diarizationRequired: true,
    drainTimeoutMs: 10_000,
    enableSpeakerContext: 0,
    engineModelType: '16k_zh_en_speaker_2.0' as const,
    maxConcurrency: 2,
    optionalTrainingOptimization: false,
    provider: 'tencent_realtime_asr_v2' as const,
    readyTimeoutMs: 5_000,
    reconnectMaxAttempts: 2,
    region: 'cn_mainland' as const,
    secretId: 'fictional-secret-id',
    secretKey: 'fictional-secret-key',
  };
}
