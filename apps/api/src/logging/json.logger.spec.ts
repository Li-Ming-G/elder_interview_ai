import { afterEach, describe, expect, it, vi } from 'vitest';

import { JsonLogger } from './json.logger.js';

describe('JsonLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not emit arbitrary messages, Error.message values, or traces', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const logger = new JsonLogger();

    logger.error(
      new Error('password=should-never-appear'),
      'Bearer trace-secret-should-never-appear',
      'AuthService',
    );

    expect(write).toHaveBeenCalledOnce();
    const serialized = String(write.mock.calls[0]?.[0]);
    const entry = JSON.parse(serialized) as Record<string, unknown>;
    expect(serialized).not.toContain('should-never-appear');
    expect(serialized).not.toContain('Bearer');
    expect(entry).toMatchObject({
      level: 'error',
      message: 'Application error',
      module: 'AuthService',
      trace_present: true,
    });
    expect(entry).not.toHaveProperty('trace');
  });

  it('redacts arbitrary string messages and rejects unsafe contexts', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = new JsonLogger();

    logger.log('transcript and api_key=should-never-appear', 'unsafe context: secret');

    const serialized = String(write.mock.calls[0]?.[0]);
    const entry = JSON.parse(serialized) as Record<string, unknown>;
    expect(serialized).not.toContain('should-never-appear');
    expect(serialized).not.toContain('transcript');
    expect(entry).toMatchObject({
      level: 'info',
      message: 'Application message redacted',
      module: 'application',
    });
  });
});
