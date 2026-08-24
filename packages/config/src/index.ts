import { z } from 'zod';

const appEnvironmentSchema = z.enum(['local', 'test', 'staging', 'production']);

export const CHECKPOINT_A_OPENROUTER_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions' as const;
export const CHECKPOINT_A_OPENROUTER_MODEL = 'stealth/ox-alpha' as const;
export const CHECKPOINT_A_OPENROUTER_SECRET_REF = 'OPENROUTER_API_KEY' as const;

export type CheckpointAStartMode = 'generic' | 'checkpoint_a';

export interface CheckpointADirectorDisabledConfig {
  readonly mode: 'generic';
  readonly provider: 'deterministic_fixture';
  readonly networkEnabled: false;
}

export interface CheckpointAOpenRouterConfig {
  readonly allowFallback: false;
  readonly endpoint: typeof CHECKPOINT_A_OPENROUTER_ENDPOINT;
  readonly model: typeof CHECKPOINT_A_OPENROUTER_MODEL;
  readonly mode: 'checkpoint_a';
  readonly networkEnabled: true;
  readonly provider: 'openrouter';
  readonly requireParameters: true;
  readonly responseFormat: 'json_object';
  readonly secretRef: typeof CHECKPOINT_A_OPENROUTER_SECRET_REF;
  /** Server-only credential. It is deliberately non-enumerable and redacted by toJSON(). */
  readonly apiKey: string;
}

export type CheckpointADirectorConfig =
  CheckpointADirectorDisabledConfig | CheckpointAOpenRouterConfig;

export interface ApiConfigLoadOptions {
  /** This option is server-owned; browser input must never be used to select a start mode. */
  readonly checkpointAStartMode?: CheckpointAStartMode;
}

const apiConfigSchema = z.object({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ENV: appEnvironmentSchema,
  DATABASE_URL: z.url({ protocol: /^postgresql$/ }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  AUTH_ALLOWED_ORIGINS: z.string().min(1),
  AUTH_LOGIN_THROTTLE_PEPPER: z.string().min(16),
  AI_RETENTION_CLEANUP_PEPPER: z.string().min(16),
  AUTH_SESSION_IDLE_TTL_MINUTES: z.coerce.number().int().min(1).default(30),
  AUTH_SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().int().min(1).default(12),
  AUDIO_STORAGE_ROOT: z.string().min(1).default('.local/audio-storage'),
  AUDIO_CHUNK_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .default(25 * 1024 * 1024),
  ASR_PROVIDER: z.enum(['deterministic_fixture', 'tencent_realtime_asr_v2']).optional(),
  ASR_REGION: z.literal('cn_mainland').default('cn_mainland'),
  ASR_ENGINE_MODEL_TYPE: z.literal('16k_zh_en_speaker_2.0').default('16k_zh_en_speaker_2.0'),
  ASR_DIARIZATION_REQUIRED: z.literal('true').default('true'),
  ASR_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).max(5_000).default(5_000),
  ASR_READY_TIMEOUT_MS: z.coerce.number().int().min(1).max(5_000).default(5_000),
  ASR_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(1).max(10_000).default(10_000),
  ASR_RECONNECT_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(2).default(2),
  ASR_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(2),
  ASR_DAILY_BUDGET_CNY: z.coerce.number().positive().max(5).default(5),
  ASR_DAILY_BILLED_SECONDS: z.coerce.number().int().positive().max(7_200).default(7_200),
  ASR_OPTIONAL_TRAINING_OPTIMIZATION: z.literal('false').default('false'),
  TENCENT_ASR_APP_ID: z.string().regex(/^\d+$/).optional(),
  TENCENT_ASR_SECRET_ID: z.string().min(1).optional(),
  TENCENT_ASR_SECRET_KEY: z.string().min(1).optional(),
});

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export interface ApiConfig {
  apiHost: string;
  apiPort: number;
  appEnv: AppEnvironment;
  databaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  authAllowedOrigins: readonly string[];
  authLoginThrottlePepper: string;
  aiRetentionCleanupPepper: string;
  authSessionIdleTtlMinutes: number;
  authSessionAbsoluteTtlHours: number;
  audioStorageRoot: string;
  audioChunkMaxBytes: number;
  asr: AsrConfig;
  checkpointA: CheckpointADirectorConfig;
}

