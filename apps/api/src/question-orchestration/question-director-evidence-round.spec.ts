import { describe, expect, it, vi } from 'vitest';

import { assembleP4DirectorContextV2 } from './p4-context-v2-consumer.js';
import type {
  InterviewDirectorContextV1,
  InterviewDirectorOutputV1,
} from './question-director-contract.js';
import { QuestionDirector, type QuestionDirectorRequest } from './question-director.js';
import {
  runQuestionDirectorEvidenceRound,
  type QuestionDirectorEvidenceCall,
} from './question-director-evidence-round.js';
import {
  EVIDENCE_CONTRACT_VERSION,
  type EvidenceErrorEnvelope,
  type EvidenceRequestEnvelope,
  type EvidenceResultEnvelope,
} from '../evidence-drilldown/evidence-drilldown.types.js';

const ids = {
  actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  project: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  session: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  segment: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};

describe('QuestionDirector evidence round', () => {
  it('preserves the zero-tool path and calls the Director once', async () => {
    const director = new ScriptedDirector([{ decision: 'continue_listening' }]);
    const evidence = evidenceDouble();

    await expect(run(director, evidence)).resolves.toMatchObject({
      decision: 'continue_listening',
    });
    expect(director.calls).toHaveLength(1);
    expect(evidence.getMemoryEvidence).not.toHaveBeenCalled();
    expect(evidence.searchTranscript).not.toHaveBeenCalled();
  });

  it.each([
    ['get_memory_evidence', { memory_id: ids.segment }],
    ['search_transcript', { query: 'harbor' }],
  ] as const)(
    'allows one successful %s round and one final Director call',
    async (operation, request) => {
      const director = new ScriptedDirector([
        { decision: 'request_evidence', evidence: { operation, request } },
        { decision: 'continue_listening' },
      ]);
      const evidence = evidenceDouble();
      const calls: QuestionDirectorEvidenceCall[] = [];

      await expect(run(director, evidence, calls)).resolves.toMatchObject({
        decision: 'continue_listening',
      });
      expect(director.calls).toHaveLength(2);
      expect(director.calls[1]?.evidence?.message_type).toBe('result');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ operation, resultIds: [] });
      expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
      expect(calls[0]?.requestDigest).not.toContain('harbor');
    },
  );

  it('fails closed when a second evidence request is attempted', async () => {
    const director = new ScriptedDirector([
      {
        decision: 'request_evidence',
        evidence: { operation: 'search_transcript', request: { query: 'harbor' } },
      },
      {
        decision: 'request_evidence',
        evidence: { operation: 'search_transcript', request: { query: 'again' } },
      },
    ]);

    await expect(run(director, evidenceDouble())).rejects.toThrow(
      'EVIDENCE_ROUND_RECURSION_FORBIDDEN',
    );
    expect(director.calls).toHaveLength(2);
  });

  it('maps tool errors to SYSTEM_ERROR and never asks for a fallback question', async () => {
    const director = new ScriptedDirector([
      {
        decision: 'request_evidence',
        evidence: { operation: 'search_transcript', request: { query: 'harbor' } },
      },
      { decision: 'continue_listening' },
    ]);
    const evidence = evidenceDouble({ error: 'STALE_SOURCE' });
    const calls: QuestionDirectorEvidenceCall[] = [];

    await expect(run(director, evidence, calls)).rejects.toThrow('EVIDENCE_STALE_SOURCE');
    expect(director.calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 'STALE_SOURCE', resultIds: [] });
  });

  it('rejects a stale result envelope before the final Director call', async () => {
    const director = new ScriptedDirector([
      {
        decision: 'request_evidence',
        evidence: { operation: 'search_transcript', request: { query: 'harbor' } },
      },
      { decision: 'continue_listening' },
    ]);
    const evidence = evidenceDouble({ staleResult: true });

    await expect(run(director, evidence)).rejects.toThrow('EVIDENCE_MALFORMED_RESULT');
    expect(director.calls).toHaveLength(1);
  });
});

