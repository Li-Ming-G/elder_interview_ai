import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ProjectAccessService,
  ResourceAccessAuthorizer,
} from '../project-foundation/project-access.service.js';
import { mapTranscriptSegment } from './transcription.mapper.js';
import type { TranscriptSegmentView } from './transcription.types.js';

@Injectable()
export class TranscriptQueryService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly authorization: ResourceAccessAuthorizer,
  ) {}

  public async listFinalSegments(
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<TranscriptSegmentView[]> {
    const session = await this.prisma.interviewSession.findUnique({
      select: {
        projectId: true,
      },
      where: { id: sessionId },
    });
    if (session === null) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        details: {},
        message: 'Resource not found',
      });
    }
    const project = await this.access.assertCanAccess(actor, session.projectId);
    if (project.status === 'restricted') {
      await this.authorization.assertResourceAccess(actor, {
        assignedUserIds: project.assignedUserIds,
        ownerUserId: null,
        restrictedToDataAdmin: true,
      });
    }
    const segments = await this.prisma.transcriptSegment.findMany({
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      where: { sessionId },
    });
    return segments.map(mapTranscriptSegment);
  }
}
