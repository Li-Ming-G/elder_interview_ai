import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../apps/api/src/create-application.js';

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected an object response');
  }
  return value as Record<string, unknown>;
}

function getTestServer(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}

describe('API and PostgreSQL integration', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    }

    application = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: 'error',
      }),
    );
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('serves health through the real Prisma PostgreSQL adapter', async () => {
    const response = await request(getTestServer(application)).get('/api/v1/health').expect(200);
    const body = toRecord(response.body as unknown);
    const requestId = response.headers['x-request-id'];

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body).toMatchObject({ database: 'up', status: 'ok' });
    expect(typeof body.timestamp).toBe('string');
    expect(Date.parse(String(body.timestamp))).not.toBeNaN();
  });

  it('returns the unified envelope for an unknown route', async () => {
    const response = await request(getTestServer(application)).get('/api/v1/unknown').expect(404);
    const body = toRecord(response.body as unknown);

    expect(body).toEqual({
      code: 'NOT_FOUND',
      details: {},
      message: 'Resource not found',
      request_id: response.headers['x-request-id'],
    });
  });
});
