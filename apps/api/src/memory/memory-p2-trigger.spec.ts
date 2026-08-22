import { describe, expect, it } from 'vitest';

import type { MemoryP2TriggerRequest } from './memory-p2-runtime.types.js';
import { buildMemoryP2Trigger } from './memory-p2-trigger.js';

describe('buildMemoryP2Trigger', () => {
  it('coalesces duplicates and changes identity when the frozen source changes', () => {
    const request = onlineRequest();
    const first = buildMemoryP2Trigger(request);
    expect(buildMemoryP2Trigger(structuredClone(request))).toEqual(first);
    expect(
      buildMemoryP2Trigger({ ...request, sourceSnapshotRevision: 3 }).triggerIdentity,
    ).not.toBe(first.triggerIdentity);
  });

  it('binds retry attempts to a terminal direct predecessor', () => {
    const first = buildMemoryP2Trigger(onlineRequest());
    const retry = buildMemoryP2Trigger({
      ...onlineRequest(),
      retryOf: { attemptNo: 1, jobId: 'job:one', status: 'unavailable' },
    });
    expect(retry).toMatchObject({ attemptNo: 2, jobKind: 'mid_online' });
    expect(retry.triggerIdentity).toBe(first.triggerIdentity);
    expect(retry.requestIdentity).not.toBe(first.requestIdentity);
  });

  it('requires a v1.2 P1 terminal and final-tail manifest for final flush', () => {
    expect(() => buildMemoryP2Trigger({ ...onlineRequest(), kind: 'session_final_flush' })).toThrow(
      'P2_FINAL_SOURCE_REQUIRED',
    );
    expect(
      buildMemoryP2Trigger({
        ...onlineRequest(),
        finalTailManifestHash: 'f'.repeat(64),
        kind: 'session_final_flush',
        p1TerminalJobId: 'p1:terminal',
      }).jobKind,
    ).toBe('mid_final');
  });

  it('rejects legacy P1 and non-terminal retry sources', () => {
    expect(() =>
      buildMemoryP2Trigger({
        ...onlineRequest(),
        p1SourceContractVersion: 'memory-maintainer-v1.1',
      } as unknown as MemoryP2TriggerRequest),
    ).toThrow('P2_P1_SOURCE_VERSION_INVALID');
    expect(() =>
      buildMemoryP2Trigger({
        ...onlineRequest(),
        retryOf: { attemptNo: 1, jobId: 'job:running', status: 'running' },
      } as unknown as MemoryP2TriggerRequest),
    ).toThrow('P2_RETRY_PREDECESSOR_INVALID');
  });
});

function onlineRequest(): MemoryP2TriggerRequest {
  return {
    kind: 'capacity_checkpoint',
    p1SourceContractVersion: 'memory-maintainer-v1.2',
    p1TerminalJobId: null,
    policy: {
      aiPolicyRevision: 2,
      deletionScopeDigest: 'd'.repeat(64),
      p2PolicyRevision: 'p2-semantic-v1',
      p2RetentionPolicyVersion: 'r1',
      retentionPolicyVersion: 4,
    },
    projectId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    sourceCheckpointRootIdentity: 'c'.repeat(64),
    sourceManifestHash: 'a'.repeat(64),
    sourceSnapshotId: 'snapshot:one',
    sourceSnapshotRevision: 2,
    targetLayerRootIdentity: 'b'.repeat(64),
    targetRevision: 1,
  };
}
