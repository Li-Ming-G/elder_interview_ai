import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadApiConfig } from '@elder-interview/config';
import { describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import {
  StreamingAsrError,
  type StreamingAsrAttemptIdentity,
  type StreamingAsrResult,
} from './streaming-asr.js';
import { StreamingAsrMetrics } from './streaming-asr.metrics.js';
import {
  buildTencentSignedUrl,
  classifyTencentTransportError,
  mapTencentError,
  mapTencentWebSocketClose,
  TencentAsrBudgetLedger,
  TencentRealtimeAsrV2Adapter,
  type TencentProtocolConnection,
  type TencentProtocolConnectionFactory,
  WsTencentProtocolConnectionFactory,
} from './tencent-realtime-asr-v2.adapter.js';

describe('TencentRealtimeAsrV2Adapter', () => {
  it('signs the formal V2 speaker query and omits speaker context identity', () => {
    const url = buildTencentSignedUrl({
      appId: 'fictional-app',
      engineModelType: '16k_zh_en_speaker_2.0',
      nonce: 123,
      secretId: 'fictional-secret-id',
      secretKey: 'fictional-secret-key-9',
      timestampSeconds: 1_700_000_000,
      voiceId: '00000000-0000-4000-8000-000000000001',
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('wss://asr.cloud.tencent.com');
    expect(parsed.pathname).toBe('/asr/v2/fictional-app');
    expect(parsed.searchParams.get('engine_model_type')).toBe('16k_zh_en_speaker_2.0');
    expect(parsed.searchParams.get('enable_speaker_context')).toBe('0');
    expect(parsed.searchParams.get('speaker_diarization')).toBe('1');
    expect(parsed.searchParams.has('speaker_context_id')).toBe(false);
    expect(parsed.searchParams.has('result_mod')).toBe(false);
    const canonical = [
      'convert_num_mode=1',
      'enable_speaker_context=0',
      'engine_model_type=16k_zh_en_speaker_2.0',
      'expired=1700000300',
      'needvad=1',
      'nonce=123',
      'reinforce_hotword=0',
      'secretid=fictional-secret-id',
      'sentence_strategy=1',
      'speaker_diarization=1',
      'timestamp=1700000000',
      'voice_format=1',
      'voice_id=00000000-0000-4000-8000-000000000001',
    ].join('&');
    expect(parsed.searchParams.get('signature')).toBe(
      createHmac('sha1', 'fictional-secret-key-9')
        .update(`asr.cloud.tencent.com/asr/v2/fictional-app?${canonical}`)
        .digest('base64'),
    );
    expect(parsed.search).toContain('signature=hTEHQHKqQgrL%2BPQEt8InejArj%2FM%3D');
    expect(url).toContain('signature=');
    expect(url).not.toContain('signature%3D');
    expect([...parsed.searchParams.keys()].sort()).toEqual([
      'convert_num_mode',
      'enable_speaker_context',
      'engine_model_type',
      'expired',
      'needvad',
      'nonce',
      'reinforce_hotword',
      'secretid',
      'sentence_strategy',
      'signature',
      'speaker_diarization',
      'timestamp',
      'voice_format',
      'voice_id',
    ]);
  });

  it('captures only safe local upgrade status, transport class, and WebSocket close code', async () => {
    const rejectServer = createServer();
    rejectServer.on('upgrade', (_request, socket) => {
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 17\r\n\r\nsensitive-fixture',
      );
    });
    await listen(rejectServer);
    const rejectedPort = (rejectServer.address() as AddressInfo).port;
    const factory = new WsTencentProtocolConnectionFactory();
    const rejected = await factory
      .connect(
        `ws://127.0.0.1:${String(rejectedPort)}/fixture?signature=fictional-sensitive`,
        new AbortController().signal,
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejected).toMatchObject({
      safeCode: 'ASR_PROVIDER_UNAVAILABLE',
      transportDiagnostic: {
        errorClass: 'http_upgrade_rejected',
        httpStatus: 403,
        phase: 'upgrade',
      },
    });
    expect(String(rejected)).not.toContain('fictional-sensitive');
    expect(String(rejected)).not.toContain('sensitive-fixture');
    await closeServer(rejectServer);

    const websocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => {
      websocketServer.once('listening', resolve);
    });
    const websocketPort = (websocketServer.address() as AddressInfo).port;
    const connection = await factory.connect(
      `ws://127.0.0.1:${String(websocketPort)}/fixture`,
      new AbortController().signal,
    );
    const closeCode = new Promise<number | undefined>((resolve) => {
      connection.onClose(resolve);
    });
    for (const client of websocketServer.clients) client.close(1013, 'sensitive-close-reason');
    expect(await closeCode).toBe(1013);
    expect(mapTencentWebSocketClose(await closeCode)).toMatchObject({
      transportDiagnostic: {
        closeCode: 1013,
        errorClass: 'websocket_closed',
        phase: 'websocket',
      },
    });
    await new Promise<void>((resolve) => {
      websocketServer.close(() => {
        resolve();
      });
    });

    expect(
      classifyTencentTransportError(Object.assign(new Error('sensitive'), { code: 'ENOTFOUND' })),
    ).toMatchObject({ transportDiagnostic: { errorClass: 'dns_resolution', phase: 'dns' } });
    expect(
      classifyTencentTransportError(
        Object.assign(new Error('sensitive'), { code: 'CERT_HAS_EXPIRED' }),
      ),
    ).toMatchObject({ transportDiagnostic: { errorClass: 'tls_certificate', phase: 'tls' } });
  });

  it('replays a close that arrives before the adapter attaches its listener', async () => {
    const websocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    let offeredExtensions: string | undefined;
    websocketServer.on('connection', (client, request) => {
      offeredExtensions = request.headers['sec-websocket-extensions'];
      client.close(1013, 'sensitive-local-reason');
    });
    await new Promise<void>((resolve) => {
      websocketServer.once('listening', resolve);
    });
    const port = (websocketServer.address() as AddressInfo).port;
    const connection = await new WsTencentProtocolConnectionFactory().connect(
      `ws://127.0.0.1:${String(port)}/fixture`,
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const replayedCloseCode = await new Promise<number | undefined>((resolve) => {
      connection.onClose(resolve);
    });
    expect(replayedCloseCode).toBe(1013);
    expect(offeredExtensions).toBeUndefined();
    await expect(connection.sendBinary(Buffer.alloc(6_400))).rejects.toMatchObject({
      transportDiagnostic: {
        closeCode: 1013,
        errorClass: 'websocket_not_open',
        phase: 'websocket',
      },
    });
    await new Promise<void>((resolve) => {
      websocketServer.close(() => {
        resolve();
      });
    });
  });

  it('keeps a real local ws connection open after code0 and completes the live-harness pump/drain sequence', async () => {
    const events: string[] = [];
    const binaryPacketSizes: number[] = [];
    const websocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    websocketServer.on('connection', (client) => {
      events.push('server.connection');
      client.on('close', (code) => {
        events.push(`server.close.${String(code)}`);
      });
      client.on('message', (data, isBinary) => {
        if (isBinary) {
          binaryPacketSizes.push(Buffer.from(data as Buffer).byteLength);
          events.push('server.binary');
          return;
        }
        expect(Buffer.from(data as Buffer).toString('utf8')).toBe(JSON.stringify({ type: 'end' }));
        events.push('server.end');
        client.send(
          JSON.stringify({
            code: 0,
            final: 1,
            sentences: {
              sentence_list: [
                {
                  end_time: 200,
                  sentence: '完全虚构的本地时序句。',
                  sentence_id: 0,
                  sentence_type: 1,
                  speaker_id: 0,
                  start_time: 0,
                },
              ],
            },
          }),
        );
      });
      client.send(JSON.stringify({ code: 0 }));
      events.push('server.code0');
    });
    await new Promise<void>((resolve) => {
      websocketServer.once('listening', resolve);
    });
    const port = (websocketServer.address() as AddressInfo).port;
    const localFactory: TencentProtocolConnectionFactory = {
      connect: (_url, signal) =>
        new WsTencentProtocolConnectionFactory().connect(
          `ws://127.0.0.1:${String(port)}/deterministic-local-provider`,
          signal,
        ),
    };
    const metrics = new StreamingAsrMetrics();
    const sessionId = '00000000-0000-4000-8000-000000000007';
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({
        ASR_CONNECT_TIMEOUT_MS: '20',
        ASR_DRAIN_TIMEOUT_MS: '3000',
        ASR_READY_TIMEOUT_MS: '20',
        ASR_RECONNECT_MAX_ATTEMPTS: '0',
      }),
      metrics,
      localFactory,
    );
    const results: StreamingAsrResult[] = [];
    await adapter.open(openContext(sessionId, results));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(events).toEqual(['server.connection', 'server.code0']);
    expect([...websocketServer.clients].every((client) => client.readyState === client.OPEN)).toBe(
      true,
    );
    for (let sequence = 0; sequence < 20; sequence += 1) {
      await adapter.accept(frame(sequence, sessionId));
    }
    const receipt = await adapter.drainAndClose({
      lastAudioSequenceAccepted: 19,
      sessionId,
    });
    expect(binaryPacketSizes).toEqual(Array.from({ length: 10 }, () => 6_400));
    expect(events.slice(0, 2)).toEqual(['server.connection', 'server.code0']);
    expect(events.slice(2, 12)).toEqual(Array.from({ length: 10 }, () => 'server.binary'));
    expect(events[12]).toBe('server.end');
    expect(results).toHaveLength(1);
    expect(receipt).toMatchObject({
      acceptedThroughSequence: 19,
      providerFinalObserved: true,
      resultsIngested: true,
      terminalThroughSequence: 19,
    });
    expect(metrics.snapshot().counters).toMatchObject({
      asr_pcm_send_attempted_bytes_total: 64_000,
      asr_pcm_sent_bytes_total: 64_000,
    });
    await new Promise<void>((resolve) => {
      websocketServer.close(() => {
        resolve();
      });
    });
  });

  it('treats provider close after final=1 as normal drain completion', async () => {
    const factory = new FixtureFactory({ closeAfterFinal: true });
    const statuses: string[] = [];
    const sessionId = '00000000-0000-4000-8000-000000000009';
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      new StreamingAsrMetrics(),
      factory,
    );
    await adapter.open({
      ...openContext(sessionId),
      onStatus: (error) => {
        statuses.push(error.safeCode);
      },
    });
    await adapter.accept(frame(0, sessionId));
    const receipt = await adapter.drainAndClose({ lastAudioSequenceAccepted: 0, sessionId });
    expect(receipt).toMatchObject({ providerFinalObserved: true, resultsIngested: true });
    expect(statuses).toEqual([]);
  });

  it('preserves a safe close diagnostic through failed drain', async () => {
    const factory = new FixtureFactory();
    const sessionId = '00000000-0000-4000-8000-000000000008';
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      new StreamingAsrMetrics(),
      factory,
    );
    await adapter.open(openContext(sessionId));
    factory.connections[0]?.closeFromProvider(1013);
    await waitFor(() => factory.connections[0]?.closed === true);
    await expect(
      adapter.drainAndClose({ lastAudioSequenceAccepted: -1, sessionId }),
    ).rejects.toMatchObject({
      safeCode: 'ASR_PROVIDER_UNAVAILABLE',
      transportDiagnostic: {
        closeCode: 1013,
        errorClass: 'websocket_closed',
        phase: 'websocket',
      },
    });
  });

  it('paces 100ms frames into 6400-byte packets, sends an exact tail, maps async results, and drains explicitly', async () => {
    const factory = new FixtureFactory();
    const metrics = new StreamingAsrMetrics();
    const adapter = new TencentRealtimeAsrV2Adapter(config(), metrics, factory);
    const results: StreamingAsrResult[] = [];
    let identity: StreamingAsrAttemptIdentity | null = null;
    await adapter.open({
      initialSpeakerStreamId: '00000000-0000-4000-8000-000000000011',
      onAttempt: (value) => {
        identity = value;
        return Promise.resolve();
      },
      onResult: (result) => {
        results.push(result);
        return Promise.resolve();
      },
      rotateSpeakerStream: () => Promise.resolve('00000000-0000-4000-8000-000000000012'),
      sessionId: '00000000-0000-4000-8000-000000000010',
    });
    await adapter.accept(frame(0));
    await adapter.accept(frame(1));
    await waitFor(() => factory.connections[0]?.binaryPackets.length === 1);
    factory.connections[0]?.emit({
      code: 0,
      message_id: 'provider-interim-sensitive',
      result: {
        sentences: [
          {
            end_time: 160,
            sentence: '完全虚构的中间态。',
            sentence_id: 0,
            sentence_type: 0,
            speaker_id: 1,
            start_time: 20,
          },
        ],
      },
    });
    await waitFor(() => results.length === 1);
    factory.connections[0]?.emit({
      code: 0,
      message_id: 'provider-message-sensitive',
      result: {
        sentences: [
          {
            end_time: 180,
            sentence: '完全虚构的测试句。',
            sentence_id: 0,
            sentence_type: 1,
            speaker_id: -1,
            start_time: 20,
          },
        ],
      },
    });
    await waitFor(() => results.length === 2);
    factory.connections[0]?.emit({
      code: 0,
      message_id: 'duplicate-message',
      result: {
        sentences: [
          {
            end_time: 180,
            sentence: '不应覆盖确定态。',
            sentence_id: 0,
            sentence_type: 0,
            speaker_id: 1,
            start_time: 20,
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(results).toHaveLength(2);
    await adapter.accept(frame(2));
    const receipt = await adapter.drainAndClose({
      lastAudioSequenceAccepted: 2,
      sessionId: '00000000-0000-4000-8000-000000000010',
    });
    expect(factory.connections[0]?.binaryPackets.map(({ byteLength }) => byteLength)).toEqual([
      6_400, 3_200,
    ]);
    expect(factory.connections[0]?.texts).toEqual([JSON.stringify({ type: 'end' })]);
    expect(results[0]).toMatchObject({
      kind: 'interim',
      speakerProviderId: '1',
      text: '完全虚构的中间态。',
    });
    expect(results[1]).toMatchObject({
      kind: 'final',
      speakerProviderId: null,
      speakerStreamId: '00000000-0000-4000-8000-000000000011',
      text: '完全虚构的测试句。',
    });
    expect(JSON.stringify(results[1]?.providerPayload)).not.toContain('provider-message-sensitive');
    expect(receipt).toMatchObject({
      ...identity,
      acceptedThroughSequence: 2,
      providerFinalObserved: true,
      resultsIngested: true,
      terminalThroughSequence: 2,
    });
    expect(metrics.snapshot().counters).toMatchObject({
      asr_final_results_total: 1,
      asr_interim_results_total: 1,
      asr_pcm_accepted_bytes_total: 9_600,
      asr_pcm_sent_bytes_total: 9_600,
      asr_unknown_speaker_total: 1,
    });
    const gauges = metrics.snapshot().gauges;
    expect(typeof gauges.asr_final_persistence_latency_ms).toBe('number');
    expect(typeof gauges.asr_first_final_latency_ms).toBe('number');
    expect(typeof gauges.asr_first_interim_latency_ms).toBe('number');
    expect(gauges.asr_pcm_sent_through_sequence).toBe(2);
  });

  it('does not accumulate successful WebSocket callback latency into long-running pacing', async () => {
    vi.useFakeTimers();
    try {
      const factory = new FixtureFactory({ successfulBinaryDelayMs: 30 });
      const adapter = new TencentRealtimeAsrV2Adapter(config(), new StreamingAsrMetrics(), factory);
      await adapter.open(openContext('00000000-0000-4000-8000-000000000014'));
      for (let sequence = 0; sequence < 12; sequence += 1) {
        await adapter.accept(frame(sequence, '00000000-0000-4000-8000-000000000014'));
      }

      await vi.advanceTimersByTimeAsync(1_100);

      expect(factory.connections[0]?.binarySentAt).toHaveLength(6);
      expect(
        (factory.connections[0]?.binarySentAt.at(-1) ?? 0) -
          (factory.connections[0]?.binarySentAt[0] ?? 0),
      ).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps official speaker snapshots and the documented legacy single-sentence shape', async () => {
    const factory = new FixtureFactory();
    const adapter = new TencentRealtimeAsrV2Adapter(config(), new StreamingAsrMetrics(), factory);
    const results: StreamingAsrResult[] = [];
    const sessionId = '00000000-0000-4000-8000-000000000013';
    await adapter.open({
      ...openContext(sessionId),
      onResult: (result) => {
        results.push(result);
        return Promise.resolve();
      },
    });

    factory.connections[0]?.emit({
      code: 0,
      message_id: 'official-snapshot',
      sentences: {
        sentence_list: [
          {
            end_time: 100,
            sentence: 'official-shape',
            sentence_id: 0,
            sentence_type: 1,
            speaker_id: 0,
            start_time: 0,
          },
        ],
        voice_text_str: 'must-not-be-used-as-a-result',
      },
    });
    await waitFor(() => results.length === 1);

    factory.connections[0]?.emit({
      code: 0,
      message_id: 'legacy-single',
      result: {
        speaker_sentences: {
          end_time: 200,
          sentence: 'legacy-shape',
          sentence_id: 1,
          sentence_type: 1,
          speaker_id: -1,
          start_time: 100,
        },
      },
    });
    await waitFor(() => results.length === 2);

    expect(results).toMatchObject([
      { kind: 'final', providerSegmentId: '0', speakerProviderId: '0', text: 'official-shape' },
      { kind: 'final', providerSegmentId: '1', speakerProviderId: null, text: 'legacy-shape' },
    ]);
  });

  it('rotates namespace, fences late results, and keeps an earlier gap sticky after reconnect success', async () => {
    const factory = new FixtureFactory();
    const adapter = new TencentRealtimeAsrV2Adapter(config(), new StreamingAsrMetrics(), factory);
    const attempts: StreamingAsrAttemptIdentity[] = [];
    const results: StreamingAsrResult[] = [];
    let rotation = 0;
    const sessionId = '00000000-0000-4000-8000-000000000020';
    await adapter.open({
      initialSpeakerStreamId: '00000000-0000-4000-8000-000000000021',
      onAttempt: (identity) => {
        attempts.push(identity);
        return Promise.resolve();
      },
      onResult: (result) => {
        results.push(result);
        return Promise.resolve();
      },
      rotateSpeakerStream: () => {
        rotation += 1;
        return Promise.resolve('00000000-0000-4000-8000-000000000022');
      },
      sessionId,
    });
    await adapter.accept(frame(0, sessionId));
    factory.connections[0]?.closeFromProvider();
    const acceptedDuringBackoffAt = Date.now();
    const acceptedDuringBackoff = await adapter.accept(frame(1, sessionId));
    expect(Date.now() - acceptedDuringBackoffAt).toBeLessThan(200);
    expect(acceptedDuringBackoff.attemptId).toBe(attempts[0]?.attemptId);
    await waitFor(() => factory.connections.length === 2);
    factory.connections[0]?.emit(finalSentence('late-old'));
    await adapter.accept(frame(2, sessionId));
    await adapter.accept(frame(3, sessionId));
    await waitFor(() => factory.connections[1]?.binaryPackets.length === 1);
    const drain = adapter.drainAndClose({ lastAudioSequenceAccepted: 3, sessionId });
    await drain;
    expect(rotation).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.providerNamespaceId).not.toBe(attempts[1]?.providerNamespaceId);
    expect(attempts[0]?.speakerStreamId).not.toBe(attempts[1]?.speakerStreamId);
    expect(results).toHaveLength(0);
    expect(adapter.completeness(sessionId)).toMatchObject({
      status: 'known_unbackfilled_gap',
      stickyDegraded: true,
    });
  });

  it('rejects corrupt PCM and fences accepted unterminal audio on cancellation', async () => {
    const factory = new FixtureFactory();
    const adapter = new TencentRealtimeAsrV2Adapter(config(), new StreamingAsrMetrics(), factory);
    const results: StreamingAsrResult[] = [];
    const sessionId = '00000000-0000-4000-8000-000000000030';
    await adapter.open(openContext(sessionId, results));
    const corrupt = frame(0, sessionId);
    corrupt.frame.pcm_sha256 = '0'.repeat(64);
    await expect(adapter.accept(corrupt)).rejects.toMatchObject({
      safeCode: 'ASR_AUDIO_INVALID',
    });
    const controller = new AbortController();
    controller.abort();
    const aborted = frame(0, sessionId);
    aborted.signal = controller.signal;
    await expect(adapter.accept(aborted)).rejects.toMatchObject({ safeCode: 'ASR_CANCELLED' });
    await adapter.accept(frame(0, sessionId));
    await adapter.cancel(sessionId);
    expect(factory.connections[0]?.closed).toBe(true);
    factory.connections[0]?.emit(finalSentence('取消后的迟到结果不得进入 sink。'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(results).toHaveLength(0);
    expect(adapter.completeness(sessionId)).toMatchObject({
      status: 'known_unbackfilled_gap',
      stickyDegraded: true,
      unbackfilledGaps: [
        expect.objectContaining({ reason: 'cancelled_unaccounted_pcm', startSequence: 0 }),
      ],
    });
  });

  it('fails closed on a mismatched voice handshake without exposing credentials or the signed URL', async () => {
    const factory = new FixtureFactory({ handshake: 'mismatch' });
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      new StreamingAsrMetrics(),
      factory,
    );
    const error = await adapter.open(openContext('00000000-0000-4000-8000-000000000040')).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ safeCode: 'ASR_PROTOCOL_INVALID' });
    expect(String(error)).toBe('StreamingAsrError: ASR_PROTOCOL_INVALID');
    expect(String(error)).not.toContain('fictional-secret');
    expect(String(error)).not.toContain('signature=');
    expect(factory.connections[0]?.closed).toBe(true);
  });

  it('cancels an in-progress provider handshake when the open scope is revoked', async () => {
    const factory = new FixtureFactory({ handshake: 'none' });
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      new StreamingAsrMetrics(),
      factory,
    );
    const controller = new AbortController();
    const opening = adapter.open({
      ...openContext('00000000-0000-4000-8000-000000000041'),
      signal: controller.signal,
    });
    await waitFor(() => factory.connections.length === 1);
    controller.abort();
    await expect(opening).rejects.toMatchObject({ safeCode: 'ASR_CANCELLED' });
    expect(factory.connections[0]?.closed).toBe(true);
  });

  it('waits for final ingestion before drain and fences all late results after its deadline', async () => {
    let releaseSink = (): void => undefined;
    let markSinkStarted = (): void => undefined;
    const sinkStarted = new Promise<void>((resolve) => {
      markSinkStarted = resolve;
    });
    const sinkBlocked = new Promise<void>((resolve) => {
      releaseSink = resolve;
    });
    const factory = new FixtureFactory();
    const adapter = new TencentRealtimeAsrV2Adapter(config(), new StreamingAsrMetrics(), factory);
    const sessionId = '00000000-0000-4000-8000-000000000050';
    await adapter.open({
      ...openContext(sessionId),
      onResult: async () => {
        markSinkStarted();
        await sinkBlocked;
      },
    });
    await adapter.accept(frame(0, sessionId));
    await adapter.accept(frame(1, sessionId));
    await waitFor(() => factory.connections[0]?.binaryPackets.length === 1);
    factory.connections[0]?.emit(finalSentence('最终落库完成前不得产生 drain receipt。'));
    await sinkStarted;
    let drained = false;
    const drain = adapter.drainAndClose({ lastAudioSequenceAccepted: 1, sessionId }).finally(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);
    releaseSink();
    await expect(drain).resolves.toMatchObject({
      acceptedThroughSequence: 1,
      providerFinalObserved: true,
      resultsIngested: true,
    });

    const deadlineFactory = new FixtureFactory({ finalOnEnd: false });
    const lateResults: StreamingAsrResult[] = [];
    const statuses: string[] = [];
    const deadlineAdapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_DRAIN_TIMEOUT_MS: '20', ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      new StreamingAsrMetrics(),
      deadlineFactory,
    );
    const deadlineSessionId = '00000000-0000-4000-8000-000000000051';
    await deadlineAdapter.open({
      ...openContext(deadlineSessionId, lateResults),
      onStatus: (error) => {
        statuses.push(error.safeCode);
      },
    });
    await deadlineAdapter.accept(frame(0, deadlineSessionId));
    await expect(
      deadlineAdapter.drainAndClose({
        lastAudioSequenceAccepted: 0,
        sessionId: deadlineSessionId,
      }),
    ).rejects.toMatchObject({ safeCode: 'ASR_TIMEOUT' });
    expect(statuses).toEqual(['ASR_TIMEOUT']);
    expect(deadlineFactory.connections[0]?.closed).toBe(true);
    deadlineFactory.connections[0]?.emit(finalSentence('超时 fence 后不得写入。'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lateResults).toHaveLength(0);
  });

  it('routes asynchronous packet send failures through the safe retry and gap state machine', async () => {
    const factory = new FixtureFactory({ failBinaryAt: 0, failBinaryDelayMs: 10 });
    const statuses: string[] = [];
    const metrics = new StreamingAsrMetrics();
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      metrics,
      factory,
    );
    const sessionId = '00000000-0000-4000-8000-000000000060';
    await adapter.open({
      ...openContext(sessionId),
      onStatus: (error) => {
        statuses.push(error.safeCode);
      },
    });
    await adapter.accept(frame(0, sessionId));
    await adapter.accept(frame(1, sessionId));
    await expect(
      adapter.drainAndClose({ lastAudioSequenceAccepted: 1, sessionId }),
    ).rejects.toMatchObject({ safeCode: 'ASR_PROVIDER_UNAVAILABLE' });
    expect(statuses).toEqual(['ASR_PROVIDER_UNAVAILABLE']);
    expect(factory.connections[0]?.closed).toBe(true);
    expect(factory.connections[0]?.binaryPackets).toHaveLength(0);
    expect(metrics.snapshot().counters).toMatchObject({
      asr_pcm_send_attempted_bytes_total: 6_400,
    });
    expect(adapter.completeness(sessionId)).toMatchObject({
      status: 'known_unbackfilled_gap',
      stickyDegraded: true,
    });
  });

  it('contains an initial transport rejection before provider ready without an orphan promise', async () => {
    const factory = new FixtureFactory({ failConnect: true });
    const adapter = new TencentRealtimeAsrV2Adapter(
      config({ ASR_RECONNECT_MAX_ATTEMPTS: '0' }),
      new StreamingAsrMetrics(),
      factory,
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        adapter.open(openContext('00000000-0000-4000-8000-000000000061')),
      ).rejects.toMatchObject({ safeCode: 'ASR_PROVIDER_UNAVAILABLE' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('maps provider errors to safe stable codes and enforces local concurrency/budget ceilings', () => {
    expect(mapTencentError(4002)).toMatchObject({ retryable: false, safeCode: 'ASR_AUTH_FAILED' });
    expect(mapTencentError(4004)).toMatchObject({
      providerCode: 4004,
      retryable: false,
      safeCode: 'ASR_QUOTA_EXHAUSTED',
    });
    expect(mapTencentError(4005)).toMatchObject({
      providerCode: 4005,
      retryable: false,
      safeCode: 'ASR_QUOTA_EXHAUSTED',
    });
    expect(mapTencentError(4006)).toMatchObject({ retryable: true, safeCode: 'ASR_RATE_LIMITED' });
    expect(mapTencentError(4007)).toMatchObject({ safeCode: 'ASR_AUDIO_INVALID' });
    expect(mapTencentError(5001)).toMatchObject({
      retryable: true,
      safeCode: 'ASR_PROVIDER_UNAVAILABLE',
    });
    const ledger = new TencentAsrBudgetLedger(2, 2, 5);
    ledger.acquire();
    ledger.acquire();
    expect(() => {
      ledger.acquire();
    }).toThrow('ASR_QUOTA_EXHAUSTED');
    ledger.release(32_000);
    ledger.release(32_000);
    expect(() => {
      ledger.acquire();
    }).toThrow('ASR_QUOTA_EXHAUSTED');
    const chargeLedger = new TencentAsrBudgetLedger(2, 7_200, 5);
    chargeLedger.recordCharge(5);
    expect(() => {
      chargeLedger.acquire();
    }).toThrow('ASR_QUOTA_EXHAUSTED');
  });
});

interface FixtureOptions {
  closeAfterFinal?: boolean;
  failConnect?: boolean;
  failBinaryAt?: number;
  failBinaryDelayMs?: number;
  finalOnEnd?: boolean;
  handshake?: 'mismatch' | 'none' | 'valid';
  successfulBinaryDelayMs?: number;
}

class FixtureFactory implements TencentProtocolConnectionFactory {
  public readonly connections: FixtureConnection[] = [];
  public readonly urls: string[] = [];

  public constructor(private readonly options: FixtureOptions = {}) {}

  public connect(url: string): Promise<TencentProtocolConnection> {
    if (this.options.failConnect === true) {
      return Promise.reject(new StreamingAsrError('network', true, 'ASR_PROVIDER_UNAVAILABLE'));
    }
    const connection = new FixtureConnection(this.options);
    this.connections.push(connection);
    this.urls.push(url);
    const voiceId = new URL(url).searchParams.get('voice_id');
    if (this.options.handshake !== 'none') {
      queueMicrotask(() => {
        connection.emit({
          code: 0,
          voice_id:
            this.options.handshake === 'mismatch'
              ? '00000000-0000-4000-8000-000000000099'
              : voiceId,
        });
      });
    }
    return Promise.resolve(connection);
  }
}

class FixtureConnection implements TencentProtocolConnection {
  public readonly binaryPackets: Uint8Array[] = [];
  public readonly binarySentAt: number[] = [];
  public readonly texts: string[] = [];
  public closed = false;
  private readonly closeListeners: Array<(code?: number) => void> = [];
  private readonly errorListeners: Array<(error: unknown) => void> = [];
  private readonly messages: Array<(message: string) => void> = [];
  private readonly pending: string[] = [];

  public constructor(private readonly options: FixtureOptions = {}) {}

  public close(): void {
    this.closed = true;
  }

  public closeFromProvider(code?: number): void {
    for (const listener of this.closeListeners) listener(code);
  }

  public emit(message: object): void {
    const serialized = JSON.stringify(message);
    if (this.messages.length === 0) this.pending.push(serialized);
    else for (const listener of this.messages) listener(serialized);
  }

  public onClose(listener: (code?: number) => void): void {
    this.closeListeners.push(listener);
  }

  public onError(listener: (error: unknown) => void): void {
    this.errorListeners.push(listener);
  }

  public onMessage(listener: (message: string) => void): void {
    this.messages.push(listener);
    for (const message of this.pending.splice(0)) listener(message);
  }

  public sendBinary(data: Uint8Array): Promise<void> {
    if (this.binaryPackets.length === this.options.failBinaryAt) {
      const error = new Error('provider transport detail must be redacted');
      if (this.options.failBinaryDelayMs !== undefined) {
        return new Promise((_, reject) => {
          setTimeout(() => {
            reject(error);
          }, this.options.failBinaryDelayMs);
        });
      }
      return Promise.reject(error);
    }
    this.binarySentAt.push(Date.now());
    this.binaryPackets.push(new Uint8Array(data));
    if (this.options.successfulBinaryDelayMs !== undefined) {
      return new Promise((resolve) => {
        setTimeout(resolve, this.options.successfulBinaryDelayMs);
      });
    }
    return Promise.resolve();
  }

  public sendText(data: string): Promise<void> {
    this.texts.push(data);
    if (data === JSON.stringify({ type: 'end' }) && this.options.finalOnEnd !== false) {
      queueMicrotask(() => {
        this.emit({ code: 0, final: 1 });
        if (this.options.closeAfterFinal === true) this.closeFromProvider(1000);
      });
    }
    return Promise.resolve();
  }
}

function config(overrides: NodeJS.ProcessEnv = {}): ReturnType<typeof loadApiConfig> {
  return loadApiConfig({
    AI_RETENTION_CLEANUP_PEPPER: 'fictional-retention-pepper',
    APP_ENV: 'test',
    ASR_PROVIDER: 'tencent_realtime_asr_v2',
    AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
    AUTH_LOGIN_THROTTLE_PEPPER: 'fictional-auth-throttle-pepper',
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5433/fixture',
    TENCENT_ASR_APP_ID: '1250000000',
    TENCENT_ASR_SECRET_ID: 'fictional-secret-id',
    TENCENT_ASR_SECRET_KEY: 'fictional-secret-key',
    ...overrides,
  });
}

function openContext(
  sessionId: string,
  results: StreamingAsrResult[] = [],
): Parameters<TencentRealtimeAsrV2Adapter['open']>[0] {
  return {
    initialSpeakerStreamId: '00000000-0000-4000-8000-000000000011',
    onAttempt: () => Promise.resolve(),
    onResult: (result): Promise<void> => {
      results.push(result);
      return Promise.resolve();
    },
    rotateSpeakerStream: () => Promise.resolve('00000000-0000-4000-8000-000000000012'),
    sessionId,
  };
}

function frame(
  sequence: number,
  sessionId = '00000000-0000-4000-8000-000000000010',
): Parameters<TencentRealtimeAsrV2Adapter['accept']>[0] {
  const bytes = Buffer.alloc(3_200, sequence + 1);
  return {
    frame: {
      audio_stream_id: '00000000-0000-4000-8000-000000000099',
      channels: 1,
      encoding: 'pcm_s16le',
      end_ms: (sequence + 1) * 100,
      pcm_base64: bytes.toString('base64'),
      pcm_sha256: createHash('sha256').update(bytes).digest('hex'),
      sample_rate_hz: 16_000,
      sequence_no: sequence,
      start_ms: sequence * 100,
    },
    sessionId,
    signal: new AbortController().signal,
  };
}

function finalSentence(text: string): object {
  return {
    code: 0,
    message_id: randomUUID(),
    result: {
      sentences: [
        {
          end_time: 100,
          sentence: text,
          sentence_id: 0,
          sentence_type: 1,
          speaker_id: 0,
          start_time: 0,
        },
      ],
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Fixture condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
