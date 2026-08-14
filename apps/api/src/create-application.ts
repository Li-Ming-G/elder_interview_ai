import type { ApiConfig } from '@elder-interview/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './http/api-exception.filter.js';
import { JsonLogger } from './logging/json.logger.js';
import { InterviewWsAdapter } from './realtime-transcription/interview-ws.adapter.js';
import type { AppRuntimeOverrides } from './app.module.js';

export async function createApplication(
  config: ApiConfig,
  overrides: AppRuntimeOverrides = {},
): Promise<INestApplication> {
  const application = await NestFactory.create(AppModule.register(config, overrides), {
    abortOnError: false,
    bufferLogs: true,
    logger: new JsonLogger(),
  });
  application.useWebSocketAdapter(new InterviewWsAdapter(application, config));
  application.useGlobalFilters(new ApiExceptionFilter());
  application.setGlobalPrefix('api/v1');
  return application;
}
