import { createHash } from 'node:crypto';

export interface SemanticEnvelopeValidationResult {
  valid: boolean;
  errors: readonly string[];
  verification: 'contract';
}

type JsonObject = Record<string, unknown>;

const DURABLE_CONTENT_KEYS = new Set([
  'semantic_state',
  'proposed_state',
  'value',
  'text',
  'transcript',
  'prompt',
  'context',
  'summary',
  'narrative',
  'provider_payload',
]);

export function semanticCanonicalDigest(domain: string, value: unknown): string {
  const canonical = JSON.stringify(sortJson(value));
  return createHash('sha256').update(`${domain}\u0000${canonical}`, 'utf8').digest('hex');
}

export function semanticContentDigest(semanticState: unknown): string {
  return semanticCanonicalDigest('memory-semantic-content-v1', semanticState);
}

export function semanticEvidenceManifestHash(evidenceMembership: readonly unknown[]): string {
  return semanticCanonicalDigest(
    'memory-semantic-evidence-manifest-v1',
    evidenceMembership.map((item) => {
      const evidence = object(item) ?? {};
      return [
        evidence.evidence_ref_id,
        evidence.segment_id,
        evidence.session_id,
        evidence.text_revision,
        evidence.speaker_role_revision,
        evidence.effective_text_digest,
        evidence.input_order,
      ];
    }),
  );
}

export function semanticSourceManifestHash(
  sourceMembers: readonly unknown[],
  evidenceMembership: readonly unknown[] = [],
): string {
  return semanticCanonicalDigest('memory-semantic-source-manifest-v1', [
    semanticEvidenceManifestHash(evidenceMembership),
    sourceMembers.map((item) => {
      const member = object(item) ?? {};
      return [
        member.source_ref_id,
        member.source_kind,
        member.project_id,
        member.session_id,
        member.resolution_id,
        member.resolution_revision,
        member.authority,
        member.content_digest,
        member.input_order,
      ];
    }),
  ]);
}

export function semanticProposalDigest(proposal: unknown): string {
  return semanticCanonicalDigest('memory-semantic-proposal-v1', proposal);
}

export function semanticClaimEvidenceManifestHash(proposal: unknown): string {
  const value = object(proposal);
  const state = object(value?.proposed_state);
  return semanticCanonicalDigest(
    'memory-semantic-claim-evidence-v1',
    (array(state?.claims) ?? []).map((item) => {
      const claim = object(item) ?? {};
      return [claim.proposal_claim_ref_id, claim.source_claim_ref_ids, claim.evidence_ref_ids];
    }),
  );
}

export function semanticMutationPlanDigest(plan: unknown): string {
  const value = object(plan);
  if (value === null) return semanticCanonicalDigest('validated-memory-mutation-plan-v1', null);
  const digestable = { ...value };
  delete digestable.plan_digest;
  return semanticCanonicalDigest('validated-memory-mutation-plan-v1', digestable);
}

export function semanticCommittedProjectionDigest(projection: unknown): string {
  const value = object(projection);
  if (value === null) return semanticCanonicalDigest('committed-semantic-projection-v1', null);
  const digestable = { ...value };
  delete digestable.commit_digest;
  return semanticCanonicalDigest('committed-semantic-projection-v1', digestable);
}

export function semanticSourceKindManifestHash(
  sourceKind: 'mid_resolution' | 'current_resolution',
  sourceMembers: readonly unknown[],
): string {
  return semanticCanonicalDigest(
    `memory-semantic-${sourceKind === 'mid_resolution' ? 'mid' : 'current'}-manifest-v1`,
    sourceMembers
      .filter((item) => asString(object(item)?.source_kind) === sourceKind)
      .map((item) => {
        const member = object(item) ?? {};
        return [
          member.source_ref_id,
          member.project_id,
          member.session_id,
          member.resolution_id,
          member.resolution_revision,
          member.authority,
          member.content_digest,
          member.input_order,
        ];
      }),
  );
}

export function committedEvidenceManifestHash(evidenceRefs: readonly unknown[]): string {
  return semanticCanonicalDigest(
    'committed-memory-evidence-manifest-v1',
    evidenceRefs.map((item) => {
      const ref = object(item) ?? {};
      return [ref.proposal_claim_ref_id, ref.evidence_ref_id, ref.memory_evidence_id];
    }),
  );
}

