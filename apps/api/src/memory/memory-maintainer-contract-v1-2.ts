export interface MemoryMaintainerV12ValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export type MemoryMaintainerV12TriggerDisposition =
  'freeze_maintainer_context' | 'defer_without_job' | 'terminalize_unjudged_system_job';

export interface MemoryMaintainerV12TriggerGateInput {
  batch_threshold_reached: boolean;
  time_threshold_reached: boolean;
  session_final_flush: boolean;
  cumulative_useful_characters: number;
  minimum_useful_characters: number;
}

export interface MemoryMaintainerV12NamespaceObservation {
  job_type: string;
  trigger_identity: string | null;
}

export interface MemoryProducerCutoverStateV12 {
  contract_review_status: 'review' | 'pass';
  contract_merged: boolean;
  loaded_contract_version:
    'none' | 'memory-maintainer-v1' | 'memory-maintainer-v1.1' | 'memory-maintainer-v1.2';
  p1_runtime_enabled: boolean;
  legacy_memory_extract_enabled: boolean;
  post_session_memory_lane:
    'legacy_memory_extract' | 'delegate_p1_final_flush' | 'project_p1_terminal_outcome';
  unconsumed_final_authority: 'legacy_memory_extract' | 'p1';
}

type JsonObject = Record<string, unknown>;

interface CurrentResolutionTruth {
  canonicalKey: string;
  eligibleClaimIds: ReadonlySet<string>;
  revision: number;
  semanticKind: string;
  threadId: string;
}

const V11_TRIGGER_NAMESPACE = 'memory-p1-v1.1:';
const V12_TRIGGER_NAMESPACE = 'memory-p1-v1.2:';

/** NFKC + Unicode whitespace removal is the sole useful-character normalization. */
export function normalizeMemoryMaintainerUsefulTextV12(text: string): string {
  return text.normalize('NFKC').replace(/\p{White_Space}+/gu, '');
}

/** Array.from counts Unicode code points rather than UTF-16 code units or UTF-8 bytes. */
export function countMemoryMaintainerUsefulCharactersV12(text: string): number {
  return Array.from(normalizeMemoryMaintainerUsefulTextV12(text)).length;
}

/**
 * A low-content final flush terminates the durable lane without invoking the Maintainer.
 * Ordinary scans remain pending and create no job until both halves of the gate are true.
 */
export function decideMemoryMaintainerTriggerV12(
  input: MemoryMaintainerV12TriggerGateInput,
): MemoryMaintainerV12TriggerDisposition {
  const timingReady =
    input.batch_threshold_reached || input.time_threshold_reached || input.session_final_flush;
  const contentReady =
    isNonNegativeInteger(input.cumulative_useful_characters) &&
    isPositiveInteger(input.minimum_useful_characters) &&
    input.cumulative_useful_characters >= input.minimum_useful_characters;

  if (timingReady && contentReady) return 'freeze_maintainer_context';
  if (input.session_final_flush) return 'terminalize_unjudged_system_job';
  return 'defer_without_job';
}