export type AsrConfig =
  | { provider: 'deterministic_fixture' }
  | {
      appId: string;
      connectTimeoutMs: number;
      dailyBilledSeconds: number;
      dailyBudgetCny: number;
      diarizationRequired: true;
      drainTimeoutMs: number;
      enableSpeakerContext: 0;
      engineModelType: '16k_zh_en_speaker_2.0';
      maxConcurrency: number;
      optionalTrainingOptimization: false;
      provider: 'tencent_realtime_asr_v2';
      readyTimeoutMs: number;
      reconnectMaxAttempts: number;
      region: 'cn_mainland';
      secretId: string;
      secretKey: string;
    };

export class ConfigValidationError extends Error {
  public readonly invalidKeys: readonly string[];

  public constructor(invalidKeys: readonly string[]) {
    super(`Invalid configuration keys: ${invalidKeys.join(', ')}`);
    this.name = 'ConfigValidationError';
    this.invalidKeys = invalidKeys;
  }
}

export function loadApiConfig(
  environment: NodeJS.ProcessEnv,
  options: ApiConfigLoadOptions = {},
): ApiConfig {
  const result = apiConfigSchema.safeParse(environment);

  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
      .filter((key) => key.length > 0)
      .sort();
    throw new ConfigValidationError(invalidKeys);
  }

  const provider =
    result.data.ASR_PROVIDER ??
    (['local', 'test'].includes(result.data.APP_ENV) ? 'deterministic_fixture' : null);
  const invalidAsrKeys: string[] = [];
  if (provider === null) invalidAsrKeys.push('ASR_PROVIDER');
  if (provider === 'tencent_realtime_asr_v2') {
    if (result.data.TENCENT_ASR_APP_ID === undefined) invalidAsrKeys.push('TENCENT_ASR_APP_ID');
    if (result.data.TENCENT_ASR_SECRET_ID === undefined)
      invalidAsrKeys.push('TENCENT_ASR_SECRET_ID');
    if (result.data.TENCENT_ASR_SECRET_KEY === undefined)
      invalidAsrKeys.push('TENCENT_ASR_SECRET_KEY');
  }
  if (
    ['staging', 'production'].includes(result.data.APP_ENV) &&
    provider !== 'tencent_realtime_asr_v2'
  ) {
    invalidAsrKeys.push('ASR_PROVIDER');
  }
  if (invalidAsrKeys.length > 0) {
    throw new ConfigValidationError([...new Set(invalidAsrKeys)].sort());
  }
  const asr: AsrConfig =
    provider === 'deterministic_fixture'
      ? { provider }
      : {
          appId: result.data.TENCENT_ASR_APP_ID as string,
          connectTimeoutMs: result.data.ASR_CONNECT_TIMEOUT_MS,
          dailyBilledSeconds: result.data.ASR_DAILY_BILLED_SECONDS,
          dailyBudgetCny: result.data.ASR_DAILY_BUDGET_CNY,
          diarizationRequired: true,
          drainTimeoutMs: result.data.ASR_DRAIN_TIMEOUT_MS,
          enableSpeakerContext: 0,
          engineModelType: result.data.ASR_ENGINE_MODEL_TYPE,
          maxConcurrency: result.data.ASR_MAX_CONCURRENCY,
          optionalTrainingOptimization: false,
          provider: 'tencent_realtime_asr_v2',
          readyTimeoutMs: result.data.ASR_READY_TIMEOUT_MS,
          reconnectMaxAttempts: result.data.ASR_RECONNECT_MAX_ATTEMPTS,
          region: result.data.ASR_REGION,
          secretId: result.data.TENCENT_ASR_SECRET_ID as string,
          secretKey: result.data.TENCENT_ASR_SECRET_KEY as string,
        };

  return {
    apiHost: result.data.API_HOST,
    apiPort: result.data.API_PORT,
    appEnv: result.data.APP_ENV,
    databaseUrl: result.data.DATABASE_URL,
    logLevel: result.data.LOG_LEVEL,
    authAllowedOrigins: result.data.AUTH_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    authLoginThrottlePepper: result.data.AUTH_LOGIN_THROTTLE_PEPPER,
    aiRetentionCleanupPepper: result.data.AI_RETENTION_CLEANUP_PEPPER,
    authSessionIdleTtlMinutes: result.data.AUTH_SESSION_IDLE_TTL_MINUTES,
    authSessionAbsoluteTtlHours: result.data.AUTH_SESSION_ABSOLUTE_TTL_HOURS,
    audioStorageRoot: result.data.AUDIO_STORAGE_ROOT,
    audioChunkMaxBytes: result.data.AUDIO_CHUNK_MAX_BYTES,
    asr,
    checkpointA: loadCheckpointADirectorConfig(environment, options.checkpointAStartMode),
  };
}