export function validateSemanticEnvelope(
  context: unknown,
  proposalOutput: unknown,
  mutationPlan: unknown,
  committedProjection?: unknown,
  trace?: unknown,
): SemanticEnvelopeValidationResult {
  const errors: string[] = [];
  const contextValue = object(context);
  const proposalValue = object(proposalOutput);
  const planValue = object(mutationPlan);
  if (contextValue === null || proposalValue === null || planValue === null) {
    return result(['SEMANTIC_ENVELOPE_OBJECT_REQUIRED']);
  }

  const members = array(contextValue.source_members) ?? [];
  const memberByRef = new Map<string, JsonObject>();
  const sourceResolutionIds = new Set<string>();
  const claimToEvidence = new Map<string, Set<string>>();
  const claimOwnerByRef = new Map<string, string>();
  const evidenceRefs = new Set<string>();
  const segmentIdentities = new Set<string>();
  const evidenceMembership = array(contextValue.evidence_membership) ?? [];
  const evidenceOrders: number[] = [];
  const orders: number[] = [];
  let claimCount = 0;
  let semanticCharacters = 0;
  let maximumDepth = 0;
  const sourceSessionIds = new Set(
    (array(contextValue.source_session_ids) ?? [])
      .map(asString)
      .filter((value): value is string => value !== null),
  );
  for (const item of evidenceMembership) {
    const evidence = object(item);
    const evidenceRef = asString(evidence?.evidence_ref_id);
    const evidenceOrder = asInteger(evidence?.input_order);
    if (evidence === null || evidenceRef === null || evidenceRefs.has(evidenceRef)) {
      errors.push('SEMANTIC_EVIDENCE_REF_INVALID');
      continue;
    }
    evidenceRefs.add(evidenceRef);
    if (evidenceOrder !== null) evidenceOrders.push(evidenceOrder);
    if (
      asString(evidence.trusted_role) !== 'elder' ||
      asString(evidence.content_kind) !== 'conversation' ||
      !sourceSessionIds.has(asString(evidence.session_id) ?? '')
    )
      errors.push('SEMANTIC_EVIDENCE_REF_INVALID');
    const segmentId = asString(evidence.segment_id);
    const sessionId = asString(evidence.session_id);
    const segmentIdentity = `${sessionId ?? ''}\u0000${segmentId ?? ''}`;
    if (segmentId === null || sessionId === null || segmentIdentities.has(segmentIdentity))
      errors.push('SEMANTIC_EVIDENCE_SEGMENT_DUPLICATE');
    else segmentIdentities.add(segmentIdentity);
  }
  if (!isContiguous(evidenceOrders) || evidenceRefs.size !== evidenceMembership.length)
    errors.push('SEMANTIC_EVIDENCE_ORDER_INVALID');
  const evidenceManifestHash = semanticEvidenceManifestHash(evidenceMembership);
  if (asString(contextValue.evidence_manifest_hash) !== evidenceManifestHash)
    errors.push('SEMANTIC_EVIDENCE_MANIFEST_MISMATCH');
  for (const item of members) {
    const member = object(item);
    const ref = asString(member?.source_ref_id);
    if (member === null || ref === null || memberByRef.has(ref)) {
      errors.push('SEMANTIC_SOURCE_REF_INVALID');
      continue;
    }
    memberByRef.set(ref, member);
    const resolutionId = asString(member.resolution_id);
    if (resolutionId !== null && sourceResolutionIds.has(resolutionId))
      errors.push('SEMANTIC_SOURCE_RESOLUTION_ID_DUPLICATE');
    else if (resolutionId !== null) sourceResolutionIds.add(resolutionId);
    const order = asInteger(member.input_order);
    if (order !== null) orders.push(order);
    if (asString(member.project_id) !== asString(contextValue.project_id))
      errors.push('SEMANTIC_SOURCE_SCOPE_INVALID');
    const sessionId = asString(member.session_id);
    if (sessionId === null || !sourceSessionIds.has(sessionId))
      errors.push('SEMANTIC_SOURCE_SCOPE_INVALID');
    const state = object(member.semantic_state);
    if (state === null || asString(member.content_digest) !== semanticContentDigest(state))
      errors.push('SEMANTIC_CONTENT_DIGEST_MISMATCH');
    validateStateDialect(state, errors, 'SEMANTIC_SOURCE_STATE_INVALID');
    if (findSemanticForbiddenKey(state)) errors.push('SEMANTIC_VALUE_KEY_FORBIDDEN');
    semanticCharacters += Array.from(JSON.stringify(sortJson(state))).length;
    maximumDepth = Math.max(maximumDepth, jsonDepth(state));
    for (const claimItem of array(state?.claims) ?? []) {
      const claim = object(claimItem);
      const claimRef = asString(claim?.source_claim_ref_id);
      if (claimRef === null || claimToEvidence.has(claimRef)) {
        errors.push('SEMANTIC_SOURCE_REF_INVALID');
        continue;
      }
      claimCount += 1;
      claimOwnerByRef.set(claimRef, ref);
      const claimEvidenceRefs = stringArray(claim?.evidence_ref_ids);
      const refs = new Set(claimEvidenceRefs);
      if (
        refs.size === 0 ||
        refs.size !== claimEvidenceRefs.length ||
        [...refs].some((evidenceRef) => !evidenceRefs.has(evidenceRef))
      )
        errors.push('SEMANTIC_EVIDENCE_REF_INVALID');
      claimToEvidence.set(claimRef, refs);
    }
  }
  if (!isContiguous(orders) || memberByRef.size !== members.length)
    errors.push('SEMANTIC_SOURCE_ORDER_INVALID');
  if (
    asString(contextValue.source_manifest_hash) !==
    semanticSourceManifestHash(members, evidenceMembership)
  )
    errors.push('SEMANTIC_SOURCE_MANIFEST_MISMATCH');
  const checkpoint = object(contextValue.source_checkpoint);
  if (
    asString(checkpoint?.project_id) !== asString(contextValue.project_id) ||
    !sameStringSets(
      stringArray(checkpoint?.source_session_ids),
      stringArray(contextValue.source_session_ids),
    ) ||
    asInteger(checkpoint?.expected_member_count) !== members.length ||
    asString(checkpoint?.member_manifest_hash) !== asString(contextValue.source_manifest_hash) ||
    asString(checkpoint?.evidence_manifest_hash) !== evidenceManifestHash
  )
    errors.push('SEMANTIC_CHECKPOINT_PARITY_INVALID');
  const limits = object(contextValue.limits);
  if (
    members.length > (asInteger(limits?.max_source_members) ?? -1) ||
    claimCount > (asInteger(limits?.max_claims) ?? -1) ||
    evidenceRefs.size > (asInteger(limits?.max_evidence_refs) ?? -1) ||
    semanticCharacters > (asInteger(limits?.max_semantic_characters) ?? -1) ||
    maximumDepth > (asInteger(limits?.max_json_depth) ?? -1)
  )
    errors.push('SEMANTIC_CONTEXT_LIMIT_EXCEEDED');
  const mode = asString(contextValue.mode);
  if (
    mode === 'working_to_mid' &&
    (sourceSessionIds.size !== 1 ||
      !sourceSessionIds.has(asString(contextValue.source_session_id) ?? '') ||
      members.some((member) => asString(object(member)?.source_kind) !== 'working_resolution'))
  )
    errors.push('SEMANTIC_WORKING_SCOPE_INVALID');
  if (
    mode === 'session_end_to_long' &&
    members.some((member) => {
      const kind = asString(object(member)?.source_kind);
      return kind !== 'mid_resolution' && kind !== 'current_resolution';
    })
  )
    errors.push('SEMANTIC_LONG_SOURCE_INVALID');
  if (mode === 'session_end_to_long') {
    if (!sourceSessionIds.has(asString(contextValue.source_session_id) ?? ''))
      errors.push('SEMANTIC_LONG_TRIGGER_SESSION_INVALID');
    const sourceSet = object(checkpoint?.source_set);
    const midMembers = members.filter(
      (member) => asString(object(member)?.source_kind) === 'mid_resolution',
    );
    const currentMembers = members.filter(
      (member) => asString(object(member)?.source_kind) === 'current_resolution',
    );
    if (
      asString(sourceSet?.kind) !== 'final_mid_and_current' ||
      asInteger(sourceSet?.mid_expected_count) !== midMembers.length ||
      midMembers.length === 0 ||
      asString(sourceSet?.mid_manifest_hash) !==
        semanticSourceKindManifestHash('mid_resolution', members) ||
      asInteger(sourceSet?.current_expected_count) !== currentMembers.length ||
      asString(sourceSet?.current_manifest_hash) !==
        semanticSourceKindManifestHash('current_resolution', members)
    )
      errors.push('SEMANTIC_LONG_SOURCE_SET_INVALID');
  } else if (asString(object(checkpoint?.source_set)?.kind) !== 'working_checkpoint') {
    errors.push('SEMANTIC_WORKING_SOURCE_SET_INVALID');
  }
  const policy = object(contextValue.policy);
  if (
    asString(policy?.deletion_scope_status) !== 'active' ||
    asString(policy?.retention_status) !== 'active'
  )
    errors.push('SEMANTIC_POLICY_NOT_ACTIVE');

  if (asString(proposalValue.source_manifest_hash) !== asString(contextValue.source_manifest_hash))
    errors.push('SEMANTIC_PROPOSAL_MANIFEST_MISMATCH');
  const proposals = array(proposalValue.proposals) ?? [];
  const proposalById = new Map<string, JsonObject>();
  const proposalClaimRefs = new Set<string>();
  const proposalTargetSlots = new Set<string>();
  for (const item of proposals) {
    const proposal = object(item);
    const proposalId = asString(proposal?.proposal_id);
    if (proposal === null || proposalId === null || proposalById.has(proposalId)) {
      errors.push('SEMANTIC_PROPOSAL_INVALID');
      continue;
    }
    proposalById.set(proposalId, proposal);
    const refs = stringArray(proposal.source_member_ref_ids);
    const declaredSourceRefs = new Set(refs);
    if (
      refs.length === 0 ||
      refs.length !== declaredSourceRefs.size ||
      refs.some((ref) => !memberByRef.has(ref))
    )
      errors.push('SEMANTIC_PROPOSAL_SOURCE_INVALID');
    const intent = asString(proposal.semantic_intent);
    if ((intent === 'merge' || intent === 'compress') && new Set(refs).size < 2)
      errors.push('SEMANTIC_PROPOSAL_SOURCE_INVALID');
    const target = object(proposal.target);
    const targetKind = asString(target?.kind);
    const targetRef = asString(target?.existing_source_ref_id);
    if (
      (targetKind === 'new_slot' && targetRef !== null) ||
      (targetKind === 'existing_slot' &&
        (targetRef === null || !memberByRef.has(targetRef) || !declaredSourceRefs.has(targetRef)))
    )
      errors.push('SEMANTIC_PROPOSAL_TARGET_INVALID');
    if (targetRef !== null && asString(memberByRef.get(targetRef)?.authority) === 'human_confirmed')
      errors.push('SEMANTIC_HUMAN_AUTHORITY_OVERRIDE_FORBIDDEN');
    const state = object(proposal.proposed_state);
    if (findSemanticForbiddenKey(state)) errors.push('SEMANTIC_VALUE_KEY_FORBIDDEN');
    if (intent === 'mark_uncertain' && asString(state?.semantic_status) !== 'uncertain')
      errors.push('SEMANTIC_PROPOSAL_STATUS_INVALID');
    const proposedClaims = array(state?.claims) ?? [];
    validateStateDialect(state, errors, 'SEMANTIC_PROPOSAL_STATE_INVALID');
    const proposalTargetSlot = semanticSlotKey(state);
    if (proposalTargetSlot !== null && proposalTargetSlots.has(proposalTargetSlot))
      errors.push('SEMANTIC_PROPOSAL_TARGET_SLOT_DUPLICATE');
    else if (proposalTargetSlot !== null) proposalTargetSlots.add(proposalTargetSlot);
    if (targetRef !== null) {
      const targetState = object(memberByRef.get(targetRef)?.semantic_state);
      if (
        asString(targetState?.semantic_kind) !== asString(state?.semantic_kind) ||
        asString(targetState?.canonical_key) !== asString(state?.canonical_key)
      )
        errors.push('SEMANTIC_PROPOSAL_SLOT_MISMATCH');
    }
    if (asString(state?.semantic_status) === 'disputed' && proposedClaims.length < 2)
      errors.push('SEMANTIC_PROPOSAL_STATUS_INVALID');
    for (const claimItem of proposedClaims) {
      const claim = object(claimItem);
      const proposalClaimRef = asString(claim?.proposal_claim_ref_id);
      if (proposalClaimRef === null || proposalClaimRefs.has(proposalClaimRef))
        errors.push('SEMANTIC_PROPOSAL_CLAIM_DUPLICATE');
      else proposalClaimRefs.add(proposalClaimRef);
      const sourceClaimRefs = stringArray(claim?.source_claim_ref_ids);
      const proposedEvidenceRefs = stringArray(claim?.evidence_ref_ids);
      if (
        sourceClaimRefs.length === 0 ||
        sourceClaimRefs.length !== new Set(sourceClaimRefs).size ||
        sourceClaimRefs.some((ref) => !claimToEvidence.has(ref)) ||
        sourceClaimRefs.some((ref) => !declaredSourceRefs.has(claimOwnerByRef.get(ref) ?? '')) ||
        proposedEvidenceRefs.length === 0 ||
        proposedEvidenceRefs.length !== new Set(proposedEvidenceRefs).size ||
        proposedEvidenceRefs.some((ref) => {
          if (!evidenceRefs.has(ref)) return true;
          return !sourceClaimRefs.some((claimRef) => claimToEvidence.get(claimRef)?.has(ref));
        })
      )
        errors.push('SEMANTIC_PROPOSAL_EVIDENCE_INVALID');
    }
  }

  const proposalDigest = semanticProposalDigest(proposalValue);
  if (
    asString(planValue.source_manifest_hash) !== asString(contextValue.source_manifest_hash) ||
    asString(planValue.proposal_digest) !== proposalDigest
  )
    errors.push('SEMANTIC_MUTATION_PLAN_LINK_INVALID');
  const planEntries = array(planValue.entries) ?? [];
  const planByProposal = new Map<string, JsonObject>();
  const planAuthorityWrites = new Set<string>();
  const planTargetSlots = new Set<string>();
  for (const item of planEntries) {
    const entry = object(item);
    const proposalId = asString(entry?.proposal_id);
    if (entry === null || proposalId === null || planByProposal.has(proposalId)) {
      errors.push('SEMANTIC_MUTATION_PLAN_INVALID');
      continue;
    }
    planByProposal.set(proposalId, entry);
    const proposal = proposalById.get(proposalId);
    if (proposal === undefined) {
      errors.push('SEMANTIC_MUTATION_PLAN_INVALID');
      continue;
    }
    if (
      !sameStrings(
        stringArray(entry.source_member_ref_ids),
        stringArray(proposal.source_member_ref_ids),
      )
    )
      errors.push('SEMANTIC_MUTATION_PLAN_SOURCE_INVALID');
    const target = object(proposal.target);
    const targetKind = asString(target?.kind);
    const entryTargetKind = asString(entry.target_kind);
    const authorityRef = object(entry.target_authority_ref);
    const planTargetSlot = semanticSlotKey(object(proposal.proposed_state));
    if (planTargetSlot !== null && planTargetSlots.has(planTargetSlot))
      errors.push('SEMANTIC_MUTATION_PLAN_TARGET_SLOT_DUPLICATE');
    else if (planTargetSlot !== null) planTargetSlots.add(planTargetSlot);
    if (entryTargetKind !== targetKind) errors.push('SEMANTIC_MUTATION_PLAN_TARGET_INVALID');
    const authorityResolutionId = asString(authorityRef?.resolution_id);
    if (
      entryTargetKind === 'existing_slot' &&
      authorityResolutionId !== null &&
      planAuthorityWrites.has(authorityResolutionId)
    )
      errors.push('SEMANTIC_MUTATION_PLAN_AUTHORITY_DUPLICATE');
    else if (entryTargetKind === 'existing_slot' && authorityResolutionId !== null)
      planAuthorityWrites.add(authorityResolutionId);
    if (targetKind === 'new_slot' && authorityRef !== null)
      errors.push('SEMANTIC_MUTATION_PLAN_TARGET_INVALID');
    if (targetKind === 'existing_slot') {
      const source = memberByRef.get(asString(target?.existing_source_ref_id) ?? '');
      if (
        source === undefined ||
        asString(authorityRef?.resolution_id) !== asString(source.resolution_id) ||
        asInteger(authorityRef?.expected_revision) !== asInteger(source.resolution_revision)
      )
        errors.push('SEMANTIC_MUTATION_PLAN_TARGET_INVALID');
    }
    if (asString(entry.proposed_state_digest) !== semanticContentDigest(proposal.proposed_state))
      errors.push('SEMANTIC_MUTATION_PLAN_STATE_INVALID');
    if (
      asString(entry.claim_evidence_manifest_hash) !== semanticClaimEvidenceManifestHash(proposal)
    )
      errors.push('SEMANTIC_MUTATION_PLAN_EVIDENCE_INVALID');
  }
  if (planByProposal.size !== proposalById.size)
    errors.push('SEMANTIC_MUTATION_PLAN_PARITY_INVALID');
  const planDigest = semanticMutationPlanDigest(planValue);
  if (asString(planValue.plan_digest) !== planDigest)
    errors.push('SEMANTIC_MUTATION_PLAN_DIGEST_MISMATCH');

  if (committedProjection !== undefined) {
    validateCommittedProjection(
      contextValue,
      proposalValue,
      planValue,
      committedProjection,
      trace,
      memberByRef,
      errors,
    );
  } else if (trace !== undefined) {
    errors.push('SEMANTIC_TRACE_WITHOUT_COMMIT');
  }
  return result(errors);
}

