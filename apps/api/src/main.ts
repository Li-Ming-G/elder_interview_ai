import 'reflect-metadata';

import { ConfigValidationError, loadApiConfig } from '@elder-interview/config';

import { createApplication } from './create-application.js';

async function main(): Promise<void> {
  const config = loadApiConfig(process.env);
  const application = await createApplication(config);
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
