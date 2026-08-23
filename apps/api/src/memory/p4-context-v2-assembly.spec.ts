import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  assembleP4ContextV2,
  P4ContextAssemblyError,
  type P4AssemblyInput,
  type P4AssemblyMember,
  type P4ContextV2,
  validateP4ContextV2,
} from './p4-context-v2-assembly.js';

describe('P4 Context V2 deterministic assembly boundary', () => {
  it('assembles a schema-valid source-complete context reproducibly', () => {
    const input = syntheticInput();
    const first = assembleP4ContextV2(input);
    const second = assembleP4ContextV2(reverseOrderedInputs(input));

    expect(first).toEqual(second);
    expect(first.membership.sections).toHaveLength(11);
    expect(
      first.membership.sections.map(({ expected_member_count }) => expected_member_count),
    ).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
    expect(first.membership_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.context_digest).toMatch(/^[a-f0-9]{64}$/u);
    validateP4ContextV2(first);
    expect(validateSchema(first)).toBe(true);
  });

  it('preserves revisions and evidence references without copying evidence bodies', () => {
    const input = syntheticInput();
    const context = assembleP4ContextV2(input);

    expect(context.working_memory.items[0]?.evidence).toEqual([
      {
        segment_id: UUID.segment,
        text_revision: 2,
        speaker_role_revision: 3,
        effective_text_digest: 'c'.repeat(64),
        order: 0,
      },
    ]);
    expect(context.boundaries[0]).toEqual({
      id: UUID.boundary,
      code: 'do_not_ask',
      abstract_scope: 'synthetic protected topic',
      status: 'active',
      revision: 4,
      content_policy: 'control-only-no-source-text',
    });
    expect(context.boundaries[0]).not.toHaveProperty('evidence');
    expect(context.memory_candidates[0]).not.toHaveProperty('provider_payload');
    expect(context.membership.sections[1]?.entries[0]?.source_revision).toBe(7);
    expect(context.membership.sections[4]?.entries[0]?.source_revision).toBe(2);
    expect(context.membership.sections[5]?.entries[0]?.source_revision).toBe(5);
    expect(Object.isFrozen(input.working_memory[0])).toBe(false);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.membership.sections)).toBe(true);
  });

  it('fails closed when frozen membership or source revision changes', () => {
    const original = assembleP4ContextV2(syntheticInput());
    const changedRevision = clone(original);
    changedRevision.working_memory.items[0] = {
      ...changedRevision.working_memory.items[0],
      revision: 8,
    };
    expect(() => {
      validateP4ContextV2(changedRevision);
    }).toThrow(new P4ContextAssemblyError('P4_MEMBERSHIP_REVISION_MISMATCH'));

    const missingSection = clone(original);
    missingSection.membership.sections = missingSection.membership.sections.slice(0, 10);
    expect(() => {
      validateP4ContextV2(missingSection);
    }).toThrow(new P4ContextAssemblyError('P4_MEMBERSHIP_SECTION_OMITTED'));

    const changedDigest = clone(original);
    changedDigest.membership.sections[4].entries[0].content_digest = 'f'.repeat(64);
    expect(() => {
      validateP4ContextV2(changedDigest);
    }).toThrow(new P4ContextAssemblyError('P4_MEMBERSHIP_CONTENT_DIGEST_MISMATCH'));
  });

  it('keeps active and resumed thread domains independent, including explicit empty state', () => {
    const context = assembleP4ContextV2(syntheticInput());

    expect(context.active_memory.state).toBe('active');
    expect(context.active_memory.thread_id).toBe(UUID.activeThread);
    expect(context.resumed_memory.state).toBe('empty');
    expect(context.resumed_memory.thread_id).toBeNull();
    expect(context.resumed_memory.items).toEqual([]);

    const invalid = syntheticInput();
    invalid.active_memory = { ...invalid.active_memory, state: 'resumed' };
    expect(() => assembleP4ContextV2(invalid)).toThrow(
      new P4ContextAssemblyError('P4_ACTIVE_STATE_MISMATCH'),
    );
  });
});

