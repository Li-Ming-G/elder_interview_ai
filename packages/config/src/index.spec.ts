import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadApiConfig } from './index.js';

describe('loadApiConfig', () => {
  it('loads a complete API configuration', () => {
    const config = loadApiConfig({
      APP_ENV: 'test',
      AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
      AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
      DATABASE_URL: 'postgresql://app:test@127.0.0.1:5433/app_test',
    });

    expect(config).toMatchObject({
      apiHost: '127.0.0.1',
      apiPort: 3000,
      appEnv: 'test',
      audioChunkMaxBytes: 25 * 1024 * 1024,
      audioStorageRoot: '.local/audio-storage',
      logLevel: 'info',
    });
  });

  it('reports only invalid key names and never the supplied value', () => {
    const sensitiveValue = 'do-not-echo-this-value';

    expect(() =>
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        DATABASE_URL: sensitiveValue,
      }),
    ).toThrow(ConfigValidationError);

    try {
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        DATABASE_URL: sensitiveValue,
      });
    } catch (error: unknown) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain(sensitiveValue);
    }
  });

  it('fails closed for production without the single approved provider and backend secrets', () => {
    const environment = {
      AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
      APP_ENV: 'production',
      AUTH_ALLOWED_ORIGINS: 'https://fictional.example.test',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
      DATABASE_URL: 'postgresql://app:test@127.0.0.1:5433/app_test',
    };
    expect(() => loadApiConfig(environment)).toThrow('ASR_PROVIDER');
    expect(() =>
      loadApiConfig({ ...environment, ASR_PROVIDER: 'tencent_realtime_asr_v2' }),
    ).toThrow('TENCENT_ASR_APP_ID');
  });

  it('loads only the frozen Tencent profile and never echoes credential values on validation errors', () => {
    const secret = 'fictional-sensitive-secret-key';
    const environment = {
      AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
      APP_ENV: 'production',
      ASR_PROVIDER: 'tencent_realtime_asr_v2',
      AUTH_ALLOWED_ORIGINS: 'https://fictional.example.test',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
      DATABASE_URL: 'postgresql://app:test@127.0.0.1:5433/app_test',
      TENCENT_ASR_APP_ID: '1250000000',
      TENCENT_ASR_SECRET_ID: 'fictional-secret-id',
      TENCENT_ASR_SECRET_KEY: secret,
    };
    const loaded = loadApiConfig(environment);
    expect(loaded.asr).toMatchObject({
      dailyBilledSeconds: 7_200,
      dailyBudgetCny: 5,
      diarizationRequired: true,
      drainTimeoutMs: 10_000,
      enableSpeakerContext: 0,
      engineModelType: '16k_zh_en_speaker_2.0',
      maxConcurrency: 2,
      optionalTrainingOptimization: false,
      provider: 'tencent_realtime_asr_v2',
      reconnectMaxAttempts: 2,
      region: 'cn_mainland',
    });
    expect(JSON.stringify(loaded.asr)).toContain(secret);
    try {
      loadApiConfig({
        ...environment,
        ASR_DAILY_BUDGET_CNY: '6',
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('rejects a non-numeric Tencent AppID without exposing credential values', () => {
    const invalidAppId = 'not-an-app-id';
    expect(() =>
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        APP_ENV: 'production',
        ASR_PROVIDER: 'tencent_realtime_asr_v2',
        AUTH_ALLOWED_ORIGINS: 'https://fictional.example.test',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        DATABASE_URL: 'postgresql://app:test@127.0.0.1:5433/app_test',
        TENCENT_ASR_APP_ID: invalidAppId,
        TENCENT_ASR_SECRET_ID: 'fictional-secret-id',
        TENCENT_ASR_SECRET_KEY: 'fictional-secret-key',
      }),
    ).toThrow('TENCENT_ASR_APP_ID');
    try {
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        APP_ENV: 'production',
        ASR_PROVIDER: 'tencent_realtime_asr_v2',
        AUTH_ALLOWED_ORIGINS: 'https://fictional.example.test',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        DATABASE_URL: 'postgresql://app:test@127.0.0.1:5433/app_test',
        TENCENT_ASR_APP_ID: invalidAppId,
        TENCENT_ASR_SECRET_ID: 'fictional-secret-id',
        TENCENT_ASR_SECRET_KEY: 'fictional-secret-key',
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(invalidAppId);
    }
  });
});
