import { z } from 'zod';

const apiConfigSchema = z.object({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ENV: z.enum(['local', 'test', 'staging', 'production']),
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
});

export interface ApiConfig {
  apiHost: string;
  apiPort: number;
  appEnv: 'local' | 'test' | 'staging' | 'production';
  databaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  authAllowedOrigins: readonly string[];
  authLoginThrottlePepper: string;
  aiRetentionCleanupPepper: string;
  authSessionIdleTtlMinutes: number;
  authSessionAbsoluteTtlHours: number;
  audioStorageRoot: string;
  audioChunkMaxBytes: number;
}

export class ConfigValidationError extends Error {
  public readonly invalidKeys: readonly string[];

  public constructor(invalidKeys: readonly string[]) {
    super(`Invalid configuration keys: ${invalidKeys.join(', ')}`);
    this.name = 'ConfigValidationError';
    this.invalidKeys = invalidKeys;
  }
}

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const result = apiConfigSchema.safeParse(environment);

  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
      .filter((key) => key.length > 0)
      .sort();
    throw new ConfigValidationError(invalidKeys);
  }

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
  };
}
