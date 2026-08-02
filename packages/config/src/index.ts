import { z } from 'zod';

const apiConfigSchema = z.object({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ENV: z.enum(['local', 'test', 'staging', 'production']),
  DATABASE_URL: z.url({ protocol: /^postgresql$/ }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface ApiConfig {
  apiHost: string;
  apiPort: number;
  appEnv: 'local' | 'test' | 'staging' | 'production';
  databaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
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
  };
}
