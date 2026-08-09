import WebSocket from 'ws';

const action = process.argv[2];
if (!['arm', 'inspect', 'setup', 'summary'].includes(action)) {
  throw new Error('Expected arm, inspect, setup, or summary');
}

const targetsResponse = await fetch('http://127.0.0.1:9222/json/list');
if (!targetsResponse.ok) throw new Error(`CDP target list failed: ${targetsResponse.status}`);
const targets = await targetsResponse.json();
const target = targets.find(
  (candidate) =>
    candidate.type === 'page' &&
    typeof candidate.url === 'string' &&
    candidate.url.startsWith('http://127.0.0.1:4176/'),
);
if (target?.webSocketDebuggerUrl === undefined) throw new Error('Android R4 page target missing');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

let nextId = 1;
const pending = new Map();
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (waiter === undefined) return;
  pending.delete(message.id);
  if (message.error === undefined) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error.message ?? 'CDP command failed'));
});

function command(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(response.exceptionDetails.text ?? 'Android page evaluation failed');
  }
  return response.result.value;
}

await command('Page.enable');
await command('Runtime.enable');

if (action === 'arm') {
  await evaluate(evidenceInitSource());
  process.stdout.write(
    `${JSON.stringify({ action, ...(await evaluate(pageEvidenceExpression())) })}\n`,
  );
} else if (action === 'setup') {
  await command('Page.addScriptToEvaluateOnNewDocument', { source: evidenceInitSource() });
  const setup = await evaluate(`(async () => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store', credentials: 'same-origin' });
    if (!csrfResponse.ok) throw new Error('csrf:' + csrfResponse.status);
    const csrf = (await csrfResponse.json()).csrf_token;
    async function write(path, body) {
      const response = await fetch('/api/v1' + path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        method: 'POST',
      });
      if (!response.ok) throw new Error(path + ':' + response.status);
      return response.json();
    }
    const project = await write('/projects', { display_name: '虚构 R4 Android 真机验收' });
    await write('/projects/' + project.id + '/service-terms', {
      currency: 'CNY', estimated_session_count: 1, expected_current_minutes: 10,
      included_minutes: 60, overtime_price_minor: 0, overtime_unit_minutes: 30,
    });
    await write('/projects/' + project.id + '/consents', {
      consent_audio_object_id: null, consent_method: 'electronic',
      consent_text_version: 'dev005r4-android-fictional-v1',
      consent_type: 'recording_transcription_ai', consented_at: new Date().toISOString(),
    });
    return { projectId: project.id };
  })()`);
  const path = `/projects/${setup.projectId}/interview/prepare`;
  await command('Page.navigate', { url: `http://127.0.0.1:4176${path}` });
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const page = await evaluate(pageEvidenceExpression());
  process.stdout.write(`${JSON.stringify({ action, projectId: setup.projectId, ...page })}\n`);
} else {
  const page = await evaluate(pageEvidenceExpression());
  const r4State = await evaluate(r4StateExpression());
  if (action === 'summary') {
    const evidence = page.evidence;
    process.stdout.write(
      `${JSON.stringify({
        action,
        buttonStates: page.buttonStates,
        evidence:
          evidence === null
            ? null
            : {
                audioSources: evidence.audioSources,
                getUserMediaCount: evidence.getUserMedia.length,
                lastLifecycle: evidence.lifecycle.at(-1) ?? null,
                lastRecorderData: evidence.recorderData.at(-1) ?? null,
                mediaRecorders: evidence.mediaRecorders,
                pcmFirst: evidence.wsAudioFrames[0] ?? null,
                pcmLast: evidence.wsAudioFrames.at(-1) ?? null,
              },
        height: page.height,
        local: r4State.local,
        orientation: page.orientation,
        server: r4State.server,
        url: page.url,
        visibility: page.visibility,
        width: page.width,
      })}\n`,
    );
    socket.close();
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify({ action, ...page, ...r4State })}\n`);
}

socket.close();

function pageEvidenceExpression() {
  return `(() => ({
    buttons: Array.from(document.querySelectorAll('button')).filter((node) => node.offsetParent !== null).map((node) => node.textContent.trim()),
    buttonStates: Array.from(document.querySelectorAll('button')).filter((node) => node.offsetParent !== null).map((node) => ({ disabled: node.disabled, text: node.textContent.trim() })),
    dpr: devicePixelRatio,
    evidence: globalThis.__dev005r4AndroidEvidence ?? null,
    height: innerHeight,
    orientation: screen.orientation?.type ?? null,
    permission: 'permissions' in navigator ? 'queryable' : 'unavailable',
    title: document.title,
    url: location.href,
    visibility: document.visibilityState,
    width: innerWidth,
    statusItems: Array.from(document.querySelectorAll('.status-item')).map((node) => node.textContent.trim()),
  }))()`;
}

function r4StateExpression() {
  return `(async () => {
    const match = location.pathname.match(/\\/interview\\/([^/]+)\\/(?:prepare|workbench)$/);
    if (match === null) return { local: null, server: null };
    const sessionId = match[1];
    const serverResponse = await fetch('/api/v1/sessions/' + sessionId, { cache: 'no-store', credentials: 'same-origin' });
    const serverSession = serverResponse.ok ? await serverResponse.json() : null;
    let database;
    try {
      database = await new Promise((resolve, reject) => {
        const open = indexedDB.open('elder-interview-audio-buffer', 4);
        open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
        open.onsuccess = () => resolve(open.result);
      });
      function readAll(storeName) {
        return new Promise((resolve, reject) => {
          const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onerror = () => reject(request.error ?? new Error(storeName + ' read failed'));
          request.onsuccess = () => resolve(request.result);
        });
      }
      function readOne(storeName, key) {
        return new Promise((resolve, reject) => {
          const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onerror = () => reject(request.error ?? new Error(storeName + ' read failed'));
          request.onsuccess = () => resolve(request.result ?? null);
        });
      }
      const jobId = 'interview-capture:' + sessionId;
      const [archives, deliveries, state, job, checkpoint] = await Promise.all([
        readAll('archive-chunks'), readAll('delivery-queue'), readOne('session-state', sessionId),
        readOne('upload-jobs', jobId), readOne('capture-checkpoints', jobId),
      ]);
      const capture = job?.interviewCapture;
      const local = {
        archiveCount: archives.filter((record) => record.sessionId === sessionId).length,
        archiveHighWater: Number(state?.nextSequenceNo ?? 0) - 1,
        checkpoint: checkpoint === null ? null : {
          audioStreamId: String(checkpoint.audioStreamId), dirty: Boolean(checkpoint.dirty),
          localJobId: String(checkpoint.localJobId), status: String(checkpoint.status),
          timelineEndMs: Number(checkpoint.timelineEndMs),
        },
        deliveryAcknowledgedHighWater: Number(state?.deliveryAcknowledgedHighWaterSequenceNo ?? -1),
        deliveryCount: deliveries.filter((record) => record.sessionId === sessionId).length,
        job: job === null ? null : {
          audioObjectId: typeof job.audioObjectId === 'string' ? job.audioObjectId : null,
          audioStreamId: typeof capture?.audioStreamId === 'string' ? capture.audioStreamId : null,
          generationNo: typeof capture?.generationNo === 'number' ? capture.generationNo : null,
          jobId: String(job.jobId), status: String(job.status),
          timelineOffsetMs: typeof capture?.timelineOffsetMs === 'number' ? capture.timelineOffsetMs : null,
        },
        timelineEndMs: Number(state?.timelineEndMs ?? 0),
      };
      database.close();
      return {
        local,
        server: serverSession === null ? null : {
          capture: serverSession.capture ?? null,
          finalization: serverSession.finalization ?? null,
          id: serverSession.id,
          status: serverSession.status,
        },
      };
    } catch (error) {
      if (database !== undefined) database.close();
      return { local: { error: String(error) }, server: serverSession };
    }
  })()`;
}

function evidenceInitSource() {
  return `(() => {
    const evidence = { audioSources: [], fetches: [], getUserMedia: [], lifecycle: [], mediaRecorders: [], recorderData: [], wsAudioFrames: [] };
    globalThis.__dev005r4AndroidEvidence = evidence;
    const streamKeys = new WeakMap();
    let nextStreamKey = 1;
    function describe(stream) {
      let streamKey = streamKeys.get(stream);
      if (streamKey === undefined) { streamKey = nextStreamKey; nextStreamKey += 1; streamKeys.set(stream, streamKey); }
      return { streamKey, trackId: stream.getAudioTracks()[0]?.id ?? 'no-audio-track' };
    }
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await nativeGetUserMedia(constraints);
      evidence.getUserMedia.push(describe(stream));
      return stream;
    };
    const NativeMediaRecorder = globalThis.MediaRecorder;
    globalThis.MediaRecorder = new Proxy(NativeMediaRecorder, {
      construct(target, argumentsList, newTarget) {
        const recorder = Reflect.construct(target, argumentsList, newTarget);
        const description = describe(argumentsList[0]);
        evidence.mediaRecorders.push(description);
        recorder.addEventListener('dataavailable', (event) => evidence.recorderData.push({ at: performance.now(), size: event.data.size, streamKey: description.streamKey }));
        return recorder;
      },
    });
    const prototype = globalThis.AudioContext.prototype;
    const nativeCreateSource = prototype.createMediaStreamSource;
    prototype.createMediaStreamSource = function (stream) {
      evidence.audioSources.push(describe(stream));
      return nativeCreateSource.call(this, stream);
    };
    const nativeSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data);
          if (message.type === 'audio.frame') evidence.wsAudioFrames.push({ audioStreamId: message.payload.audio_stream_id, endMs: message.payload.end_ms, sequenceNo: message.payload.sequence_no, startMs: message.payload.start_ms });
        } catch {}
      }
      return nativeSend.call(this, data);
    };
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      evidence.fetches.push({ at: performance.now(), method: init?.method ?? (input instanceof Request ? input.method : 'GET'), path: url.pathname });
      return nativeFetch(input, init);
    };
    for (const name of ['orientationchange', 'pagehide', 'pageshow', 'visibilitychange']) {
      globalThis.addEventListener(name, () => evidence.lifecycle.push({ at: performance.now(), name, visibility: document.visibilityState }));
    }
  })();`;
}
