import { ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  BoundaryPolicyReader,
  type BoundaryPolicySnapshot,
  DeletionScopeReader,
} from './deletion-scope.reader.js';

export interface AiPolicySnapshot {
  policyRevision: number;
  retentionPolicyVersion: number;
}

@Injectable()
export class PrismaBoundaryPolicyReader extends BoundaryPolicyReader {
  public constructor(private readonly prisma: PrismaService) {
    super();
  }

  public override async read(projectId: string): Promise<BoundaryPolicySnapshot> {
    const project = await this.prisma.elderProject.findUniqueOrThrow({ where: { id: projectId } });
    return { blockedCanonicalKeys: [], policyRevision: project.aiPolicyRevision };
  }
}

@Injectable()
export class AiPolicyService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly deletionScopes: DeletionScopeReader,
    private readonly boundaries: BoundaryPolicyReader,
  ) {}

  public async assertAllowed(
    actorId: string,
    projectId: string,
    sessionIds: readonly string[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AiPolicySnapshot> {
    const [project, assignment, consent, boundary] = await Promise.all([
      db.elderProject.findUnique({ where: { id: projectId } }),
      db.projectAssignment.findFirst({ where: { projectId, revokedAt: null, userId: actorId } }),
      db.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId },
      }),
      this.boundaries.read(projectId),
    ]);
    if (
      project === null ||
      project.deletedAt !== null ||
      ['restricted', 'deleted'].includes(project.status) ||
      assignment === null ||
      consent?.status !== 'valid' ||
      consent.revokedAt !== null ||
      boundary.policyRevision !== project.aiPolicyRevision
    ) {
      throw new ForbiddenException({
        code: 'AI_POLICY_BLOCKED',
        details: {},
        message: 'AI use is blocked',
      });
    }
    await this.deletionScopes.assertNoActiveScope(projectId, sessionIds);
    return {
      policyRevision: project.aiPolicyRevision,
      retentionPolicyVersion: project.aiRetentionPolicyVersion,
    };
  }
}
