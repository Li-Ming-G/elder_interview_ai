export interface MemoryMaintainerV11ValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export interface RevisionObservation {
  segment_id: string;
  text_revision: number;
}

export interface RevisionParityInput {
  database: readonly RevisionObservation[];
  context_membership: readonly RevisionObservation[];
  decision_trace_membership: readonly RevisionObservation[];
  writeback_cas: readonly RevisionObservation[];
}

export interface JobDedupeObservation {
  job_type: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  trigger_identity: string;
  attempt: number;
  retry_of_attempt: number | null;
}

export interface WorkingConsumptionObservation {
  transcript_segment_id: string;
  snapshot_id: string | null;
  ai_job_input_segment_id: string | null;
}

export interface ProducerCutoverState {
  contract_review_status: 'review' | 'pass';
  contract_merged: boolean;
  loaded_contract_version: 'none' | 'memory-maintainer-v1' | 'memory-maintainer-v1.1';
  p1_runtime_enabled: boolean;
  legacy_memory_extract_enabled: boolean;
  post_session_memory_lane:
    'legacy_memory_extract' | 'delegate_p1_final_flush' | 'project_p1_terminal_outcome';
  unconsumed_final_authority: 'legacy_memory_extract' | 'p1';
}

type JsonObject = Record<string, unknown>;

/** Cross-document rules for the forward-only Memory Maintainer v1.1 contract. */
export function validateMemoryMaintainerV11SemanticPair(
  context: unknown,
  output: unknown,
): MemoryMaintainerV11ValidationResult {
  const errors: string[] = [];
  const contextObject = asObject(context);
  const outputObject = asObject(output);
  const memberships = asArray(contextObject?.transcript_membership);
  const newElderIds = new Set<string>();
  const allIds = new Set<string>();

  if (memberships === null) {
    errors.push('MEMORY_CONTEXT_MEMBERSHIP_REQUIRED');
  } else {
    for (const item of memberships) {
      const membership = asObject(item);
      const segmentId = asString(membership?.segment_id);
      if (segmentId === null) continue;
      if (allIds.has(segmentId)) errors.push('MEMORY_CONTEXT_SEGMENT_ID_DUPLICATE');
      allIds.add(segmentId);
      if (
        membership?.membership_kind === 'new' &&
        membership.trusted_role === 'elder' &&
        membership.content_kind === 'conversation'
      ) {
        newElderIds.add(segmentId);
      }
    }
    if (newElderIds.size === 0) errors.push('MEMORY_CONTEXT_NEW_ELDER_REQUIRED');
  }

  for (const memory of asArray(contextObject?.current_working_memory) ?? []) {
    validateResolutionSemantics(asObject(memory), errors, 'MEMORY_CONTEXT');
  }
  for (const memory of asArray(contextObject?.session_mid_index) ?? []) {
    validateResolutionSemantics(asObject(memory), errors, 'MEMORY_CONTEXT');
  }

  if (outputObject !== null) {
    const operationIds = new Set<string>();
    for (const operation of asArray(outputObject.operations) ?? []) {
      const operationObject = asObject(operation);
      const operationId = asString(operationObject?.operation_id);
      if (operationId !== null) {
        if (operationIds.has(operationId)) errors.push('MEMORY_OUTPUT_OPERATION_ID_DUPLICATE');
        operationIds.add(operationId);
      }

      const operationEvidence = new Set(
        stringItems(asArray(operationObject?.evidence_segment_ids)),
      );
      validateEvidence(operationEvidence, newElderIds, errors, 'MEMORY_OUTPUT_EVIDENCE');

      const proposedState = asObject(operationObject?.proposed_state);
      if (proposedState !== null) {
        validateResolutionSemantics(proposedState, errors, 'MEMORY_OUTPUT');
        const semanticStatus = proposedState.semantic_status;
        const kind = operationObject?.kind;
        if (semanticStatus === 'disputed') {
          if (kind === 'NEW' || kind === 'BRANCH' || kind === 'RELATED') {
            errors.push('MEMORY_DISPUTED_REQUIRES_EXISTING_TARGET_OPERATION');
          }
          if (
            asString(operationObject?.target_resolution_id) === null ||
            !isPositiveInteger(operationObject?.expected_resolution_revision)
          ) {
            errors.push('MEMORY_DISPUTED_REQUIRES_EXISTING_TARGET_REVISION');
          }
        }

        const claimKeys = new Set<string>();
        for (const claim of asArray(proposedState.claims) ?? []) {
          const claimObject = asObject(claim);
          const claimKey = asString(claimObject?.claim_key);
          if (claimKey !== null) {
            if (claimKeys.has(claimKey)) errors.push('MEMORY_OUTPUT_CLAIM_KEY_DUPLICATE');
            claimKeys.add(claimKey);
          }
          const claimEvidence = new Set(stringItems(asArray(claimObject?.evidence_segment_ids)));
          validateEvidence(claimEvidence, newElderIds, errors, 'MEMORY_CLAIM_EVIDENCE');
          for (const evidenceId of claimEvidence) {
            if (!operationEvidence.has(evidenceId)) {
              errors.push('MEMORY_CLAIM_EVIDENCE_OUTSIDE_OPERATION');
            }
          }
        }
      }
    }

    const boundaryIds = new Set<string>();
    for (const candidate of asArray(outputObject.boundary_candidates) ?? []) {
      const candidateObject = asObject(candidate);
      const candidateId = asString(candidateObject?.candidate_id);
      if (candidateId !== null) {
        if (boundaryIds.has(candidateId)) errors.push('MEMORY_BOUNDARY_ID_DUPLICATE');
        boundaryIds.add(candidateId);
      }
      validateEvidence(
        new Set(stringItems(asArray(candidateObject?.evidence_segment_ids))),
        newElderIds,
        errors,
        'MEMORY_BOUNDARY_EVIDENCE',
      );
    }
  }

  return result(errors);
}

