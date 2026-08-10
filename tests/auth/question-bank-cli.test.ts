import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  executeQuestionBankCommand,
  runQuestionBankCli,
} from '../../apps/api/src/cli/question-bank-cli.js';

const fixturePath = fileURLToPath(
  new URL('../../docs/question-bank/question-bank-internal-demo.fixture.csv', import.meta.url),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

function service(): {
  activateRelease: ReturnType<typeof vi.fn>;
  importDraft: ReturnType<typeof vi.fn>;
  retireRelease: ReturnType<typeof vi.fn>;
  validateCsv: ReturnType<typeof vi.fn>;
} {
  return {
    activateRelease: vi.fn(),
    importDraft: vi.fn(),
    retireRelease: vi.fn(),
    validateCsv: vi.fn(() => ({
      errors: [],
      ok: true as const,
      rows: [],
      summary: {
        bankVersion: 'test-v1',
        contentDigest: 'a'.repeat(64),
        environmentScope: 'product' as const,
        rowCount: 2,
        sourceFileDigest: 'b'.repeat(64),
        validatorVersion: 'question-bank-validator-v1' as const,
      },
    })),
  };
}

describe('controlled question-bank CLI', () => {
  it('permits read-only validation without operator write authority', async () => {
    const fake = service();
    const result = await executeQuestionBankCommand(
      fake,
      ['question-bank:validate', '--file', 'fixture.csv'],
      () => Promise.resolve(new Uint8Array()),
    );
    expect(result).toMatchObject({ ok: true, summary: { rowCount: 2 } });
    expect(result).not.toHaveProperty('rows');
    expect(fake.validateCsv).toHaveBeenCalledOnce();
  });

  it.each(['question-bank:import', 'question-bank:activate', 'question-bank:retire'])(
    'requires explicit operator and request identity for %s',
    async (command) => {
      await expect(
        executeQuestionBankCommand(service(), [command, '--file', 'fixture.csv'], () =>
          Promise.resolve(new Uint8Array()),
        ),
      ).rejects.toThrow('Missing required option --operator-ref');
    },
  );

  it.each([['--environment', 'test'], ['--environment=internal_demo']])(
    'rejects CLI environment override %s because APP_ENV is authoritative',
    async (...flags) => {
      await expect(
        executeQuestionBankCommand(service(), ['question-bank:activate', ...flags]),
      ).rejects.toThrow('--environment is not supported');
    },
  );

  it.each(['staging', 'production'] as const)(
    'uses trusted APP_ENV=%s and blocks fixture validation even without a database',
    async (appEnvironment) => {
      vi.stubEnv('APP_ENV', appEnvironment);
      const result = (await runQuestionBankCli([
        'question-bank:validate',
        '--file',
        fixturePath,
      ])) as { errors: Array<{ code: string }>; ok: boolean };
      expect(result.ok).toBe(false);
      expect(result.errors.map(({ code }) => code)).toContain(
        'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED',
      );
    },
  );

  it('allows the explicit internal-demo fixture under trusted test APP_ENV', async () => {
    vi.stubEnv('APP_ENV', 'test');
    await expect(
      runQuestionBankCli(['question-bank:validate', '--file', fixturePath]),
    ).resolves.toMatchObject({ ok: true, summary: { environmentScope: 'internal_demo' } });
  });

  it('fails closed when APP_ENV is absent or invalid', async () => {
    vi.stubEnv('APP_ENV', 'internal_demo');
    await expect(
      runQuestionBankCli(['question-bank:validate', '--file', fixturePath]),
    ).rejects.toThrow('Invalid configuration keys: APP_ENV');
  });
});
