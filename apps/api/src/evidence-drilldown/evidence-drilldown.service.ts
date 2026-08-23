import { Injectable } from '@nestjs/common';

import { AiOutputEligibilityService } from '../ai-runtime/ai-output-eligibility.service.js';
import { AiPolicyService, type AiPolicySnapshot } from '../ai-runtime/ai-policy.service.js';
import { validateP4ContextV2, type P4ContextV2 } from '../memory/p4-context-v2-assembly.js';
import { effectiveTextDigest } from '../ai-runtime/ai-provenance.js';
import { EvidenceDrilldownReader } from './evidence-drilldown.reader.js';
import {
  EVIDENCE_CONTRACT_VERSION,
  EVIDENCE_SCOPE_TYPE,
  EVIDENCE_SOURCE_CONTRACT,
  EVIDENCE_STAGE,
  type EvidenceDiagnostics,
  type EvidenceDrilldownRuntimeScope,
  type EvidenceErrorCode,
  type EvidenceErrorEnvelope,
  type EvidenceErrorPhase,
  type EvidenceHit,
  type EvidenceMemoryReference,
  type EvidenceRequestEnvelope,
  type EvidenceResultEnvelope,
  type EvidenceScope,
  type EvidenceSourceFence,
  type EvidenceTranscriptSegment,
  type EvidenceTranscriptRecord,
} from './evidence-drilldown.types.js';

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';
const ZERO_DIGEST = '0'.repeat(64);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;

@Injectable()
export class EvidenceDrilldownService {
  private readonly usedGenerations = new Set<string>();

  public constructor(
    private readonly reader: EvidenceDrilldownReader,
    private readonly policy: AiPolicyService,
    private readonly eligibility: AiOutputEligibilityService,
  ) {}

  public async getMemoryEvidence(
    request: unknown,
    runtime: EvidenceDrilldownRuntimeScope,
  ): Promise<EvidenceResultEnvelope | EvidenceErrorEnvelope> {
    return this.execute('get_memory_evidence', request, runtime, async (envelope, p4, policy) => {
      const payload = envelope.request as { memory_id: string };
      const member = memoryMember(p4, payload.memory_id);
      if (member === null) throw new EvidenceFailure('MEMORY_NOT_MEMBER', 'membership');
      const record = await this.reader.readMemory(payload.memory_id, envelope.scope.project_id);
      if (record === null || !sameMemory(record.memory, member))
        throw new EvidenceFailure('STALE_SOURCE', 'source_fence');
      if (record.evidence.length > 20)
        throw new EvidenceFailure('MALFORMED_RESULT', 'result_validation');
      if (
        !(await this.eligibility.isMemoryIdentityEligible(
          runtime.actorId,
          envelope.scope.project_id,
          payload.memory_id,
        ))
      )
        throw new EvidenceFailure('RETENTION_INELIGIBLE', 'source_fence');
      const transcript = await this.readAndValidateTranscript(
        envelope.scope.project_id,
        envelope.scope.authorized_session_ids,
        null,
        p4,
        policy,
      );
      const transcriptById = new Map(transcript.map((segment) => [segment.segment_id, segment]));
      const evidence = record.evidence.map((entry) => {
        const source = transcriptById.get(entry.source_id);
        if (
          source === undefined ||
          source.session_id !== entry.session_id ||
          source.text_revision !== entry.text_revision ||
          source.speaker_role_revision !== entry.speaker_role_revision ||
          source.effective_text_digest !== entry.effective_text_digest
        )
          throw new EvidenceFailure('STALE_SOURCE', 'source_fence');
        return { neighboring_context: neighbors(source, transcript), source };
      });
      return {
        result: { evidence, memory: record.memory, result_type: 'memory_evidence' },
        resultCount: evidence.length,
        referenceCount: evidence.reduce(
          (count, hit) =>
            count +
            1 +
            hit.neighboring_context.before.length +
            hit.neighboring_context.after.length,
          0,
        ),
      };
    });
  }

