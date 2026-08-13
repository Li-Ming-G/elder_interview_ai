import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { loadApiConfig } from '../packages/config/dist/index.js';
import { StreamingAsrMetrics } from '../apps/api/dist/realtime-transcription/streaming-asr.metrics.js';
import { TencentRealtimeAsrV2Adapter } from '../apps/api/dist/realtime-transcription/tencent-realtime-asr-v2.adapter.js';

const FRAME_BYTES = 3_200;
const FRAME_DURATION_MS = 100;
const MIN_DURATION_SECONDS = 7 * 60;
const MAX_DURATION_SECONDS = 9 * 60;
const REPLAY_COUNT = 3;
const CALIBRATION_WINDOW_MS = 60_000;

class SafeLiveError extends Error {}

let activeAdapter = null;
let activeSessionId = null;
const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());

try {
  const pcmPath = process.env.ASR_LIVE_PCM_PATH;
  if (pcmPath === undefined || pcmPath.length === 0) {
    throw new SafeLiveError('ASR_LIVE_PCM_PATH_REQUIRED');
  }
  const config = loadApiConfig({
    AI_RETENTION_CLEANUP_PEPPER: 'live-replay-process-only-retention-pepper',
    APP_ENV: 'test',
    AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1',
    AUTH_LOGIN_THROTTLE_PEPPER: 'live-replay-process-only-login-pepper',
    DATABASE_URL: 'postgresql://live_replay:unused@127.0.0.1:1/live_replay',
    ...process.env,
    ASR_PROVIDER: 'tencent_realtime_asr_v2',
  });
  if (config.asr.provider !== 'tencent_realtime_asr_v2') {
    throw new SafeLiveError('ASR_LIVE_PROVIDER_INVALID');
  }
  const pcm = await readFile(pcmPath);
  const durationSeconds = pcm.byteLength / 32_000;
  if (
    pcm.byteLength === 0 ||
    pcm.byteLength % FRAME_BYTES !== 0 ||
    durationSeconds < MIN_DURATION_SECONDS ||
    durationSeconds > MAX_DURATION_SECONDS
  ) {
    throw new SafeLiveError('ASR_LIVE_PCM_PROFILE_INVALID');
  }
  const sourceEvidence = {
    byteLength: pcm.byteLength,
    durationSeconds,
    pcmSha256: sha256(pcm),
    profile: 'mono/16000Hz/s16le/100ms-frames',
  };
  writeEvidence({ event: 'source_validated', ...sourceEvidence });

  const runs = [];
  for (let replayIndex = 0; replayIndex < REPLAY_COUNT; replayIndex += 1) {
    if (cancellation.signal.aborted) throw new SafeLiveError('ASR_LIVE_CANCELLED');
    const run = await replay(config, pcm, replayIndex + 1, cancellation.signal);
    runs.push(run);
    writeEvidence({ event: 'replay_complete', ...publicRun(run) });
  }
  const aggregate = summarize(runs);
  writeEvidence({
    actualBillingSku: 'unknown_requires_console_confirmation',
    event: 'replay_set_complete',
    hardGateObservation: aggregate.allRunsObservedTwoCalibrationLabels
      ? 'two_labels_observed_in_every_replay'
      : 'two_labels_not_observed_in_every_replay',
    replayCount: REPLAY_COUNT,
    source: sourceEvidence,
    ...aggregate,
  });
  if (!aggregate.allRunsObservedTwoCalibrationLabels) process.exitCode = 2;
} catch (error) {
  if (activeAdapter !== null && activeSessionId !== null) {
    await activeAdapter.cancel(activeSessionId).catch(() => undefined);
  }
  writeEvidence({ event: 'live_replay_failed', ...safeDiagnostic(error) });
  process.exitCode = 1;
}

