import WebSocket from 'ws';

const versionResponse = await fetch('http://127.0.0.1:9222/json/version');
if (!versionResponse.ok) throw new Error(`CDP version failed: ${versionResponse.status}`);
const version = await versionResponse.json();
if (typeof version.webSocketDebuggerUrl !== 'string') {
  throw new Error('CDP browser endpoint missing');
}

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP browser connect timeout')), 10_000);
  socket.once('open', () => {
    clearTimeout(timer);
    resolve();
  });
  socket.once('error', reject);
});

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP target create timeout')), 10_000);
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.error === undefined) resolve(message.result);
    else reject(new Error(message.error.message ?? 'CDP target create failed'));
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Target.createTarget',
      params: { url: 'http://127.0.0.1:4176/' },
    }),
  );
});

socket.close();
process.stdout.write(`${JSON.stringify({ created: typeof result.targetId === 'string' })}\n`);
process.exit(0);
