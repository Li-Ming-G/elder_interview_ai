import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  public constructor(@Inject(API_CONFIG) config: ApiConfigValue) {
    super({
      adapter: new PrismaPg({ connectionString: config.databaseUrl }),
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  public async verifyConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
