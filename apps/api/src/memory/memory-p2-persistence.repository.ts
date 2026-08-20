import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { EMPTY_MANIFEST_HASH, manifestHash } from '../ai-runtime/ai-provenance.js';
import { PrismaService } from '../database/prisma.service.js';
import {
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

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class MemoryP2PersistenceRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async freezeCheckpoint(
    input: MemoryP2FreezeCheckpointInput,
  ): Promise<MemoryP2FrozenCheckpoint> {
    return this.prisma.$transaction(
      async (tx) => {
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

        const replay = await tx.memoryEvolutionCheckpoint.findUnique({
          where: { p2ProducerJobId: input.aiJobId },
        });
        if (replay !== null) {
          if (
            replay.id !== input.checkpointId ||
            replay.rootIdentity !== input.rootIdentity ||
            replay.memberManifestHash !== input.memberManifestHash
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

        this.assertOrdered(input.members);
        this.assertOrdered(input.sourceTraceReferences);
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
            memoryOutcome: 'unavailable',
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async freezeLongJob(input: MemoryP2FreezeLongJobInput): Promise<MemoryP2FrozenCheckpoint> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMigrationReady(tx);
        this.assertLease(input.lease);
        await this.lockScope(tx, input.projectId, input.sourceSessionId);
        await tx.$queryRaw`SELECT "id" FROM "memory_evolution_checkpoint" WHERE "id" = ${input.sourceFinalMidCheckpointId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "ai_job" WHERE "id" = ${input.aiJobId}::uuid FOR UPDATE`;
        const job = await tx.aiJob.findUnique({ where: { id: input.aiJobId } });
        const checkpoint = await tx.memoryEvolutionCheckpoint.findUnique({
          where: { id: input.sourceFinalMidCheckpointId },
        });
        const replay = await tx.memoryP2JobProjection.findUnique({
          where: { aiJobId: input.aiJobId },
        });
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
          checkpoint.sourceP1TerminalJobId !== input.sourceP1TerminalJobId
        )
          throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
        if (input.lease.expiresAt > input.expiresAt)
          throw new MemoryP2PersistenceError('MEMORY_P2_CHECKPOINT_INVALID');
        if (replay !== null) {
          const semantic = await tx.decisionTraceMemorySemantic.findUnique({
            where: { aiJobId: input.aiJobId },
          });
          if (
            semantic === null ||
            replay.sourceFinalMidCheckpointId !== input.sourceFinalMidCheckpointId ||
            replay.sourceRevisionDigest !== input.sourceRevisionDigest ||
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
        this.assertOrdered(input.sourceTraceReferences);
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
            memoryOutcome: 'unavailable',
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async commitLayerRevision(input: MemoryP2CommitInput): Promise<MemoryP2CommitResult> {
    this.assertLease(input.lease);
    return this.prisma.$transaction(
      async (tx) => {
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
        const resolutionRevision = input.target.expectedCurrentRevision + 1;
        if (previousResolution !== null) {
          const frozen = await tx.aiJobInputMemory.findFirst({
            where: { aiJobId: input.aiJobId, memoryResolutionId: previousResolution.id },
          });
          if (
            frozen === null ||
            frozen.resolutionRevision !== previousResolution.resolutionRevision
          )
            throw new MemoryP2PersistenceError('MEMORY_P2_SOURCE_NOT_FROZEN');
          await tx.memoryResolution.update({
            data: { status: 'superseded' },
            where: { id: previousResolution.id },
          });
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
          ...new Map(
            claimRows.flatMap(({ inputs }) => inputs).map((row) => [row.id, row]),
          ).values(),
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
            memoryOutcome:
              input.target.layer === 'long' ? 'long_committed' : 'checkpoint_committed',
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
        const committedSources = [
          ...claimRows.flatMap(({ evidences }) =>
            evidences.map((evidence) => ({
              deletionScopeDigest: projection.deletionScopeDigest,
              inputOrder: 0,
              membershipDigest: evidence.membershipDigest,
              sourceId: evidence.evidenceId,
              sourceKind: 'evidence' as const,
              sourceRevision: evidence.authorityRevision,
            })),
          ),
          {
            deletionScopeDigest: projection.deletionScopeDigest,
            inputOrder: 0,
            membershipDigest: targetRevisionDigest,
            sourceId: authority.authorityId,
            sourceKind: 'resolution' as const,
            sourceRevision: resolutionRevision,
          },
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
      if (job.status !== 'running') {
        if (job.status === 'unavailable' && job.failureCode === input.errorCode) return;
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
        data: { completedAt: new Date(), failureCode: input.errorCode, status: 'unavailable' },
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
          memoryOutcome: 'unavailable',
          stage: 'terminal',
          status: 'unavailable',
        },
        where: { id: input.traceId },
      });
    });
  }

  public async listStaleRecoveryCandidates(
    limit = 100,
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
        AND projection."recovery_lease_expires_at" <= now()
      ORDER BY projection."recovery_lease_expires_at" ASC, projection."ai_job_id" ASC
      LIMIT ${boundedLimit}
    `;
    return rows.map((row) => ({
      aiJobId: row.aiJobId,
      lease: { epoch: row.epoch, expiresAt: row.expiresAt, owner: row.owner },
    }));
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
