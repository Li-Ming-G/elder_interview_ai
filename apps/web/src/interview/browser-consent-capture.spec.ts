// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserAudioRecorder } from '../audio/browser-audio-recorder.js';
import { BrowserConsentCapture } from './browser-consent-capture.js';

describe('BrowserConsentCapture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('disposes once, stops the recorder, and rejects reuse of the released lifecycle', async () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (): boolean => true });
    const stop = vi.spyOn(BrowserAudioRecorder.prototype, 'stop').mockResolvedValue([]);
    const capture = new BrowserConsentCapture();
    const listener = vi.fn();
    capture.subscribe(listener);

    const first = capture.dispose();
    const second = capture.dispose();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => capture.subscribe(vi.fn())).toThrow('CONSENT_AUDIO_CAPTURE_DISPOSED');
  });
});
