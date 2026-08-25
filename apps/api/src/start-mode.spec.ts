import { describe, expect, it } from 'vitest';

import { ConfigValidationError } from '@elder-interview/config';

import {
  CHECKPOINT_A_START_ARGUMENT,
  loadApiConfigForStart,
  resolveApiStartMode,
} from './start-mode.js';

const baseEnvironment: NodeJS.ProcessEnv = {
  APP_ENV: 'local',
  AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
  AUTH_LOGIN_THROTTLE_PEPPER: 'synthetic-start-mode-login-pepper',
  AI_RETENTION_CLEANUP_PEPPER: 'synthetic-start-mode-retention-pepper',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic',
};

describe('API start mode', () => {
  it('keeps the generic entry point deterministic', () => {
    expect(resolveApiStartMode([])).toBe('generic');
    expect(
      loadApiConfigForStart(
        {
          ...baseEnvironment,
          OPENROUTER_API_KEY: 'ambient-fictional-key',
        },
        [],
      ),
    ).toMatchObject({ checkpointA: { mode: 'generic', networkEnabled: false } });
  });

  it('selects Checkpoint A only for its explicit argument and requires real ASR', () => {
    expect(resolveApiStartMode([CHECKPOINT_A_START_ARGUMENT])).toBe('checkpoint_a');
    expect(() =>
      loadApiConfigForStart(
        { ...baseEnvironment, OPENROUTER_API_KEY: 'fictional-openrouter-key' },
        [CHECKPOINT_A_START_ARGUMENT],
      ),
    ).toThrow('ASR_PROVIDER');

    expect(
      loadApiConfigForStart(
        {
          ...baseEnvironment,
          ASR_PROVIDER: 'tencent_realtime_asr_v2',
          OPENROUTER_API_KEY: 'fictional-openrouter-key',
          TENCENT_ASR_APP_ID: '1250000000',
          TENCENT_ASR_SECRET_ID: 'fictional-tencent-id',
          TENCENT_ASR_SECRET_KEY: 'fictional-tencent-key',
        },
        [CHECKPOINT_A_START_ARGUMENT],
      ),
    ).toMatchObject({
      asr: { provider: 'tencent_realtime_asr_v2' },
      checkpointA: { mode: 'checkpoint_a', model: 'stealth/ox-alpha' },
    });
  });

  it('rejects unknown startup arguments without echoing values', () => {
    expect(() => resolveApiStartMode(['--unknown', 'fictional-secret'])).toThrow(
      ConfigValidationError,
    );
  });
});
