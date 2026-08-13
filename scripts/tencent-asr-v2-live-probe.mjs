import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { loadApiConfig } from '../packages/config/dist/index.js';
import { StreamingAsrMetrics } from '../apps/api/dist/realtime-transcription/streaming-asr.metrics.js';
import { TencentRealtimeAsrV2Adapter } from '../apps/api/dist/realtime-transcription/tencent-realtime-asr-v2.adapter.js';

const FRAME_BYTES = 3_200;
const DEFAULT_FRAME_COUNT = 20;
const FRAME_DURATION_MS = 100;
const MAX_FRAME_COUNT = 300;

let adapter = null;
let configValid = false;
let handshakeComplete = false;
let lastStatusDiagnostic = null;
let metrics = null;
let sessionId = null;
const finals = [];

try {
  const config = loadApiConfig({
    AI_RETENTION_CLEANUP_PEPPER: 'live-probe-process-only-retention-pepper',
    APP_ENV: 'test',
    AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1',
    AUTH_LOGIN_THROTTLE_PEPPER: 'live-probe-process-only-login-pepper',
    DATABASE_URL: 'postgresql://live_probe:unused@127.0.0.1:1/live_probe',
    ...process.env,
    ASR_PROVIDER: 'tencent_realtime_asr_v2',
    ASR_RECONNECT_MAX_ATTEMPTS: '0',
  });
  if (config.asr.provider !== 'tencent_realtime_asr_v2') throw new Error('PROVIDER_INVALID');
  configValid = true;
  metrics = new StreamingAsrMetrics();
  adapter = new TencentRealtimeAsrV2Adapter(config, metrics);
  sessionId = randomUUID();
  await adapter.open({
    initialSpeakerStreamId: randomUUID(),
    onAttempt: () => Promise.resolve(),
    onResult: (result) => {
      if (result.kind === 'final') {
        finals.push({
          speakerKnown: result.speakerProviderId !== null,
          text: result.text.normalize('NFKC').replace(/\s+/gu, ' ').trim(),
        });
      }
      return Promise.resolve();
    },
    onStatus: (error) => {
      lastStatusDiagnostic = safeDiagnostic(error);
    },
    rotateSpeakerStream: () => Promise.resolve(randomUUID()),
    sessionId,
  });
  handshakeComplete = true;
  const pcm = syntheticPcm();
  const frameCount = pcm.byteLength / FRAME_BYTES;
  const captureStartedAt = Date.now();
  for (let sequence = 0; sequence < frameCount; sequence += 1) {
    await delayUntil(captureStartedAt + sequence * FRAME_DURATION_MS);
    const bytes = pcm.subarray(sequence * FRAME_BYTES, (sequence + 1) * FRAME_BYTES);
    await adapter.accept({
      frame: {
        audio_stream_id: sessionId,
        channels: 1,
        encoding: 'pcm_s16le',
        end_ms: (sequence + 1) * FRAME_DURATION_MS,
        pcm_base64: bytes.toString('base64'),
        pcm_sha256: sha256(bytes),
        sample_rate_hz: 16_000,
        sequence_no: sequence,
        start_ms: sequence * FRAME_DURATION_MS,
      },
      sessionId,
      signal: new AbortController().signal,
    });
  }
  const receipt = await adapter.drainAndClose({
    lastAudioSequenceAccepted: frameCount - 1,
    sessionId,
  });
  const snapshot = metrics.snapshot();
  const pcmAttemptedBytes = snapshot.counters.asr_pcm_send_attempted_bytes_total ?? 0;
  const pcmSentBytes = snapshot.counters.asr_pcm_sent_bytes_total ?? 0;
  const estimatedBilledSeconds = Math.ceil(pcmAttemptedBytes / 32_000);
  const finalText = finals.map(({ text }) => text).join('');
  process.stdout.write(
    `${JSON.stringify({
      category: null,
      connectionCount: 1,
      configValid,
      drainComplete: true,
      estimatedCostCny: Math.round((estimatedBilledSeconds / 3_600) * 1 * 1_000_000) / 1_000_000,
      event: 'asr_live_probe_complete',
      finalCharacterCount: [...finalText].length,
      finalObserved: receipt.providerFinalObserved,
      finalSegmentCount: finals.length,
      finalTextSha256: sha256(finalText),
      handshakeComplete,
      knownSpeakerFinalCount: finals.filter(({ speakerKnown }) => speakerKnown).length,
      estimatedBilledSeconds,
      pcmAttemptedBytes,
      pcmSentBytes,
      safeCode: null,
      unknownSpeakerFinalCount: finals.filter(({ speakerKnown }) => !speakerKnown).length,
    })}\n`,
  );
} catch (error) {
  if (adapter !== null && sessionId !== null)
    await adapter.cancel(sessionId).catch(() => undefined);
  const snapshot = metrics?.snapshot();
  const pcmAttemptedBytes = snapshot?.counters.asr_pcm_send_attempted_bytes_total ?? 0;
  const pcmSentBytes = snapshot?.counters.asr_pcm_sent_bytes_total ?? 0;
  process.stdout.write(
    `${JSON.stringify({
      configValid,
      connectionCount: 1,
      conservativeAttemptedSeconds: Math.ceil(pcmAttemptedBytes / 32_000),
      drainComplete: false,
      estimatedBilledSeconds: 0,
      estimatedCostCny: 0,
      event: 'asr_live_probe_failed',
      finalObserved: handshakeComplete ? null : false,
      handshakeComplete,
      pcmAttemptedBytes,
      pcmSentBytes,
      ...mergeDiagnostic(safeDiagnostic(error), lastStatusDiagnostic),
    })}\n`,
  );
  process.exitCode = 1;
}