/** Locks Context, Decision Trace and writeback CAS to the exact database revision. */
export function validateMemoryMaintainerRevisionParity(
  input: RevisionParityInput,
): MemoryMaintainerV11ValidationResult {
  const errors: string[] = [];
  const database = new Map<string, number>();

  for (const item of input.database) {
    if (!isNonNegativeInteger(item.text_revision)) {
      errors.push('MEMORY_DATABASE_TEXT_REVISION_INVALID');
      continue;
    }
    if (database.has(item.segment_id)) errors.push('MEMORY_DATABASE_SEGMENT_DUPLICATE');
    database.set(item.segment_id, item.text_revision);
  }

  validateRevisionSet(input.context_membership, database, 'CONTEXT', errors);
  validateRevisionSet(input.decision_trace_membership, database, 'TRACE', errors);
  validateRevisionSet(input.writeback_cas, database, 'CAS', errors);
  return result(errors);
}

/** Mirrors the two partial unique indexes required by the formal SQL plan. */
export function validateMemoryMaintainerJobDedupe(
  jobs: readonly JobDedupeObservation[],
): MemoryMaintainerV11ValidationResult {
  const errors: string[] = [];
  const byIdentity = new Map<string, JobDedupeObservation[]>();
  for (const job of jobs) {
    const group = byIdentity.get(job.trigger_identity) ?? [];
    group.push(job);
    byIdentity.set(job.trigger_identity, group);
  }

  for (const group of byIdentity.values()) {
    const nonMaintainer = group.filter(({ job_type }) => job_type !== 'working_memory_maintain');
    const maintainer = group.filter(({ job_type }) => job_type === 'working_memory_maintain');
    if (nonMaintainer.length > 0 && maintainer.length > 0) {
      errors.push('AI_JOB_TRIGGER_IDENTITY_JOB_TYPE_COLLISION');
    }
    if (nonMaintainer.length > 1) errors.push('AI_JOB_NON_MAINTAINER_TRIGGER_DUPLICATE');

    const protectedRows = maintainer.filter(
      ({ status }) => status === 'pending' || status === 'running' || status === 'succeeded',
    );
    if (protectedRows.length > 1) errors.push('AI_JOB_MAINTAINER_LIVE_TRIGGER_DUPLICATE');

    const byAttempt = new Map<number, JobDedupeObservation>();
    for (const job of maintainer) {
      if (!isPositiveInteger(job.attempt) || byAttempt.has(job.attempt)) {
        errors.push('AI_JOB_MAINTAINER_ATTEMPT_INVALID');
      }
      byAttempt.set(job.attempt, job);
    }
    for (const job of maintainer) {
      if (job.attempt === 1 && job.retry_of_attempt !== null) {
        errors.push('AI_JOB_MAINTAINER_FIRST_ATTEMPT_HAS_RETRY_OF');
      }
      if (job.attempt > 1) {
        const previous = byAttempt.get(job.attempt - 1);
        if (
          job.retry_of_attempt !== job.attempt - 1 ||
          previous === undefined ||
          previous.status !== 'failed'
        ) {
          errors.push('AI_JOB_MAINTAINER_RETRY_REQUIRES_FAILED_PREDECESSOR');
        }
      }
    }
  }

  return result(errors);
}

