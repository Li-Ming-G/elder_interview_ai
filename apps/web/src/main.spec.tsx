// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app.js', () => ({
  App: (): React.JSX.Element => <div data-testid="product-entry">real product app</div>,
}));

describe('ordinary web entry', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    globalThis.history.replaceState(null, '', '/');
    vi.resetModules();
  });

  it('always renders the product app when harness query switches are present', async () => {
    globalThis.history.replaceState(
      null,
      '',
      '/?audio_harness=1&capture_core_harness=1&realtime_harness=1&interview_controller_harness=1&suggestion_harness=1',
    );
    document.body.innerHTML = '<div id="root"></div>';

    await import('./main.js');

    expect((await screen.findByTestId('product-entry')).textContent).toBe('real product app');
    expect(screen.queryByTestId('audio-browser-harness')).toBeNull();
    expect(screen.queryByTestId('capture-core-harness')).toBeNull();
    expect(screen.queryByTestId('interview-controller-harness')).toBeNull();
    expect(screen.queryByTestId('suggestion-panel')).toBeNull();
  });
});
