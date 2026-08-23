import { canonicalJson, sha256 } from '../ai-runtime/ai-provenance.js';
import type { EvidenceDrilldownRuntimeScope } from '../evidence-drilldown/evidence-drilldown.types.js';
import {
  EVIDENCE_CONTRACT_VERSION,
  EVIDENCE_SCOPE_TYPE,
  EVIDENCE_SOURCE_CONTRACT,
  type EvidenceErrorEnvelope,
  type EvidenceRequestEnvelope,
  type EvidenceResultEnvelope,
} from '../evidence-drilldown/evidence-drilldown.types.js';
import type { P4ContextV2 } from '../memory/p4-context-v2-assembly.js';
import {
  type InterviewDirectorContextV1,
  type InterviewDirectorOutputV1,
} from './question-director-contract.js';
import {
  type QuestionDirector,
  type QuestionDirectorEvidenceRequest,
  type QuestionDirectorRequest,
} from './question-director.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface QuestionDirectorEvidenceRoundInput {
  actorId: string;
  context: InterviewDirectorContextV1;
  director: QuestionDirector;
  evidence: {
    getMemoryEvidence(
      request: unknown,
      runtime: EvidenceDrilldownRuntimeScope,
    ): Promise<EvidenceResultEnvelope | EvidenceErrorEnvelope>;
    searchTranscript(
      request: unknown,
      runtime: EvidenceDrilldownRuntimeScope,
    ): Promise<EvidenceResultEnvelope | EvidenceErrorEnvelope>;
  };
  generationId: string;
  p4Context: P4ContextV2;
  prompt: QuestionDirectorRequest['prompt'];
  requestId: string;
  scopeSessionIds: readonly string[];
  parseOutput(value: unknown): InterviewDirectorOutputV1;
  onEvidenceCall(call: QuestionDirectorEvidenceCall): Promise<void>;
}

export interface QuestionDirectorEvidenceCall {
  durationMs: number;
  operation: 'get_memory_evidence' | 'search_transcript';
  targetId: string;
  resultIds: readonly string[];
  status: string;
  requestDigest: string;
  resultDigest: string | null;
}

export async function runQuestionDirectorEvidenceRound(
  input: QuestionDirectorEvidenceRoundInput,
): Promise<InterviewDirectorOutputV1> {
  const consumeEvidenceRound = createEvidenceRoundGuard();
  const first = await input.director.generate({
    context: input.context,
    prompt: input.prompt,
  });
  const request = asEvidenceRequest(first);
  if (request === null) return input.parseOutput(first);

  consumeEvidenceRound();
  const envelope = buildEvidenceRequest(input, request);
  const started = Date.now();
  const result =
    request.evidence.operation === 'get_memory_evidence'
      ? await input.evidence.getMemoryEvidence(envelope, {
          actorId: input.actorId,
          p4Context: input.p4Context,
        })
      : await input.evidence.searchTranscript(envelope, {
          actorId: input.actorId,
          p4Context: input.p4Context,
        });
  const durationMs = Math.max(0, Date.now() - started);
  const call = evidenceCall(envelope, result, durationMs);
  if (call.status === 'MALFORMED_RESULT') {
    await input.onEvidenceCall(call);
    throw new Error('EVIDENCE_MALFORMED_RESULT');
  }
  if (result.message_type === 'error') {
    assertEvidenceEnvelopeMatches(envelope, result);
    await input.onEvidenceCall(call);
    throw new Error(`EVIDENCE_${result.error.error_code}`);
  }
  try {
    assertEvidenceEnvelopeMatches(envelope, result);
  } catch (error) {
    await input.onEvidenceCall({ ...call, resultDigest: null, status: 'MALFORMED_RESULT' });
    throw error;
  }
  await input.onEvidenceCall(call);

  const final = await input.director.generate({
    context: input.context,
    evidence: result,
    prompt: input.prompt,
  });
  if (asEvidenceRequest(final) !== null) {
    throw new Error('EVIDENCE_ROUND_RECURSION_FORBIDDEN');
  }
  return input.parseOutput(final);
}

function asEvidenceRequest(value: unknown): QuestionDirectorEvidenceRequest | null {
  if (!isRecord(value) || value.decision !== 'request_evidence' || !isRecord(value.evidence)) {
    return null;
  }
  const evidence = value.evidence;
  if (
    (evidence.operation !== 'get_memory_evidence' && evidence.operation !== 'search_transcript') ||
    !isRecord(evidence.request)
  ) {
    throw new Error('EVIDENCE_MALFORMED_REQUEST');
  }
  const keys = Object.keys(evidence.request);
  if (evidence.operation === 'get_memory_evidence') {
    if (
      keys.length !== 1 ||
      keys[0] !== 'memory_id' ||
      !UUID.test(String(evidence.request.memory_id))
    ) {
      throw new Error('EVIDENCE_MALFORMED_REQUEST');
    }
  } else if (
    keys.length !== 1 ||
    keys[0] !== 'query' ||
    typeof evidence.request.query !== 'string' ||
    evidence.request.query.length < 1 ||
    evidence.request.query.length > 240
  ) {
    throw new Error('EVIDENCE_MALFORMED_REQUEST');
  }
  return value as QuestionDirectorEvidenceRequest;
}

