import { Injectable } from '@nestjs/common';

import { canonicalJson, sha256 } from '../ai-runtime/ai-provenance.js';
import { PrismaService } from '../database/prisma.service.js';
import { canonicalDigest } from './memory-persistence-contract.js';
import {
  MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT,
  MEMORY_P2_MIGRATION_SCHEMA_VERSION,
  memoryP2LongSourceManifestHash,
  memoryP2SourceSessionSetHash,
  type ReadableMemoryP2Checkpoint,
  type ReadableMemoryP2LayerRevision,
  type MemoryP2LongWakeCandidate,
} from './memory-p2-persistence.types.js';

@Injectable()
export class MemoryP2PersistenceReader {
  public constructor(private readonly prisma: PrismaService) {}

  public async readCheckpoint(checkpointId: string): Promise<ReadableMemoryP2Checkpoint | null> {
    if (!(await this.migrationReady())) return null;
    const checkpoint = await this.prisma.memoryEvolutionCheckpoint.findUnique({
      where: { id: checkpointId },
    });
    if (
      checkpoint === null ||
      checkpoint.lifecycleStatus !== 'committed' ||
      checkpoint.committedAt === null
    )
      return null;
    const [job, members, retention] = await Promise.all([
      this.prisma.aiJob.findUnique({ where: { id: checkpoint.p2ProducerJobId } }),
      this.prisma.memoryEvolutionCheckpointMember.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { checkpointId },
      }),
      this.prisma.memoryP2RetentionTarget.findFirst({
        where: { aiJobId: checkpoint.p2ProducerJobId, checkpointId, targetKind: 'checkpoint' },
      }),
    ]);
    if (
      job === null ||
      job.status !== 'succeeded' ||
      job.retentionState !== 'active' ||
      job.expiresAt <= new Date() ||
      retention === null ||
      members.length !== checkpoint.expectedMemberCount ||
      !this.contiguous(members)
    )
      return null;
    if (
      canonicalDigest(
        members.map((member) => [
          member.resolutionAuthorityId,
          member.resolutionRevision,
          member.semanticStatus,
          member.claimCount,
          member.boundaryStatus,
          member.membershipDigest,
          member.inputOrder,
        ]),
      ) !== checkpoint.memberManifestHash
    )
      return null;
    const resolutions = await this.prisma.memoryResolution.findMany({
      where: { id: { in: members.map((member) => member.resolutionRowId) } },
    });
    const resolutionMembers = await this.prisma.memoryResolutionMember.findMany({
      where: { memoryResolutionId: { in: members.map((member) => member.resolutionRowId) } },
    });
    const claimCounts = new Map<string, number>();
    for (const member of resolutionMembers)
      claimCounts.set(
        member.memoryResolutionId,
        (claimCounts.get(member.memoryResolutionId) ?? 0) + 1,
      );
    const byId = new Map(resolutions.map((resolution) => [resolution.id, resolution]));
    for (const member of members) {
      const resolution = byId.get(member.resolutionRowId);
      if (
        resolution === undefined ||
        resolution.projectId !== checkpoint.projectId ||
        resolution.authorityId !== member.resolutionAuthorityId ||
        resolution.resolutionRevision !== member.resolutionRevision ||
        resolution.semanticStatus !== member.semanticStatus ||
        (claimCounts.get(member.resolutionRowId) ?? 0) !== member.claimCount
      )
        return null;
    }
    return {
      checkpointId,
      committedAt: checkpoint.committedAt,
      memberIds: members.map((member) => member.resolutionAuthorityId),
      memberManifestHash: checkpoint.memberManifestHash,
      projectId: checkpoint.projectId,
      sourceSessionId: checkpoint.sourceSessionId,
    };
  }

  public async readCurrentLayer(identityId: string): Promise<ReadableMemoryP2LayerRevision | null> {
    if (!(await this.migrationReady())) return null;
    const revision = await this.prisma.memoryLayerRevision.findFirst({
      where: { identityId, lifecycleStatus: 'current' },
    });
    if (revision === null || (revision.layer !== 'mid' && revision.layer !== 'long')) return null;
    const [identity, resolution, checkpoint, job, projection, members, retention] =
      await Promise.all([
        this.prisma.memoryLayerIdentity.findUnique({ where: { id: identityId } }),
        this.prisma.memoryResolution.findUnique({ where: { id: revision.resolutionRowId } }),
        this.prisma.memoryEvolutionCheckpoint.findUnique({
          where: { id: revision.sourceCheckpointId },
        }),
        this.prisma.aiJob.findUnique({ where: { id: revision.sourceJobId } }),
        this.prisma.memoryP2JobProjection.findUnique({ where: { aiJobId: revision.sourceJobId } }),
        this.prisma.memoryLayerRevisionMember.findMany({
          orderBy: { inputOrder: 'asc' },
          where: { revisionId: revision.id },
        }),
        this.prisma.memoryP2RetentionTarget.findFirst({
          where: {
            aiJobId: revision.sourceJobId,
            layerRevisionId: revision.id,
            targetKind: 'layer_revision',
          },
        }),
      ]);
    if (
      identity === null ||
      resolution === null ||
      checkpoint === null ||
      job === null ||
      projection === null ||
      retention === null ||
      checkpoint.lifecycleStatus !== 'committed' ||
      job.status !== 'succeeded' ||
      job.retentionState !== 'active' ||
      job.expiresAt <= new Date() ||
      projection.targetLayerIdentityId !== identityId ||
      projection.targetLayerRevisionId !== revision.id ||
      projection.targetRevisionDigest !== revision.memberManifestHash ||
      resolution.status !== 'current' ||
      !resolution.p2Write ||
      resolution.authorityId !== revision.resolutionAuthorityId ||
      resolution.resolutionRevision !== revision.resolutionRevision ||
      resolution.semanticStatus !== revision.semanticStatus ||
      identity.originResolutionAuthorityId !== revision.resolutionAuthorityId ||
      members.length !== revision.expectedMemberCount ||
      !this.contiguous(members)
    )
      return null;
    const semantic = await this.prisma.decisionTraceMemorySemantic.findUnique({
      where: { aiJobId: revision.sourceJobId },
    });
    if (semantic === null) return null;
    const [trace, traceSources, retentionTargets] = await Promise.all([
      this.prisma.decisionTrace.findUnique({ where: { id: semantic.traceId } }),
      this.prisma.decisionTraceMemorySourceReference.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { traceId: semantic.traceId },
      }),
      this.prisma.memoryP2RetentionTarget.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: revision.sourceJobId },
      }),
    ]);
    const semanticSourceManifestHash =
      revision.layer === 'long'
        ? await this.readableLongSourceManifest(
            revision.sourceJobId,
            revision.id,
            revision.projectId,
          )
        : projection.sourceRevisionDigest;
    const expectedRetentionKinds =
      revision.layer === 'long'
        ? ['job', 'trace', 'layer_revision']
        : ['job', 'trace', 'checkpoint', 'layer_revision'];
    if (
      trace === null ||
      semanticSourceManifestHash === null ||
      trace.traceKind !== 'memory_layer_evolve' ||
      trace.triggerType !== 'memory_layer_evolve' ||
      trace.decisionOutcome !== 'unavailable' ||
      trace.directorInvoked ||
      trace.contextRevision !== 0 ||
      canonicalDigest(trace.stageTimingsJson) !== canonicalDigest({}) ||
      trace.status !== 'succeeded' ||
      trace.stage !== 'committed' ||
      trace.errorCode !== null ||
      trace.memoryOutcome !==
        (revision.layer === 'long' ? 'long_committed' : 'checkpoint_committed') ||
      trace.expiresAt.getTime() !== job.expiresAt.getTime() ||
      semantic.deletionScopeDigest !== projection.deletionScopeDigest ||
      semantic.sourceManifestHash !== semanticSourceManifestHash ||
      semantic.proposalDigest === null ||
      semantic.planDigest === null ||
      semantic.commitDigest === null ||
      traceSources.length === 0 ||
      !this.contiguous(traceSources) ||
      traceSources.some(
        (source) =>
          source.deletionScopeDigest !== projection.deletionScopeDigest ||
          !this.traceSourceTypedReferenceValid(source),
      ) ||
      retentionTargets.length !== expectedRetentionKinds.length ||
      !this.contiguous(retentionTargets) ||
      retentionTargets.some((target, index) => target.targetKind !== expectedRetentionKinds[index])
    )
      return null;
    if (
      canonicalDigest(
        members.map((member) => [
          member.memoryClaimId,
          member.claimRevision,
          member.role,
          member.inputOrder,
          member.evidenceMembershipDigest,
        ]),
      ) !== revision.memberManifestHash
    )
      return null;
    const claims = await this.prisma.memoryClaim.findMany({
      where: { id: { in: members.map((member) => member.memoryClaimId) } },
    });
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    for (const member of members) {
      const claim = claimById.get(member.memoryClaimId);
      if (
        claim === undefined ||
        claim.projectId !== revision.projectId ||
        claim.claimRevision !== member.claimRevision ||
        claim.claimRevision !== 1 ||
        claim.layer !== revision.layer ||
        (revision.layer === 'mid' && claim.sourceSessionId !== revision.sourceSessionId) ||
        claim.semanticKind !== resolution.semanticKind ||
        !(await this.claimEvidenceReadable(claim.id, member.evidenceMembershipDigest))
      )
        return null;
    }
    return {
      authorityId: revision.resolutionAuthorityId,
      claimIds: members.map((member) => member.memoryClaimId),
      identityId,
      layer: revision.layer,
      memberManifestHash: revision.memberManifestHash,
      resolutionId: revision.resolutionRowId,
      resolutionRevision: revision.resolutionRevision,
      revisionId: revision.id,
      revisionNo: revision.revisionNo,
      semanticStatus: revision.semanticStatus,
    };
  }

  /**
   * Projects durable final-Mid commits into deterministic Long wake identities.
   * The final-Mid checkpoint/job/projection are committed atomically; callers may
   * scan repeatedly after a crash and rely on the AiJob trigger key uniqueness.
   */
  public async listPendingLongWakeCandidates(
    limit = 100,
  ): Promise<readonly MemoryP2LongWakeCandidate[]> {
    if (!(await this.migrationReady())) return [];
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.prisma.$queryRaw<
      readonly {
        ownerActorId: string;
        projectId: string;
        sourceFinalMidCheckpointId: string;
        sourceMidJobId: string;
        sourceP1TerminalJobId: string;
        sourceRevisionDigest: string;
        sourceSessionId: string;
      }[]
    >`
      SELECT
        job."requested_by" AS "ownerActorId",
        checkpoint."project_id" AS "projectId",
        checkpoint."id" AS "sourceFinalMidCheckpointId",
        job."id" AS "sourceMidJobId",
        checkpoint."source_p1_terminal_job_id" AS "sourceP1TerminalJobId",
        projection."target_revision_digest" AS "sourceRevisionDigest",
        checkpoint."source_session_id" AS "sourceSessionId"
      FROM "memory_evolution_checkpoint" checkpoint
      JOIN "ai_job" job ON job."id" = checkpoint."p2_producer_job_id"
      JOIN "memory_p2_job_projection" projection ON projection."ai_job_id" = job."id"
      WHERE checkpoint."lifecycle_status" = 'committed'
        AND checkpoint."committed_at" IS NOT NULL
        AND checkpoint."source_p1_terminal_job_id" IS NOT NULL
        AND job."job_type"::text = 'mid_final'
        AND job."status" = 'succeeded'
        AND job."retention_state" = 'active'
        AND job."expires_at" > now()
        AND projection."job_kind" = 'mid_final'
        AND projection."target_layer_identity_id" IS NOT NULL
        AND projection."target_layer_revision_id" IS NOT NULL
        AND projection."source_revision_digest" = checkpoint."member_manifest_hash"
        AND projection."target_revision_digest" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "memory_p2_job_projection" long_projection
          WHERE long_projection."job_kind" = 'long_session_end'
            AND long_projection."source_final_mid_checkpoint_id" = checkpoint."id"
        )
      ORDER BY checkpoint."committed_at" ASC, checkpoint."id" ASC
      LIMIT ${boundedLimit}
    `;
    return rows.map((row) => ({
      ...row,
      triggerDedupeKey: `memory-p2-v1:long:${row.sourceFinalMidCheckpointId}`,
    }));
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

  private contiguous(rows: readonly { inputOrder: number }[]): boolean {
    return rows.every((row, index) => row.inputOrder === index);
  }

  private async claimEvidenceReadable(claimId: string, expectedDigest: string): Promise<boolean> {
    const [links, bridges] = await Promise.all([
      this.prisma.memoryClaimEvidence.findMany({
        orderBy: { evidenceOrder: 'asc' },
        where: { memoryClaimId: claimId },
      }),
      this.prisma.memoryEvidenceBridge.findMany({ where: { claimId } }),
    ]);
    if (links.length === 0 || links.length !== bridges.length) return false;
    const bridgeByEvidence = new Map(bridges.map((bridge) => [bridge.evidenceId, bridge]));
    const [authorities, inputs] = await Promise.all([
      this.prisma.memoryEvidenceAuthority.findMany({
        where: {
          evidenceId: { in: links.flatMap((link) => (link.evidenceId ? [link.evidenceId] : [])) },
        },
      }),
      this.prisma.aiJobInputSegment.findMany({
        where: { id: { in: links.map((link) => link.aiJobInputSegmentId) } },
      }),
    ]);
    const authorityById = new Map(
      authorities.map((authority) => [authority.evidenceId, authority]),
    );
    const inputById = new Map(inputs.map((input) => [input.id, input]));
    const entries: unknown[] = [];
    for (const link of links) {
      if (link.evidenceId === null || link.authorityRevision === null) return false;
      const bridge = bridgeByEvidence.get(link.evidenceId);
      const authority = authorityById.get(link.evidenceId);
      const input = inputById.get(link.aiJobInputSegmentId);
      if (
        bridge === undefined ||
        authority === undefined ||
        input === undefined ||
        bridge.authorityRevision !== link.authorityRevision ||
        bridge.aiJobInputSegmentId !== link.aiJobInputSegmentId ||
        authority.authorityRevision !== link.authorityRevision ||
        authority.sourceId !== link.transcriptSegmentId ||
        input.transcriptSegmentId !== authority.sourceId ||
        input.sessionId !== authority.sessionId ||
        input.textRevision !== authority.transcriptTextRevision ||
        input.speakerRoleRevision !== authority.speakerRoleRevision ||
        input.effectiveTextDigest !== authority.effectiveTextDigest ||
        input.trustedEffectiveRole !== 'elder' ||
        input.contentKind !== 'conversation'
      )
        return false;
      entries.push([
        authority.evidenceId,
        authority.sourceKind,
        authority.sourceId,
        authority.authorityRevision,
        authority.membershipDigest,
        authority.projectId,
        authority.sessionId,
      ]);
    }
    entries.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    return sha256(canonicalJson(entries)) === expectedDigest;
  }

  private async readableLongSourceManifest(
    aiJobId: string,
    targetRevisionId: string,
    projectId: string,
  ): Promise<string | null> {
    const projection = await this.prisma.memoryLongJobProjection.findUnique({
      where: { aiJobId },
    });
    if (projection === null || projection.targetLayerRevisionId !== targetRevisionId) return null;
    const sources = await this.prisma.memoryLongJobProjectionSource.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { projectionId: projection.id },
    });
    if (
      sources.length !== projection.expectedSourceCount ||
      sources.length === 0 ||
      !this.contiguous(sources) ||
      memoryP2LongSourceManifestHash(sources) !== projection.sourceMidManifestHash
    )
      return null;
    const actualSessionIds = [...new Set(sources.map((source) => source.sourceSessionId))].sort();
    const projectedSessionIds = [...projection.sourceSessionIds].sort();
    if (
      actualSessionIds.length !== projection.sourceSessionIds.length ||
      actualSessionIds.length !== projectedSessionIds.length ||
      actualSessionIds.some((sessionId, index) => sessionId !== projectedSessionIds[index]) ||
      memoryP2SourceSessionSetHash(actualSessionIds) !== projection.sourceSessionSetHash
    )
      return null;
    const revisions = await this.prisma.memoryLayerRevision.findMany({
      where: { id: { in: sources.map((source) => source.sourceMidRevisionId) } },
    });
    const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
    if (
      revisions.length !== sources.length ||
      sources.some((source) => {
        const revision = revisionById.get(source.sourceMidRevisionId);
        return (
          revision === undefined ||
          revision.projectId !== projectId ||
          revision.layer !== 'mid' ||
          revision.sourceSessionId !== source.sourceSessionId ||
          revision.memberManifestHash !== source.membershipDigest
        );
      })
    )
      return null;
    return projection.sourceManifestHash;
  }

  private traceSourceTypedReferenceValid(source: {
    aiJobInputSegmentId: string | null;
    evidenceId: string | null;
    resolutionAuthorityId: string | null;
    sourceCheckpointId: string | null;
    sourceJobId: string | null;
    sourceKind: string;
  }): boolean {
    const refs = [
      source.sourceCheckpointId,
      source.sourceJobId,
      source.aiJobInputSegmentId,
      source.evidenceId,
      source.resolutionAuthorityId,
    ];
    if (refs.filter((value) => value !== null).length !== 1) return false;
    return (
      (source.sourceKind === 'checkpoint' && source.sourceCheckpointId !== null) ||
      (source.sourceKind === 'job' && source.sourceJobId !== null) ||
      (source.sourceKind === 'input_segment' && source.aiJobInputSegmentId !== null) ||
      (source.sourceKind === 'evidence' && source.evidenceId !== null) ||
      (source.sourceKind === 'resolution' && source.resolutionAuthorityId !== null)
    );
  }
}
