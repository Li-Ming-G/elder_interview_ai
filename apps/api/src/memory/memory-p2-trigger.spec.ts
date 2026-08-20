import { describe, expect, it } from 'vitest';

import type { MemoryP2TriggerRequest } from './memory-p2-runtime.types.js';
import { buildMemoryP2Trigger } from './memory-p2-trigger.js';

describe('buildMemoryP2Trigger', () => {
  it('builds stable online trigger/request identities and rebases on changed authority', () => {
    const request = onlineRequest();
    const first = buildMemoryP2Trigger(request);
    const duplicate = buildMemoryP2Trigger(structuredClone(request));
    const rebased = buildMemoryP2Trigger({ ...request, sourceSnapshotRevision: 3 });

    expect(duplicate).toEqual(first);
    expect(rebased.triggerIdentity).not.toBe(first.triggerIdentity);
    expect(first.jobKind).toBe('mid_online');
  });

  it('binds a retry request to the direct terminal predecessor without changing the trigger', () => {
    const first = buildMemoryP2Trigger(onlineRequest());
    const retry = buildMemoryP2Trigger({
      ...onlineRequest(),
      retryOf: { attemptNo: 1, jobId: 'job:one', status: 'unavailable' },
    });

    expect(retry.attemptNo).toBe(2);
    expect(retry.triggerIdentity).toBe(first.triggerIdentity);
    expect(retry.requestIdentity).not.toBe(first.requestIdentity);
  });

  it('requires a P1 v1.2 terminal and tail manifest for final flush', () => {
    expect(() =>
      buildMemoryP2Trigger({
        ...onlineRequest(),
        kind: 'session_final_flush',
      }),
    ).toThrow('P2_FINAL_SOURCE_REQUIRED');

    const final = buildMemoryP2Trigger({
      ...onlineRequest(),
      finalTailManifestHash: 'f'.repeat(64),
      kind: 'session_final_flush',
      p1TerminalJobId: 'p1:terminal',
    });
    expect(final.jobKind).toBe('mid_final');
  });

  it('refuses a legacy P1 source contract', () => {
    expect(() =>
      buildMemoryP2Trigger({
        ...onlineRequest(),
        p1SourceContractVersion: 'memory-maintainer-v1.1',
      } as unknown as MemoryP2TriggerRequest),
    ).toThrow('P2_P1_SOURCE_VERSION_INVALID');
  });

  it('rejects a non-terminal retry predecessor at runtime', () => {
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
    kind: 'semantic_park',
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
