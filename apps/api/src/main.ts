import 'reflect-metadata';

import { ConfigValidationError } from '@elder-interview/config';

import { createApplication } from './create-application.js';
import { SyntheticConsentContinuationPolicyReader } from './project-foundation/consent-continuation.policy.js';
import {
  checkpointADirectorEndpointEnvironmentVariable,
  probeConfiguredDirectorBinding,
} from './question-orchestration/configured-question-director.js';
import { loadApiConfigForStart } from './start-mode.js';

async function main(): Promise<void> {
  const config = loadApiConfigForStart(process.env);
  if (config.checkpointA.mode === 'checkpoint_a') {
    const probe = await probeConfiguredDirectorBinding(config.checkpointA);
    process.stdout.write(
      `${JSON.stringify({
        credential_environment_variable: config.checkpointA.secretRef,
        endpoint_environment_variable: checkpointADirectorEndpointEnvironmentVariable(
          config.checkpointA,
        ),
        event: 'checkpoint_a.director_binding_probe',
        ...probe,
      })}\n`,
    );
  }
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