const UUID = {
  project: '11111111-1111-4111-8111-111111111111',
  session: '22222222-2222-4222-8222-222222222222',
  activeThread: '33333333-3333-4333-8333-333333333333',
  working: '44444444-4444-4444-8444-444444444444',
  segment: '55555555-5555-4555-8555-555555555555',
  memory: '66666666-6666-4666-8666-666666666666',
  authority: '77777777-7777-4777-8777-777777777777',
  revision: '88888888-8888-4888-8888-888888888888',
  boundary: '99999999-9999-4999-8999-999999999999',
  question: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  snapshot: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  bank: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

function syntheticInput(): P4AssemblyInput {
  return {
    project_id: UUID.project,
    current_session_id: UUID.session,
    interview_state: {
      journey_stage: 'story_depth',
      journey_reason_codes: ['current_thread', 'recent_detail'],
      goal: '沿着当前故事主线深入一个具体片段。',
    },
    working_memory: [
      member(
        {
          id: UUID.working,
          canonical_key: 'episode:school',
          memory_type: 'episode',
          value: 'synthetic working value',
          value_kind: 'exact',
          layer: 'working',
          status: 'current',
          revision: 7,
          thread_id: UUID.activeThread,
          evidence: [
            {
              segment_id: UUID.segment,
              text_revision: 2,
              speaker_role_revision: 3,
              effective_text_digest: 'c'.repeat(64),
              order: 0,
            },
          ],
        },
        1,
        '1'.repeat(64),
      ),
    ],
    active_memory: {
      state: 'active',
      thread_id: UUID.activeThread,
      thread_revision: 6,
      source_session_id: UUID.session,
      items: [
        member(
          {
            memory_id: UUID.memory,
            resolution_authority_id: UUID.authority,
            revision_id: UUID.revision,
            revision_no: 5,
            source_level: 'mid',
            semantic_kind: 'episode',
            semantic_status: 'current',
            safe_content: 'synthetic active memory',
            membership_digest: '2'.repeat(64),
            input_order: 2,
          },
          2,
          '2'.repeat(64),
        ),
      ],
    },
    resumed_memory: {
      state: 'empty',
      thread_id: null,
      thread_revision: null,
      source_session_id: null,
      items: [],
    },
    recent_transcript: [
      member(
        {
          segment_id: UUID.segment,
          session_id: UUID.session,
          start_ms: 1200,
          text: 'synthetic elder final',
          trusted_role: 'elder',
          content_kind: 'conversation_final',
          text_revision: 2,
          speaker_role_revision: 3,
          effective_text_digest: 'c'.repeat(64),
        },
        3,
        '3'.repeat(64),
      ),
    ],
    memory_candidates: [
      member(
        {
          memory_id: UUID.memory,
          resolution_authority_id: UUID.authority,
          revision_id: UUID.revision,
          revision_no: 5,
          source_level: 'mid',
          semantic_kind: 'episode',
          semantic_status: 'current',
          safe_content: 'synthetic candidate content',
          retrieval_sources: ['embedding', 'graph'],
          embedding_score: 0.9,
          graph_distance: 1,
          rank: 0,
        },
        4,
        '4'.repeat(64),
      ),
    ],
    boundaries: [
      member(
        {
          id: UUID.boundary,
          code: 'do_not_ask',
          abstract_scope: 'synthetic protected topic',
          status: 'active',
          revision: 4,
          content_policy: 'control-only-no-source-text',
        },
        5,
        '5'.repeat(64),
      ),
    ],
    actual_asked: [
      member(
        {
          actual_question_id: UUID.question,
          text: 'synthetic actual question',
          source: 'interviewer_spontaneous',
          evidence_segment_ids: [UUID.segment],
        },
        6,
        '6'.repeat(64),
      ),
    ],
    displayed: [
      member(
        {
          snapshot_id: UUID.snapshot,
          text: 'synthetic displayed question',
          display_sequence: 1,
          outcome: 'actual_asked',
          actual_question_id: UUID.question,
        },
        7,
        '7'.repeat(64),
      ),
    ],
    question_bank: [
      member(
        {
          question_bank_item_id: UUID.bank,
          bank: 'deep',
          topic: 'synthetic topic',
          question_text: 'synthetic bank question',
          purpose: 'detail',
          sensitivity: 'low',
          bank_version: 'synthetic-1',
        },
        8,
        '8'.repeat(64),
      ),
    ],
    current_presentation: member(
      {
        snapshot_id: UUID.snapshot,
        text: 'synthetic displayed question',
        display_sequence: 1,
      },
      9,
      '9'.repeat(64),
    ),
    budget: {
      config_ref: 'synthetic://p4/budget/profile-1',
      policy_version: 'p4-priority-budget-v1',
    },
    policy_revision: 'synthetic-policy-v1',
  };
}

function member<T>(
  value: T,
  input_order: number,
  source_membership_digest: string,
): P4AssemblyMember<T> {
  return { value, input_order, source_membership_digest };
}

function reverseOrderedInputs(input: P4AssemblyInput): P4AssemblyInput {
  return {
    ...input,
    working_memory: [...input.working_memory].reverse(),
    recent_transcript: [...input.recent_transcript].reverse(),
    memory_candidates: [...input.memory_candidates].reverse(),
    boundaries: [...input.boundaries].reverse(),
    actual_asked: [...input.actual_asked].reverse(),
    displayed: [...input.displayed].reverse(),
    question_bank: [...input.question_bank].reverse(),
    active_memory: {
      ...input.active_memory,
      items: [...input.active_memory.items].reverse(),
    },
  };
}

function clone(context: P4ContextV2): P4ContextV2 {
  return JSON.parse(JSON.stringify(context)) as P4ContextV2;
}

function validateSchema(context: P4ContextV2): boolean {
  const schema = JSON.parse(
    readFileSync(
      join(process.cwd(), 'docs/contracts/interview-director-context-v2.schema.json'),
      'utf8',
    ),
  ) as object;
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    compile: (schema: object) => (value: unknown) => boolean;
  };
  return new AjvConstructor({ allErrors: true, strict: false }).compile(schema)(context);
}
