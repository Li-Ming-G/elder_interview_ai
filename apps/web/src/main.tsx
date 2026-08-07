import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { AudioBrowserHarness } from './audio/audio-browser-harness.js';
import { RealtimeTranscriptionHarness } from './realtime-transcription/realtime-harness.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) {
  throw new Error('Web root element is missing');
}

const search = new URLSearchParams(globalThis.location.search);
const audioHarnessEnabled = search.get('audio_harness') === '1';
const audioHarnessSession = search.get('session_id')?.trim() || 'dev003a-audio-harness';
const audioHarnessProject = search.get('project_id')?.trim() || null;
const realtimeHarnessEnabled = search.get('realtime_harness') === '1';
const realtimeHarnessSession = search.get('session_id')?.trim() || null;

createRoot(root).render(
  <StrictMode>
    {realtimeHarnessEnabled && realtimeHarnessSession !== null ? (
      <RealtimeTranscriptionHarness sessionId={realtimeHarnessSession} />
    ) : audioHarnessEnabled ? (
      <AudioBrowserHarness projectId={audioHarnessProject} sessionId={audioHarnessSession} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