function createEvidenceRoundGuard(): () => number {
  let evidenceRoundCount = 0;
  return () => {
    if (evidenceRoundCount >= 1) throw new Error('EVIDENCE_ROUND_ALREADY_USED');
    evidenceRoundCount += 1;
    return evidenceRoundCount;
  };
}

function buildEvidenceRequest(
  input: QuestionDirectorEvidenceRoundInput,
  request: QuestionDirectorEvidenceRequest,
): EvidenceRequestEnvelope {
  if (
    input.p4Context.project_id !== input.p4Context.freeze.scope.project_id ||
    input.p4Context.current_session_id !== input.p4Context.freeze.scope.current_session_id ||
    !input.scopeSessionIds.includes(input.p4Context.current_session_id)
  ) {
    throw new Error('EVIDENCE_OUT_OF_SCOPE');
  }
  return {
    contract_version: EVIDENCE_CONTRACT_VERSION,
    message_type: 'request',
    operation: request.evidence.operation,
    request: request.evidence.request,
    request_id: stableUuid(`${input.requestId}:evidence:1`),
    round: {
      context_digest: input.p4Context.context_digest,
      evidence_round: 1,
      generation_id: input.generationId,
      max_evidence_rounds: 1,
      membership_digest: input.p4Context.membership_digest,
    },
    scope: {
      authorized_session_ids: [...input.scopeSessionIds],
      current_session_id: input.p4Context.current_session_id,
      project_id: input.p4Context.project_id,
      scope_type: EVIDENCE_SCOPE_TYPE,
      source_contract: EVIDENCE_SOURCE_CONTRACT,
    },
  };
}

function evidenceCall(
  request: EvidenceRequestEnvelope,
  result: EvidenceResultEnvelope | EvidenceErrorEnvelope,
  durationMs: number,
): QuestionDirectorEvidenceCall {
  const messageType = (result as { message_type?: unknown }).message_type;
  const targetId =
    request.operation === 'get_memory_evidence'
      ? (request.request as { memory_id: string }).memory_id
      : stableUuid(sha256(canonicalJson(request.request)));
  if (messageType !== 'result' && messageType !== 'error') {
    return {
      durationMs,
      operation: request.operation,
      requestDigest: sha256(canonicalJson(request)),
      resultDigest: null,
      resultIds: [],
      status: 'MALFORMED_RESULT',
      targetId,
    };
  }
  if (messageType === 'error') {
    const error = (result as { error?: { error_code?: unknown } }).error;
    const errorCode = typeof error?.error_code === 'string' ? error.error_code : null;
    if (errorCode === null) {
      return {
        durationMs,
        operation: request.operation,
        requestDigest: sha256(canonicalJson(request)),
        resultDigest: null,
        resultIds: [],
        status: 'MALFORMED_RESULT',
        targetId,
      };
    }
    return {
      durationMs,
      operation: request.operation,
      requestDigest: sha256(canonicalJson(request)),
      resultDigest: null,
      resultIds: [],
      status: errorCode,
      targetId,
    };
  }
  let resultIds: string[];
  try {
    resultIds = resultReferences(result as EvidenceResultEnvelope);
  } catch {
    return {
      durationMs,
      operation: request.operation,
      requestDigest: sha256(canonicalJson(request)),
      resultDigest: null,
      resultIds: [],
      status: 'MALFORMED_RESULT',
      targetId,
    };
  }
  return {
    durationMs,
    operation: request.operation,
    requestDigest: sha256(canonicalJson(request)),
    resultDigest:
      result.message_type === 'result'
        ? sha256(canonicalJson({ operation: result.operation, resultIds }))
        : null,
    resultIds,
    status: result.message_type === 'result' ? 'succeeded' : result.error.error_code,
    targetId,
  };
}

function resultReferences(result: EvidenceResultEnvelope): string[] {
  const body = result.result as unknown as {
    evidence?: unknown;
    matches?: unknown;
    result_type?: unknown;
  };
  if (body.result_type !== 'memory_evidence' && body.result_type !== 'transcript_search') {
    throw new Error('EVIDENCE_MALFORMED_RESULT');
  }
  const hits = body.result_type === 'memory_evidence' ? body.evidence : body.matches;
  if (!Array.isArray(hits)) throw new Error('EVIDENCE_MALFORMED_RESULT');
  const ids = hits.map((hit: unknown) => {
    if (!isRecord(hit) || !isRecord(hit.source) || typeof hit.source.segment_id !== 'string') {
      throw new Error('EVIDENCE_MALFORMED_RESULT');
    }
    return hit.source.segment_id;
  });
  for (const id of ids) if (!UUID.test(id)) throw new Error('EVIDENCE_MALFORMED_RESULT');
  return [...new Set(ids)];
}

function assertEvidenceEnvelopeMatches(
  request: EvidenceRequestEnvelope,
  result: EvidenceResultEnvelope | EvidenceErrorEnvelope,
): void {
  const messageType = (result as { message_type?: unknown }).message_type;
  if (
    (result as { contract_version?: unknown }).contract_version !== EVIDENCE_CONTRACT_VERSION ||
    (messageType !== 'result' && messageType !== 'error') ||
    result.request_id !== request.request_id ||
    result.operation !== request.operation ||
    JSON.stringify(result.round) !== JSON.stringify(request.round) ||
    JSON.stringify(result.scope) !== JSON.stringify(request.scope)
  ) {
    throw new Error('EVIDENCE_MALFORMED_RESULT');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableUuid(value: string): string {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}