export function validateP1LongInputBoundary(value: unknown): SemanticEnvelopeValidationResult {
  const errors: string[] = [];
  visit(value, (key, item) => {
    if (
      key === 'long_memory' ||
      (key === 'layer' && item === 'long') ||
      (key === 'source_kind' && item === 'long_resolution')
    )
      errors.push('P1_LONG_INPUT_FORBIDDEN');
  });
  return result(errors);
}

function validateCommittedProjection(
  context: JsonObject,
  proposalOutput: JsonObject,
  mutationPlan: JsonObject,
  committedProjection: unknown,
  trace: unknown,
  memberByRef: ReadonlyMap<string, JsonObject>,
  errors: string[],
): void {
  const committed = object(committedProjection);
  if (committed === null) {
    errors.push('SEMANTIC_COMMIT_BRIDGE_INVALID');
    return;
  }
  if (
    asString(committed.source_manifest_hash) !== asString(context.source_manifest_hash) ||
    asString(committed.proposal_digest) !== semanticProposalDigest(proposalOutput) ||
    asString(committed.plan_digest) !== asString(mutationPlan.plan_digest)
  )
    errors.push('SEMANTIC_COMMIT_BRIDGE_LINK_INVALID');
  if (asString(committed.commit_digest) !== semanticCommittedProjectionDigest(committed))
    errors.push('SEMANTIC_COMMIT_DIGEST_MISMATCH');
  const planByProposal = new Map(
    (array(mutationPlan.entries) ?? []).map((item) => {
      const entry = object(item) ?? {};
      return [asString(entry.proposal_id) ?? '', entry] as const;
    }),
  );
  const committedByProposal = new Map<string, JsonObject>();
  const committedAuthorityMetadata = new Map<string, string>();
  const committedTargetSlots = new Set<string>();
  const globalCommittedPairs = new Set<string>();
  const globalMemoryEvidenceIds = new Set<string>();
  for (const item of array(committed.entries) ?? []) {
    const entry = object(item);
    const proposalId = asString(entry?.proposal_id);
    if (entry === null || proposalId === null || committedByProposal.has(proposalId)) {
      errors.push('SEMANTIC_COMMIT_BRIDGE_INVALID');
      continue;
    }
    committedByProposal.set(proposalId, entry);
    const planEntry = planByProposal.get(proposalId);
    if (
      planEntry === undefined ||
      !sameStrings(
        stringArray(entry.source_checkpoint_member_refs),
        stringArray(planEntry.source_member_ref_ids),
      ) ||
      stringArray(entry.source_checkpoint_member_refs).some((ref) => !memberByRef.has(ref))
    )
      errors.push('SEMANTIC_COMMIT_SOURCE_INVALID');
    const targetLayer = object(entry.target_layer);
    const expectedLayer = asString(context.mode) === 'working_to_mid' ? 'mid' : 'long';
    if (asString(targetLayer?.layer) !== expectedLayer)
      errors.push('SEMANTIC_COMMIT_LAYER_INVALID');
    const committedAuthority = object(entry.committed_authority_ref);
    const committedResolutionId = asString(committedAuthority?.resolution_id);
    const committedSlot = semanticSlotKey(committedAuthority);
    if (committedSlot !== null && committedTargetSlots.has(committedSlot))
      errors.push('SEMANTIC_COMMIT_TARGET_SLOT_DUPLICATE');
    else if (committedSlot !== null) committedTargetSlots.add(committedSlot);
    if (committedResolutionId !== null) {
      const authorityMetadata = semanticAuthorityMetadata(committedAuthority);
      const previousMetadata = committedAuthorityMetadata.get(committedResolutionId);
      if (previousMetadata !== undefined) {
        errors.push('SEMANTIC_COMMIT_AUTHORITY_ID_DUPLICATE');
        if (previousMetadata !== authorityMetadata)
          errors.push('SEMANTIC_COMMIT_AUTHORITY_METADATA_CONFLICT');
      } else committedAuthorityMetadata.set(committedResolutionId, authorityMetadata);
    }
    const sourceResolutionIds = new Set(
      [...memberByRef.values()]
        .map((member) => asString(member.resolution_id))
        .filter((value): value is string => value !== null),
    );
    if (
      asString(planEntry?.target_kind) === 'new_slot' &&
      committedResolutionId !== null &&
      sourceResolutionIds.has(committedResolutionId)
    )
      errors.push('SEMANTIC_COMMIT_AUTHORITY_ID_COLLISION');
    if (
      asString(planEntry?.target_kind) === 'new_slot' &&
      asInteger(committedAuthority?.resolution_revision) !== 1
    )
      errors.push('SEMANTIC_COMMIT_NEW_AUTHORITY_REVISION_INVALID');
    if (asString(planEntry?.target_kind) === 'existing_slot') {
      const targetAuthority = object(planEntry?.target_authority_ref);
      if (
        committedResolutionId !== asString(targetAuthority?.resolution_id) ||
        asInteger(committedAuthority?.resolution_revision) !==
          (asInteger(targetAuthority?.expected_revision) ?? -1) + 1
      )
        errors.push('SEMANTIC_COMMIT_EXISTING_AUTHORITY_INVALID');
    }
    const evidence = object(entry.committed_evidence_manifest);
    const refs = array(evidence?.evidence_refs) ?? [];
    const committedPairs = new Set<string>();
    for (const refItem of refs) {
      const ref = object(refItem);
      const proposalClaimRefId = asString(ref?.proposal_claim_ref_id);
      const evidenceRefId = asString(ref?.evidence_ref_id);
      const memoryEvidenceId = asString(ref?.memory_evidence_id);
      if (
        proposalClaimRefId === null ||
        evidenceRefId === null ||
        memoryEvidenceId === null ||
        committedPairs.has(`${proposalClaimRefId}\u0000${evidenceRefId}`) ||
        globalCommittedPairs.has(`${proposalClaimRefId}\u0000${evidenceRefId}`)
      )
        errors.push('SEMANTIC_COMMIT_EVIDENCE_DUPLICATE');
      if (memoryEvidenceId !== null && globalMemoryEvidenceIds.has(memoryEvidenceId))
        errors.push('SEMANTIC_COMMIT_MEMORY_EVIDENCE_ID_DUPLICATE');
      if (proposalClaimRefId !== null && evidenceRefId !== null) {
        const pair = `${proposalClaimRefId}\u0000${evidenceRefId}`;
        committedPairs.add(pair);
        globalCommittedPairs.add(pair);
      }
      if (memoryEvidenceId !== null) globalMemoryEvidenceIds.add(memoryEvidenceId);
    }
    if (
      asInteger(evidence?.expected_evidence_count) !== refs.length ||
      asString(evidence?.evidence_manifest_hash) !== committedEvidenceManifestHash(refs)
    )
      errors.push('SEMANTIC_COMMIT_EVIDENCE_INVALID');
    const proposal = (array(proposalOutput.proposals) ?? [])
      .map(object)
      .find((candidate) => asString(candidate?.proposal_id) === proposalId);
    const proposedState = object(proposal?.proposed_state);
    if (
      asString(committedAuthority?.semantic_kind) !== asString(proposedState?.semantic_kind) ||
      asString(committedAuthority?.canonical_key) !== asString(proposedState?.canonical_key) ||
      nullableString(committedAuthority?.value_kind) !==
        nullableString(proposedState?.value_kind) ||
      asString(committedAuthority?.resolution_kind) !== asString(proposedState?.resolution_kind) ||
      asString(committedAuthority?.semantic_status) !== asString(proposedState?.semantic_status)
    )
      errors.push('SEMANTIC_COMMIT_STATE_MISMATCH');
    const allowedPairs = new Set<string>();
    for (const claimItem of array(object(proposal?.proposed_state)?.claims) ?? []) {
      const claim = object(claimItem);
      const proposalClaimRefId = asString(claim?.proposal_claim_ref_id);
      if (proposalClaimRefId !== null)
        for (const evidenceRef of stringArray(claim?.evidence_ref_ids))
          allowedPairs.add(`${proposalClaimRefId}\u0000${evidenceRef}`);
    }
    if (
      refs.some((ref) => {
        const value = object(ref);
        const proposalClaimRefId = asString(value?.proposal_claim_ref_id);
        const evidenceRefId = asString(value?.evidence_ref_id);
        return (
          proposalClaimRefId === null ||
          evidenceRefId === null ||
          !allowedPairs.has(`${proposalClaimRefId}\u0000${evidenceRefId}`)
        );
      })
    )
      errors.push('SEMANTIC_COMMIT_EVIDENCE_INVALID');
    if (
      committedPairs.size !== allowedPairs.size ||
      [...allowedPairs].some((pair) => !committedPairs.has(pair))
    )
      errors.push('SEMANTIC_COMMIT_EVIDENCE_INCOMPLETE');
  }
  if (committedByProposal.size !== planByProposal.size)
    errors.push('SEMANTIC_COMMIT_PARITY_INVALID');
  if (findDurableContentKey(committed)) errors.push('SEMANTIC_DURABLE_CONTENT_FORBIDDEN');
  if (trace !== undefined) validateSemanticTrace(context, committed, trace, errors);
}

