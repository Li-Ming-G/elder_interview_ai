import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  EMPTY_MANIFEST_HASH,
  effectiveTextDigest,
  manifestHash,
} from '../ai-runtime/ai-provenance.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  MemoryResolutionKind,
  Prisma,
  type AiJobInputSegment,
  type MemoryLayerIdentity,
  type MemoryResolutionAuthority,
} from '../generated/prisma/client.js';
import {
  MEMORY_P2_MANIFEST_ALGORITHM_VERSION,
  MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT,
  MEMORY_P2_MIGRATION_SCHEMA_VERSION,
  MemoryP2PersistenceError,
  memoryP2CheckpointManifestHash,
  memoryP2ClaimEvidenceManifestHash,
  memoryP2LayerMemberManifestHash,
  memoryP2LongSourceManifestHash,
  memoryP2SourceSessionSetHash,
  type MemoryP2ClaimRecoveryLeaseInput,
  type MemoryP2ClaimInput,
  type MemoryP2CommitInput,
  type MemoryP2CommitResult,
  type MemoryP2FreezeCheckpointInput,
  type MemoryP2FreezeLongJobInput,
  type MemoryP2FrozenCheckpoint,
  type MemoryP2TerminalizeUnavailableInput,
  type MemoryP2LeaseToken,
  type MemoryP2EvidenceInput,
  type MemoryP2StaleRecoveryCandidate,
  type MemoryP2TraceSourceInput,
} from './memory-p2-persistence.types.js';
import type {
  MemoryP2CommittedAuthority,
  MemoryP2RecoveryAuthority,
  MemoryP2RecoveryCasResult,
  MemoryP2RecoveryCommand,
  MemoryP2TraceReferenceAuthority,
  MemoryP2TraceReference,
} from './memory-p2-observability.types.js';
import {
  classifyMemoryGateEvidenceRole,
  memoryGateEligibility,
  MemoryGateCorrectionService,
  type MemoryGateCandidate,
  type MemoryGateEvidenceReference,
} from './memory-gate-correction.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';

type TransactionClient = Prisma.TransactionClient;
type DatabaseClient = PrismaService | TransactionClient;

function resolutionValueKind(value: MemoryResolutionKind): 'exact' | 'range' | 'unknown' | null {
  if (value === MemoryResolutionKind.range) return 'range';
  if (value === MemoryResolutionKind.unknown || value === MemoryResolutionKind.review_required)
    return 'unknown';
  return 'exact';
}

@Injectable()
export class MemoryP2PersistenceRepository {
  public readonly transactionOwnership = 'existing_ai_job_coordinator' as const;
  private readonly gate = new MemoryGateCorrectionService();
  public constructor(private readonly prisma: PrismaService) {}

