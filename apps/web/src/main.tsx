import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { AudioBrowserHarness } from './audio/audio-browser-harness.js';
import { BrowserCaptureCoreHarness } from './audio/browser-capture-core-harness.js';
import { RealtimeTranscriptionHarness } from './realtime-transcription/realtime-harness.js';
import { InterviewCaptureControllerHarness } from './interview/interview-capture-controller-harness.js';
import { SuggestionPanelHarness } from './interview/suggestion-panel-harness.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) {
  throw new Error('Web root element is missing');
}

const search = new URLSearchParams(globalThis.location.search);
const audioHarnessEnabled = search.get('audio_harness') === '1';
const audioHarnessSession = search.get('session_id')?.trim() || 'dev003a-audio-harness';
const audioHarnessProject = search.get('project_id')?.trim() || null;
const captureCoreHarnessEnabled = search.get('capture_core_harness') === '1';
const realtimeHarnessEnabled = search.get('realtime_harness') === '1';
const realtimeHarnessSession = search.get('session_id')?.trim() || null;
const interviewControllerHarnessEnabled = search.get('interview_controller_harness') === '1';
const suggestionHarnessEnabled = search.get('suggestion_harness') === '1';
const interviewControllerProject =
  search.get('project_id')?.trim() || '11111111-1111-4111-8111-111111111111';

createRoot(root).render(
  <StrictMode>
    {suggestionHarnessEnabled ? (
      <SuggestionPanelHarness />
    ) : interviewControllerHarnessEnabled ? (
      <InterviewCaptureControllerHarness
        projectId={interviewControllerProject}
        sessionId={audioHarnessSession}
      />
    ) : captureCoreHarnessEnabled ? (
      <BrowserCaptureCoreHarness sessionId={audioHarnessSession} />
    ) : realtimeHarnessEnabled && realtimeHarnessSession !== null ? (
      <RealtimeTranscriptionHarness sessionId={realtimeHarnessSession} />
    ) : audioHarnessEnabled ? (
      <AudioBrowserHarness projectId={audioHarnessProject} sessionId={audioHarnessSession} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