class ScriptedDirector extends QuestionDirector {
  public readonly calls: QuestionDirectorRequest[] = [];
  private index = 0;

  public constructor(private readonly outputs: readonly unknown[]) {
    super();
  }

  public override generate(request: QuestionDirectorRequest): Promise<unknown> {
    this.calls.push(request);
    const output = this.outputs[this.index++];
    if (output === undefined) throw new Error('SCRIPT_EXHAUSTED');
    return Promise.resolve(output);
  }
}

function run(
  director: QuestionDirector,
  evidence: ReturnType<typeof evidenceDouble>,
  calls: QuestionDirectorEvidenceCall[] = [],
): Promise<InterviewDirectorOutputV1> {
  const p4Context = assembleP4DirectorContextV2({
    actualAsked: [],
    currentPresentation: null,
    displayed: [],
    goal: 'test',
    journeyReasonCodes: [],
    journeyStage: 'rapport',
    policyRevision: 1,
    projectId: ids.project,
    questionBank: [],
    recentTranscript: [],
    sessionId: ids.session,
  });
  const context: InterviewDirectorContextV1 = {
    actual_asked: [],
    bank_references: [],
    boundaries: [],
    context_schema_version: 'interview-director-context-v1',
    current_memories: [],
    current_presentation: null,
    interview_state: { goal: 'test', journey_reason_codes: [], journey_stage: 'rapport' },
    recent_transcript: [],
    recently_displayed: [],
  };
  return runQuestionDirectorEvidenceRound({
    actorId: ids.actor,
    context,
    director,
    evidence,
    generationId: ids.generation,
    onEvidenceCall: (call) => {
      calls.push(call);
      return Promise.resolve();
    },
    p4Context,
    parseOutput: (value) => value as InterviewDirectorOutputV1,
    prompt: { system: 'test', task: 'test' },
    requestId: ids.actor,
    scopeSessionIds: [ids.session],
  });
}

function evidenceDouble(options: { error?: string; staleResult?: boolean } = {}): {
  getMemoryEvidence: ReturnType<typeof vi.fn>;
  searchTranscript: ReturnType<typeof vi.fn>;
} {
  return {
    getMemoryEvidence: vi.fn((request: EvidenceRequestEnvelope) => response(request, options)),
    searchTranscript: vi.fn((request: EvidenceRequestEnvelope) => response(request, options)),
  };
}

function response(
  request: EvidenceRequestEnvelope,
  options: { error?: string; staleResult?: boolean },
): EvidenceResultEnvelope | EvidenceErrorEnvelope {
  if (options.error !== undefined) {
    return {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      diagnostics: {
        duration_ms: 1,
        error_code: options.error as never,
        reference_count: 0,
        result_count: 0,
        stage: 'evidence_drilldown',
      },
      error: {
        error_code: options.error as never,
        generation_outcome: 'SYSTEM_ERROR',
        phase: 'source_fence',
      },
      message_type: 'error',
      operation: request.operation,
      request_id: request.request_id,
      round: request.round,
      scope: request.scope,
    };
  }
  return {
    contract_version: EVIDENCE_CONTRACT_VERSION,
    diagnostics: {
      duration_ms: 1,
      error_code: 'NONE',
      reference_count: 0,
      result_count: 0,
      stage: 'evidence_drilldown',
    },
    message_type: 'result',
    operation: request.operation,
    request_id: options.staleResult ? ids.segment : request.request_id,
    result:
      request.operation === 'get_memory_evidence'
        ? {
            evidence: [],
            memory: {
              membership_digest: request.round.membership_digest,
              memory_id: ids.segment,
              resolution_authority_id: ids.actor,
              revision_id: ids.generation,
              revision_no: 1,
              semantic_kind: 'fact',
              semantic_status: 'current',
              source_level: 'long',
            },
            result_type: 'memory_evidence',
          }
        : {
            match_state: 'no_match',
            matches: [],
            query: 'harbor',
            result_type: 'transcript_search',
          },
    round: request.round,
    scope: request.scope,
  };
}
