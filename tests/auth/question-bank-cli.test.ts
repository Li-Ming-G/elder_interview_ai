import { describe, expect, it, vi } from 'vitest';

import { executeQuestionBankCommand } from '../../apps/api/src/cli/question-bank-cli.js';

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
      ['question-bank:validate', '--environment', 'test', '--file', 'fixture.csv'],
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
        executeQuestionBankCommand(
          service(),
          [command, '--environment', 'test', '--file', 'fixture.csv'],
          () => Promise.resolve(new Uint8Array()),
        ),
      ).rejects.toThrow('Missing required option --operator-ref');
    },
  );

  it('rejects unknown deployment environments before writes', async () => {
    await expect(
      executeQuestionBankCommand(service(), ['question-bank:activate', '--environment', 'staging']),
    ).rejects.toThrow('Invalid --environment');
  });
});
