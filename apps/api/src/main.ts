import 'reflect-metadata';

import { ConfigValidationError } from '@elder-interview/config';

import { createApplication } from './create-application.js';
import { SyntheticConsentContinuationPolicyReader } from './project-foundation/consent-continuation.policy.js';
import { loadApiConfigForStart } from './start-mode.js';

async function main(): Promise<void> {
  const config = loadApiConfigForStart(process.env);
  const consentContinuationPolicyReader =
    config.appEnv === 'test' &&
    process.env.TEST_CONSENT_CONTINUATION_POLICY === 'synthetic-fictional-v1'
      ? new SyntheticConsentContinuationPolicyReader()
      : undefined;
  const application = await createApplication(config, {
    ...(consentContinuationPolicyReader === undefined ? {} : { consentContinuationPolicyReader }),
  });
  await application.listen(config.apiPort, config.apiHost);
}

void main().catch((error: unknown) => {
  const invalidKeys = error instanceof ConfigValidationError ? error.invalidKeys : undefined;
  process.stderr.write(
    `${JSON.stringify({
      error_code: error instanceof ConfigValidationError ? 'CONFIG_INVALID' : 'STARTUP_FAILED',
      event: 'application.start_failed',
      invalid_keys: invalidKeys,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exitCode = 1;
});