function syntheticPcm() {
  const fixturePath = process.env.ASR_LIVE_SYNTHETIC_PCM_PATH;
  if (fixturePath !== undefined) {
    if (!isAbsolute(fixturePath)) throw new Error('ASR_LIVE_SYNTHETIC_PCM_PATH_INVALID');
    const fixture = readFileSync(fixturePath);
    if (
      fixture.byteLength < FRAME_BYTES * DEFAULT_FRAME_COUNT ||
      fixture.byteLength > FRAME_BYTES * MAX_FRAME_COUNT ||
      fixture.byteLength % FRAME_BYTES !== 0
    ) {
      throw new Error('ASR_LIVE_SYNTHETIC_PCM_LENGTH_INVALID');
    }
    return fixture;
  }
  const pcm = Buffer.alloc(FRAME_BYTES * DEFAULT_FRAME_COUNT);
  for (let sample = 0; sample < pcm.byteLength / 2; sample += 1) {
    const time = sample / 16_000;
    const frequency = time < 1 ? 440 : 660;
    pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * 8_000), sample * 2);
  }
  return pcm;
}

function safeCode(error) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'safeCode' in error &&
    typeof error.safeCode === 'string'
  ) {
    return error.safeCode;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'invalidKeys' in error &&
    Array.isArray(error.invalidKeys)
  ) {
    return `CONFIG_INVALID:${error.invalidKeys.join(',')}`;
  }
  return 'ASR_LIVE_PROBE_INTERNAL_FAILURE';
}

function safeDiagnostic(error) {
  const diagnostic = { safeCode: safeCode(error) };
  if (typeof error !== 'object' || error === null) return diagnostic;
  if ('category' in error && typeof error.category === 'string') {
    diagnostic.category = error.category;
  }
  if ('providerCode' in error && Number.isInteger(error.providerCode)) {
    const officialMessageCategory = officialMessageCategoryFor(error.providerCode);
    if (officialMessageCategory !== null) {
      diagnostic.officialMessageCategory = officialMessageCategory;
      diagnostic.providerCode = error.providerCode;
    }
  }
  const transport = safeTransportDiagnostic(error);
  if (transport !== null) diagnostic.transport = transport;
  return diagnostic;
}

function mergeDiagnostic(primary, status) {
  if (status === null) return primary;
  return {
    ...primary,
    ...(primary.providerCode === undefined && status.providerCode !== undefined
      ? {
          officialMessageCategory: status.officialMessageCategory,
          providerCode: status.providerCode,
        }
      : {}),
    ...(primary.transport === undefined && status.transport !== undefined
      ? { transport: status.transport }
      : {}),
  };
}

function safeTransportDiagnostic(error) {
  if (!('transportDiagnostic' in error)) return null;
  const value = error.transportDiagnostic;
  if (typeof value !== 'object' || value === null) return null;
  const allowedClasses = new Set([
    'dns_resolution',
    'http_upgrade_rejected',
    'network_unreachable',
    'tcp_refused',
    'tcp_reset',
    'tcp_timeout',
    'tls_certificate',
    'tls_handshake',
    'unknown_transport',
    'websocket_closed',
    'websocket_not_open',
  ]);
  const allowedPhases = new Set(['dns', 'tcp', 'tls', 'upgrade', 'websocket']);
  if (!allowedClasses.has(value.errorClass) || !allowedPhases.has(value.phase)) return null;
  const diagnostic = { errorClass: value.errorClass, phase: value.phase };
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) {
    diagnostic.httpStatus = value.httpStatus;
  }
  if (Number.isInteger(value.closeCode) && value.closeCode >= 1000 && value.closeCode <= 4999) {
    diagnostic.closeCode = value.closeCode;
  }
  return diagnostic;
}

function officialMessageCategoryFor(code) {
  return (
    {
      4000: 'audio_send_rate_exceeded',
      4001: 'invalid_parameter',
      4002: 'authentication_failed',
      4003: 'appid_service_not_enabled',
      4004: 'resource_package_exhausted',
      4005: 'account_overdue',
      4006: 'account_concurrency_exceeded',
      4007: 'audio_decode_failed',
      4008: 'audio_send_timeout',
      4009: 'client_connection_closed',
      4010: 'unknown_text_message',
      5000: 'provider_load_or_network_failure',
      5001: 'provider_load_or_network_failure',
      5002: 'provider_load_or_network_failure',
      6001: 'mainland_international_service_mismatch',
    }[code] ?? null
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function delayUntil(deadline) {
  const milliseconds = Math.max(0, deadline - Date.now());
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