  public async searchTranscript(
    request: unknown,
    runtime: EvidenceDrilldownRuntimeScope,
  ): Promise<EvidenceResultEnvelope | EvidenceErrorEnvelope> {
    return this.execute('search_transcript', request, runtime, async (envelope, p4, policy) => {
      const payload = envelope.request as { query: string };
      const frozenIds = null;
      const transcript = await this.readAndValidateTranscript(
        envelope.scope.project_id,
        envelope.scope.authorized_session_ids,
        frozenIds,
        p4,
        policy,
      );
      const query = payload.query.toLowerCase();
      const matches = transcript
        .filter((segment) => segment.text.toLowerCase().includes(query))
        .sort(compareTranscript)
        .slice(0, 20)
        .map((source, match_rank) => ({
          match_rank,
          neighboring_context: neighbors(source, transcript),
          source,
        }));
      return {
        result: {
          match_state: matches.length === 0 ? 'no_match' : 'matches',
          matches,
          query: payload.query,
          result_type: 'transcript_search',
        },
        resultCount: matches.length,
        referenceCount: matches.reduce(
          (count, hit) =>
            count +
            1 +
            hit.neighboring_context.before.length +
            hit.neighboring_context.after.length,
          0,
        ),
      };
    });
  }

  private async execute(
    operation: 'get_memory_evidence' | 'search_transcript',
    input: unknown,
    runtime: EvidenceDrilldownRuntimeScope,
    work: (
      request: EvidenceRequestEnvelope,
      p4: P4ContextV2,
      policy: AiPolicySnapshot,
    ) => Promise<{
      result: EvidenceResultEnvelope['result'];
      resultCount: number;
      referenceCount: number;
    }>,
  ): Promise<EvidenceResultEnvelope | EvidenceErrorEnvelope> {
    const started = Date.now();
    const request = requestEnvelope(operation, input);
    try {
      validateRequest(operation, request, runtime);
      validateP4ContextV2(runtime.p4Context);
      if (this.usedGenerations.has(request.round.generation_id))
        throw new EvidenceFailure('ROUND_ALREADY_USED', 'round_guard');
      this.usedGenerations.add(request.round.generation_id);
      validateScope(request.scope, runtime.p4Context);
      if (
        request.round.context_digest !== runtime.p4Context.context_digest ||
        request.round.membership_digest !== runtime.p4Context.membership_digest
      )
        throw new EvidenceFailure('OUT_OF_SCOPE', 'scope');
      const policy = await this.policy.assertAllowed(
        runtime.actorId,
        request.scope.project_id,
        request.scope.authorized_session_ids,
      );
      const output = await work(request, runtime.p4Context, policy);
      return {
        contract_version: EVIDENCE_CONTRACT_VERSION,
        diagnostics: diagnostics('NONE', started, output.resultCount, output.referenceCount),
        message_type: 'result',
        operation,
        request_id: request.request_id,
        result: output.result,
        round: request.round,
        scope: request.scope,
      };
    } catch (error) {
      const failure = toFailure(error);
      return errorEnvelope(operation, request, failure.code, failure.phase, started);
    }
  }

  private async readAndValidateTranscript(
    projectId: string,
    sessionIds: readonly string[],
    segmentIds: readonly string[] | null,
    p4: P4ContextV2,
    policy: AiPolicySnapshot,
  ): Promise<readonly EvidenceTranscriptSegment[]> {
    const rows = await this.reader.readTranscript(projectId, sessionIds, segmentIds);
    if (segmentIds !== null && rows.length !== new Set(segmentIds).size)
      throw new EvidenceFailure('DELETED_SOURCE', 'source_fence');
    const frozenById = new Map(
      p4.recent_transcript.map((segment) => [segment.segment_id, segment]),
    );
    return rows.map((row) => {
      if (
        row.project_id !== projectId ||
        !sessionIds.includes(row.session_id) ||
        row.content_kind !== 'conversation' ||
        !['elder', 'interviewer'].includes(row.trusted_role) ||
        row.text.length === 0 ||
        row.text.length > 1000 ||
        row.effective_text_digest !== effectiveTextDigest(row.text)
      )
        throw new EvidenceFailure('STALE_SOURCE', 'source_fence');
      const frozen = frozenById.get(row.segment_id);
      if (
        frozen !== undefined &&
        (frozen.session_id !== row.session_id ||
          frozen.start_ms !== row.start_ms ||
          frozen.text !== row.text ||
          frozen.text_revision !== row.text_revision ||
          frozen.speaker_role_revision !== row.speaker_role_revision ||
          frozen.effective_text_digest !== row.effective_text_digest ||
          frozen.trusted_role !== row.trusted_role)
      )
        throw new EvidenceFailure('STALE_SOURCE', 'source_fence');
      return toTranscriptSegment(row, policy);
    });
  }
}

