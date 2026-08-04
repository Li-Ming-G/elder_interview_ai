import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { AppendSpeakerMappingInput } from './transcription.types.js';

@Injectable()
export class SpeakerMappingService {
  public constructor(private readonly prisma: PrismaService) {}

  public async append(input: AppendSpeakerMappingInput): Promise<string> {
    this.validate(input);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.sessionId}\u0000${input.speakerProviderId}`}, 0))`;
      const session = await transaction.interviewSession.findUnique({
        select: { id: true },
        where: { id: input.sessionId },
      });
      if (session === null) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          details: {},
          message: 'Resource not found',
        });
      }
      const now = new Date();
      await transaction.speakerMapping.updateMany({
        data: { supersededAt: now },
        where: {
          sessionId: input.sessionId,
          speakerProviderId: input.speakerProviderId,
          supersededAt: null,
        },
      });
      const mapping = await transaction.speakerMapping.create({
        data: {
          createdBy: input.createdBy,
          sessionId: input.sessionId,
          source: input.source,
          speakerProviderId: input.speakerProviderId,
          speakerRole: input.role,
        },
        select: { id: true },
      });
      return mapping.id;
    });
  }

  private validate(input: AppendSpeakerMappingInput): void {
    if (input.speakerProviderId.length < 1 || input.speakerProviderId.length > 200) this.invalid();
    if (!['elder', 'interviewer', 'unknown'].includes(input.role)) this.invalid();
    if (!['batch_remap', 'calibration', 'manual', 'provider'].includes(input.source))
      this.invalid();
    if (input.source !== 'provider' && input.createdBy === null) this.invalid();
  }

  private invalid(): never {
    throw new BadRequestException({
      code: 'INVALID_SPEAKER_MAPPING',
      details: {},
      message: 'Speaker mapping is invalid',
    });
  }
}
