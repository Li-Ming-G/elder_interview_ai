import { readFile } from 'node:fs/promises';
import { stdout } from 'node:process';

import { loadAppEnvironment } from '@elder-interview/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { validateQuestionBankCsv } from '../question-bank/question-bank.csv.js';
import { questionBankEnvironmentFromAppEnv } from '../question-bank/question-bank.environment.js';
import { QuestionBankImportService } from '../question-bank/question-bank.service.js';
import { type QuestionBankValidationResult } from '../question-bank/question-bank.types.js';

type Command =
  | 'question-bank:validate'
  | 'question-bank:import'
  | 'question-bank:activate'
  | 'question-bank:retire';

interface QuestionBankCommandService {
  activateRelease(releaseId: string, actorReference: string, requestId: string): Promise<unknown>;
  importDraft(file: Uint8Array, actorReference: string, requestId: string): Promise<unknown>;
  retireRelease(releaseId: string, actorReference: string, requestId: string): Promise<unknown>;
  validateCsv(file: Uint8Array): QuestionBankValidationResult;
}

function requiredFlag(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

export async function executeQuestionBankCommand(
  service: QuestionBankCommandService,
  args: readonly string[],
  fileReader: (path: string) => Promise<Uint8Array> = readFile,
): Promise<unknown> {
  const command = args[0] as Command | undefined;
  if (
    ![
      'question-bank:validate',
      'question-bank:import',
      'question-bank:activate',
      'question-bank:retire',
    ].includes(command ?? '')
  ) {
    throw new Error(
      'Expected question-bank:validate, question-bank:import, question-bank:activate, or question-bank:retire',
    );
  }
  if (
    args.some((argument) => argument === '--environment' || argument.startsWith('--environment='))
  ) {
    throw new Error('--environment is not supported; validated APP_ENV is authoritative');
  }
  if (command === 'question-bank:validate') {
    const validation = service.validateCsv(await fileReader(requiredFlag(args, '--file')));
    return {
      errors: validation.errors,
      ok: validation.ok,
      summary: validation.summary,
    };
  }
  const actorReference = requiredFlag(args, '--operator-ref');
  const requestId = requiredFlag(args, '--request-id');
  if (command === 'question-bank:import') {
    return service.importDraft(
      await fileReader(requiredFlag(args, '--file')),
      actorReference,
      requestId,
    );
  }
  const releaseId = requiredFlag(args, '--release-id');
  return command === 'question-bank:activate'
    ? service.activateRelease(releaseId, actorReference, requestId)
    : service.retireRelease(releaseId, actorReference, requestId);
}

export async function runQuestionBankCli(args: readonly string[]): Promise<unknown> {
  const deploymentEnvironment = questionBankEnvironmentFromAppEnv(loadAppEnvironment(process.env));
  if (args[0] === 'question-bank:validate') {
    const writeUnavailable = (): Promise<never> =>
      Promise.reject(new Error('Database write service is unavailable during validation'));
    return executeQuestionBankCommand(
      {
        activateRelease: writeUnavailable,
        importDraft: writeUnavailable,
        retireRelease: writeUnavailable,
        validateCsv: (file) => validateQuestionBankCsv(file, deploymentEnvironment),
      },
      args,
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    return await executeQuestionBankCommand(
      new QuestionBankImportService(prisma, deploymentEnvironment),
      args,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('question-bank-cli.js')) {
  void runQuestionBankCli(process.argv.slice(2))
    .then((result) => {
      stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Question bank operation failed'}\n`,
      );
      process.exitCode = 1;
    });
}