class EvidenceFailure extends Error {
  public constructor(
    public readonly code: EvidenceErrorCode,
    public readonly phase: EvidenceErrorPhase,
  ) {
    super(code);
  }
}

/* eslint-disable @typescript-eslint/no-unnecessary-condition */
function validateRequest(
  operation: 'get_memory_evidence' | 'search_transcript',
  request: EvidenceRequestEnvelope,
  runtime: EvidenceDrilldownRuntimeScope,
): void {
  if (
    request.contract_version !== EVIDENCE_CONTRACT_VERSION ||
    request.message_type !== 'request' ||
    request.operation !== operation ||
    !UUID.test(request.request_id) ||
    !UUID.test(request.round.generation_id) ||
    !DIGEST.test(request.round.context_digest) ||
    !DIGEST.test(request.round.membership_digest) ||
    runtime.actorId.length === 0
  )
    throw new EvidenceFailure('MALFORMED_REQUEST', 'request_validation');
  const round = request.round as unknown as Record<string, unknown>;
  if (round.evidence_round !== 1) {
    if (typeof round.evidence_round === 'number' && round.evidence_round > 1)
      throw new EvidenceFailure('ROUND_ALREADY_USED', 'round_guard');
    throw new EvidenceFailure('MALFORMED_REQUEST', 'request_validation');
  }
  if (round.max_evidence_rounds !== 1)
    throw new EvidenceFailure('MALFORMED_REQUEST', 'request_validation');
  if (operation === 'get_memory_evidence') {
    const payload = request.request as Record<string, unknown>;
    if (
      !isRecord(payload) ||
      !hasExactKeys(payload, ['memory_id']) ||
      !UUID.test(String(payload.memory_id))
    )
      throw new EvidenceFailure('MALFORMED_REQUEST', 'request_validation');
  } else if (
    !isRecord(request.request) ||
    !hasExactKeys(request.request, ['query']) ||
    typeof (request.request as Record<string, unknown>).query !== 'string' ||
    ((request.request as Record<string, unknown>).query as string).length < 1 ||
    ((request.request as Record<string, unknown>).query as string).length > 240
  )
    throw new EvidenceFailure('MALFORMED_REQUEST', 'request_validation');
}

function validateScope(scope: EvidenceScope, p4: P4ContextV2): void {
  if (
    !hasExactKeys(scope, [
      'scope_type',
      'source_contract',
      'project_id',
      'current_session_id',
      'authorized_session_ids',
    ]) ||
    scope.scope_type !== EVIDENCE_SCOPE_TYPE ||
    scope.source_contract !== EVIDENCE_SOURCE_CONTRACT ||
    scope.project_id !== p4.project_id ||
    scope.current_session_id !== p4.current_session_id ||
    scope.authorized_session_ids.length === 0 ||
    new Set(scope.authorized_session_ids).size !== scope.authorized_session_ids.length ||
    !scope.authorized_session_ids.includes(scope.current_session_id)
  )
    throw new EvidenceFailure('OUT_OF_SCOPE', 'scope');
  const knownSessions = new Set([
    ...p4.recent_transcript.map((segment) => segment.session_id),
    p4.active_memory.source_session_id,
    p4.resumed_memory.source_session_id,
  ]);
  if (scope.authorized_session_ids.some((sessionId) => !knownSessions.has(sessionId)))
    throw new EvidenceFailure('OUT_OF_SCOPE', 'scope');
}
/* eslint-enable @typescript-eslint/no-unnecessary-condition */

