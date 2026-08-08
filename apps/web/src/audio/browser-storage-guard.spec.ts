// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { BrowserStorageGuard } from './browser-storage-guard.js';
import { AudioBufferCapacityError } from './errors.js';

describe('BrowserStorageGuard', () => {
  it('runs the IndexedDB canary before assessing configurable capacity thresholds', async () => {
    const runCanary = vi.fn().mockResolvedValue(undefined);
    const guard = new BrowserStorageGuard({
      criticalAvailableBytes: 10,
      estimate: (): Promise<StorageEstimate> => Promise.resolve({ quota: 100, usage: 70 }),
      recommendedAvailableBytes: 40,
      runCanary,
    });

    await expect(guard.assertCanStart()).resolves.toEqual({
      availableBytes: 30,
      recommendedCapacityAvailable: false,
    });
    expect(runCanary).toHaveBeenCalledOnce();
  });

  it('fails visibly at the critical threshold', async () => {
    const guard = new BrowserStorageGuard({
      criticalAvailableBytes: 20,
      estimate: (): Promise<StorageEstimate> => Promise.resolve({ quota: 100, usage: 80 }),
      recommendedAvailableBytes: 40,
      runCanary: (): Promise<void> => Promise.resolve(),
    });

    await expect(guard.assertCanStart()).rejects.toBeInstanceOf(AudioBufferCapacityError);
  });
});
