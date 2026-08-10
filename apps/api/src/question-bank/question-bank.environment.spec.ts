import { describe, expect, it } from 'vitest';

import { questionBankEnvironmentFromAppEnv } from './question-bank.environment.js';

describe('trusted question-bank deployment environment', () => {
  it.each([
    ['local', 'local'],
    ['test', 'test'],
    ['staging', 'formal_internal'],
    ['production', 'production'],
  ] as const)('maps validated APP_ENV=%s to %s', (appEnvironment, expected) => {
    expect(questionBankEnvironmentFromAppEnv(appEnvironment)).toBe(expected);
  });
});