function requestEnvelope(
  operation: 'get_memory_evidence' | 'search_transcript',
  input: unknown,
): EvidenceRequestEnvelope {
  if (!isRecord(input)) return fallbackRequest(operation);
  return {
    contract_version: (typeof input.contract_version === 'string'
      ? input.contract_version
      : EVIDENCE_CONTRACT_VERSION) as typeof EVIDENCE_CONTRACT_VERSION,
    message_type: (input.message_type === 'request' ? 'request' : input.message_type) as 'request',
    operation: (typeof input.operation === 'string'
      ? input.operation
      : operation) as EvidenceRequestEnvelope['operation'],
    request: isRecord(input.request)
      ? (input.request as EvidenceRequestEnvelope['request'])
      : ({} as EvidenceRequestEnvelope['request']),
    request_id: typeof input.request_id === 'string' ? input.request_id : ZERO_UUID,
    round: isRecord(input.round)
      ? (input.round as unknown as EvidenceRequestEnvelope['round'])
      : {
          context_digest: ZERO_DIGEST,
          evidence_round: 1,
          generation_id: ZERO_UUID,
          max_evidence_rounds: 1,
          membership_digest: ZERO_DIGEST,
        },
    scope: isRecord(input.scope)
      ? (input.scope as unknown as EvidenceScope)
      : {
          authorized_session_ids: [],
          current_session_id: ZERO_UUID,
          project_id: ZERO_UUID,
          scope_type: EVIDENCE_SCOPE_TYPE,
          source_contract: EVIDENCE_SOURCE_CONTRACT,
        },
  };
}

function fallbackRequest(
  operation: 'get_memory_evidence' | 'search_transcript',
): EvidenceRequestEnvelope {
  return {
    contract_version: EVIDENCE_CONTRACT_VERSION,
    message_type: 'request',
    operation,
    request: {} as EvidenceRequestEnvelope['request'],
    request_id: ZERO_UUID,
    round: {
      context_digest: ZERO_DIGEST,
      evidence_round: 1,
      generation_id: ZERO_UUID,
      max_evidence_rounds: 1,
      membership_digest: ZERO_DIGEST,
    },
    scope: {
      authorized_session_ids: [],
      current_session_id: ZERO_UUID,
      project_id: ZERO_UUID,
      scope_type: EVIDENCE_SCOPE_TYPE,
      source_contract: EVIDENCE_SOURCE_CONTRACT,
    },
  };
}

function errorEnvelope(
  operation: 'get_memory_evidence' | 'search_transcript',
  request: EvidenceRequestEnvelope,
  code: EvidenceErrorCode,
  phase: EvidenceErrorPhase,
  started: number,
): EvidenceErrorEnvelope {
  const round = validRound(request.round) ? request.round : fallbackRequest(operation).round;
  const scope = validScopeShape(request.scope) ? request.scope : fallbackRequest(operation).scope;
  const requestId = UUID.test(request.request_id) ? request.request_id : ZERO_UUID;
  return {
    contract_version: EVIDENCE_CONTRACT_VERSION,
    diagnostics: diagnostics(code, started, 0, 0),
    error: { error_code: code, generation_outcome: 'SYSTEM_ERROR', phase },
    message_type: 'error',
    operation,
    request_id: requestId,
    round,
    scope,
  };
}

function diagnostics(
  code: 'NONE' | EvidenceErrorCode,
  started: number,
  resultCount: number,
  referenceCount: number,
): EvidenceDiagnostics {
  return {
    duration_ms: Math.max(0, Date.now() - started),
    error_code: code,
    reference_count: referenceCount,
    result_count: resultCount,
    stage: EVIDENCE_STAGE,
  };
}

function toFailure(error: unknown): EvidenceFailure {
  if (error instanceof EvidenceFailure) return error;
  if (
    error instanceof Error &&
    (['ForbiddenException', 'AI_POLICY_BLOCKED'].includes(error.name) ||
      error.message === 'AI_POLICY_BLOCKED')
  )
    return new EvidenceFailure('AUTHORIZATION_DENIED', 'scope');
  return new EvidenceFailure('TOOL_EXECUTION_FAILED', 'execution');
}

