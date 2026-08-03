import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { ProjectAccessReader, type ProjectAccessSnapshot } from './project-access.service.js';

@Injectable()
export class PrismaProjectAccessReader extends ProjectAccessReader {
  public constructor(private readonly prisma: PrismaService) {
    super();
  }

  public async findAccessSnapshot(projectId: string): Promise<ProjectAccessSnapshot | null> {
    const project = await this.prisma.elderProject.findUnique({
      include: {
        assignments: { select: { userId: true }, where: { revokedAt: null } },
      },
      where: { id: projectId },
    });
    return project === null
      ? null
      : {
          assignedUserIds: project.assignments.map((assignment) => assignment.userId),
          createdBy: project.createdBy,
          deletedAt: project.deletedAt,
          projectId: project.id,
          status: project.status,
        };
  }
}
