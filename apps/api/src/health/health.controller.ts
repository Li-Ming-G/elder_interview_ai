import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@elder-interview/contracts';

import { PrismaService } from '../database/prisma.service.js';

@Controller('health')
export class HealthController {
  public constructor(private readonly prisma: PrismaService) {}

  @Get()
  public async getHealth(): Promise<HealthResponse> {
    await this.prisma.verifyConnection();

    return {
      database: 'up',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