/** Cross-document rules for the forward-only Memory Maintainer v1.2 contract. */
export function validateMemoryMaintainerV12SemanticPair(
  context: unknown,
  output: unknown,
): MemoryMaintainerV12ValidationResult {
  const errors: string[] = [];
  const contextObject = asObject(context);
  const outputObject = asObject(output);
  const memberships = asArray(contextObject?.transcript_membership);
  const newElderIds = new Set<string>();
  const allIds = new Set<string>();
  let cumulativeUsefulCharacters = 0;

  if (memberships === null) {
    errors.push('MEMORY_CONTEXT_MEMBERSHIP_REQUIRED');
  } else {
    for (const item of memberships) {
      const membership = asObject(item);
      const segmentId = asString(membership?.segment_id);
      if (segmentId === null) continue;
      const duplicate = allIds.has(segmentId);
      if (duplicate) errors.push('MEMORY_CONTEXT_SEGMENT_ID_DUPLICATE');
      allIds.add(segmentId);
      if (
        !duplicate &&
        membership?.membership_kind === 'new' &&
        membership.trusted_role === 'elder' &&
        membership.content_kind === 'conversation'
      ) {
        newElderIds.add(segmentId);
        const text = asString(membership.text);
        if (text !== null)
          cumulativeUsefulCharacters += countMemoryMaintainerUsefulCharactersV12(text);
      }
    }
  }
  if (newElderIds.size === 0) errors.push('MEMORY_CONTEXT_NEW_ELDER_REQUIRED');
  validateFrozenTrigger(
    contextObject?.trigger,
    newElderIds.size,
    cumulativeUsefulCharacters,
    errors,
  );

  const currentResolutions = collectCurrentResolutionTruth(contextObject, errors);
  for (const memory of asArray(contextObject?.session_mid_index) ?? []) {
    validateResolutionSemantics(asObject(memory), errors, 'MEMORY_CONTEXT');
  }

  if (outputObject !== null) {
    const operationIds = new Set<string>();
    const outputSlots = new Set<string>();
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
      const targetResolutionId = asString(operationObject?.target_resolution_id);
      const target =
        targetResolutionId === null ? undefined : currentResolutions.get(targetResolutionId);
      if (targetResolutionId !== null) {
        if (target === undefined) {
          errors.push('MEMORY_TARGET_NOT_IN_CURRENT_CONTEXT');
        } else {
          if (operationObject?.expected_resolution_revision !== target.revision) {
            errors.push('MEMORY_TARGET_REVISION_MISMATCH');
          }
          if (asString(operationObject?.anchor_thread_id) !== target.threadId) {
            errors.push('MEMORY_TARGET_THREAD_IDENTITY_MISMATCH');
          }
          if (proposedState !== null) {
            if (asString(proposedState.canonical_key) !== target.canonicalKey) {
              errors.push('MEMORY_TARGET_CANONICAL_KEY_MISMATCH');
            }
            if (asString(proposedState.semantic_kind) !== target.semanticKind) {
              errors.push('MEMORY_TARGET_SEMANTIC_KIND_MISMATCH');
            }
          }
        }
      }

      if (proposedState !== null) {
        validateResolutionSemantics(proposedState, errors, 'MEMORY_OUTPUT');
        const semanticKind = asString(proposedState.semantic_kind);
        const canonicalKey = asString(proposedState.canonical_key);
        if (semanticKind !== null && canonicalKey !== null) {
          const slot = semanticSlot(semanticKind, canonicalKey);
          if (outputSlots.has(slot)) errors.push('MEMORY_OUTPUT_SEMANTIC_SLOT_DUPLICATE');
          outputSlots.add(slot);
        }

        const semanticStatus = proposedState.semantic_status;
        const kind = operationObject?.kind;
        if (semanticStatus === 'disputed') {
          if (kind === 'NEW' || kind === 'BRANCH' || kind === 'RELATED') {
            errors.push('MEMORY_DISPUTED_REQUIRES_EXISTING_TARGET_OPERATION');
          }
          const expectedRevision = operationObject?.expected_resolution_revision;
          if (targetResolutionId === null || !isPositiveInteger(expectedRevision)) {
            errors.push('MEMORY_DISPUTED_REQUIRES_EXISTING_TARGET_REVISION');
          } else if (target === undefined) {
            errors.push('MEMORY_DISPUTED_TARGET_NOT_IN_CURRENT_CONTEXT');
          } else if (target.revision !== expectedRevision) {
            errors.push('MEMORY_DISPUTED_TARGET_REVISION_MISMATCH');
          }
        }

        const claimKeys = new Set<string>();
        const disputedClaimIds = new Set<string>();
        const disputedTarget =
          proposedState.semantic_status === 'disputed'
            ? currentResolutions.get(asString(operationObject?.target_resolution_id) ?? '')
            : undefined;
        for (const claim of asArray(proposedState.claims) ?? []) {
          const claimObject = asObject(claim);
          const claimKey = asString(claimObject?.claim_key);
          if (claimKey !== null) {
            if (claimKeys.has(claimKey)) errors.push('MEMORY_OUTPUT_CLAIM_KEY_DUPLICATE');
            claimKeys.add(claimKey);
          }
          if (proposedState.semantic_status === 'disputed') {
            const claimId = asString(claimObject?.claim_id);
            if (claimId === null) {
              errors.push('MEMORY_DISPUTED_CLAIM_ID_REQUIRED');
            } else {
              if (disputedClaimIds.has(claimId)) {
                errors.push('MEMORY_DISPUTED_CLAIM_ID_DUPLICATE');
              }
              disputedClaimIds.add(claimId);
              if (disputedTarget !== undefined && !disputedTarget.eligibleClaimIds.has(claimId)) {
                errors.push('MEMORY_DISPUTED_CLAIM_NOT_ELIGIBLE');
              }
            }
          }
          const claimEvidence = new Set(stringItems(asArray(claimObject?.evidence_segment_ids)));
          validateEvidence(claimEvidence, newElderIds, errors, 'MEMORY_CLAIM_EVIDENCE');
          for (const evidenceId of claimEvidence) {
            if (!operationEvidence.has(evidenceId)) {
              errors.push('MEMORY_CLAIM_EVIDENCE_OUTSIDE_OPERATION');
            }
          }
        }
        if (proposedState.semantic_status === 'disputed' && disputedClaimIds.size < 2) {
          errors.push('MEMORY_DISPUTED_REQUIRES_TWO_DISTINCT_ELIGIBLE_CLAIMS');
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

/** Historical v1.1 rows remain valid; non-maintainer jobs may use neither namespace. */
export function validateMemoryMaintainerNamespacesV12(
  jobs: readonly MemoryMaintainerV12NamespaceObservation[],
): MemoryMaintainerV12ValidationResult {
  const errors: string[] = [];
  for (const job of jobs) {
    const identity = job.trigger_identity;
    const usesMaintainerNamespace =
      identity !== null &&
      (identity.startsWith(V11_TRIGGER_NAMESPACE) || identity.startsWith(V12_TRIGGER_NAMESPACE));
    if (
      job.job_type === 'working_memory_maintain' &&
      (identity === null || !usesMaintainerNamespace)
    ) {
      errors.push('AI_JOB_MAINTAINER_TRIGGER_NAMESPACE_REQUIRED');
    }
    if (job.job_type !== 'working_memory_maintain' && usesMaintainerNamespace) {
      errors.push('AI_JOB_NON_MAINTAINER_TRIGGER_NAMESPACE_FORBIDDEN');
    }
  }
  return result(errors);
}

export function validateMemoryProducerCutoverV12(
  state: MemoryProducerCutoverStateV12,
): MemoryMaintainerV12ValidationResult {
  const errors: string[] = [];
  if (state.p1_runtime_enabled) {
    if (
      state.contract_review_status !== 'pass' ||
      !state.contract_merged ||
      state.loaded_contract_version !== 'memory-maintainer-v1.2'
    ) {
      errors.push('MEMORY_P1_V12_PASS_AND_MERGE_REQUIRED');
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

function validateFrozenTrigger(
  triggerValue: unknown,
  expectedSelectedCount: number,
  expectedCumulativeCharacters: number,
  errors: string[],
): void {
  const trigger = asObject(triggerValue);
  if (trigger === null) {
    errors.push('MEMORY_TRIGGER_REQUIRED');
    return;
  }
  const identity = asString(trigger.identity);
  if (identity === null || !identity.startsWith(V12_TRIGGER_NAMESPACE)) {
    errors.push('MEMORY_TRIGGER_V12_NAMESPACE_REQUIRED');
  }
  if (trigger.selected_new_segment_count !== expectedSelectedCount) {
    errors.push('MEMORY_TRIGGER_SELECTED_NEW_COUNT_MISMATCH');
  }
  if (trigger.cumulative_useful_characters !== expectedCumulativeCharacters) {
    errors.push('MEMORY_TRIGGER_CUMULATIVE_CHARACTERS_MISMATCH');
  }
  if (
    !isPositiveInteger(trigger.minimum_useful_characters) ||
    expectedCumulativeCharacters < trigger.minimum_useful_characters
  ) {
    errors.push('MEMORY_TRIGGER_MINIMUM_USEFUL_CHARACTERS_NOT_MET');
  }
}

function collectCurrentResolutionTruth(
  context: JsonObject | null,
  errors: string[],
): Map<string, CurrentResolutionTruth> {
  const currentResolutions = new Map<string, CurrentResolutionTruth>();
  const currentSlots = new Set<string>();
  for (const memory of asArray(context?.current_working_memory) ?? []) {
    const memoryObject = asObject(memory);
    validateResolutionSemantics(memoryObject, errors, 'MEMORY_CONTEXT');
    const resolutionId = asString(memoryObject?.resolution_id);
    const revision = memoryObject?.revision;
    const semanticKind = asString(memoryObject?.semantic_kind) ?? '';
    const canonicalKey = asString(memoryObject?.canonical_key) ?? '';
    if (semanticKind !== '' && canonicalKey !== '') {
      const slot = semanticSlot(semanticKind, canonicalKey);
      if (currentSlots.has(slot)) errors.push('MEMORY_CONTEXT_SEMANTIC_SLOT_DUPLICATE');
      currentSlots.add(slot);
    }
    if (resolutionId !== null && isPositiveInteger(revision)) {
      if (currentResolutions.has(resolutionId)) {
        errors.push('MEMORY_CONTEXT_RESOLUTION_ID_DUPLICATE');
      }
      const eligibleClaimIds = new Set<string>();
      for (const claim of asArray(memoryObject?.claims) ?? []) {
        const claimId = asString(asObject(claim)?.claim_id);
        if (claimId === null) continue;
        if (eligibleClaimIds.has(claimId)) errors.push('MEMORY_CONTEXT_CLAIM_ID_DUPLICATE');
        eligibleClaimIds.add(claimId);
      }
      currentResolutions.set(resolutionId, {
        canonicalKey,
        eligibleClaimIds,
        revision,
        semanticKind,
        threadId: asString(memoryObject?.thread_id) ?? '',
      });
    }
  }
  return currentResolutions;
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

function semanticSlot(semanticKind: string, canonicalKey: string): string {
  return `${semanticKind}\u0000${canonicalKey}`;
}

function result(errors: string[]): MemoryMaintainerV12ValidationResult {
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
