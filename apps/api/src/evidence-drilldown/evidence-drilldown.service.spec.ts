import { describe, expect, it } from 'vitest';

import type { AiOutputEligibilityService } from '../ai-runtime/ai-output-eligibility.service.js';
import type { AiPolicyService } from '../ai-runtime/ai-policy.service.js';
import { effectiveTextDigest } from '../ai-runtime/ai-provenance.js';
import {
  assembleP4ContextV2,
  type P4AssemblyMember,
  type P4AssemblyInput,
  type P4ContextV2,
  type P4TranscriptSegment,
} from '../memory/p4-context-v2-assembly.js';
import { EvidenceDrilldownReader } from './evidence-drilldown.reader.js';
import { EvidenceDrilldownService } from './evidence-drilldown.service.js';
import type {
  EvidenceMemoryRecord,
  EvidenceRequestEnvelope,
  EvidenceTranscriptRecord,
} from './evidence-drilldown.types.js';

const UUID = {
  actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  project: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  session: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  thread: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  memory: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  authority: '11111111-1111-4111-8111-111111111111',
  revision: '22222222-2222-4222-8222-222222222222',
  segment1: '33333333-3333-4333-8333-333333333333',
  segment2: '44444444-4444-4444-8444-444444444444',
  segment3: '55555555-5555-4555-8555-555555555555',
  segment4: '88888888-8888-4888-8888-888888888888',
};

describe('EvidenceDrilldownService', () => {
  it('returns authorized memory evidence with bounded neighboring context', async () => {
    const fixture = createFixture();
    const result = await fixture.service.getMemoryEvidence(
      fixture.memoryRequest(),
      fixture.runtime,
    );

    expect(result.message_type).toBe('result');
    if (result.message_type !== 'result') return;
    expect(result.result.result_type).toBe('memory_evidence');
    if (result.result.result_type !== 'memory_evidence') return;
    expect(result.result.evidence[0]?.source.text).toBe('Harbor evidence from elder.');
    expect(result.result.evidence[0]?.neighboring_context.before[0]?.text).toBe('Before detail.');
    expect(result.result.evidence[0]?.neighboring_context.after[0]?.text).toBe('After detail.');
    expect(result.result.evidence[0]?.source.source_fence).toEqual({
      authorization: { scope: 'p4-frozen-project-session-scope', status: 'authorized' },
      deletion: { fence_revision: 7, status: 'not-deleted' },
      retention: { policy_revision: '3', status: 'eligible' },
    });
  });

  it('fails closed for non-member memory IDs without reading storage', async () => {
    const fixture = createFixture();
    const result = await fixture.service.getMemoryEvidence(
      fixture.memoryRequest({ request: { memory_id: '66666666-6666-4666-8666-666666666666' } }),
      fixture.runtime,
    );

    expect(result).toMatchObject({
      message_type: 'error',
      error: { error_code: 'MEMORY_NOT_MEMBER' },
    });
    expect(fixture.reader.memoryReads).toBe(0);
  });

  it('searches only frozen transcript members and orders matches deterministically', async () => {
    const fixture = createFixture();
    fixture.reader.transcriptRows = [...fixture.reader.transcriptRows].reverse();
    const result = await fixture.service.searchTranscript(
      fixture.searchRequest({ query: 'harbor' }),
      fixture.runtime,
    );

    expect(result.message_type).toBe('result');
    if (result.message_type !== 'result' || result.result.result_type !== 'transcript_search')
      return;
    expect(result.result.matches.map((match) => match.source.segment_id)).toEqual([UUID.segment2]);
    expect(result.result.matches[0]?.match_rank).toBe(0);
  });

  it('searches the frozen authorized sessions beyond the recent transcript slice', async () => {
    const fixture = createFixture();
    const result = await fixture.service.searchTranscript(
      fixture.searchRequest({ request: { query: 'older' } }),
      fixture.runtime,
    );

    expect(result).toMatchObject({ message_type: 'result' });
    if (result.message_type !== 'result' || result.result.result_type !== 'transcript_search')
      return;
    expect(result.result.matches.map((match) => match.source.segment_id)).toEqual([UUID.segment4]);
    expect(result.result.matches[0]?.neighboring_context.before.at(-1)?.segment_id).toBe(
      UUID.segment3,
    );
  });

  it('rejects cross-scope sessions, source drift, retention failure and malformed queries', async () => {
    const crossScope = createFixture();
    const crossScopeResult = await crossScope.service.searchTranscript(
      crossScope.searchRequest({
        scope: {
          ...crossScope.searchRequest().scope,
          authorized_session_ids: [UUID.session, '77777777-7777-4777-8777-777777777777'],
        },
      }),
      crossScope.runtime,
    );
    expect(crossScopeResult).toMatchObject({
      message_type: 'error',
      error: { error_code: 'OUT_OF_SCOPE' },
    });

    const drift = createFixture();
    drift.reader.transcriptRows = drift.reader.transcriptRows.map((row) =>
      row.segment_id === UUID.segment2
        ? {
            ...row,
            text: 'Drifted text.',
            effective_text_digest: effectiveTextDigest('Drifted text.'),
          }
        : row,
    );
    const driftResult = await drift.service.searchTranscript(drift.searchRequest(), drift.runtime);
    expect(driftResult).toMatchObject({
      message_type: 'error',
      error: { error_code: 'STALE_SOURCE' },
    });

    const retention = createFixture(false);
    const retentionResult = await retention.service.getMemoryEvidence(
      retention.memoryRequest(),
      retention.runtime,
    );
    expect(retentionResult).toMatchObject({
      message_type: 'error',
      error: { error_code: 'RETENTION_INELIGIBLE' },
    });

    const malformed = createFixture();
    const malformedResult = await malformed.service.searchTranscript(
      malformed.searchRequest({ request: { query: '' } }),
      malformed.runtime,
    );
    expect(malformedResult).toMatchObject({
      message_type: 'error',
      error: { error_code: 'MALFORMED_REQUEST' },
    });

    const secondRound = createFixture();
    const secondRoundResult = await secondRound.service.searchTranscript(
      secondRound.searchRequest({
        round: {
          ...secondRound.searchRequest().round,
          evidence_round: 2,
        },
      }),
      secondRound.runtime,
    );
    expect(secondRoundResult).toMatchObject({
      message_type: 'error',
      error: { error_code: 'ROUND_ALREADY_USED' },
    });
  });

  it('consumes at most one evidence round per generation and performs no writes', async () => {
    const fixture = createFixture();
    const first = await fixture.service.searchTranscript(fixture.searchRequest(), fixture.runtime);
    const second = await fixture.service.searchTranscript(fixture.searchRequest(), fixture.runtime);

    expect(first.message_type).toBe('result');
    expect(second).toMatchObject({
      message_type: 'error',
      error: { error_code: 'ROUND_ALREADY_USED' },
    });
    expect(fixture.reader.writes).toBe(0);
  });
});

