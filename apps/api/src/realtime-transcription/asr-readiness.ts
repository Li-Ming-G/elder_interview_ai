import type { ApiConfig, AsrConfig } from '@elder-interview/config';

import type { TranscriptSourceValue } from '../transcription/transcription.types.js';

export const REAL_ASR_SECRET_REFS = [
  'TENCENT_ASR_APP_ID',
  'TENCENT_ASR_SECRET_ID',
  'TENCENT_ASR_SECRET_KEY',
] as const;

export type AsrReadinessConfigurationStatus = 'configuration_ready' | 'rejected';
export type AsrLiveEvidenceStatus = 'not_proven' | 'proven' | 'rejected';

export interface AsrReadinessReport {
  readonly appEnv: ApiConfig['appEnv'];
  readonly configurationStatus: AsrReadinessConfigurationStatus;
  readonly liveEvidenceStatus: 'not_proven';
  readonly mode: 'deterministic_fixture' | 'real_tencent';
  readonly provider: AsrConfig['provider'];
  readonly reason:
    | 'DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE'
    | 'REAL_ASR_REQUIRES_LOCAL_APP_ENV'
    | 'REAL_TENCENT_ASR_CONFIGURED';
  readonly safeSecretRefs: readonly string[];
}

export interface AsrLiveEvidence {
  readonly audioFramesForwarded: number;
  readonly finalizedSources: readonly TranscriptSourceValue[];
  readonly provider: AsrConfig['provider'];
}

export interface AsrLiveEvidenceReport {
  readonly status: AsrLiveEvidenceStatus;
  readonly reason:
    | 'DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE'
    | 'NO_AUDIO_FRAMES_FORWARDED'
    | 'NO_REALTIME_FINALIZED_TRANSCRIPT'
    | 'REALTIME_FINALIZED_TRANSCRIPT_OBSERVED';
}

export function inspectAsrReadiness(config: Pick<ApiConfig, 'appEnv' | 'asr'>): AsrReadinessReport {
  if (config.asr.provider === 'deterministic_fixture') {
    return {
      appEnv: config.appEnv,
      configurationStatus: 'rejected',
      liveEvidenceStatus: 'not_proven',
      mode: 'deterministic_fixture',
      provider: config.asr.provider,
      reason: 'DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE',
      safeSecretRefs: [],
    };
  }

  if (config.appEnv !== 'local') {
    return {
      appEnv: config.appEnv,
      configurationStatus: 'rejected',
      liveEvidenceStatus: 'not_proven',
      mode: 'real_tencent',
      provider: config.asr.provider,
      reason: 'REAL_ASR_REQUIRES_LOCAL_APP_ENV',
      safeSecretRefs: REAL_ASR_SECRET_REFS,
    };
  }

  return {
    appEnv: config.appEnv,
    configurationStatus: 'configuration_ready',
    liveEvidenceStatus: 'not_proven',
    mode: 'real_tencent',
    provider: config.asr.provider,
    reason: 'REAL_TENCENT_ASR_CONFIGURED',
    safeSecretRefs: REAL_ASR_SECRET_REFS,
  };
}

export function evaluateAsrLiveEvidence(evidence: AsrLiveEvidence): AsrLiveEvidenceReport {
  if (evidence.provider === 'deterministic_fixture') {
    return {
      reason: 'DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE',
      status: 'rejected',
    };
  }
  if (evidence.audioFramesForwarded < 1) {
    return { reason: 'NO_AUDIO_FRAMES_FORWARDED', status: 'not_proven' };
  }
  if (!evidence.finalizedSources.includes('realtime')) {
    return { reason: 'NO_REALTIME_FINALIZED_TRANSCRIPT', status: 'not_proven' };
  }
  return {
    reason: 'REALTIME_FINALIZED_TRANSCRIPT_OBSERVED',
    status: 'proven',
  };
}