function validateSemanticTrace(
  context: JsonObject,
  committed: JsonObject,
  traceValue: unknown,
  errors: string[],
): void {
  const trace = object(traceValue);
  if (trace === null) {
    errors.push('SEMANTIC_TRACE_INVALID');
    return;
  }
  if (
    asString(trace.source_manifest_hash) !== asString(committed.source_manifest_hash) ||
    asString(trace.proposal_digest) !== asString(committed.proposal_digest) ||
    asString(trace.plan_digest) !== asString(committed.plan_digest) ||
    asString(trace.commit_digest) !== asString(committed.commit_digest)
  )
    errors.push('SEMANTIC_TRACE_LINK_INVALID');
  const members = array(context.source_members) ?? [];
  const traceMembers = array(trace.source_memberships) ?? [];
  if (traceMembers.length !== members.length) errors.push('SEMANTIC_TRACE_SOURCE_INVALID');
  for (let index = 0; index < members.length; index += 1) {
    const source = object(members[index]);
    const actual = object(traceMembers[index]);
    if (
      source === null ||
      actual === null ||
      asString(actual.source_ref_id) !== asString(source.source_ref_id) ||
      asString(actual.resolution_id) !== asString(source.resolution_id) ||
      asInteger(actual.resolution_revision) !== asInteger(source.resolution_revision) ||
      asInteger(actual.input_order) !== asInteger(source.input_order) ||
      asString(actual.content_digest) !== asString(source.content_digest)
    )
      errors.push('SEMANTIC_TRACE_SOURCE_INVALID');
  }
  const committedEntries = array(committed.entries) ?? [];
  const committedRefs = array(trace.committed_refs) ?? [];
  if (committedRefs.length !== committedEntries.length)
    errors.push('SEMANTIC_TRACE_COMMIT_INVALID');
  for (let index = 0; index < committedEntries.length; index += 1) {
    const entry = object(committedEntries[index]);
    const actual = object(committedRefs[index]);
    const authority = object(entry?.committed_authority_ref);
    const evidence = object(entry?.committed_evidence_manifest);
    const layer = object(entry?.target_layer);
    if (
      actual === null ||
      asString(actual.proposal_id) !== asString(entry?.proposal_id) ||
      asString(actual.resolution_id) !== asString(authority?.resolution_id) ||
      asInteger(actual.resolution_revision) !== asInteger(authority?.resolution_revision) ||
      asString(actual.evidence_manifest_hash) !== asString(evidence?.evidence_manifest_hash) ||
      asString(actual.layer_identity_id) !== asString(layer?.layer_identity_id) ||
      asString(actual.layer_revision_id) !== asString(layer?.layer_revision_id)
    )
      errors.push('SEMANTIC_TRACE_COMMIT_INVALID');
  }
  if (findDurableContentKey(trace)) errors.push('SEMANTIC_DURABLE_CONTENT_FORBIDDEN');
}