export function validateWorkingConsumptions(
  consumptions: readonly WorkingConsumptionObservation[],
): MemoryMaintainerV11ValidationResult {
  const errors: string[] = [];
  const segmentIds = new Set<string>();
  for (const consumption of consumptions) {
    if (segmentIds.has(consumption.transcript_segment_id)) {
      errors.push('MEMORY_CONSUMPTION_SEGMENT_DUPLICATE');
    }
    segmentIds.add(consumption.transcript_segment_id);
  }
  return result(errors);
}

/** AI-root cleanup may null pointers, but it cannot make the transcript child pending again. */
export function isTranscriptSegmentPendingForMaintainer(
  transcriptSegmentId: string,
  consumptions: readonly WorkingConsumptionObservation[],
): boolean {
  return !consumptions.some(
    ({ transcript_segment_id }) => transcript_segment_id === transcriptSegmentId,
  );
}

export function validateMemoryProducerCutover(
  state: ProducerCutoverState,
): MemoryMaintainerV11ValidationResult {
  const errors: string[] = [];
  if (state.p1_runtime_enabled) {
    if (
      state.contract_review_status !== 'pass' ||
      !state.contract_merged ||
      state.loaded_contract_version !== 'memory-maintainer-v1.1'
    ) {
      errors.push('MEMORY_P1_V11_PASS_AND_MERGE_REQUIRED');
    }
    if (state.legacy_memory_extract_enabled) errors.push('MEMORY_DUAL_PRODUCER_FORBIDDEN');
    if (
      state.post_session_memory_lane !== 'delegate_p1_final_flush' &&
      state.post_session_memory_lane !== 'project_p1_terminal_outcome'
    ) {
      errors.push('MEMORY_POST_SESSION_MUST_DELEGATE_TO_P1');
    }
    if (state.unconsumed_final_authority !== 'p1') {
      errors.push('MEMORY_UNCONSUMED_FINAL_REQUIRES_P1_AUTHORITY');
    }
  }
  return result(errors);
}

function validateResolutionSemantics(
  value: JsonObject | null,
  errors: string[],
  prefix: string,
): void {
  if (value === null) return;
  const semanticStatus = value.semantic_status;
  const resolutionKind = value.resolution_kind;
  const valueKind = value.value_kind;
  const claims = asArray(value.claims) ?? [];

  if (semanticStatus === 'disputed') {
    if (resolutionKind !== 'conflict_set') errors.push(`${prefix}_DISPUTED_REQUIRES_CONFLICT_SET`);
    if (claims.length < 2) errors.push(`${prefix}_DISPUTED_REQUIRES_TWO_CLAIMS`);
    return;
  }

  const expected = valueKindToResolutionKind(valueKind);
  if (expected !== null && resolutionKind !== expected) {
    errors.push(`${prefix}_VALUE_KIND_RESOLUTION_KIND_MISMATCH`);
  }
}

function valueKindToResolutionKind(value: unknown): 'single' | 'range' | 'unknown' | null {
  if (value === 'exact') return 'single';
  if (value === 'range') return 'range';
  if (value === 'unknown') return 'unknown';
  return null;
}

function validateEvidence(
  evidenceIds: ReadonlySet<string>,
  newElderIds: ReadonlySet<string>,
  errors: string[],
  prefix: string,
): void {
  for (const evidenceId of evidenceIds) {
    if (!newElderIds.has(evidenceId)) errors.push(`${prefix}_MUST_BE_NEW_ELDER`);
  }
}

function validateRevisionSet(
  observations: readonly RevisionObservation[],
  database: ReadonlyMap<string, number>,
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const item of observations) {
    if (seen.has(item.segment_id)) errors.push(`MEMORY_${label}_SEGMENT_DUPLICATE`);
    seen.add(item.segment_id);
    if (!isNonNegativeInteger(item.text_revision)) {
      errors.push(`MEMORY_${label}_TEXT_REVISION_INVALID`);
      continue;
    }
    const databaseRevision = database.get(item.segment_id);
    if (databaseRevision === undefined) errors.push(`MEMORY_${label}_SEGMENT_NOT_IN_DATABASE`);
    else if (item.text_revision !== databaseRevision) {
      errors.push(`MEMORY_${label}_TEXT_REVISION_MISMATCH`);
    }
  }
}

function result(errors: string[]): MemoryMaintainerV11ValidationResult {
  const unique = [...new Set(errors)];
  return { errors: unique, valid: unique.length === 0 };
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringItems(value: readonly unknown[] | null): string[] {
  return (value ?? []).filter((item): item is string => typeof item === 'string');
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1;
}
