import { Injectable } from '@nestjs/common';

import {
  AiOutputEligibilityService,
  isCurrentMemoryProvenanceReadable,
} from '../ai-runtime/ai-output-eligibility.service.js';
import { manifestHash } from '../ai-runtime/ai-provenance.js';
import { AiPolicyService } from '../ai-runtime/ai-policy.service.js';
import { PrismaService } from '../database/prisma.service.js';

export interface ReadableWorkingSnapshot {
  id: string;
  committedAt: Date;
  resolutionIds: readonly string[];
  threadIds: readonly string[];
  boundaryIds: readonly string[];
}

@Injectable()
export class MemoryWorkingSnapshotReader {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
    private readonly eligibility: AiOutputEligibilityService,
  ) {}

  public async readLatest(
    actorId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ReadableWorkingSnapshot | null> {
    await this.policy.assertAllowed(actorId, projectId, [sessionId]);
    const snapshots = await this.prisma.memoryWorkingSnapshot.findMany({
      orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
      where: {
        contractVersion: { in: ['memory-maintainer-v1.2', 'memory-maintainer-v1.1'] },
        projectId,
        sourceSessionId: sessionId,
      },
    });
    for (const snapshot of snapshots) {
      const [resolutionMembers, threadMembers, boundaryMembers] = await Promise.all([
        this.prisma.memoryWorkingSnapshotResolution.findMany({
          orderBy: { inputOrder: 'asc' },
          where: { snapshotId: snapshot.id },
        }),
        this.prisma.memoryWorkingSnapshotThread.findMany({
          orderBy: { inputOrder: 'asc' },
          where: { snapshotId: snapshot.id },
        }),
        this.prisma.memoryWorkingSnapshotBoundary.findMany({
          orderBy: { inputOrder: 'asc' },
          where: { snapshotId: snapshot.id },
        }),
      ]);
      if (
        resolutionMembers.length !== snapshot.expectedResolutionCount ||
        threadMembers.length !== snapshot.expectedThreadCount ||
        boundaryMembers.length !== snapshot.expectedBoundaryCount
      )
        continue;
      const resolutions = await this.prisma.memoryResolution.findMany({
        where: {
          id: { in: resolutionMembers.map(({ memoryResolutionId }) => memoryResolutionId) },
        },
      });
      const resolutionById = new Map(resolutions.map((item) => [item.id, item]));
      let valid = true;
      const resolutionEntries: string[] = [];
      for (const member of resolutionMembers) {
        const resolution = resolutionById.get(member.memoryResolutionId);
        if (
          resolution === undefined ||
          resolution.projectId !== projectId ||
          resolution.status !== 'current' ||
          !isCurrentMemoryProvenanceReadable(resolution.provenanceState) ||
          resolution.layer !== 'working' ||
          resolution.semanticKind === null ||
          resolution.semanticStatus === null ||
          resolution.threadId === null ||
          resolution.aiDerivedOutputId === null ||
          resolution.resolutionRevision !== member.resolutionRevision ||
          !(await this.eligibility.isEligible(actorId, resolution.aiDerivedOutputId, this.prisma))
        ) {
          valid = false;
          break;
        }
        resolutionEntries.push(
          `${resolution.id}:${String(resolution.resolutionRevision)}:${resolution.semanticStatus}:${resolution.threadId}`,
        );
      }
      if (!valid || manifestHash(resolutionEntries) !== snapshot.resolutionManifestHash) continue;
      const threadRevisions = await this.prisma.memoryThreadRevision.findMany({
        where: { id: { in: threadMembers.map(({ threadRevisionId }) => threadRevisionId) } },
      });
      const threadById = new Map(threadRevisions.map((item) => [item.id, item]));
      const threadEntries: string[] = [];
      for (const member of threadMembers) {
        const revision = threadById.get(member.threadRevisionId);
        if (
          revision === undefined ||
          revision.threadId !== member.threadId ||
          revision.revision !== member.revision ||
          revision.supersededAt !== null
        ) {
          valid = false;
          break;
        }
        threadEntries.push(`${revision.threadId}:${String(revision.revision)}:${revision.status}`);
      }
      if (!valid || manifestHash(threadEntries) !== snapshot.threadManifestHash) continue;
      const boundaryRevisions = await this.prisma.memoryBoundaryRevision.findMany({
        where: { id: { in: boundaryMembers.map(({ boundaryRevisionId }) => boundaryRevisionId) } },
      });
      const boundaryById = new Map(boundaryRevisions.map((item) => [item.id, item]));
      const boundaryEntries: string[] = [];
      for (const member of boundaryMembers) {
        const revision = boundaryById.get(member.boundaryRevisionId);
        if (
          revision === undefined ||
          revision.boundaryId !== member.boundaryId ||
          revision.revision !== member.revision ||
          revision.status !== 'active' ||
          revision.supersededAt !== null
        ) {
          valid = false;
          break;
        }
        boundaryEntries.push(
          `${revision.boundaryId}:${String(revision.revision)}:${revision.status}`,
        );
      }
      if (!valid || manifestHash(boundaryEntries) !== snapshot.boundaryManifestHash) continue;
      return {
        boundaryIds: boundaryMembers.map(({ boundaryId }) => boundaryId),
        committedAt: snapshot.committedAt,
        id: snapshot.id,
        resolutionIds: resolutionMembers.map(({ memoryResolutionId }) => memoryResolutionId),
        threadIds: threadMembers.map(({ threadId }) => threadId),
      };
    }
    return null;
  }
}