class FixtureReader extends EvidenceDrilldownReader {
  public memoryReads = 0;
  public writes = 0;
  public memoryRecord: EvidenceMemoryRecord;
  public transcriptRows: EvidenceTranscriptRecord[];

  public constructor(
    memoryRecord: EvidenceMemoryRecord,
    transcriptRows: EvidenceTranscriptRecord[],
  ) {
    super();
    this.memoryRecord = memoryRecord;
    this.transcriptRows = transcriptRows;
  }

  public override readMemory(): Promise<EvidenceMemoryRecord> {
    this.memoryReads += 1;
    return Promise.resolve(this.memoryRecord);
  }

  public override readTranscript(
    _projectId: string,
    _sessionIds: readonly string[],
    segmentIds: readonly string[] | null,
  ): Promise<readonly EvidenceTranscriptRecord[]> {
    return Promise.resolve(
      segmentIds === null
        ? this.transcriptRows
        : this.transcriptRows.filter((row) => segmentIds.includes(row.segment_id)),
    );
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createFixture(eligible = true) {
  const p4Context = createP4Context();
  const memory = p4Context.active_memory.items[0];
  if (memory === undefined) throw new Error('memory fixture missing');
  const transcriptRows = [
    transcript(UUID.segment1, 0, 'Before detail.'),
    transcript(UUID.segment2, 100, 'Harbor evidence from elder.', 'elder'),
    transcript(UUID.segment3, 200, 'After detail.', 'interviewer'),
    transcript(UUID.segment4, 300, 'Older authorized detail.', 'elder'),
  ];
  const reader = new FixtureReader(
    {
      memory: {
        memory_id: memory.memory_id,
        membership_digest: memory.membership_digest,
        resolution_authority_id: memory.resolution_authority_id,
        revision_id: memory.revision_id,
        revision_no: memory.revision_no,
        semantic_kind: memory.semantic_kind,
        semantic_status: memory.semantic_status,
        source_level: memory.source_level,
      },
      evidence: [
        {
          authority_revision: 1,
          effective_text_digest: effectiveTextDigest('Harbor evidence from elder.'),
          evidence_id: '66666666-6666-4666-8666-666666666666',
          membership_digest: 'a'.repeat(64),
          project_id: UUID.project,
          session_id: UUID.session,
          source_id: UUID.segment2,
          speaker_role_revision: 1,
          text_revision: 1,
        },
      ],
    },
    transcriptRows,
  );
  const policy = {
    assertAllowed: () =>
      Promise.resolve({
        blockedCanonicalKeys: [],
        deletionFenceRevision: 7,
        policyRevision: 7,
        retentionPolicyVersion: 3,
      }),
  } as unknown as AiPolicyService;
  const eligibility = {
    isMemoryResolutionEligible: () => Promise.resolve(eligible),
  } as unknown as AiOutputEligibilityService;
  return {
    memoryRequest: (overrides: Record<string, unknown> = {}): EvidenceRequestEnvelope => ({
      contract_version: 'p5-evidence-drilldown-v1',
      message_type: 'request',
      operation: 'get_memory_evidence',
      request: { memory_id: memory.memory_id },
      request_id: UUID.segment1,
      round: {
        context_digest: p4Context.context_digest,
        evidence_round: 1,
        generation_id: UUID.generation,
        max_evidence_rounds: 1,
        membership_digest: p4Context.membership_digest,
      },
      scope: {
        authorized_session_ids: [UUID.session],
        current_session_id: UUID.session,
        project_id: UUID.project,
        scope_type: 'p4-frozen-project-session-scope',
        source_contract: 'p4-context-freeze-v1',
      },
      ...overrides,
    }),
    p4Context,
    reader,
    runtime: { actorId: UUID.actor, p4Context },
    searchRequest: (overrides: Record<string, unknown> = {}): EvidenceRequestEnvelope => ({
      ...({
        contract_version: 'p5-evidence-drilldown-v1',
        message_type: 'request',
        operation: 'search_transcript',
        request: { query: 'evidence' },
        request_id: UUID.segment3,
        round: {
          context_digest: p4Context.context_digest,
          evidence_round: 1,
          generation_id: UUID.generation,
          max_evidence_rounds: 1,
          membership_digest: p4Context.membership_digest,
        },
        scope: {
          authorized_session_ids: [UUID.session],
          current_session_id: UUID.session,
          project_id: UUID.project,
          scope_type: 'p4-frozen-project-session-scope',
          source_contract: 'p4-context-freeze-v1',
        },
      } satisfies EvidenceRequestEnvelope),
      ...overrides,
    }),
    service: new EvidenceDrilldownService(reader, policy, eligibility),
  };
}

function createP4Context(): P4ContextV2 {
  const segment = (
    id: string,
    startMs: number,
    text: string,
    trustedRole: 'elder' | 'interviewer',
  ): P4TranscriptSegment => ({
    content_kind: 'conversation_final' as const,
    effective_text_digest: effectiveTextDigest(text),
    segment_id: id,
    session_id: UUID.session,
    start_ms: startMs,
    text,
    text_revision: 1,
    speaker_role_revision: 1,
    trusted_role: trustedRole,
  });
  const member = <T>(value: T, inputOrder: number, digest: string): P4AssemblyMember<T> => ({
    input_order: inputOrder,
    source_membership_digest: digest,
    value,
  });
  const emptyThread = {
    items: [],
    source_session_id: null,
    state: 'empty' as const,
    thread_id: null,
    thread_revision: null,
  };
  const input: P4AssemblyInput = {
    active_memory: {
      items: [
        member(
          {
            input_order: 0,
            memory_id: UUID.memory,
            membership_digest: 'b'.repeat(64),
            resolution_authority_id: UUID.authority,
            revision_id: UUID.revision,
            revision_no: 2,
            safe_content: 'synthetic memory',
            semantic_kind: 'episode',
            semantic_status: 'current',
            source_level: 'mid',
          },
          0,
          'b'.repeat(64),
        ),
      ],
      source_session_id: UUID.session,
      state: 'active',
      thread_id: UUID.thread,
      thread_revision: 1,
    },
    actual_asked: [],
    boundaries: [],
    budget: { config_ref: 'synthetic://budget', policy_version: 'p4-priority-budget-v1' },
    current_presentation: null,
    displayed: [],
    interview_state: { goal: 'synthetic', journey_reason_codes: [], journey_stage: 'story_depth' },
    memory_candidates: [],
    policy_revision: 'synthetic-policy-v1',
    question_bank: [],
    recent_transcript: [
      member(segment(UUID.segment1, 0, 'Before detail.', 'elder'), 0, '1'.repeat(64)),
      member(
        segment(UUID.segment2, 100, 'Harbor evidence from elder.', 'elder'),
        1,
        '2'.repeat(64),
      ),
      member(segment(UUID.segment3, 200, 'After detail.', 'interviewer'), 2, '3'.repeat(64)),
    ],
    resumed_memory: emptyThread,
    working_memory: [],
    project_id: UUID.project,
    current_session_id: UUID.session,
  };
  return assembleP4ContextV2(input);
}

function transcript(
  segmentId: string,
  startMs: number,
  text: string,
  trustedRole: 'elder' | 'interviewer' = 'elder',
): EvidenceTranscriptRecord {
  return {
    content_kind: 'conversation',
    effective_text_digest: effectiveTextDigest(text),
    project_id: UUID.project,
    segment_id: segmentId,
    session_id: UUID.session,
    speaker_role_revision: 1,
    start_ms: startMs,
    text,
    text_revision: 1,
    trusted_role: trustedRole,
  };
}