function findDurableContentKey(value: unknown): boolean {
  let found = false;
  visit(value, (key) => {
    if (DURABLE_CONTENT_KEYS.has(key)) found = true;
  });
  return found;
}

function validateStateDialect(state: JsonObject | null, errors: string[], errorCode: string): void {
  if (state === null) {
    errors.push(errorCode);
    return;
  }
  const status = asString(state.semantic_status);
  const valueKind = asString(state.value_kind);
  const resolutionKind = asString(state.resolution_kind);
  const value = state.value;
  if (status === 'disputed') {
    if (
      valueKind !== null ||
      value !== null ||
      resolutionKind !== 'conflict_set' ||
      (array(state.claims) ?? []).length < 2
    )
      errors.push(errorCode);
    return;
  }
  const expectedResolutionKind =
    valueKind === 'exact'
      ? 'single'
      : valueKind === 'range'
        ? 'range'
        : valueKind === 'unknown'
          ? 'unknown'
          : null;
  if (expectedResolutionKind === null || resolutionKind !== expectedResolutionKind)
    errors.push(errorCode);
}

function semanticSlotKey(value: JsonObject | null): string | null {
  const semanticKind = asString(value?.semantic_kind);
  const canonicalKey = asString(value?.canonical_key);
  return semanticKind === null || canonicalKey === null
    ? null
    : `${semanticKind}\u0000${canonicalKey}`;
}