function memoryMember(p4: P4ContextV2, memoryId: string): EvidenceMemoryReference | null {
  const candidate = p4.memory_candidates.find((item) => item.memory_id === memoryId);
  if (candidate !== undefined) {
    const entry = p4.membership.sections
      .find((section) => section.section === 'memory_candidates')
      ?.entries.find(
        (membershipEntry) =>
          membershipEntry.source_type === 'memory_candidate' &&
          membershipEntry.source_id === memoryId,
      );
    if (
      entry === undefined ||
      entry.source_revision === null ||
      (candidate.revision_no !== undefined && candidate.revision_no !== entry.source_revision)
    )
      return null;
    return {
      memory_id: candidate.memory_id,
      membership_digest: entry.membership_digest,
      resolution_authority_id: candidate.resolution_authority_id,
      revision_id: candidate.revision_id,
      revision_no: entry.source_revision,
      semantic_kind: candidate.semantic_kind,
      semantic_status: candidate.semantic_status,
      source_level: candidate.source_level,
    };
  }
  const member = [...p4.active_memory.items, ...p4.resumed_memory.items].find(
    (item) => item.memory_id === memoryId,
  );
  return member === undefined
    ? null
    : {
        memory_id: member.memory_id,
        membership_digest: member.membership_digest,
        resolution_authority_id: member.resolution_authority_id,
        revision_id: member.revision_id,
        revision_no: member.revision_no,
        semantic_kind: member.semantic_kind,
        semantic_status: member.semantic_status,
        source_level: member.source_level,
      };
}

function sameMemory(left: EvidenceMemoryReference, right: EvidenceMemoryReference): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toTranscriptSegment(
  row: EvidenceTranscriptRecord,
  policy: AiPolicySnapshot,
): EvidenceTranscriptSegment {
  return {
    content_kind: 'conversation_final' as const,
    effective_text_digest: row.effective_text_digest,
    project_id: row.project_id,
    segment_id: row.segment_id,
    session_id: row.session_id,
    source_fence: sourceFence(policy),
    speaker_role_revision: row.speaker_role_revision,
    start_ms: row.start_ms,
    text: row.text,
    text_revision: row.text_revision,
    trusted_role: row.trusted_role as 'elder' | 'interviewer',
  };
}

function sourceFence(policy: AiPolicySnapshot): EvidenceSourceFence {
  return {
    authorization: { scope: EVIDENCE_SCOPE_TYPE, status: 'authorized' },
    deletion: { fence_revision: policy.deletionFenceRevision, status: 'not-deleted' },
    retention: { policy_revision: String(policy.retentionPolicyVersion), status: 'eligible' },
  };
}

function neighbors(
  source: EvidenceTranscriptSegment,
  all: readonly EvidenceTranscriptSegment[],
): EvidenceHit['neighboring_context'] {
  const ordered = [...all]
    .filter((segment) => segment.session_id === source.session_id)
    .sort(compareTranscript);
  const index = ordered.findIndex((segment) => segment.segment_id === source.segment_id);
  return {
    after: index < 0 ? [] : ordered.slice(index + 1, index + 3),
    before: index < 0 ? [] : ordered.slice(Math.max(0, index - 2), index),
  };
}

function compareTranscript(
  left: { start_ms: number; segment_id: string },
  right: { start_ms: number; segment_id: string },
): number {
  return left.start_ms - right.start_ms || left.segment_id.localeCompare(right.segment_id);
}

function validRound(value: unknown): value is EvidenceRequestEnvelope['round'] {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'generation_id',
      'context_digest',
      'membership_digest',
      'evidence_round',
      'max_evidence_rounds',
    ]) &&
    UUID.test(String(value.generation_id)) &&
    DIGEST.test(String(value.context_digest)) &&
    DIGEST.test(String(value.membership_digest)) &&
    value.evidence_round === 1 &&
    value.max_evidence_rounds === 1
  );
}

function validScopeShape(value: unknown): value is EvidenceScope {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'scope_type',
      'source_contract',
      'project_id',
      'current_session_id',
      'authorized_session_ids',
    ]) &&
    value.scope_type === EVIDENCE_SCOPE_TYPE &&
    value.source_contract === EVIDENCE_SOURCE_CONTRACT &&
    typeof value.project_id === 'string' &&
    UUID.test(value.project_id) &&
    typeof value.current_session_id === 'string' &&
    UUID.test(value.current_session_id) &&
    Array.isArray(value.authorized_session_ids) &&
    value.authorized_session_ids.length > 0 &&
    new Set(value.authorized_session_ids).size === value.authorized_session_ids.length &&
    value.authorized_session_ids.every(
      (sessionId) => typeof sessionId === 'string' && UUID.test(sessionId),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}
