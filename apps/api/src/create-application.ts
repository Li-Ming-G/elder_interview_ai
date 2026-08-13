import type { ApiConfig } from '@elder-interview/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './http/api-exception.filter.js';
import { JsonLogger } from './logging/json.logger.js';
import { InterviewWsAdapter } from './realtime-transcription/interview-ws.adapter.js';

export async function createApplication(config: ApiConfig): Promise<INestApplication> {
  const application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    abortOnError: false,
    bufferLogs: true,
    logger: new JsonLogger(),
  });
  // A normal eight-minute capture can freeze several hundred per-chunk archive
  // commitments in one stop request. Keep the accepted body bounded while
  // allowing that contract-sized manifest to exceed Express' 100 KiB default.
  application.useBodyParser('json', { limit: '1mb' });
  application.useWebSocketAdapter(new InterviewWsAdapter(application, config));
  application.useGlobalFilters(new ApiExceptionFilter());
  application.setGlobalPrefix('api/v1');
  return application;
}
