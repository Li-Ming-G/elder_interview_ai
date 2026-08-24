import { loadApiConfig } from '../packages/config/dist/index.js';
import { inspectAsrReadiness } from '../apps/api/dist/realtime-transcription/asr-readiness.js';

const environment = {
  AI_RETENTION_CLEANUP_PEPPER: 'checkpoint-a-asr-readiness-process-only-retention-pepper',
  APP_ENV: 'local',
  AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
  AUTH_LOGIN_THROTTLE_PEPPER: 'checkpoint-a-asr-readiness-process-only-login-pepper',
  DATABASE_URL: 'postgresql://checkpoint_a_readiness:unused@127.0.0.1:1/checkpoint_a_readiness',
  ...process.env,
};

try {
  const config = loadApiConfig(environment);
  const report = inspectAsrReadiness(config);
  process.stdout.write(`${JSON.stringify({ event: 'checkpoint_a_asr_preflight', ...report })}\n`);
  if (report.configurationStatus !== 'configuration_ready') process.exitCode = 1;
} catch (error) {
  const invalidKeys =
    typeof error === 'object' &&
    error !== null &&
    'invalidKeys' in error &&
    Array.isArray(error.invalidKeys)
      ? error.invalidKeys.filter((key) => typeof key === 'string')
      : ['UNKNOWN_CONFIGURATION'];
  process.stdout.write(
    `${JSON.stringify({
      event: 'checkpoint_a_asr_preflight',
      configurationStatus: 'rejected',
      reason: 'CONFIG_INVALID',
      invalidKeys,
    })}\n`,
  );
  process.exitCode = 1;
}
