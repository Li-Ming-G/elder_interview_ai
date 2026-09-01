// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import {
  canonicalWorkflowPayload,
  IndexedDbNewInterviewWorkflowStore,
} from './new-interview-workflow-store.js';

describe('IndexedDbNewInterviewWorkflowStore', () => {
  it('restores only the current actor active workflow and preserves the stable request identity', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbNewInterviewWorkflowStore(factory);
    const workflow = await first.create('actor-a');
    const requestId = crypto.randomUUID();
    await first.put({
      ...workflow,
      projectAttempt: {
        payload: {
          approximate_age: null,
          birth_year: null,
          current_city: null,
          display_name: '虚构恢复项目',
          native_place: null,
          request_id: requestId,
        },
        requestId,
        response: null,
        state: 'unknown_response',
      },
    });

    const reopened = new IndexedDbNewInterviewWorkflowStore(factory);
    expect((await reopened.getActive('actor-a'))?.projectAttempt).toMatchObject({
      requestId,
      state: 'unknown_response',
    });
    expect(await reopened.getActive('actor-b')).toBeNull();
  });

  it('does not create a second active workflow for the same actor', async () => {
    const store = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await store.create('actor-a');

    await expect(store.create('actor-a')).rejects.toThrow('ACTIVE_NEW_INTERVIEW_WORKFLOW_EXISTS');
    expect(await store.getActive('actor-a')).toMatchObject({
      workflowId: workflow.workflowId,
    });
  });

  it('persists a detached prepare session request until acknowledgement', async () => {
    const store = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const first = await store.getOrCreateDetachedSessionRequestId('actor-a', 'project-a');
    expect(await store.getOrCreateDetachedSessionRequestId('actor-a', 'project-a')).toBe(first);
    expect(await store.getOrCreateDetachedSessionRequestId('actor-b', 'project-a')).not.toBe(first);
    await store.acknowledgeDetachedSession('actor-a', 'project-a');
    expect(await store.getOrCreateDetachedSessionRequestId('actor-a', 'project-a')).not.toBe(first);
  });

  it('freezes the complete next-session payload before networking and reuses it after reopen', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbNewInterviewWorkflowStore(factory);
    const first = await store.getOrCreateNextSessionAttempt(
      'actor-a',
      'project-a',
      '11111111-1111-4111-8111-111111111111',
      1,
    );
    await store.markNextSessionUnknown(first);
    const reopened = new IndexedDbNewInterviewWorkflowStore(factory);
    const attempts = await reopened.listNextSessionAttempts('actor-a');
    expect(attempts).toEqual([
      {
        ...first,
        state: 'unknown_response',
      },
    ]);
    expect(
      await reopened.getOrCreateNextSessionAttempt(
        'actor-a',
        'project-a',
        '22222222-2222-4222-8222-222222222222',
        9,
      ),
    ).toEqual({ ...first, state: 'unknown_response' });
    await reopened.acknowledgeNextSession('actor-a', 'project-a');
    expect(await reopened.listNextSessionAttempts('actor-a')).toEqual([]);
  });

  it('canonicalizes equivalent payloads without request-order guesses', () => {
    expect(canonicalWorkflowPayload({ b: 2, a: { y: 2, x: 1 } })).toBe(
      canonicalWorkflowPayload({ a: { x: 1, y: 2 }, b: 2 }),
    );
  });
});
