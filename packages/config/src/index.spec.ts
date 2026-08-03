import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadApiConfig } from './index.js';

describe('loadApiConfig', () => {
  it('loads a complete API configuration', () => {
    const config = loadApiConfig({
      APP_ENV: 'test',
      AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
      DATABASE_URL: 'postgresql://app:test@127.0.0.1:5433/app_test',
    });

    expect(config).toMatchObject({
      apiHost: '127.0.0.1',
      apiPort: 3000,
      appEnv: 'test',
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
        DATABASE_URL: sensitiveValue,
      }),
    ).toThrow(ConfigValidationError);

    try {
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        DATABASE_URL: sensitiveValue,
      });
    } catch (error: unknown) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain(sensitiveValue);
    }
  });
});
