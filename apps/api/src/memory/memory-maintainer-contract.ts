export interface MemoryMaintainerSemanticResult {
  valid: boolean;
  errors: readonly string[];
}

type JsonObject = Record<string, unknown>;

/**
 * Cross-document invariants cannot be expressed by either standalone JSON Schema.
 * This validator remains a pure contract helper; it does not read or write persistence.
 */
export function validateMemoryMaintainerSemanticPair(
  context: unknown,
  output: unknown,
): MemoryMaintainerSemanticResult {
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
        membership !== null &&
        membership.membership_kind === 'new' &&
        membership.trusted_role === 'elder' &&
        membership.content_kind === 'conversation'
      ) {
        newElderIds.add(segmentId);
      }
    }
    if (newElderIds.size === 0) errors.push('MEMORY_CONTEXT_NEW_ELDER_REQUIRED');
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
      for (const evidenceId of asArray(operationObject?.evidence_segment_ids) ?? []) {
        if (typeof evidenceId === 'string' && !newElderIds.has(evidenceId)) {
          errors.push('MEMORY_OUTPUT_EVIDENCE_MUST_BE_NEW_ELDER');
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
      for (const evidenceId of asArray(candidateObject?.evidence_segment_ids) ?? []) {
        if (typeof evidenceId === 'string' && !newElderIds.has(evidenceId)) {
          errors.push('MEMORY_BOUNDARY_EVIDENCE_MUST_BE_NEW_ELDER');
        }
      }
    }
  }

  return { errors: [...new Set(errors)], valid: errors.length === 0 };
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