function semanticAuthorityMetadata(value: JsonObject | null): string {
  return JSON.stringify([
    asInteger(value?.resolution_revision),
    asString(value?.semantic_kind),
    asString(value?.canonical_key),
    nullableString(value?.value_kind),
    asString(value?.resolution_kind),
    asString(value?.semantic_status),
  ]);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function findSemanticForbiddenKey(value: unknown): boolean {
  let found = false;
  const denied = [
    'raw_transcript',
    'transcript',
    'prompt',
    'provider_payload',
    'provider_request',
    'provider_response',
    'sql',
    'cas',
  ];
  visit(value, (key) => {
    const normalized = key.toLowerCase();
    if (denied.some((token) => normalized.includes(token))) found = true;
  });
  return found;
}

function visit(value: unknown, inspect: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, inspect);
    return;
  }
  const record = object(value);
  if (record === null) return;
  for (const [key, item] of Object.entries(record)) {
    inspect(key, item);
    visit(item, inspect);
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  const record = object(value);
  if (record === null) return value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortJson(record[key])]),
  );
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(jsonDepth));
  const record = object(value);
  if (record === null) return 0;
  return 1 + Math.max(0, ...Object.values(record).map(jsonDepth));
}

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function array(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function stringArray(value: unknown): string[] {
  return (array(value) ?? []).map(asString).filter((item): item is string => item !== null);
}

function isContiguous(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value, index) => value === index);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSets(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function result(errors: readonly string[]): SemanticEnvelopeValidationResult {
  const unique = [...new Set(errors)];
  return { valid: unique.length === 0, errors: unique, verification: 'contract' };
}