/**
 * Loads the server-owned Director seam without making a network call.
 *
 * The default generic mode is intentionally deterministic and ignores an ambient key. The
 * Checkpoint A mode is only valid for the explicit local checkpoint path. This function returns
 * the credential only to the server-side adapter boundary; its serialized form is always safe.
 */
export function loadCheckpointADirectorConfig(
  environment: NodeJS.ProcessEnv,
  startMode: CheckpointAStartMode = 'generic',
): CheckpointADirectorConfig {
  if (!isCheckpointAStartMode(startMode)) {
    throw new ConfigValidationError(['CHECKPOINT_A_START_MODE']);
  }
  if (startMode === 'generic') {
    return Object.freeze({
      mode: 'generic',
      networkEnabled: false,
      provider: 'deterministic_fixture',
    });
  }

  if (environment.APP_ENV !== 'local') {
    throw new ConfigValidationError(['APP_ENV']);
  }

  const apiKey = environment[CHECKPOINT_A_OPENROUTER_SECRET_REF];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new ConfigValidationError([CHECKPOINT_A_OPENROUTER_SECRET_REF]);
  }

  return createCheckpointAOpenRouterConfig(apiKey);
}

function isCheckpointAStartMode(value: unknown): value is CheckpointAStartMode {
  return value === 'generic' || value === 'checkpoint_a';
}

function createCheckpointAOpenRouterConfig(apiKey: string): CheckpointAOpenRouterConfig {
  const config = {
    allowFallback: false,
    endpoint: CHECKPOINT_A_OPENROUTER_ENDPOINT,
    model: CHECKPOINT_A_OPENROUTER_MODEL,
    mode: 'checkpoint_a',
    networkEnabled: true,
    provider: 'openrouter',
    requireParameters: true,
    responseFormat: 'json_object',
    secretRef: CHECKPOINT_A_OPENROUTER_SECRET_REF,
  } as CheckpointAOpenRouterConfig;

  Object.defineProperty(config, 'apiKey', {
    configurable: false,
    enumerable: false,
    value: apiKey,
    writable: false,
  });
  Object.defineProperty(config, 'toJSON', {
    configurable: false,
    enumerable: false,
    value: () => ({
      allowFallback: false,
      endpoint: CHECKPOINT_A_OPENROUTER_ENDPOINT,
      model: CHECKPOINT_A_OPENROUTER_MODEL,
      mode: 'checkpoint_a',
      networkEnabled: true,
      provider: 'openrouter',
      requireParameters: true,
      responseFormat: 'json_object',
      secretRef: CHECKPOINT_A_OPENROUTER_SECRET_REF,
    }),
    writable: false,
  });

  return Object.freeze(config);
}

export function loadAppEnvironment(environment: NodeJS.ProcessEnv): AppEnvironment {
  const result = appEnvironmentSchema.safeParse(environment.APP_ENV);
  if (!result.success) throw new ConfigValidationError(['APP_ENV']);
  return result.data;
}
