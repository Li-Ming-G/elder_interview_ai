import type { ApiConfig } from '@elder-interview/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './http/api-exception.filter.js';
import { JsonLogger } from './logging/json.logger.js';

export async function createApplication(config: ApiConfig): Promise<INestApplication> {
  const application = await NestFactory.create(AppModule.register(config), {
    bufferLogs: true,
    logger: new JsonLogger(),
  });
  application.useGlobalFilters(new ApiExceptionFilter());
  application.setGlobalPrefix('api/v1');
  return application;
}
