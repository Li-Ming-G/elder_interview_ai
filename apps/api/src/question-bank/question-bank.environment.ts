import type { AppEnvironment } from '@elder-interview/config';

import type { QuestionBankEnvironment } from './question-bank.types.js';

export const QUESTION_BANK_DEPLOYMENT_ENVIRONMENT = Symbol('QUESTION_BANK_DEPLOYMENT_ENVIRONMENT');

export function questionBankEnvironmentFromAppEnv(
  appEnvironment: AppEnvironment,
): QuestionBankEnvironment {
  return appEnvironment === 'staging' ? 'formal_internal' : appEnvironment;
}