async function replay(config, pcm, replayNumber, signal) {
  const metrics = new StreamingAsrMetrics();
  const adapter = new TencentRealtimeAsrV2Adapter(config, metrics);
  const sessionId = randomUUID();
  activeAdapter = adapter;
  activeSessionId = sessionId;
  const attempts = [];
  const statuses = [];
  const finals = [];
  let interimCount = 0;
  await adapter.open({
    initialSpeakerStreamId: randomUUID(),
    onAttempt: (identity) => {
      attempts.push(minimizedIdentity(identity));
      return Promise.resolve();
    },
    onResult: (result) => {
      if (result.kind === 'interim') interimCount += 1;
      else {
        finals.push({
          endMs: result.endMs,
          label: result.speakerProviderId,
          startMs: result.startMs,
          text: normalizeText(result.text),
        });
      }
      return Promise.resolve();
    },
    onStatus: (error) => {
      statuses.push(safeDiagnostic(error));
    },
    rotateSpeakerStream: () => Promise.resolve(randomUUID()),
    sessionId,
    signal,
  });
  const startedAt = Date.now();
  const frameCount = pcm.byteLength / FRAME_BYTES;
  for (let sequence = 0; sequence < frameCount; sequence += 1) {
    await delayUntil(startedAt + sequence * FRAME_DURATION_MS, signal);
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
      signal,
    });
    if (sequence % 2 === 1) {
      await waitForSentBytes(metrics, (sequence + 1) * FRAME_BYTES, signal);
    }
  }
  const receipt = await adapter.drainAndClose({
    lastAudioSequenceAccepted: frameCount - 1,
    sessionId,
    signal,
  });
  const completeness = adapter.completeness(sessionId);
  const snapshot = metrics.snapshot();
  activeAdapter = null;
  activeSessionId = null;
  return {
    attempts,
    completeness: {
      completeCaptureCoverageProven: completeness.completeCaptureCoverageProven,
      status: completeness.status,
      stickyDegraded: completeness.stickyDegraded,
      unbackfilledGapCount: completeness.unbackfilledGaps.length,
    },
    finals,
    interimCount,
    metrics: {
      billedDurationSeconds: snapshot.gauges.asr_billed_duration_seconds ?? null,
      drainLatencyMs: snapshot.gauges.asr_drain_latency_ms ?? null,
      firstFinalLatencyMs: snapshot.gauges.asr_first_final_latency_ms ?? null,
      firstInterimLatencyMs: snapshot.gauges.asr_first_interim_latency_ms ?? null,
      pcmAcceptedBytes: snapshot.counters.asr_pcm_accepted_bytes_total ?? 0,
      pcmSentBytes: snapshot.counters.asr_pcm_sent_bytes_total ?? 0,
      reconnectAttempts: snapshot.counters.asr_reconnect_attempt_total ?? 0,
      unknownSpeakerFinals: finals.filter(({ label }) => label === null).length,
    },
    receipt: {
      ...minimizedIdentity(receipt),
      acceptedThroughSequence: receipt.acceptedThroughSequence,
      providerFinalObserved: receipt.providerFinalObserved,
      resultsIngested: receipt.resultsIngested,
      terminalThroughSequence: receipt.terminalThroughSequence,
    },
    replayNumber,
    statuses,
  };
}

function publicRun(run) {
  const finalText = run.finals.map(({ text }) => text).join('');
  const calibrationLabels = distinctKnownLabels(
    run.finals.filter(({ startMs }) => startMs < CALIBRATION_WINDOW_MS),
  );
  return {
    attempts: run.attempts,
    calibrationDistinctLabelCount: calibrationLabels.length,
    completeness: run.completeness,
    finalCharacterCount: [...finalText].length,
    finalSegmentCount: run.finals.length,
    finalTextSha256: sha256(finalText),
    interimCount: run.interimCount,
    labelSequenceSha256: sha256(
      run.finals.map(({ label }) => (label === null ? 'unknown' : labelHash(label))).join('|'),
    ),
    metrics: run.metrics,
    receipt: run.receipt,
    replayNumber: run.replayNumber,
    statuses: run.statuses,
    twoDistinctCalibrationLabelsObserved: calibrationLabels.length >= 2,
  };
}

function summarize(runs) {
  const baseline = runs[0];
  if (baseline === undefined) throw new SafeLiveError('ASR_LIVE_NO_RUNS');
  return {
    allRunsObservedTwoCalibrationLabels: runs.every(
      (run) =>
        distinctKnownLabels(run.finals.filter(({ startMs }) => startMs < CALIBRATION_WINDOW_MS))
          .length >= 2,
    ),
    comparisonsToReplayOne: runs.slice(1).map((run) => ({
      bestMappedLabelAgreement: bestMappedLabelAgreement(baseline.finals, run.finals),
      replayNumber: run.replayNumber,
      textSimilarity: textSimilarity(
        baseline.finals.map(({ text }) => text).join(''),
        run.finals.map(({ text }) => text).join(''),
      ),
    })),
    totalBilledDurationSeconds: runs.reduce(
      (total, run) => total + (run.metrics.billedDurationSeconds ?? 0),
      0,
    ),
  };
}

