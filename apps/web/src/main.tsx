import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { AudioBrowserHarness } from './audio/audio-browser-harness.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) {
  throw new Error('Web root element is missing');
}

const search = new URLSearchParams(globalThis.location.search);
const audioHarnessEnabled = search.get('audio_harness') === '1';
const audioHarnessSession = search.get('session_id')?.trim() || 'dev003a-audio-harness';

createRoot(root).render(
  <StrictMode>
    {audioHarnessEnabled ? <AudioBrowserHarness sessionId={audioHarnessSession} /> : <App />}
  </StrictMode>,
);