  public async freezeCheckpoint(
    input: MemoryP2FreezeCheckpointInput,
    transaction?: TransactionClient,
  ): Promise<MemoryP2FrozenCheckpoint> {
    const work = async (tx: TransactionClient): Promise<MemoryP2FrozenCheckpoint> => {
      await this.assertMigrationReady(tx);
      this.assertLease(input.lease);
      await this.lockScope(tx, input.projectId, input.sourceSessionId);
      await tx.$queryRaw`SELECT "id" FROM "memory_working_snapshot" WHERE "id" = ${input.sourceWorkingSnapshotId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "memory_thread_revision" WHERE "id" = ${input.sourceThreadRevisionId}::uuid FOR SHARE`;
      for (const member of [...input.members].sort((left, right) =>
        left.resolutionAuthorityId.localeCompare(right.resolutionAuthorityId),
      )) {
        await tx.$queryRaw`SELECT "id" FROM "memory_resolution" WHERE "id" = ${member.resolutionRowId}::uuid FOR SHARE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${input.aiJobId}::uuid FOR UPDATE`;

      const job = await tx.aiJob.findUnique({ where: { id: input.aiJobId } });
      const replay = await tx.memoryEvolutionCheckpoint.findUnique({
        where: { p2ProducerJobId: input.aiJobId },
      });
      if (replay !== null) {
        if (
          replay.id !== input.checkpointId ||
          replay.projectId !== input.projectId ||
          replay.sourceSessionId !== input.sourceSessionId ||
          replay.rootIdentity !== input.rootIdentity ||
          replay.memberManifestHash !== input.memberManifestHash ||
          replay.deletionScopeDigest !== input.deletionScopeDigest
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
        const trace = await tx.decisionTraceMemorySemantic.findUnique({
          where: { aiJobId: input.aiJobId },
        });
        const projection = await tx.memoryP2JobProjection.findUnique({
          where: { aiJobId: input.aiJobId },
        });
        if (
          trace === null ||
          projection === null ||
          projection.recoveryLeaseOwner !== input.lease.owner ||
          projection.recoveryLeaseEpoch !== input.lease.epoch ||
          projection.recoveryLeaseExpiresAt.getTime() !== input.lease.expiresAt.getTime()
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
        return { checkpointId: replay.id, replayed: true, traceId: trace.traceId };
      }
      if (
        job === null ||
        job.projectId !== input.projectId ||
        !['mid_online', 'mid_final'].includes(job.jobType) ||
        job.status !== 'running' ||
        job.triggerDedupeKey?.startsWith('memory-p2-v1:') !== true ||
        job.policyRevision !== input.aiPolicyRevision ||
        job.retentionPolicyVersion !== input.retentionPolicyVersion ||
        job.retentionState !== 'active' ||
        job.expiresAt.getTime() !== input.expiresAt.getTime() ||
        input.sourceWorkingSnapshotContractVersion !== 'memory-maintainer-v1.2'
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_JOB_NOT_RUNNING');
      if (input.lease.expiresAt > input.expiresAt)
        throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');

      this.assertOrdered(input.members);
      this.assertOrdered(input.sourceTraceReferences);
      this.assertUnique(input.members.map((member) => member.resolutionAuthorityId));
      this.assertUnique(input.members.map((member) => member.resolutionRowId));
      this.assertUnique(
        input.sourceTraceReferences.map((source) =>
          [source.sourceKind, source.sourceId, source.sourceRevision].join(':'),
        ),
      );
      if (
        input.expectedMemberCount !== input.members.length ||
        input.members.length === 0 ||
        memoryP2CheckpointManifestHash(input.members) !== input.memberManifestHash
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_MANIFEST_INVALID');
      const sourceResolutionMembers = await tx.memoryResolutionMember.findMany({
        where: {
          memoryResolutionId: { in: input.members.map((member) => member.resolutionRowId) },
        },
      });
      const sourceClaimCounts = new Map<string, number>();
      for (const member of sourceResolutionMembers)
        sourceClaimCounts.set(
          member.memoryResolutionId,
          (sourceClaimCounts.get(member.memoryResolutionId) ?? 0) + 1,
        );
      if (
        input.members.some(
          (member) => (sourceClaimCounts.get(member.resolutionRowId) ?? 0) !== member.claimCount,
        )
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
      const expectedJobType =
        input.triggerKind === 'session_final_flush' ? 'mid_final' : 'mid_online';
      if (job.jobType !== expectedJobType)
        throw new MemoryP2PersistenceError('MEMORY_P2_INPUT_SCOPE_MISMATCH');

      await tx.memoryEvolutionCheckpoint.create({
        data: {
          aiPolicyRevision: input.aiPolicyRevision,
          currentExpectedCount: input.sourceCurrentExpectedCount,
          currentManifestHash: input.sourceCurrentManifestHash,
          deletionScopeDigest: input.deletionScopeDigest,
          deletionScopePolicyRevision: input.deletionScopePolicyRevision,
          evidenceManifestHash: input.evidenceManifestHash,
          expectedMemberCount: input.expectedMemberCount,
          id: input.checkpointId,
          lifecycleStatus: 'frozen',
          manifestAlgorithmVersion: MEMORY_P2_MANIFEST_ALGORITHM_VERSION,
          memberManifestHash: input.memberManifestHash,
          midExpectedCount: input.midExpectedCount,
          midManifestHash: input.midManifestHash,
          p2PolicyContractRevision: input.p2PolicyContractRevision,
          p2ProducerJobId: input.aiJobId,
          p2RetentionContractVersion: input.p2RetentionContractVersion,
          projectId: input.projectId,
          retentionPolicyVersion: input.retentionPolicyVersion,
          rootIdentity: input.rootIdentity,
          sourceBoundaryManifestHash: input.sourceBoundaryManifestHash,
          sourceP1TerminalJobId: input.sourceP1TerminalJobId,
          sourceP1TerminalOutcome: input.sourceP1TerminalOutcome,
          sourceP1TerminalStatus: input.sourceP1TerminalStatus,
          sourceResolutionManifestHash: input.sourceResolutionManifestHash,
          sourceSessionId: input.sourceSessionId,
          sourceSetKind: input.sourceSetKind,
          sourceThreadId: input.sourceThreadId,
          sourceThreadManifestHash: input.sourceThreadManifestHash,
          sourceThreadRevision: input.sourceThreadRevision,
          sourceThreadRevisionId: input.sourceThreadRevisionId,
          sourceThreadStatus: input.sourceThreadStatus,
          sourceSnapshotContractVersion: input.sourceWorkingSnapshotContractVersion,
          sourceWorkingSnapshotId: input.sourceWorkingSnapshotId,
          triggerIdentity: input.triggerIdentity,
          triggerKind: input.triggerKind,
        },
      });
      await tx.memoryEvolutionCheckpointMember.createMany({
        data: input.members.map((member) => ({
          boundaryStatus: member.boundaryStatus,
          checkpointId: input.checkpointId,
          claimCount: member.claimCount,
          inputOrder: member.inputOrder,
          membershipDigest: member.membershipDigest,
          resolutionAuthorityId: member.resolutionAuthorityId,
          resolutionRevision: member.resolutionRevision,
          resolutionRowId: member.resolutionRowId,
          semanticStatus: member.semanticStatus,
        })),
      });
      await tx.memoryP2JobProjection.create({
        data: {
          aiJobId: input.aiJobId,
          deletionScopeDigest: input.deletionScopeDigest,
          deletionScopePolicyRevision: input.deletionScopePolicyRevision,
          jobKind: job.jobType,
          p2PolicyContractRevision: input.p2PolicyContractRevision,
          p2PolicyRevision: input.p2PolicyRevision,
          p2RetentionContractVersion: input.p2RetentionContractVersion,
          p2RetentionPolicyVersion: input.p2RetentionPolicyVersion,
          recoveryLeaseEpoch: input.lease.epoch,
          recoveryLeaseExpiresAt: input.lease.expiresAt,
          recoveryLeaseOwner: input.lease.owner,
          sourceCheckpointId: input.checkpointId,
          sourceP1TerminalJobId: input.sourceP1TerminalJobId,
          sourceRevisionDigest: input.sourceRevisionDigest,
          sourceThreadRevisionId: input.sourceThreadRevisionId,
          sourceWorkingSnapshotId: input.sourceWorkingSnapshotId,
          targetSlotDigest: input.targetSlotDigest,
          triggerIdentityHash: input.triggerIdentityHash,
        },
      });
      await tx.decisionTrace.create({
        data: {
          activeThreadId: input.sourceThreadId,
          aiJobId: input.aiJobId,
          contextRevision: 0,
          decisionOutcome: 'unavailable',
          directorInvoked: false,
          expiresAt: input.expiresAt,
          generationId: input.traceGenerationId,
          id: input.traceId,
          inputHash: job.inputHash,
          memoryOutcome: 'unjudged',
          ownerActorId: input.ownerActorId,
          projectId: input.projectId,
          requestId: input.traceRequestId,
          sessionId: input.sourceSessionId,
          stage: 'frozen',
          stageTimingsJson: {},
          startedAt: new Date(),
          status: 'running',
          traceKind: 'memory_layer_evolve',
          triggerType: 'memory_layer_evolve',
        },
      });
      await tx.decisionTraceMemorySemantic.create({
        data: {
          aiJobId: input.aiJobId,
          deletionScopeDigest: input.deletionScopeDigest,
          sourceManifestHash: input.sourceRevisionDigest,
          traceId: input.traceId,
        },
      });
      await tx.decisionTraceMemorySourceReference.createMany({
        data: input.sourceTraceReferences.map((source) =>
          this.traceSourceRow(input.traceId, source),
        ),
      });
      await tx.memoryP2RetentionTarget.createMany({
        data: [
          this.retentionTarget(input.aiJobId, 'job', input.aiJobId, 0),
          this.retentionTarget(input.aiJobId, 'trace', input.traceId, 1),
          this.retentionTarget(input.aiJobId, 'checkpoint', input.checkpointId, 2),
        ],
      });
      return { checkpointId: input.checkpointId, replayed: false, traceId: input.traceId };
    };
    if (transaction !== undefined) return work(transaction);
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  public async freezeLongJob(
    input: MemoryP2FreezeLongJobInput,
    transaction?: TransactionClient,
  ): Promise<MemoryP2FrozenCheckpoint> {
    const work = async (tx: TransactionClient): Promise<MemoryP2FrozenCheckpoint> => {
      await this.assertMigrationReady(tx);
      this.assertLease(input.lease);
      await this.lockScope(tx, input.projectId, input.sourceSessionId);
      await tx.$queryRaw`SELECT "id" FROM "memory_evolution_checkpoint" WHERE "id" = ${input.sourceFinalMidCheckpointId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${input.aiJobId}::uuid FOR UPDATE`;
      const job = await tx.aiJob.findUnique({ where: { id: input.aiJobId } });
      const checkpoint = await tx.memoryEvolutionCheckpoint.findUnique({
        where: { id: input.sourceFinalMidCheckpointId },
      });
      const finalProjection =
        checkpoint === null
          ? null
          : await tx.memoryP2JobProjection.findUnique({
              where: { aiJobId: checkpoint.p2ProducerJobId },
            });
      const replay = await tx.memoryP2JobProjection.findUnique({
        where: { aiJobId: input.aiJobId },
      });
      if (replay !== null) {
        const semantic = await tx.decisionTraceMemorySemantic.findUnique({
          where: { aiJobId: input.aiJobId },
        });
        if (
          semantic === null ||
          replay.sourceFinalMidCheckpointId !== input.sourceFinalMidCheckpointId ||
          replay.sourceRevisionDigest !== input.sourceRevisionDigest ||
          replay.deletionScopeDigest !== input.deletionScopeDigest ||
          replay.recoveryLeaseOwner !== input.lease.owner ||
          replay.recoveryLeaseEpoch !== input.lease.epoch ||
          replay.recoveryLeaseExpiresAt.getTime() !== input.lease.expiresAt.getTime()
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
        return {
          checkpointId: input.sourceFinalMidCheckpointId,
          replayed: true,
          traceId: semantic.traceId,
        };
      }
      if (
        job === null ||
        checkpoint === null ||
        job.projectId !== input.projectId ||
        job.jobType !== 'long_session_end' ||
        job.status !== 'running' ||
        job.triggerDedupeKey?.startsWith('memory-p2-v1:') !== true ||
        job.retentionState !== 'active' ||
        job.expiresAt.getTime() !== input.expiresAt.getTime() ||
        checkpoint.projectId !== input.projectId ||
        checkpoint.sourceSessionId !== input.sourceSessionId ||
        checkpoint.lifecycleStatus !== 'committed' ||
        checkpoint.sourceP1TerminalJobId !== input.sourceP1TerminalJobId ||
        finalProjection === null ||
        finalProjection.jobKind !== 'mid_final' ||
        finalProjection.targetRevisionDigest !== input.sourceRevisionDigest
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
      if (input.lease.expiresAt > input.expiresAt)
        throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
      this.assertOrdered(input.sourceTraceReferences);
      this.assertUnique(
        input.sourceTraceReferences.map((source) =>
          [source.sourceKind, source.sourceId, source.sourceRevision].join(':'),
        ),
      );
      await tx.memoryP2JobProjection.create({
        data: {
          aiJobId: input.aiJobId,
          deletionScopeDigest: input.deletionScopeDigest,
          deletionScopePolicyRevision: input.deletionScopePolicyRevision,
          jobKind: 'long_session_end',
          p2PolicyContractRevision: input.p2PolicyContractRevision,
          p2PolicyRevision: input.p2PolicyRevision,
          p2RetentionContractVersion: input.p2RetentionContractVersion,
          p2RetentionPolicyVersion: input.p2RetentionPolicyVersion,
          recoveryLeaseEpoch: input.lease.epoch,
          recoveryLeaseExpiresAt: input.lease.expiresAt,
          recoveryLeaseOwner: input.lease.owner,
          sourceCheckpointId: input.sourceFinalMidCheckpointId,
          sourceFinalMidCheckpointId: input.sourceFinalMidCheckpointId,
          sourceP1TerminalJobId: input.sourceP1TerminalJobId,
          sourceRevisionDigest: input.sourceRevisionDigest,
          targetSlotDigest: input.targetSlotDigest,
          triggerIdentityHash: input.triggerIdentityHash,
        },
      });
      await tx.decisionTrace.create({
        data: {
          aiJobId: input.aiJobId,
          contextRevision: 0,
          decisionOutcome: 'unavailable',
          directorInvoked: false,
          expiresAt: input.expiresAt,
          generationId: input.traceGenerationId,
          id: input.traceId,
          inputHash: job.inputHash,
          memoryOutcome: 'unjudged',
          ownerActorId: input.ownerActorId,
          projectId: input.projectId,
          requestId: input.traceRequestId,
          sessionId: input.sourceSessionId,
          stage: 'frozen',
          stageTimingsJson: {},
          startedAt: new Date(),
          status: 'running',
          traceKind: 'memory_layer_evolve',
          triggerType: 'memory_layer_evolve',
        },
      });
      await tx.decisionTraceMemorySemantic.create({
        data: {
          aiJobId: input.aiJobId,
          deletionScopeDigest: input.deletionScopeDigest,
          sourceManifestHash: input.sourceRevisionDigest,
          traceId: input.traceId,
        },
      });
      await tx.decisionTraceMemorySourceReference.createMany({
        data: input.sourceTraceReferences.map((source) =>
          this.traceSourceRow(input.traceId, source),
        ),
      });
      await tx.memoryP2RetentionTarget.createMany({
        data: [
          this.retentionTarget(input.aiJobId, 'job', input.aiJobId, 0),
          this.retentionTarget(input.aiJobId, 'trace', input.traceId, 1),
        ],
      });
      return {
        checkpointId: input.sourceFinalMidCheckpointId,
        replayed: false,
        traceId: input.traceId,
      };
    };
    if (transaction !== undefined) return work(transaction);
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  public async commitLayerRevision(
    input: MemoryP2CommitInput,
    transaction?: TransactionClient,
    finalize = true,
  ): Promise<MemoryP2CommitResult> {
    this.assertLease(input.lease);
    const work = async (tx: TransactionClient): Promise<MemoryP2CommitResult> => {
      await this.assertMigrationReady(tx);
      await this.lockScope(tx, input.projectId, input.sourceSessionId);
      const checkpoint = await tx.memoryEvolutionCheckpoint.findUnique({
        where: { id: input.checkpointId },
      });
      if (
        checkpoint === null ||
        checkpoint.projectId !== input.projectId ||
        checkpoint.sourceSessionId !== input.sourceSessionId ||
        !['frozen', 'committed'].includes(checkpoint.lifecycleStatus)
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
      const checkpointMembers = await tx.memoryEvolutionCheckpointMember.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { checkpointId: input.checkpointId },
      });
      if (
        checkpointMembers.length !== checkpoint.expectedMemberCount ||
        checkpointMembers.some((member, index) => member.inputOrder !== index) ||
        memoryP2CheckpointManifestHash(checkpointMembers) !== checkpoint.memberManifestHash
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
      await tx.$queryRaw`SELECT "id" FROM "memory_working_snapshot" WHERE "id" = ${checkpoint.sourceWorkingSnapshotId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "memory_thread_revision" WHERE "id" = ${checkpoint.sourceThreadRevisionId}::uuid FOR SHARE`;

      await tx.$queryRaw`SELECT "authority_id" FROM "memory_resolution_authority" WHERE "project_id" = ${input.projectId}::uuid AND "semantic_kind" = ${input.target.semanticKind}::"MemorySemanticKind" AND "canonical_key" = ${input.target.canonicalKey} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "memory_layer_identity" WHERE "identity_key_digest" = ${input.target.identityKeyDigest} FOR UPDATE`;
      await tx.$queryRaw`SELECT revision."id" FROM "memory_layer_revision" revision JOIN "memory_layer_identity" identity ON identity."id" = revision."identity_id" WHERE identity."identity_key_digest" = ${input.target.identityKeyDigest} AND revision."lifecycle_status" = 'current' FOR UPDATE OF revision`;
      await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${input.aiJobId}::uuid FOR UPDATE`;

      const job = await tx.aiJob.findUnique({ where: { id: input.aiJobId } });
      const projection = await tx.memoryP2JobProjection.findUnique({
        where: { aiJobId: input.aiJobId },
      });
      const trace = await tx.decisionTraceMemorySemantic.findUnique({
        where: { traceId: input.traceId },
      });
      if (job?.status === 'succeeded') {
        const replay = await this.replayCommittedLayerRevision(
          tx,
          input,
          checkpoint,
          projection,
          trace,
        );
        if (replay !== null) return replay;
        throw new MemoryP2PersistenceError('MEMORY_P2_COMMIT_ALREADY_TERMINAL');
      }
      if (
        job === null ||
        projection === null ||
        trace === null ||
        job.status !== 'running' ||
        job.projectId !== input.projectId ||
        projection.sourceCheckpointId !== input.checkpointId ||
        trace.aiJobId !== input.aiJobId ||
        projection.deletionScopeDigest !== trace.deletionScopeDigest ||
        (job.jobType !== 'long_session_end' &&
          projection.deletionScopeDigest !== checkpoint.deletionScopeDigest) ||
        job.policyRevision !== checkpoint.aiPolicyRevision ||
        job.retentionPolicyVersion !== checkpoint.retentionPolicyVersion ||
        job.retentionState !== 'active' ||
        job.expiresAt <= new Date() ||
        projection.recoveryLeaseOwner !== input.lease.owner ||
        projection.recoveryLeaseEpoch !== input.lease.epoch ||
        projection.recoveryLeaseExpiresAt.getTime() !== input.lease.expiresAt.getTime() ||
        projection.recoveryLeaseExpiresAt <= new Date() ||
        (job.jobType !== 'long_session_end' &&
          projection.sourceRevisionDigest !== checkpoint.memberManifestHash)
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_JOB_NOT_RUNNING');
      if (
        input.claims.length === 0 ||
        input.target.layer !== (job.jobType === 'long_session_end' ? 'long' : 'mid')
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_MANIFEST_INVALID');

      const resolutionId = randomUUID();
      const resolutionOutputId = randomUUID();
      const layerRevisionId = randomUUID();

      const authority = await this.resolveAuthority(tx, input);
      const previousResolution = await tx.memoryResolution.findFirst({
        where: { authorityId: authority.authorityId, status: 'current' },
      });
      if (
        (previousResolution?.id ?? null) !== input.target.expectedCurrentResolutionId ||
        (previousResolution?.resolutionRevision ?? 0) !== input.target.expectedCurrentRevision
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
      await this.assertGateForCommit(
        tx,
        input,
        checkpoint.deletionScopeDigest,
        checkpoint.evidenceManifestHash,
        previousResolution,
      );
      const resolutionRevision = input.target.expectedCurrentRevision + 1;
      if (previousResolution !== null) {
        const frozen = await tx.aiJobInputMemory.findFirst({
          where: { aiJobId: input.aiJobId, memoryResolutionId: previousResolution.id },
        });
        if (frozen === null || frozen.resolutionRevision !== previousResolution.resolutionRevision)
          throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
        const superseded = await tx.memoryResolution.updateMany({
          data: { status: 'superseded' },
          where: {
            id: previousResolution.id,
            resolutionRevision: previousResolution.resolutionRevision,
            status: 'current',
          },
        });
        if (superseded.count !== 1)
          throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
      }

      const claimRows = await this.createClaims(tx, input);
      const targetRevisionDigest = memoryP2LayerMemberManifestHash(
        claimRows.map((row, inputOrder) => ({
          claimId: row.claimId,
          evidenceMembershipDigest: row.evidenceManifestHash,
          inputOrder,
          role: row.claim.role,
        })),
      );
      const resolutionSegmentInputs = [
        ...new Map(claimRows.flatMap(({ inputs }) => inputs).map((row) => [row.id, row])).values(),
      ].sort((left, right) => left.inputOrder - right.inputOrder);
      const segmentEntries = resolutionSegmentInputs.map((row) => this.segmentManifestEntry(row));
      const priorInput =
        previousResolution === null
          ? null
          : await tx.aiJobInputMemory.findFirstOrThrow({
              where: { aiJobId: input.aiJobId, memoryResolutionId: previousResolution.id },
            });
      const memoryEntries =
        priorInput === null
          ? []
          : [
              `${priorInput.id}:${priorInput.memoryResolutionId}:${String(priorInput.resolutionRevision)}`,
            ];
      await tx.aiDerivedOutput.create({
        data: {
          aiJobId: input.aiJobId,
          businessOutputId: resolutionId,
          expectedMemoryCount: memoryEntries.length,
          expectedMemoryManifestHash: manifestHash(memoryEntries),
          expectedQuestionCount: 0,
          expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
          expectedSegmentCount: segmentEntries.length,
          expectedSegmentManifestHash: manifestHash(segmentEntries),
          id: resolutionOutputId,
          outputType: 'memory_resolution',
          projectId: input.projectId,
        },
      });
      await tx.memoryResolution.create({
        data: {
          aiDerivedOutputId: resolutionOutputId,
          aiJobId: input.aiJobId,
          authority: 'automatic',
          authorityId: authority.authorityId,
          canonicalKey: input.target.canonicalKey,
          id: resolutionId,
          layer: input.target.layer,
          p2Write: true,
          projectId: input.projectId,
          provenanceState: 'active',
          resolutionKind: input.target.resolutionKind,
          resolutionRevision,
          resolvedValueJson: input.target.resolvedValueJson,
          semanticKind: input.target.semanticKind,
          semanticStatus: input.target.semanticStatus,
          sourceSessionId: input.sourceSessionId,
          status: 'current',
          supersedesResolutionId: previousResolution?.id ?? null,
          threadId: checkpoint.sourceThreadId,
        },
      });
      await tx.memoryResolutionMember.createMany({
        data: claimRows.map(({ claimId }, memberOrder) => ({
          id: randomUUID(),
          memberOrder,
          memoryClaimId: claimId,
          memoryResolutionId: resolutionId,
        })),
      });
      for (const [dependencyOrder, row] of resolutionSegmentInputs.entries()) {
        await tx.aiOutputSegmentDependency.create({
          data: {
            aiDerivedOutputId: resolutionOutputId,
            aiJobInputSegmentId: row.id,
            dependencyOrder,
            id: randomUUID(),
          },
        });
      }
      if (priorInput !== null) {
        await tx.aiOutputMemoryDependency.create({
          data: {
            aiDerivedOutputId: resolutionOutputId,
            aiJobInputMemoryId: priorInput.id,
            dependencyOrder: 0,
            id: randomUUID(),
          },
        });
      }

      const identity = await this.resolveLayerIdentity(tx, input, authority.authorityId);
      const predecessor = await tx.memoryLayerRevision.findFirst({
        where: { identityId: identity.id, lifecycleStatus: 'current' },
      });
      if (predecessor !== null) {
        await tx.memoryLayerRevision.update({
          data: { lifecycleStatus: 'superseded' },
          where: { id: predecessor.id },
        });
      }
      const revisionNo = (predecessor?.revisionNo ?? 0) + 1;
      await tx.memoryLayerRevision.create({
        data: {
          expectedMemberCount: claimRows.length,
          id: layerRevisionId,
          identityId: identity.id,
          layer: input.target.layer,
          lifecycleStatus: 'current',
          manifestAlgorithmVersion: MEMORY_P2_MANIFEST_ALGORITHM_VERSION,
          memberManifestHash: targetRevisionDigest,
          predecessorRevisionId: predecessor?.id ?? null,
          projectId: input.projectId,
          resolutionAuthorityId: authority.authorityId,
          resolutionRevision,
          resolutionRowId: resolutionId,
          revisionNo,
          semanticStatus: input.target.semanticStatus,
          sourceCheckpointId: input.checkpointId,
          sourceJobId: input.aiJobId,
          sourceSessionId: input.sourceSessionId,
        },
      });
      await tx.memoryLayerRevisionMember.createMany({
        data: claimRows.map(({ claim, claimId, evidenceManifestHash }, inputOrder) => ({
          claimRevision: 1,
          evidenceMembershipDigest: evidenceManifestHash,
          inputOrder,
          memoryClaimId: claimId,
          revisionId: layerRevisionId,
          role: claim.role,
        })),
      });
      if (input.target.layer === 'long')
        await this.createLongProjection(tx, input, layerRevisionId);

      if (!finalize) {
        const retentionCount = await tx.memoryP2RetentionTarget.count({
          where: { aiJobId: input.aiJobId },
        });
        await tx.memoryP2RetentionTarget.create({
          data: this.retentionTarget(
            input.aiJobId,
            'layer_revision',
            layerRevisionId,
            retentionCount,
          ),
        });
        return {
          authorityId: authority.authorityId,
          checkpointId: input.checkpointId,
          layerIdentityId: identity.id,
          layerRevisionId,
          memoryClaimIds: claimRows.map(({ claimId }) => claimId),
          resolutionId,
          resolutionRevision,
          targetRevisionDigest,
        };
      }
      if (checkpoint.lifecycleStatus === 'frozen') {
        await tx.memoryEvolutionCheckpoint.update({
          data: { committedAt: new Date(), lifecycleStatus: 'committed' },
          where: { id: input.checkpointId },
        });
      }
      await tx.aiJob.update({
        data: { completedAt: new Date(), status: 'succeeded' },
        where: { id: input.aiJobId },
      });
      await tx.memoryP2JobProjection.update({
        data: {
          targetLayerIdentityId: identity.id,
          targetLayerRevisionId: layerRevisionId,
          targetRevisionDigest,
        },
        where: { aiJobId: input.aiJobId },
      });
      const completedAt = new Date();
      const traceParent = await tx.decisionTrace.findUniqueOrThrow({
        where: { id: input.traceId },
      });
      await tx.decisionTrace.update({
        data: {
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - traceParent.startedAt.getTime()),
          memoryOutcome: input.target.layer === 'long' ? 'long_committed' : 'checkpoint_committed',
          stage: 'committed',
          status: 'succeeded',
        },
        where: { id: input.traceId },
      });
      await tx.decisionTraceMemorySemantic.update({
        data: {
          commitDigest: input.commitDigest,
          planDigest: input.planDigest,
          proposalDigest: input.proposalDigest,
          sourceManifestHash:
            input.target.layer === 'long'
              ? (input.longSourceManifestHash ?? projection.sourceRevisionDigest)
              : projection.sourceRevisionDigest,
        },
        where: { traceId: input.traceId },
      });
      const sourceCount = await tx.decisionTraceMemorySourceReference.count({
        where: { traceId: input.traceId },
      });
      const committedRevisions = await tx.memoryLayerRevision.findMany({
        where: { sourceJobId: input.aiJobId },
      });
      const committedRevisionMembers = await tx.memoryLayerRevisionMember.findMany({
        where: { revisionId: { in: committedRevisions.map((row) => row.id) } },
      });
      const committedEvidenceLinks = await tx.memoryClaimEvidence.findMany({
        where: {
          memoryClaimId: {
            in: committedRevisionMembers.map((row) => row.memoryClaimId),
          },
        },
      });
      const committedEvidenceAuthorities = await tx.memoryEvidenceAuthority.findMany({
        where: {
          evidenceId: {
            in: committedEvidenceLinks
              .map((row) => row.evidenceId)
              .filter((value): value is string => value !== null),
          },
        },
      });
      const evidenceById = new Map(
        committedEvidenceAuthorities.map((row) => [row.evidenceId, row]),
      );
      const committedSources = [
        ...[...evidenceById.values()].map((evidence) => ({
          deletionScopeDigest: projection.deletionScopeDigest,
          inputOrder: 0,
          membershipDigest: evidence.membershipDigest,
          sourceId: evidence.evidenceId,
          sourceKind: 'evidence' as const,
          sourceRevision: evidence.authorityRevision,
        })),
        ...committedRevisions.map((revision) => ({
          deletionScopeDigest: projection.deletionScopeDigest,
          inputOrder: 0,
          membershipDigest: revision.memberManifestHash,
          sourceId: revision.resolutionAuthorityId,
          sourceKind: 'resolution' as const,
          sourceRevision: revision.resolutionRevision,
        })),
      ];
      await tx.decisionTraceMemorySourceReference.createMany({
        data: committedSources.map((source, offset) =>
          this.traceSourceRow(input.traceId, { ...source, inputOrder: sourceCount + offset }),
        ),
      });
      const retentionCount = await tx.memoryP2RetentionTarget.count({
        where: { aiJobId: input.aiJobId },
      });
      await tx.memoryP2RetentionTarget.create({
        data: this.retentionTarget(
          input.aiJobId,
          'layer_revision',
          layerRevisionId,
          retentionCount,
        ),
      });
      return {
        authorityId: authority.authorityId,
        checkpointId: input.checkpointId,
        layerIdentityId: identity.id,
        layerRevisionId,
        memoryClaimIds: claimRows.map(({ claimId }) => claimId),
        resolutionId,
        resolutionRevision,
        targetRevisionDigest,
      };
    };
    if (transaction !== undefined) return work(transaction);
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  public async commitLayerRevisions(
    inputs: readonly MemoryP2CommitInput[],
  ): Promise<readonly MemoryP2CommitResult[]> {
    if (inputs.length === 0) throw new MemoryP2PersistenceError('MEMORY_P2_MANIFEST_INVALID');
    return this.prisma.$transaction(
      async (tx) => {
        const results: MemoryP2CommitResult[] = [];
        for (const [index, input] of inputs.entries())
          results.push(await this.commitLayerRevision(input, tx, index === inputs.length - 1));
        return results;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async terminalizeUnavailable(input: MemoryP2TerminalizeUnavailableInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${input.aiJobId}::uuid FOR UPDATE`;
      const job = await tx.aiJob.findUnique({ where: { id: input.aiJobId } });
      const projection = await tx.memoryP2JobProjection.findUnique({
        where: { aiJobId: input.aiJobId },
      });
      if (job === null) throw new MemoryP2PersistenceError('MEMORY_P2_JOB_NOT_RUNNING');
      const status = input.status ?? 'unavailable';
      if (job.status !== 'running') {
        if (job.status === status && job.failureCode === input.errorCode) return;
        throw new MemoryP2PersistenceError('MEMORY_P2_COMMIT_ALREADY_TERMINAL');
      }
      if (
        projection === null ||
        projection.recoveryLeaseOwner !== input.lease.owner ||
        projection.recoveryLeaseEpoch !== input.lease.epoch ||
        projection.recoveryLeaseExpiresAt.getTime() !== input.lease.expiresAt.getTime() ||
        projection.recoveryLeaseExpiresAt <= new Date()
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
      await tx.aiJob.update({
        data: { completedAt: new Date(), failureCode: input.errorCode, status },
        where: { id: input.aiJobId },
      });
      await tx.memoryP2JobProjection.update({
        data: { terminalErrorCode: input.errorCode },
        where: { aiJobId: input.aiJobId },
      });
      const completedAt = new Date();
      const traceParent = await tx.decisionTrace.findUniqueOrThrow({
        where: { id: input.traceId },
      });
      await tx.decisionTrace.update({
        data: {
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - traceParent.startedAt.getTime()),
          errorCode: input.errorCode,
          memoryOutcome:
            status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'unavailable',
          stage: 'terminal',
          status,
        },
        where: { id: input.traceId },
      });
    });
  }

  public async listStaleRecoveryCandidates(
    limit = 100,
    staleAtOrBefore = new Date(),
  ): Promise<readonly MemoryP2StaleRecoveryCandidate[]> {
    if (!(await this.migrationReady())) return [];
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.prisma.$queryRaw<
      readonly {
        aiJobId: string;
        epoch: number;
        expiresAt: Date;
        owner: string;
      }[]
    >`
      SELECT
        projection."ai_job_id" AS "aiJobId",
        projection."recovery_lease_epoch" AS "epoch",
        projection."recovery_lease_expires_at" AS "expiresAt",
        projection."recovery_lease_owner" AS "owner"
      FROM "memory_p2_job_projection" projection
      JOIN "ai_job" job ON job."id" = projection."ai_job_id"
      WHERE job."status" = 'running'
        AND job."retention_state" = 'active'
        AND job."expires_at" > now()
        AND projection."recovery_lease_expires_at" <= ${staleAtOrBefore}
      ORDER BY projection."recovery_lease_expires_at" ASC, projection."ai_job_id" ASC
      LIMIT ${boundedLimit}
    `;
    return rows.map((row) => ({
      aiJobId: row.aiJobId,
      lease: { epoch: row.epoch, expiresAt: row.expiresAt, owner: row.owner },
    }));
  }

  public async scanCandidateJobIds(input: {
    limit: number;
    staleAtOrBefore: Date;
  }): Promise<readonly string[]> {
    return (await this.listStaleRecoveryCandidates(input.limit, input.staleAtOrBefore)).map(
      (row) => row.aiJobId,
    );
  }

  public async readRecoveryAuthority(
    jobId: string,
    transaction?: TransactionClient,
  ): Promise<MemoryP2RecoveryAuthority | null> {
    const db: DatabaseClient = transaction ?? this.prisma;
    const [job, projection, semantic, checkpoint] = await Promise.all([
      db.aiJob.findUnique({ where: { id: jobId } }),
      db.memoryP2JobProjection.findUnique({ where: { aiJobId: jobId } }),
      db.decisionTraceMemorySemantic.findUnique({ where: { aiJobId: jobId } }),
      db.memoryEvolutionCheckpoint.findFirst({ where: { p2ProducerJobId: jobId } }),
    ]);
    if (job === null || projection === null || semantic === null) return null;
    const sourceCheckpoint =
      checkpoint ??
      (projection.sourceFinalMidCheckpointId === null
        ? null
        : await db.memoryEvolutionCheckpoint.findUnique({
            where: { id: projection.sourceFinalMidCheckpointId },
          }));
    const parent = await db.decisionTrace.findUnique({ where: { id: semantic.traceId } });
    if (parent === null) return null;
    const rows = await db.decisionTraceMemorySourceReference.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { traceId: semantic.traceId },
    });
    const references = rows.map(p2TraceReferenceFromRow);
    const longProjection = await db.memoryLongJobProjection.findUnique({
      where: { aiJobId: jobId },
    });
    const sourceSessionIds =
      longProjection?.sourceSessionIds ??
      (sourceCheckpoint === null ? [] : [sourceCheckpoint.sourceSessionId]);
    if (sourceSessionIds.length === 0) return null;
    const sourceSessionManifestHash =
      longProjection?.sourceSessionSetHash ?? memoryP2SourceSessionSetHash(sourceSessionIds);
    const referenceAuthorities = await this.readReferenceAuthorities(references, db);
    const targetRevisions = await db.memoryLayerRevision.findMany({
      orderBy: [{ revisionNo: 'asc' }, { id: 'asc' }],
      where: { sourceJobId: jobId },
    });
    const targetRevision =
      projection.targetLayerRevisionId === null
        ? null
        : await db.memoryLayerRevision.findUnique({
            where: { id: projection.targetLayerRevisionId },
          });
    const revisionMembers =
      targetRevisions.length === 0
        ? []
        : await db.memoryLayerRevisionMember.findMany({
            where: { revisionId: { in: targetRevisions.map((row) => row.id) } },
          });
    const claimIds = [...new Set(revisionMembers.map((row) => row.memoryClaimId))];
    const claimEvidence =
      claimIds.length === 0
        ? []
        : await db.memoryClaimEvidence.findMany({
            where: { memoryClaimId: { in: claimIds } },
          });
    const evidenceIds = [
      ...new Set(
        claimEvidence
          .map((row) => row.evidenceId)
          .filter((value): value is string => value !== null),
      ),
    ].sort();
    const evidenceAuthorities =
      evidenceIds.length === 0
        ? []
        : await db.memoryEvidenceAuthority.findMany({
            where: { evidenceId: { in: evidenceIds } },
          });
    const resolutionIds = [
      ...new Set(targetRevisions.map((row) => row.resolutionAuthorityId)),
    ].sort();
    const resolutions =
      targetRevisions.length === 0
        ? []
        : await db.memoryResolution.findMany({
            where: { id: { in: targetRevisions.map((row) => row.resolutionRowId) } },
          });
    const targetLayer = projection.jobKind === 'long_session_end' ? 'long' : 'mid';
    const revisionsAreConsistent =
      targetRevisions.length > 0 &&
      targetRevisions.every(
        (row) =>
          row.sourceJobId === jobId &&
          row.projectId === job.projectId &&
          (row.layer === 'long' ? 'long' : 'mid') === targetLayer,
      );
    const resolutionsAreConsistent =
      resolutions.length === targetRevisions.length &&
      resolutions.every(
        (row) =>
          row.projectId === job.projectId &&
          row.aiJobId === jobId &&
          (row.layer === 'long' ? 'long' : 'mid') === targetLayer,
      );
    const evidenceIsConsistent =
      evidenceAuthorities.length === evidenceIds.length &&
      evidenceAuthorities.every((row) => row.projectId === job.projectId);
    const targetProofIsComplete =
      revisionsAreConsistent &&
      resolutionsAreConsistent &&
      evidenceIsConsistent &&
      targetRevision !== null &&
      targetRevision.lifecycleStatus === 'current' &&
      projection.targetLayerIdentityId !== null &&
      projection.targetRevisionDigest !== null &&
      targetRevision.identityId === projection.targetLayerIdentityId &&
      targetRevision.memberManifestHash === projection.targetRevisionDigest &&
      projection.targetLayerRevisionId === targetRevision.id &&
      semantic.proposalDigest !== null &&
      semantic.planDigest !== null &&
      semantic.commitDigest !== null &&
      resolutionIds.length > 0 &&
      evidenceIds.length > 0;
    const migration = await db.memoryP2MigrationManifest.findFirst({
      orderBy: { startedAt: 'desc' },
      where: {
        predecessorFingerprint: MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT,
        schemaVersion: MEMORY_P2_MIGRATION_SCHEMA_VERSION,
      },
    });
    const legacyNullResolutionCount = await db.memoryResolution.count({
      where: { aiJobId: jobId, authorityId: null },
    });
    const committed: MemoryP2CommittedAuthority | null =
      targetRevisions.length === 0
        ? null
        : {
            commitDigest: targetProofIsComplete ? (semantic.commitDigest ?? '') : '',
            evidenceAuthorityIds: evidenceIds,
            planDigest: semantic.planDigest ?? '',
            proposalDigest: semantic.proposalDigest ?? '',
            resolutionAuthorityIds: resolutionIds,
            targetLayer,
            targetLayerIdentityId:
              projection.targetLayerIdentityId ?? targetRevision?.identityId ?? '',
            targetLayerRevisionId: projection.targetLayerRevisionId ?? targetRevision?.id ?? '',
            targetRevision: targetRevision?.revisionNo ?? 0,
            targetRevisionDigest:
              projection.targetRevisionDigest ?? targetRevision?.memberManifestHash ?? '',
          };
    const trace = {
      commitDigest: semantic.commitDigest,
      deletionScopeDigest: semantic.deletionScopeDigest,
      errorCode: semanticErrorCode(parent.errorCode),
      expiresAt: job.expiresAt,
      memoryOutcome: parent.memoryOutcome as never,
      p2PolicyRevision: projection.p2PolicyRevision,
      p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
      planDigest: semantic.planDigest,
      proposalDigest: semantic.proposalDigest,
      references,
      retentionState: job.retentionState as never,
      sourceManifestHash: semantic.sourceManifestHash,
      stage: parent.stage as never,
      status: parent.status as never,
      traceId: parent.id,
    };
    return {
      attemptNo: job.attemptNo,
      checkpoint:
        sourceCheckpoint === null
          ? null
          : {
              checkpointId: sourceCheckpoint.id,
              deletionScopeDigest: sourceCheckpoint.deletionScopeDigest,
              p2PolicyRevision: projection.p2PolicyRevision,
              p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
              projectId: sourceCheckpoint.projectId,
              sessionId: sourceCheckpoint.sourceSessionId,
              sourceManifestHash: sourceCheckpoint.memberManifestHash,
              status: sourceCheckpoint.lifecycleStatus as 'committed',
            },
      committed,
      identity: {
        aiJobId: job.id,
        createdAt: job.createdAt,
        deletionScopeDigest: projection.deletionScopeDigest,
        expiresAt: job.expiresAt,
        generationId: parent.generationId,
        inputHash: job.inputHash,
        ownerActorId: job.requestedBy,
        projectId: job.projectId,
        requestId: job.requestId,
        sessionId: parent.sessionId,
        sourceManifestHash: semantic.sourceManifestHash,
        startedAt: parent.startedAt,
        traceId: parent.id,
      },
      jobFailureCode: semanticErrorCode(job.failureCode),
      jobMemoryOutcome: parent.memoryOutcome as never,
      jobRevision: projection.updatedAt.getTime(),
      jobStatus: job.status as never,
      leaseEpoch: projection.recoveryLeaseEpoch,
      leaseExpiresAt: projection.recoveryLeaseExpiresAt,
      leaseOwnerId: projection.recoveryLeaseOwner,
      legacyNullResolutionCount,
      migrationStatus: recoveryMigrationStatus(migration?.status),
      p2PolicyRevision: projection.p2PolicyRevision,
      p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
      referenceAuthorities,
      references,
      retentionState: job.retentionState as never,
      sourceSessionIds,
      sourceSessionManifestHash,
      targetLayer: projection.jobKind === 'long_session_end' ? 'long' : 'mid',
      trace,
    };
  }

  public async applyRecovery(command: MemoryP2RecoveryCommand): Promise<MemoryP2RecoveryCasResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockRecoveryBase(tx, command.jobId);
      let authority = await this.readRecoveryAuthority(command.jobId, tx);
      if (authority !== null) await this.lockRecoveryParticipants(tx, authority);
      authority = await this.readRecoveryAuthority(command.jobId, tx);
      if (authority === null || !recoveryCommandMatchesAuthority(command, authority))
        return { outcome: 'cas_lost' };
      const [job, projection, semantic] = await Promise.all([
        tx.aiJob.findUnique({ where: { id: command.jobId } }),
        tx.memoryP2JobProjection.findUnique({ where: { aiJobId: command.jobId } }),
        tx.decisionTraceMemorySemantic.findUnique({ where: { aiJobId: command.jobId } }),
      ]);
      if (
        job === null ||
        projection === null ||
        semantic === null ||
        job.attemptNo !== command.expectedAttemptNo ||
        !command.expectedJobStatuses.includes(job.status) ||
        projection.recoveryLeaseEpoch !== command.expectedLeaseEpoch ||
        projection.recoveryLeaseOwner !== command.expectedLeaseOwnerId
      )
        return { outcome: 'cas_lost' };
      if (command.kind === 'terminalize_uncommitted' || command.kind === 'preserve_committed')
        await tx.aiJob.update({
          data: {
            completedAt: command.writeAt,
            failureCode: command.kind === 'preserve_committed' ? null : command.errorCode,
            status: command.terminalStatus,
          },
          where: { id: command.jobId },
        });
      await tx.decisionTrace.update({
        data: {
          completedAt: command.trace.parent.completedAt,
          decisionOutcome: command.trace.parent.decisionOutcome,
          durationMs: command.trace.parent.durationMs,
          errorCode: command.trace.parent.errorCode,
          memoryOutcome: command.trace.parent.memoryOutcome,
          stage: command.trace.parent.stage,
          status: command.trace.parent.status,
        },
        where: { id: semantic.traceId },
      });
      await tx.decisionTraceMemorySemantic.update({
        data: {
          commitDigest: command.trace.semantic.commitDigest,
          planDigest: command.trace.semantic.planDigest,
          proposalDigest: command.trace.semantic.proposalDigest,
        },
        where: { traceId: semantic.traceId },
      });
      return { outcome: 'applied' };
    });
  }

  public async claimRecoveryLease(
    input: MemoryP2ClaimRecoveryLeaseInput,
  ): Promise<MemoryP2LeaseToken | null> {
    if (!(await this.migrationReady())) return null;
    if (
      input.expectedEpoch < 1 ||
      input.leaseOwner.trim().length === 0 ||
      input.leaseExpiresAt <= new Date()
    )
      throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
    const rows = await this.prisma.$queryRaw<
      readonly { epoch: number; expiresAt: Date; owner: string }[]
    >`
      UPDATE "memory_p2_job_projection" projection
      SET
        "recovery_lease_owner" = ${input.leaseOwner},
        "recovery_lease_epoch" = projection."recovery_lease_epoch" + 1,
        "recovery_lease_expires_at" = ${input.leaseExpiresAt},
        "updated_at" = now()
      FROM "ai_job" job
      WHERE projection."ai_job_id" = ${input.aiJobId}::uuid
        AND job."id" = projection."ai_job_id"
        AND job."status" = 'running'
        AND job."retention_state" = 'active'
        AND job."expires_at" > now()
        AND ${input.leaseExpiresAt} <= job."expires_at"
        AND projection."recovery_lease_epoch" = ${input.expectedEpoch}
        AND projection."recovery_lease_expires_at" <= now()
      RETURNING
        projection."recovery_lease_epoch" AS "epoch",
        projection."recovery_lease_expires_at" AS "expiresAt",
        projection."recovery_lease_owner" AS "owner"
    `;
    return rows[0] ?? null;
  }

  public async resumeMigration(): Promise<void> {
    for (;;) {
      await this.prisma.$executeRaw`SELECT "memory_p2_resume_migration"()`;
      const manifest = await this.prisma.memoryP2MigrationManifest.findFirst({
        orderBy: { startedAt: 'desc' },
        where: {
          predecessorFingerprint: MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT,
          schemaVersion: MEMORY_P2_MIGRATION_SCHEMA_VERSION,
        },
      });
      if (manifest?.status === 'completed') return;
      if (manifest?.status !== 'upgrading')
        throw new MemoryP2PersistenceError('MEMORY_P2_MIGRATION_UNAVAILABLE');
    }
  }

  private async assertMigrationReady(tx: TransactionClient): Promise<void> {
    const manifest = await tx.memoryP2MigrationManifest.findFirst({
      orderBy: { startedAt: 'desc' },
      where: {
        predecessorFingerprint: MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT,
        schemaVersion: MEMORY_P2_MIGRATION_SCHEMA_VERSION,
      },
    });
    if (manifest?.status !== 'completed')
      throw new MemoryP2PersistenceError('MEMORY_P2_MIGRATION_UNAVAILABLE');
  }

  private async migrationReady(): Promise<boolean> {
    const manifest = await this.prisma.memoryP2MigrationManifest.findFirst({
      orderBy: { startedAt: 'desc' },
      where: {
        predecessorFingerprint: MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT,
        schemaVersion: MEMORY_P2_MIGRATION_SCHEMA_VERSION,
      },
    });
    return manifest?.status === 'completed';
  }

  private assertLease(lease: MemoryP2LeaseToken): void {
    if (lease.epoch < 1 || lease.owner.trim().length === 0 || lease.expiresAt <= new Date())
      throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
  }

  private async lockScope(
    tx: TransactionClient,
    projectId: string,
    sourceSessionId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
    await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${sourceSessionId}, 1))`;
  }

  private assertOrdered(rows: readonly { inputOrder: number }[]): void {
    if (rows.some((row, index) => row.inputOrder !== index))
      throw new MemoryP2PersistenceError('MEMORY_P2_MANIFEST_INVALID');
  }

  private assertUnique(values: readonly string[]): void {
    if (new Set(values).size !== values.length)
      throw new MemoryP2PersistenceError('MEMORY_P2_MANIFEST_INVALID');
  }

  private traceSourceRow(
    traceId: string,
    source: MemoryP2TraceSourceInput,
  ): Prisma.DecisionTraceMemorySourceReferenceUncheckedCreateInput {
    return {
      aiJobInputSegmentId: source.sourceKind === 'input_segment' ? source.sourceId : null,
      deletionScopeDigest: source.deletionScopeDigest,
      evidenceId: source.sourceKind === 'evidence' ? source.sourceId : null,
      inputOrder: source.inputOrder,
      membershipDigest: source.membershipDigest,
      resolutionAuthorityId: source.sourceKind === 'resolution' ? source.sourceId : null,
      sourceCheckpointId: source.sourceKind === 'checkpoint' ? source.sourceId : null,
      sourceId: source.sourceId,
      sourceJobId: source.sourceKind === 'job' ? source.sourceId : null,
      sourceKind: source.sourceKind,
      sourceRevision: source.sourceRevision,
      traceId,
    };
  }

  private retentionTarget(
    aiJobId: string,
    targetKind: 'checkpoint' | 'job' | 'layer_revision' | 'trace',
    targetId: string,
    inputOrder: number,
  ): Prisma.MemoryP2RetentionTargetUncheckedCreateInput {
    return {
      aiJobId,
      checkpointId: targetKind === 'checkpoint' ? targetId : null,
      inputOrder,
      jobTargetId: targetKind === 'job' ? targetId : null,
      layerRevisionId: targetKind === 'layer_revision' ? targetId : null,
      targetId,
      targetKind,
      traceId: targetKind === 'trace' ? targetId : null,
    };
  }

  private async resolveAuthority(
    tx: TransactionClient,
    input: MemoryP2CommitInput,
  ): Promise<MemoryResolutionAuthority> {
    const bySlot = await tx.memoryResolutionAuthority.findUnique({
      where: {
        projectId_semanticKind_canonicalKey: {
          canonicalKey: input.target.canonicalKey,
          projectId: input.projectId,
          semanticKind: input.target.semanticKind,
        },
      },
    });
    if (bySlot !== null) {
      if (input.target.authorityId === null || bySlot.authorityId !== input.target.authorityId)
        throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
      return bySlot;
    }
    if (
      input.target.authorityId !== null ||
      input.target.expectedCurrentResolutionId !== null ||
      input.target.expectedCurrentRevision !== 0
    )
      throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
    return tx.memoryResolutionAuthority.create({
      data: {
        authorityId: randomUUID(),
        canonicalKey: input.target.canonicalKey,
        originSessionId: input.sourceSessionId,
        originThreadId: (
          await tx.memoryEvolutionCheckpoint.findUniqueOrThrow({
            where: { id: input.checkpointId },
          })
        ).sourceThreadId,
        projectId: input.projectId,
        semanticKind: input.target.semanticKind,
      },
    });
  }

  private async replayCommittedLayerRevision(
    tx: TransactionClient,
    input: MemoryP2CommitInput,
    checkpoint: Awaited<ReturnType<TransactionClient['memoryEvolutionCheckpoint']['findUnique']>>,
    projection: Awaited<ReturnType<TransactionClient['memoryP2JobProjection']['findUnique']>>,
    trace: Awaited<ReturnType<TransactionClient['decisionTraceMemorySemantic']['findUnique']>>,
  ): Promise<MemoryP2CommitResult | null> {
    if (
      checkpoint === null ||
      projection === null ||
      trace === null ||
      projection.sourceCheckpointId !== input.checkpointId ||
      trace.aiJobId !== input.aiJobId ||
      trace.proposalDigest !== input.proposalDigest ||
      trace.planDigest !== input.planDigest ||
      trace.commitDigest !== input.commitDigest ||
      projection.targetLayerIdentityId === null ||
      projection.targetLayerRevisionId === null ||
      projection.targetRevisionDigest === null
    )
      return null;
    const [revision, identity, members] = await Promise.all([
      tx.memoryLayerRevision.findUnique({ where: { id: projection.targetLayerRevisionId } }),
      tx.memoryLayerIdentity.findUnique({ where: { id: projection.targetLayerIdentityId } }),
      tx.memoryLayerRevisionMember.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { revisionId: projection.targetLayerRevisionId },
      }),
    ]);
    const resolution =
      input.target.expectedCurrentResolutionId === null
        ? null
        : await tx.memoryResolution.findUnique({
            where: { id: input.target.expectedCurrentResolutionId },
          });
    const committedResolution =
      revision === null
        ? null
        : await tx.memoryResolution.findUnique({ where: { id: revision.resolutionRowId } });
    if (
      revision === null ||
      committedResolution === null ||
      identity === null ||
      members.length !== revision.expectedMemberCount ||
      members.some((member, index) => member.inputOrder !== index) ||
      revision.sourceCheckpointId !== input.checkpointId ||
      revision.sourceJobId !== input.aiJobId ||
      revision.layer !== input.target.layer ||
      revision.memberManifestHash !== projection.targetRevisionDigest ||
      committedResolution.authorityId !== revision.resolutionAuthorityId ||
      committedResolution.canonicalKey !== input.target.canonicalKey ||
      committedResolution.semanticKind !== input.target.semanticKind ||
      committedResolution.resolutionRevision !== revision.resolutionRevision ||
      committedResolution.status !== 'current' ||
      (input.target.identityId !== null && identity.id !== input.target.identityId) ||
      identity.identityKeyDigest !== input.target.identityKeyDigest ||
      (input.target.authorityId !== null &&
        revision.resolutionAuthorityId !== input.target.authorityId) ||
      (revision.revisionNo === 1
        ? input.target.expectedCurrentResolutionId !== null ||
          input.target.expectedCurrentRevision !== 0
        : committedResolution.supersedesResolutionId !== input.target.expectedCurrentResolutionId ||
          input.target.expectedCurrentRevision <= 0) ||
      (revision.revisionNo > 1 &&
        (resolution === null ||
          resolution.resolutionRevision !== input.target.expectedCurrentRevision))
    )
      return null;
    return {
      authorityId: revision.resolutionAuthorityId,
      checkpointId: input.checkpointId,
      layerIdentityId: identity.id,
      layerRevisionId: revision.id,
      memoryClaimIds: members.map((member) => member.memoryClaimId),
      resolutionId: committedResolution.id,
      resolutionRevision: committedResolution.resolutionRevision,
      targetRevisionDigest: projection.targetRevisionDigest,
    };
  }

  private async resolveLayerIdentity(
    tx: TransactionClient,
    input: MemoryP2CommitInput,
    authorityId: string,
  ): Promise<MemoryLayerIdentity> {
    const existing = await tx.memoryLayerIdentity.findUnique({
      where: { identityKeyDigest: input.target.identityKeyDigest },
    });
    if (existing !== null) {
      if (
        input.target.identityId === null ||
        existing.id !== input.target.identityId ||
        existing.originResolutionAuthorityId !== authorityId
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
      return existing;
    }
    if (input.target.identityId !== null || input.target.layer === 'long')
      throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
    const checkpoint = await tx.memoryEvolutionCheckpoint.findUniqueOrThrow({
      where: { id: input.checkpointId },
    });
    return tx.memoryLayerIdentity.create({
      data: {
        id: randomUUID(),
        identityKeyDigest: input.target.identityKeyDigest,
        originResolutionAuthorityId: authorityId,
        originSessionId: input.sourceSessionId,
        originThreadId: checkpoint.sourceThreadId,
        projectId: input.projectId,
      },
    });
  }

  private async assertGateForCommit(
    tx: TransactionClient,
    input: MemoryP2CommitInput,
    deletionScopeDigest: string,
    evidenceManifestDigest: string,
    previousResolution: {
      id: string;
      resolutionRevision: number;
      semanticKind: 'episode' | 'fact' | null;
      semanticStatus: 'current' | 'uncertain' | 'disputed' | null;
      status: 'current' | 'pending_review' | 'superseded';
    } | null,
  ): Promise<void> {
    const [job, project, inputs, transcripts, authorities, factAuthorities] = await Promise.all([
      tx.aiJob.findUnique({ where: { id: input.aiJobId } }),
      tx.elderProject.findUnique({ where: { id: input.projectId } }),
      tx.aiJobInputSegment.findMany({ where: { aiJobId: input.aiJobId } }),
      tx.transcriptSegment.findMany({ where: { sessionId: input.sourceSessionId } }),
      tx.memoryEvidenceAuthority.findMany({
        where: { projectId: input.projectId, sessionId: input.sourceSessionId },
      }),
      tx.memoryResolution.findMany({
        select: { sourceSessionId: true },
        where: {
          projectId: input.projectId,
          semanticKind: 'fact',
          sourceSessionId: input.sourceSessionId,
          status: 'current',
        },
      }),
    ]);
    const policyAuthorized =
      job !== null &&
      project !== null &&
      job.projectId === input.projectId &&
      project.deletedAt === null &&
      !['restricted', 'deleted'].includes(project.status) &&
      job.policyRevision === project.aiPolicyRevision;
    const retentionEligible =
      job !== null &&
      project !== null &&
      job.retentionState === 'active' &&
      job.expiresAt > new Date() &&
      job.retentionPolicyVersion === project.aiRetentionPolicyVersion;
    if (
      job === null ||
      project === null ||
      job.projectId !== input.projectId ||
      !(['mid_online', 'mid_final', 'long_session_end'] as string[]).includes(job.jobType) ||
      !policyAuthorized ||
      !retentionEligible
    )
      throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');

    const inputById = new Map(inputs.map((row) => [row.id, row]));
    const transcriptById = new Map(transcripts.map((row) => [row.id, row]));
    const authorityBySourceId = new Map<string, (typeof authorities)[number]>();
    for (const row of authorities) {
      const current = authorityBySourceId.get(row.sourceId);
      if (current === undefined || row.authorityRevision > current.authorityRevision)
        authorityBySourceId.set(row.sourceId, row);
    }
    const authorityBySourceRevision = new Map(
      authorities.map((row) => [`${row.sourceId}:${String(row.authorityRevision)}`, row]),
    );
    const acceptedFactClaimEvidence = await tx.memoryClaimEvidence.findMany({
      select: { memoryClaimId: true, transcriptSegmentId: true },
      where: { transcriptSegmentId: { in: [...transcriptById.keys()] } },
    });
    const acceptedClaimIds = acceptedFactClaimEvidence.map(({ memoryClaimId }) => memoryClaimId);
    const acceptedClaims = await tx.memoryClaim.findMany({
      select: { id: true },
      where: {
        id: { in: acceptedClaimIds },
        projectId: input.projectId,
        provenanceState: 'active',
        semanticKind: 'fact',
      },
    });
    const acceptedClaimIdSet = new Set(acceptedClaims.map(({ id }) => id));
    const acceptedMembers = await tx.memoryResolutionMember.findMany({
      select: { memoryClaimId: true, memoryResolutionId: true },
      where: { memoryClaimId: { in: [...acceptedClaimIdSet] } },
    });
    const acceptedResolutionIds = acceptedMembers.map(
      ({ memoryResolutionId }) => memoryResolutionId,
    );
    const acceptedResolutions = await tx.memoryResolution.findMany({
      select: { id: true },
      where: {
        id: { in: acceptedResolutionIds },
        projectId: input.projectId,
        semanticKind: 'fact',
        status: 'current',
      },
    });
    const acceptedResolutionIdSet = new Set(acceptedResolutions.map(({ id }) => id));
    const acceptedFactSourceIds = new Set(
      acceptedFactClaimEvidence
        .filter(({ memoryClaimId }) => acceptedClaimIdSet.has(memoryClaimId))
        .filter(({ memoryClaimId }) =>
          acceptedMembers.some(
            (member) =>
              member.memoryClaimId === memoryClaimId &&
              acceptedResolutionIdSet.has(member.memoryResolutionId),
          ),
        )
        .map(({ transcriptSegmentId }) => transcriptSegmentId),
    );
    const hasAcceptedFactAuthority = factAuthorities.length > 0;
    const evidenceById = new Map<string, MemoryGateEvidenceReference>();
    const evidenceIdentityByInputSegmentId = new Map<string, string>();
    for (const claim of input.claims) {
      for (const evidence of claim.evidences) {
        const frozen = inputById.get(evidence.inputSegmentId);
        const transcript =
          frozen === undefined ? undefined : transcriptById.get(frozen.transcriptSegmentId);
        const sourceAuthority = authorityBySourceId.get(evidence.sourceId);
        const authority = authorityBySourceRevision.get(
          `${evidence.sourceId}:${String(evidence.authorityRevision)}`,
        );
        if (
          frozen === undefined ||
          transcript === undefined ||
          frozen.sessionId !== input.sourceSessionId ||
          frozen.transcriptSegmentId !== evidence.sourceId ||
          frozen.textRevision !== evidence.textRevision ||
          frozen.speakerRoleRevision !== evidence.speakerRoleRevision ||
          frozen.effectiveTextDigest !== evidence.effectiveTextDigest ||
          frozen.trustedEffectiveRole !==
            projectTrustedSpeakerRole(transcript).trustedEffectiveSpeakerRole ||
          (frozen.trustedEffectiveRole !== 'elder' &&
            frozen.trustedEffectiveRole !== 'interviewer') ||
          frozen.contentKind !== 'conversation' ||
          transcript.textRevision !== frozen.textRevision ||
          transcript.speakerRoleRevision !== frozen.speakerRoleRevision ||
          effectiveTextDigest(transcript.correctedText ?? transcript.originalText) !==
            frozen.effectiveTextDigest
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
        if (
          (authority === undefined && evidence.expectedEvidenceId !== null) ||
          (sourceAuthority !== undefined && authority === undefined) ||
          (authority !== undefined &&
            ((authority.evidenceId !== evidence.expectedEvidenceId &&
              evidence.expectedEvidenceId !== null) ||
              authority.authorityRevision !== evidence.authorityRevision ||
              authority.sourceId !== evidence.sourceId ||
              authority.transcriptTextRevision !== evidence.textRevision ||
              authority.speakerRoleRevision !== evidence.speakerRoleRevision ||
              authority.effectiveTextDigest !== evidence.effectiveTextDigest))
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
        const evidenceId = authority?.evidenceId ?? evidence.inputSegmentId;
        evidenceIdentityByInputSegmentId.set(evidence.inputSegmentId, evidenceId);
        evidenceById.set(evidenceId, {
          authorityRevision: authority?.authorityRevision ?? evidence.authorityRevision,
          contentKind: 'conversation_final',
          effectiveTextDigest: evidence.effectiveTextDigest,
          evidenceId,
          evidenceRole: classifyMemoryGateEvidenceRole(
            frozen.trustedEffectiveRole,
            transcript.correctedText ?? transcript.originalText,
            acceptedFactSourceIds.has(evidence.sourceId) || hasAcceptedFactAuthority,
          ),
          eligibility: memoryGateEligibility(policyAuthorized, retentionEligible),
          projectId: input.projectId,
          sessionId: frozen.sessionId,
          sourceId: evidence.sourceId,
          sourceKind: 'transcript_segment',
          speakerRoleRevision: frozen.speakerRoleRevision,
          textRevision: frozen.textRevision,
          trustedRole: frozen.trustedEffectiveRole,
        });
      }
    }
    const evidence = [...evidenceById.values()];
    const semanticStatus = input.target.semanticStatus;
    const candidate: MemoryGateCandidate = {
      candidateId: input.aiJobId,
      proposalSource: 'llm_proposal',
      candidateKind: input.target.semanticKind,
      operation:
        previousResolution === null
          ? 'create'
          : semanticStatus === 'uncertain'
            ? 'mark_uncertain'
            : semanticStatus === 'disputed'
              ? 'mark_disputed'
              : 'correct',
      target:
        previousResolution === null
          ? null
          : {
              authorityId: input.target.authorityId ?? previousResolution.id,
              revisionId: previousResolution.id,
              revisionNo: previousResolution.resolutionRevision,
              resolutionStatus: previousResolution.status === 'current' ? 'current' : 'superseded',
              semanticStatus: previousResolution.semanticStatus ?? 'current',
              semanticKind: previousResolution.semanticKind ?? input.target.semanticKind,
              targetType: 'memory_resolution',
            },
      expectedRevision: previousResolution === null ? null : input.target.expectedCurrentRevision,
      proposedState: {
        canonicalKey: input.target.canonicalKey,
        claims: input.claims.map((claim) => ({
          claimId: null,
          claimKey: claim.canonicalKey,
          evidenceIds: claim.evidences.map((evidence) => {
            const evidenceId = evidenceIdentityByInputSegmentId.get(evidence.inputSegmentId);
            if (evidenceId === undefined)
              throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
            return evidenceId;
          }),
        })),
        resolutionKind:
          input.target.resolutionKind === 'review_required'
            ? 'unknown'
            : input.target.resolutionKind,
        reviewRequired: semanticStatus !== 'current',
        semanticKind: input.target.semanticKind,
        semanticStatus,
        value: semanticStatus === 'disputed' ? null : input.target.resolvedValueJson,
        valueKind:
          semanticStatus === 'disputed' ? null : resolutionValueKind(input.target.resolutionKind),
      },
      evidence,
      evidenceManifestDigest,
    };
    const decision = this.gate.evaluate(candidate, {
      authorityContract: 'memory-claim-resolution-v1',
      currentSessionId: input.sourceSessionId,
      deletionScopeDigest,
      evidenceManifestDigest,
      policyRevision: String(job.policyRevision),
      projectId: input.projectId,
      snapshotRevision: 1,
      sourceSessionIds: [input.sourceSessionId],
    });
    if (decision.mutation.action === 'none')
      throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
  }

  private async createClaims(
    tx: TransactionClient,
    input: MemoryP2CommitInput,
  ): Promise<
    Array<{
      claim: MemoryP2ClaimInput;
      claimId: string;
      evidenceManifestHash: string;
      evidences: Array<MemoryP2EvidenceInput & { evidenceId: string }>;
      inputs: AiJobInputSegment[];
    }>
  > {
    const rows: Array<{
      claim: MemoryP2ClaimInput;
      claimId: string;
      evidenceManifestHash: string;
      evidences: Array<MemoryP2EvidenceInput & { evidenceId: string }>;
      inputs: AiJobInputSegment[];
    }> = [];
    for (const claim of input.claims) {
      const claimId = randomUUID();
      this.assertOrdered(claim.evidences);
      this.assertUnique(claim.evidences.map((evidence) => evidence.inputSegmentId));
      if (
        claim.canonicalKey !== input.target.canonicalKey ||
        claim.semanticKind !== input.target.semanticKind ||
        claim.evidences.length === 0
      )
        throw new MemoryP2PersistenceError('MEMORY_P2_INPUT_SCOPE_MISMATCH');
      const inputs = await tx.aiJobInputSegment.findMany({
        orderBy: { inputOrder: 'asc' },
        where: {
          aiJobId: input.aiJobId,
          id: { in: claim.evidences.map((row) => row.inputSegmentId) },
        },
      });
      const byId = new Map(inputs.map((row) => [row.id, row]));
      const resolvedEvidences: Array<MemoryP2EvidenceInput & { evidenceId: string }> = [];
      for (const evidence of claim.evidences) {
        const frozen = byId.get(evidence.inputSegmentId);
        if (
          frozen === undefined ||
          frozen.sessionId !== input.sourceSessionId ||
          frozen.transcriptSegmentId !== evidence.sourceId ||
          frozen.textRevision !== evidence.textRevision ||
          frozen.speakerRoleRevision !== evidence.speakerRoleRevision ||
          frozen.effectiveTextDigest !== evidence.effectiveTextDigest ||
          frozen.trustedEffectiveRole !== 'elder' ||
          frozen.contentKind !== 'conversation'
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
        const authority = await tx.memoryEvidenceAuthority.findUnique({
          where: {
            projectId_sessionId_sourceKind_sourceId_authorityRevision: {
              authorityRevision: evidence.authorityRevision,
              projectId: input.projectId,
              sessionId: input.sourceSessionId,
              sourceId: evidence.sourceId,
              sourceKind: 'transcript_segment',
            },
          },
        });
        let evidenceId: string;
        if (authority === null) {
          if (evidence.expectedEvidenceId !== null)
            throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
          evidenceId = randomUUID();
          await tx.memoryEvidenceAuthority.create({
            data: {
              authorityRevision: 1,
              effectiveTextDigest: evidence.effectiveTextDigest,
              evidenceId,
              inputOrder: frozen.inputOrder,
              membershipDigest: evidence.membershipDigest,
              projectId: input.projectId,
              sessionId: input.sourceSessionId,
              sourceId: evidence.sourceId,
              sourceKind: 'transcript_segment',
              speakerRoleRevision: evidence.speakerRoleRevision,
              transcriptTextRevision: evidence.textRevision,
            },
          });
        } else {
          evidenceId = authority.evidenceId;
          if (
            (evidence.expectedEvidenceId !== null &&
              evidence.expectedEvidenceId !== authority.evidenceId) ||
            authority.authorityRevision !== evidence.authorityRevision ||
            authority.projectId !== input.projectId ||
            authority.sessionId !== input.sourceSessionId ||
            authority.sourceKind !== 'transcript_segment' ||
            authority.sourceId !== evidence.sourceId ||
            authority.membershipDigest !== evidence.membershipDigest ||
            authority.inputOrder !== frozen.inputOrder ||
            authority.transcriptTextRevision !== evidence.textRevision ||
            authority.speakerRoleRevision !== evidence.speakerRoleRevision ||
            authority.effectiveTextDigest !== evidence.effectiveTextDigest
          )
            throw new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH');
        }
        resolvedEvidences.push({ ...evidence, evidenceId });
      }
      const evidenceManifestHash = memoryP2ClaimEvidenceManifestHash(
        resolvedEvidences,
        input.projectId,
        input.sourceSessionId,
      );
      const outputId = randomUUID();
      const orderedInputs = claim.evidences.map((evidence) => {
        const frozen = byId.get(evidence.inputSegmentId);
        if (frozen === undefined) throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
        return frozen;
      });
      await tx.aiDerivedOutput.create({
        data: {
          aiJobId: input.aiJobId,
          businessOutputId: claimId,
          expectedMemoryCount: 0,
          expectedMemoryManifestHash: EMPTY_MANIFEST_HASH,
          expectedQuestionCount: 0,
          expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
          expectedSegmentCount: orderedInputs.length,
          expectedSegmentManifestHash: manifestHash(
            orderedInputs.map((row) => this.segmentManifestEntry(row)),
          ),
          id: outputId,
          outputType: 'memory_claim',
          projectId: input.projectId,
        },
      });
      await tx.memoryClaim.create({
        data: {
          aiDerivedOutputId: outputId,
          aiJobId: input.aiJobId,
          canonicalKey: claim.canonicalKey,
          claimRevision: 1,
          explicitCorrection: claim.explicitCorrection,
          id: claimId,
          layer: input.target.layer,
          memoryType: claim.memoryType,
          normalizedValueDigest: claim.normalizedValueDigest,
          projectId: input.projectId,
          provenanceState: 'active',
          semanticKind: claim.semanticKind,
          sourceSessionId: input.sourceSessionId,
          threadId: (
            await tx.memoryEvolutionCheckpoint.findUniqueOrThrow({
              where: { id: input.checkpointId },
            })
          ).sourceThreadId,
          valueJson: claim.valueJson,
          valueKind: claim.valueKind,
        },
      });
      for (const [dependencyOrder, evidence] of resolvedEvidences.entries()) {
        await tx.memoryClaimEvidence.create({
          data: {
            aiJobInputSegmentId: evidence.inputSegmentId,
            authorityRevision: evidence.authorityRevision,
            evidenceId: evidence.evidenceId,
            evidenceOrder: dependencyOrder,
            memoryClaimId: claimId,
            transcriptSegmentId: evidence.sourceId,
          },
        });
        await tx.memoryEvidenceBridge.create({
          data: {
            aiJobInputSegmentId: evidence.inputSegmentId,
            authorityRevision: evidence.authorityRevision,
            claimId,
            evidenceId: evidence.evidenceId,
          },
        });
        await tx.aiOutputSegmentDependency.create({
          data: {
            aiDerivedOutputId: outputId,
            aiJobInputSegmentId: evidence.inputSegmentId,
            dependencyOrder,
            id: randomUUID(),
          },
        });
      }
      rows.push({
        claim,
        claimId,
        evidenceManifestHash,
        evidences: resolvedEvidences,
        inputs: orderedInputs,
      });
    }
    return rows;
  }

  private async createLongProjection(
    tx: TransactionClient,
    input: MemoryP2CommitInput,
    layerRevisionId: string,
  ): Promise<void> {
    this.assertOrdered(input.longSources);
    this.assertUnique(input.longSources.map((source) => source.sourceMidRevisionId));
    if (
      input.longSources.length === 0 ||
      input.longSourceManifestHash === null ||
      input.longSourceMidManifestHash === null ||
      memoryP2LongSourceManifestHash(input.longSources) !== input.longSourceMidManifestHash
    )
      throw new MemoryP2PersistenceError('MEMORY_P2_MANIFEST_INVALID');
    const sourceSessionIds = [
      ...new Set(input.longSources.map((source) => source.sourceSessionId)),
    ].sort();
    if (!sourceSessionIds.includes(input.sourceSessionId))
      throw new MemoryP2PersistenceError('MEMORY_P2_INPUT_SCOPE_MISMATCH');
    const sourceRevisions = await tx.memoryLayerRevision.findMany({
      where: { id: { in: input.longSources.map((source) => source.sourceMidRevisionId) } },
    });
    const sourceRevisionById = new Map(sourceRevisions.map((revision) => [revision.id, revision]));
    if (
      sourceRevisions.length !== input.longSources.length ||
      input.longSources.some((source) => {
        const revision = sourceRevisionById.get(source.sourceMidRevisionId);
        return (
          revision === undefined ||
          revision.projectId !== input.projectId ||
          revision.layer !== 'mid' ||
          revision.sourceSessionId !== source.sourceSessionId ||
          revision.memberManifestHash !== source.membershipDigest
        );
      })
    )
      throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
    const projection = await tx.memoryLongJobProjection.create({
      data: {
        aiJobId: input.aiJobId,
        deletionScopeDigest: (
          await tx.memoryP2JobProjection.findUniqueOrThrow({ where: { aiJobId: input.aiJobId } })
        ).deletionScopeDigest,
        expectedSourceCount: input.longSources.length,
        sourceFinalCheckpointId: input.checkpointId,
        sourceManifestHash: input.longSourceManifestHash,
        sourceMidManifestHash: input.longSourceMidManifestHash,
        sourceSessionIds,
        sourceSessionSetHash: memoryP2SourceSessionSetHash(sourceSessionIds),
        targetLayerRevisionId: layerRevisionId,
      },
    });
    await tx.memoryLongJobProjectionSource.createMany({
      data: input.longSources.map((source) => ({
        inputOrder: source.inputOrder,
        membershipDigest: source.membershipDigest,
        projectionId: projection.id,
        sourceMidRevisionId: source.sourceMidRevisionId,
        sourceSessionId: source.sourceSessionId,
      })),
    });
  }

  private async readReferenceAuthorities(
    references: readonly MemoryP2TraceReference[],
    db: DatabaseClient = this.prisma,
  ): Promise<readonly MemoryP2TraceReferenceAuthority[]> {
    const authorities: MemoryP2TraceReferenceAuthority[] = [];
    for (const reference of references) {
      const targetId = p2TraceReferenceTarget(reference);
      const base = {
        deletionScopeDigest: reference.deletionScopeDigest,
        membershipDigest: reference.membershipDigest,
        sourceKind: reference.sourceKind,
        sourceRevision: reference.sourceRevision,
        targetId,
      } as const;
      if (reference.sourceKind === 'checkpoint') {
        const row = await db.memoryEvolutionCheckpoint.findUnique({
          where: { id: targetId },
        });
        if (row === null) return [];
        authorities.push({
          ...base,
          membershipDigest: row.memberManifestHash,
          projectId: row.projectId,
          readability: checkpointReadability(row.lifecycleStatus),
          sessionId: row.sourceSessionId,
          sourceRevision: 1,
        });
        continue;
      }
      if (reference.sourceKind === 'job') {
        const row = await db.aiJob.findUnique({ where: { id: targetId } });
        if (row === null) return [];
        const session = await db.aiJobSessionScope.findFirst({
          orderBy: { inputOrder: 'asc' },
          where: { aiJobId: row.id },
        });
        if (session === null) return [];
        authorities.push({
          ...base,
          membershipDigest: row.inputHash,
          projectId: row.projectId,
          readability:
            row.retentionState === 'active' && row.expiresAt > new Date() ? 'active' : 'expired',
          sessionId: session.sessionId,
          sourceRevision: 1,
        });
        continue;
      }
      if (reference.sourceKind === 'input_segment') {
        const row = await db.aiJobInputSegment.findUnique({ where: { id: targetId } });
        if (row === null) return [];
        const job = await db.aiJob.findUnique({ where: { id: row.aiJobId } });
        if (job === null) return [];
        authorities.push({
          ...base,
          membershipDigest: row.effectiveTextDigest,
          projectId: job.projectId,
          readability:
            job.retentionState === 'active' && job.expiresAt > new Date() ? 'active' : 'expired',
          sessionId: row.sessionId,
          sourceRevision: row.textRevision,
        });
        continue;
      }
      if (reference.sourceKind === 'evidence') {
        const row = await db.memoryEvidenceAuthority.findUnique({
          where: { evidenceId: targetId },
        });
        if (row === null) return [];
        authorities.push({
          ...base,
          membershipDigest: row.membershipDigest,
          projectId: row.projectId,
          readability: 'active',
          sessionId: row.sessionId,
          sourceRevision: row.authorityRevision,
        });
        continue;
      }
      const row = await db.memoryResolutionAuthority.findUnique({
        where: { authorityId: targetId },
      });
      if (row === null) return [];
      const member = await db.memoryEvolutionCheckpointMember.findFirst({
        orderBy: { inputOrder: 'asc' },
        where: { resolutionAuthorityId: row.authorityId },
      });
      authorities.push({
        ...base,
        membershipDigest: member?.membershipDigest ?? reference.membershipDigest,
        projectId: row.projectId,
        readability: 'active',
        sessionId: row.originSessionId,
      });
    }
    return authorities;
  }

  private async lockRecoveryBase(tx: TransactionClient, jobId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "ai_job_id" FROM "memory_p2_job_projection" WHERE "ai_job_id" = ${jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "trace_id" FROM "decision_trace_memory_semantic" WHERE "ai_job_id" = ${jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "decision_trace" WHERE "ai_job_id" = ${jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "ai_job_session_scope" WHERE "ai_job_id" = ${jobId}::uuid FOR UPDATE`;
  }

  private async lockRecoveryParticipants(
    tx: TransactionClient,
    authority: MemoryP2RecoveryAuthority,
  ): Promise<void> {
    if (authority.checkpoint !== null)
      await tx.$queryRaw`SELECT "id" FROM "memory_evolution_checkpoint" WHERE "id" = ${authority.checkpoint.checkpointId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "trace_id" FROM "decision_trace_memory_source_reference" WHERE "trace_id" = ${authority.identity.traceId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "memory_layer_revision" WHERE "source_job_id" = ${authority.identity.aiJobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT member."id" FROM "memory_layer_revision_member" member JOIN "memory_layer_revision" revision ON revision."id" = member."revision_id" WHERE revision."source_job_id" = ${authority.identity.aiJobId}::uuid FOR UPDATE OF member`;
    await tx.$queryRaw`SELECT resolution."id" FROM "memory_resolution" resolution WHERE resolution."ai_job_id" = ${authority.identity.aiJobId}::uuid FOR UPDATE`;
    if (authority.committed !== null) {
      await tx.$queryRaw`SELECT "id" FROM "memory_layer_identity" WHERE "id" = ${authority.committed.targetLayerIdentityId}::uuid FOR UPDATE`;
      const revisions = [authority.committed.targetLayerRevisionId];
      for (const revisionId of revisions) {
        await tx.$queryRaw`SELECT "id" FROM "memory_layer_revision" WHERE "id" = ${revisionId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "memory_layer_revision_member" WHERE "revision_id" = ${revisionId}::uuid FOR UPDATE`;
      }
      for (const resolutionAuthorityId of authority.committed.resolutionAuthorityIds)
        await tx.$queryRaw`SELECT "authority_id" FROM "memory_resolution_authority" WHERE "authority_id" = ${resolutionAuthorityId}::uuid FOR UPDATE`;
      for (const evidenceId of authority.committed.evidenceAuthorityIds)
        await tx.$queryRaw`SELECT "evidence_id" FROM "memory_evidence_authority" WHERE "evidence_id" = ${evidenceId}::uuid FOR UPDATE`;
    }
    for (const reference of authority.references) {
      const targetId = p2TraceReferenceTarget(reference);
      if (reference.sourceKind === 'checkpoint')
        await tx.$queryRaw`SELECT "id" FROM "memory_evolution_checkpoint" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      else if (reference.sourceKind === 'job')
        await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      else if (reference.sourceKind === 'input_segment')
        await tx.$queryRaw`SELECT "id" FROM "ai_job_input_segment" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      else if (reference.sourceKind === 'evidence')
        await tx.$queryRaw`SELECT "evidence_id" FROM "memory_evidence_authority" WHERE "evidence_id" = ${targetId}::uuid FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT "authority_id" FROM "memory_resolution_authority" WHERE "authority_id" = ${targetId}::uuid FOR UPDATE`;
    }
  }

  private segmentManifestEntry(row: {
    effectiveTextDigest: string;
    id: string;
    speakerRoleRevision: number;
    textRevision: number;
    transcriptSegmentId: string;
  }): string {
    return `${row.id}:${row.transcriptSegmentId}:${String(row.textRevision)}:${String(row.speakerRoleRevision)}:${row.effectiveTextDigest}`;
  }
}

function semanticErrorCode(
  value: string | null,
): import('./memory-p2-observability.types.js').MemoryP2ErrorCode | null {
  const values = new Set([
    'P2_CAS_LOST',
    'P2_DELETION_SCOPE_DRIFT',
    'P2_MIGRATION_UNAVAILABLE',
    'P2_POLICY_DRIFT',
    'P2_PROVIDER_UNAVAILABLE',
    'P2_RESTART_RECOVERY',
    'P2_RETENTION_UNAVAILABLE',
    'P2_SOURCE_DRIFT',
    'P2_TARGET_DRIFT',
    'P2_TERMINAL_UNAVAILABLE',
    'P2_TRACE_UNAVAILABLE',
  ]);
  return value !== null && values.has(value)
    ? (value as import('./memory-p2-observability.types.js').MemoryP2ErrorCode)
    : null;
}

function p2TraceReferenceFromRow(row: {
  sourceKind: string;
  sourceCheckpointId: string | null;
  sourceJobId: string | null;
  aiJobInputSegmentId: string | null;
  evidenceId: string | null;
  resolutionAuthorityId: string | null;
  sourceRevision: number;
  membershipDigest: string;
  deletionScopeDigest: string;
  inputOrder: number;
}): MemoryP2TraceReference {
  const base = {
    deletionScopeDigest: row.deletionScopeDigest,
    inputOrder: row.inputOrder,
    membershipDigest: row.membershipDigest,
    sourceRevision: row.sourceRevision,
  };
  if (row.sourceKind === 'checkpoint' && row.sourceCheckpointId !== null)
    return { ...base, sourceCheckpointId: row.sourceCheckpointId, sourceKind: 'checkpoint' };
  if (row.sourceKind === 'job' && row.sourceJobId !== null)
    return { ...base, sourceJobId: row.sourceJobId, sourceKind: 'job' };
  if (row.sourceKind === 'input_segment' && row.aiJobInputSegmentId !== null)
    return { ...base, aiJobInputSegmentId: row.aiJobInputSegmentId, sourceKind: 'input_segment' };
  if (row.sourceKind === 'evidence' && row.evidenceId !== null)
    return { ...base, evidenceId: row.evidenceId, sourceKind: 'evidence' };
  if (row.sourceKind === 'resolution' && row.resolutionAuthorityId !== null)
    return { ...base, resolutionAuthorityId: row.resolutionAuthorityId, sourceKind: 'resolution' };
  throw new MemoryP2PersistenceError('MEMORY_P2_READ_UNAVAILABLE');
}

function p2TraceReferenceTarget(reference: MemoryP2TraceReference): string {
  switch (reference.sourceKind) {
    case 'checkpoint':
      return reference.sourceCheckpointId;
    case 'job':
      return reference.sourceJobId;
    case 'input_segment':
      return reference.aiJobInputSegmentId;
    case 'evidence':
      return reference.evidenceId;
    case 'resolution':
      return reference.resolutionAuthorityId;
  }
}

function checkpointReadability(status: string): MemoryP2TraceReferenceAuthority['readability'] {
  if (status === 'committed' || status === 'frozen') return 'active';
  if (status === 'hidden') return 'hidden';
  if (status === 'deleted') return 'deleted';
  if (status === 'expired') return 'expired';
  if (status === 'cleanup_failed') return 'cleanup_failed';
  return 'missing';
}

function recoveryMigrationStatus(
  status: string | undefined,
): MemoryP2RecoveryAuthority['migrationStatus'] {
  if (
    status === 'ready' ||
    status === 'completed' ||
    status === 'upgrading' ||
    status === 'interrupted'
  )
    return status;
  return 'unavailable';
}

function recoveryCommandMatchesAuthority(
  command: MemoryP2RecoveryCommand,
  authority: MemoryP2RecoveryAuthority,
): boolean {
  const traceStatus = authority.trace?.status ?? 'missing';
  const committed = authority.committed;
  return (
    authority.identity.aiJobId === command.jobId &&
    authority.attemptNo === command.expectedAttemptNo &&
    command.expectedJobStatuses.includes(authority.jobStatus) &&
    authority.jobRevision === command.expectedJobRevision &&
    authority.leaseOwnerId === command.expectedLeaseOwnerId &&
    authority.leaseEpoch === command.expectedLeaseEpoch &&
    sameDate(authority.leaseExpiresAt, command.expectedLeaseExpiresAt) &&
    command.expectedTraceStatuses.includes(traceStatus) &&
    sameTraceReferences(authority.references, command.trace.references) &&
    sameReferenceAuthorities(authority.referenceAuthorities, command.trace.references) &&
    (authority.trace?.proposalDigest ?? null) === command.trace.semantic.proposalDigest &&
    (authority.trace?.planDigest ?? null) === command.trace.semantic.planDigest &&
    (authority.trace?.commitDigest ?? null) === command.trace.semantic.commitDigest &&
    (authority.checkpoint?.checkpointId ?? null) === command.expectedCheckpointId &&
    (authority.checkpoint?.deletionScopeDigest ?? null) === command.expectedDeletionScopeDigest &&
    (authority.checkpoint?.p2PolicyRevision ?? null) === command.expectedP2PolicyRevision &&
    (authority.checkpoint?.p2RetentionPolicyVersion ?? null) ===
      command.expectedP2RetentionPolicyVersion &&
    authority.identity.sourceManifestHash === command.expectedSourceManifestHash &&
    authority.targetLayer === command.expectedTargetLayer &&
    sameStrings(authority.sourceSessionIds, command.expectedSourceSessionIds) &&
    authority.sourceSessionManifestHash === command.expectedSourceSessionManifestHash &&
    referenceAuthoritiesBoundToAuthority(authority) &&
    authority.identity.deletionScopeDigest === command.expectedDeletionScopeDigest &&
    authority.p2PolicyRevision === command.expectedP2PolicyRevision &&
    authority.p2RetentionPolicyVersion === command.expectedP2RetentionPolicyVersion &&
    sameDate(authority.identity.expiresAt, command.expectedRetentionExpiresAt) &&
    (committed?.targetLayerRevisionId ?? null) === command.expectedTargetLayerRevisionId &&
    (committed?.targetRevision ?? null) === command.expectedTargetRevision &&
    (committed?.targetRevisionDigest ?? null) === command.expectedTargetRevisionDigest &&
    (committed?.commitDigest ?? null) === command.expectedCommitDigest
  );
}

function referenceAuthoritiesBoundToAuthority(authority: MemoryP2RecoveryAuthority): boolean {
  return authority.referenceAuthorities.every(
    (reference) =>
      reference.projectId === authority.identity.projectId &&
      authority.sourceSessionIds.includes(reference.sessionId) &&
      reference.readability === 'active',
  );
}

function sameDate(actual: Date | null, expected: Date | null): boolean {
  return actual?.getTime() === expected?.getTime();
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function sameTraceReferences(
  actual: readonly MemoryP2TraceReference[],
  expected: readonly MemoryP2TraceReference[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((reference, index) => {
      const other = expected[index];
      return (
        other !== undefined &&
        reference.sourceKind === other.sourceKind &&
        p2TraceReferenceTarget(reference) === p2TraceReferenceTarget(other) &&
        reference.sourceRevision === other.sourceRevision &&
        reference.membershipDigest === other.membershipDigest &&
        reference.deletionScopeDigest === other.deletionScopeDigest &&
        reference.inputOrder === other.inputOrder
      );
    })
  );
}

function sameReferenceAuthorities(
  authorities: readonly MemoryP2TraceReferenceAuthority[],
  references: readonly MemoryP2TraceReference[],
): boolean {
  return (
    authorities.length === references.length &&
    authorities.every((authority, index) => {
      const reference = references[index];
      return (
        reference !== undefined &&
        authority.sourceKind === reference.sourceKind &&
        authority.targetId === p2TraceReferenceTarget(reference) &&
        authority.sourceRevision === reference.sourceRevision &&
        authority.membershipDigest === reference.membershipDigest &&
        authority.deletionScopeDigest === reference.deletionScopeDigest
      );
    })
  );
}
