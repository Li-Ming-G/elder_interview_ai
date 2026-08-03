// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AudioCapturePanel } from './audio-capture-panel.js';
import { AudioChunkQueue } from './audio-chunk-queue.js';
import { BrowserAudioRecorder } from './browser-audio-recorder.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';

describe('AudioCapturePanel', () => {
  afterEach(cleanup);

  it('keeps the recording control disabled while the external gate denies recording', () => {
    const recorder = new BrowserAudioRecorder(
      new AudioChunkQueue(new InMemoryAudioChunkStore(), {
        checksum: (): Promise<string> => Promise.resolve('checksum'),
        maximumBufferedBytes: 1024,
      }),
      { timesliceMs: 1000 },
    );

    render(
      <AudioCapturePanel
        context={{ canRecord: false, sessionId: 'fictional-session' }}
        recorder={recorder}
      />,
    );

    expect(screen.getByRole('button', { name: '开始测试录音' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('alert').textContent).toContain('外部授权门禁尚未允许录音');
  });
});