function minimizedIdentity(identity) {
  return {
    attemptIdHash: shortHash(identity.attemptId),
    providerNamespaceIdHash: shortHash(identity.providerNamespaceId),
    providerRequestIdHash: shortHash(identity.providerRequestId),
    speakerStreamIdHash: shortHash(identity.speakerStreamId),
  };
}

function distinctKnownLabels(segments) {
  return [
    ...new Set(segments.flatMap(({ label }) => (label === null ? [] : [labelHash(label)]))),
  ].sort();
}

function bestMappedLabelAgreement(baseline, candidate) {
  const pairs = [];
  for (const current of candidate) {
    if (current.label === null) continue;
    const match = baseline
      .filter(({ label }) => label !== null)
      .map((reference) => ({
        current: current.label,
        overlap: Math.max(
          0,
          Math.min(reference.endMs, current.endMs) - Math.max(reference.startMs, current.startMs),
        ),
        reference: reference.label,
      }))
      .sort((left, right) => right.overlap - left.overlap)[0];
    if (match !== undefined && match.overlap > 0) pairs.push(match);
  }
  const total = pairs.reduce((sum, { overlap }) => sum + overlap, 0);
  if (total === 0) return null;
  const candidateLabels = [...new Set(pairs.map(({ current }) => current))];
  const baselineLabels = [...new Set(pairs.map(({ reference }) => reference))];
  if (candidateLabels.length > 7 || baselineLabels.length > 7) return null;
  let best = 0;
  for (const mapping of injectiveMappings(candidateLabels, baselineLabels)) {
    const score = pairs.reduce(
      (sum, pair) => sum + (mapping.get(pair.current) === pair.reference ? pair.overlap : 0),
      0,
    );
    best = Math.max(best, score);
  }
  return roundRatio(best / total);
}

function injectiveMappings(keys, values, index = 0, used = new Set(), mapping = new Map()) {
  if (index === keys.length) return [new Map(mapping)];
  const key = keys[index];
  const mappings = [];
  for (const value of values) {
    if (used.has(value)) continue;
    mapping.set(key, value);
    used.add(value);
    mappings.push(...injectiveMappings(keys, values, index + 1, used, mapping));
    used.delete(value);
    mapping.delete(key);
  }
  if (values.length < keys.length) {
    mapping.set(key, null);
    mappings.push(...injectiveMappings(keys, values, index + 1, used, mapping));
    mapping.delete(key);
  }
  return mappings;
}

function textSimilarity(left, right) {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  const denominator = Math.max(leftCharacters.length, rightCharacters.length);
  if (denominator === 0) return 1;
  let previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < rightCharacters.length; rightIndex += 1) {
      current.push(
        Math.min(
          (current[rightIndex] ?? 0) + 1,
          (previous[rightIndex + 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) +
            (leftCharacters[leftIndex] === rightCharacters[rightIndex] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return roundRatio(1 - (previous.at(-1) ?? denominator) / denominator);
}

function normalizeText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function labelHash(value) {
  return shortHash(`speaker-label:${value}`);
}

function shortHash(value) {
  return sha256(value).slice(0, 16);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function roundRatio(value) {
  return Math.round(value * 10_000) / 10_000;
}

async function delayUntil(deadline, signal) {
  const milliseconds = Math.max(0, deadline - Date.now());
  if (signal.aborted) throw new SafeLiveError('ASR_LIVE_CANCELLED');
  if (milliseconds === 0) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new SafeLiveError('ASR_LIVE_CANCELLED'));
      },
      { once: true },
    );
  });
}

async function waitForSentBytes(metrics, expectedBytes, signal) {
  const deadline = Date.now() + 5_000;
  while ((metrics.snapshot().counters.asr_pcm_sent_bytes_total ?? 0) < expectedBytes) {
    if (signal.aborted) throw new SafeLiveError('ASR_LIVE_CANCELLED');
    if (Date.now() >= deadline) throw new SafeLiveError('ASR_LIVE_SEND_CONFIRM_TIMEOUT');
    await delayUntil(Date.now() + 5, signal);
  }
}

function writeEvidence(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function safeCode(error) {
  if (error instanceof SafeLiveError) return error.message;
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
  return 'ASR_LIVE_INTERNAL_FAILURE';
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
