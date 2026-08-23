import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { effectiveTextDigest } from '../ai-runtime/ai-provenance.js';
import type { EvidenceMemoryRecord, EvidenceTranscriptRecord } from './evidence-drilldown.types.js';

export abstract class EvidenceDrilldownReader {
  public abstract readMemory(
    memoryId: string,
    projectId: string,
  ): Promise<EvidenceMemoryRecord | null>;

  public abstract readTranscript(
    projectId: string,
    sessionIds: readonly string[],
    segmentIds: readonly string[] | null,
  ): Promise<readonly EvidenceTranscriptRecord[]>;
}

@Injectable()
export class PrismaEvidenceDrilldownReader extends EvidenceDrilldownReader {
  public constructor(private readonly prisma: PrismaService) {
    super();
  }

  public override async readMemory(
    memoryId: string,
    projectId: string,
  ): Promise<EvidenceMemoryRecord | null> {
    const [resolution, revision] = await Promise.all([
      this.prisma.memoryResolution.findUnique({ where: { id: memoryId } }),
      this.prisma.memoryLayerRevision.findFirst({
        orderBy: { revisionNo: 'desc' },
        where: { lifecycleStatus: 'current', projectId, resolutionRowId: memoryId },
      }),
    ]);
    if (
      resolution === null ||
      revision === null ||
      resolution.projectId !== projectId ||
      resolution.status !== 'current' ||
      !resolution.p2Write ||
      resolution.authorityId !== revision.resolutionAuthorityId ||
      resolution.resolutionRevision !== revision.resolutionRevision ||
      resolution.semanticKind === null ||
      resolution.semanticStatus !== revision.semanticStatus ||
      revision.layer === 'working'
    )
      return null;

    const revisionMembers = await this.prisma.memoryLayerRevisionMember.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { revisionId: revision.id },
    });
    if (
      revisionMembers.length === 0 ||
      revisionMembers.some((member) => member.claimRevision !== 1)
    )
      return null;

    const claimEvidence = await this.prisma.memoryClaimEvidence.findMany({
      orderBy: [{ memoryClaimId: 'asc' }, { evidenceOrder: 'asc' }],
      where: { memoryClaimId: { in: revisionMembers.map((member) => member.memoryClaimId) } },
    });
    const evidenceIds = claimEvidence
      .map((row) => row.evidenceId)
      .filter((value): value is string => value !== null);
    if (evidenceIds.length !== claimEvidence.length) return null;

    const [authorities, bridges, inputs] = await Promise.all([
      this.prisma.memoryEvidenceAuthority.findMany({ where: { evidenceId: { in: evidenceIds } } }),
      this.prisma.memoryEvidenceBridge.findMany({ where: { evidenceId: { in: evidenceIds } } }),
      this.prisma.aiJobInputSegment.findMany({
        where: { id: { in: claimEvidence.map((row) => row.aiJobInputSegmentId) } },
      }),
    ]);
    const authorityById = new Map(authorities.map((row) => [row.evidenceId, row]));
    const bridgeByKey = new Map(
      bridges.map((row) => [
        `${row.claimId}:${row.evidenceId}:${String(row.authorityRevision)}`,
        row,
      ]),
    );
    const inputById = new Map(inputs.map((row) => [row.id, row]));
    const unique = new Map<string, EvidenceMemoryRecord['evidence'][number]>();
    for (const link of claimEvidence) {
      const evidenceId = link.evidenceId;
      const authority = evidenceId === null ? undefined : authorityById.get(evidenceId);
      const bridge =
        evidenceId === null || link.authorityRevision === null
          ? undefined
          : bridgeByKey.get(
              `${link.memoryClaimId}:${evidenceId}:${String(link.authorityRevision)}`,
            );
      const input = inputById.get(link.aiJobInputSegmentId);
      if (
        evidenceId === null ||
        authority === undefined ||
        bridge === undefined ||
        input === undefined ||
        link.authorityRevision === null ||
        authority.authorityRevision !== link.authorityRevision ||
        bridge.authorityRevision !== link.authorityRevision ||
        bridge.aiJobInputSegmentId !== link.aiJobInputSegmentId ||
        authority.sourceKind !== 'transcript_segment' ||
        authority.sourceId !== link.transcriptSegmentId ||
        input.transcriptSegmentId !== authority.sourceId ||
        input.sessionId !== authority.sessionId ||
        input.contentKind !== 'conversation' ||
        input.textRevision !== authority.transcriptTextRevision ||
        input.speakerRoleRevision !== authority.speakerRoleRevision ||
        input.effectiveTextDigest !== authority.effectiveTextDigest
      )
        return null;
      unique.set(evidenceId, {
        authority_revision: authority.authorityRevision,
        effective_text_digest: authority.effectiveTextDigest,
        evidence_id: evidenceId,
        membership_digest: authority.membershipDigest,
        project_id: authority.projectId,
        session_id: authority.sessionId,
        source_id: authority.sourceId,
        speaker_role_revision: authority.speakerRoleRevision,
        text_revision: authority.transcriptTextRevision,
      });
    }
    if (unique.size === 0) return null;
    return {
      memory: {
        memory_id: resolution.id,
        membership_digest: revision.memberManifestHash,
        resolution_authority_id: revision.resolutionAuthorityId,
        revision_id: revision.id,
        revision_no: revision.revisionNo,
        semantic_kind: resolution.semanticKind,
        semantic_status: revision.semanticStatus,
        source_level: revision.layer,
      },
      evidence: [...unique.values()].sort((left, right) =>
        left.evidence_id.localeCompare(right.evidence_id),
      ),
    };
  }

  public override async readTranscript(
    projectId: string,
    sessionIds: readonly string[],
    segmentIds: readonly string[] | null,
  ): Promise<readonly EvidenceTranscriptRecord[]> {
    if (segmentIds !== null && segmentIds.length === 0) return [];
    const rows = await this.prisma.transcriptSegment.findMany({
      where: {
        ...(segmentIds === null ? {} : { id: { in: [...segmentIds] } }),
        contentKind: 'conversation',
        session: { projectId, id: { in: [...sessionIds] } },
      },
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
    });
    return rows.map((segment) => {
      const projection = projectTrustedSpeakerRole(segment);
      const text = segment.correctedText ?? segment.originalText;
      return {
        content_kind: segment.contentKind,
        effective_text_digest: effectiveTextDigest(text),
        project_id: projectId,
        segment_id: segment.id,
        session_id: segment.sessionId,
        speaker_role_revision: segment.speakerRoleRevision,
        start_ms: segment.startMs,
        text,
        text_revision: segment.textRevision,
        trusted_role: projection.trustedEffectiveSpeakerRole,
      };
    });
  }
}
