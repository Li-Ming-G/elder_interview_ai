import {
  ConfigValidationError,
  loadApiConfig,
  type ApiConfig,
  type CheckpointAStartMode,
} from '@elder-interview/config';

export const CHECKPOINT_A_START_ARGUMENT = '--checkpoint-a' as const;

/**
 * The generic API entry point has no networked Director. Checkpoint A is selected only by the
 * dedicated command-line argument; an ambient OPENROUTER_API_KEY is never enough.
 */
export function resolveApiStartMode(
  argv: readonly string[] = process.argv.slice(2),
): CheckpointAStartMode {
  if (argv.length === 0) return 'generic';
  if (argv.length === 1 && argv[0] === CHECKPOINT_A_START_ARGUMENT) return 'checkpoint_a';
  throw new ConfigValidationError(['CHECKPOINT_A_START_MODE']);
}

export function loadApiConfigForStart(
  environment: NodeJS.ProcessEnv,
  argv: readonly string[] = process.argv.slice(2),
): ApiConfig {
  const startMode = resolveApiStartMode(argv);
  const config = loadApiConfig(environment, { checkpointAStartMode: startMode });
  if (startMode === 'checkpoint_a' && config.asr.provider !== 'tencent_realtime_asr_v2') {
    throw new ConfigValidationError(['ASR_PROVIDER']);
  }
  return config;
}
