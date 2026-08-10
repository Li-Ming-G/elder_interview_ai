import { readFile } from 'node:fs/promises';
import { stdout } from 'node:process';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { validateQuestionBankCsv } from '../question-bank/question-bank.csv.js';
import { QuestionBankImportService } from '../question-bank/question-bank.service.js';
import {
  QUESTION_BANK_ENVIRONMENTS,
  type QuestionBankEnvironment,
  type QuestionBankValidationResult,
} from '../question-bank/question-bank.types.js';

type Command =
  | 'question-bank:validate'
  | 'question-bank:import'
  | 'question-bank:activate'
  | 'question-bank:retire';

interface QuestionBankCommandService {
  activateRelease(
    releaseId: string,
    actorReference: string,
    requestId: string,
    environment: QuestionBankEnvironment,
  ): Promise<unknown>;
  importDraft(
    file: Uint8Array,
    actorReference: string,
    requestId: string,
    environment: QuestionBankEnvironment,
  ): Promise<unknown>;
  retireRelease(
    releaseId: string,
    actorReference: string,
    requestId: string,
    environment: QuestionBankEnvironment,
  ): Promise<unknown>;
  validateCsv(file: Uint8Array, environment: QuestionBankEnvironment): QuestionBankValidationResult;
}

function requiredFlag(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

function environmentFlag(args: readonly string[]): QuestionBankEnvironment {
  const environment = requiredFlag(args, '--environment');
  if (!QUESTION_BANK_ENVIRONMENTS.includes(environment as QuestionBankEnvironment)) {
    throw new Error('Invalid --environment');
  }
  return environment as QuestionBankEnvironment;
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
  const environment = environmentFlag(args);
  if (command === 'question-bank:validate') {
    const validation = service.validateCsv(
      await fileReader(requiredFlag(args, '--file')),
      environment,
    );
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
      environment,
    );
  }
  const releaseId = requiredFlag(args, '--release-id');
  return command === 'question-bank:activate'
    ? service.activateRelease(releaseId, actorReference, requestId, environment)
    : service.retireRelease(releaseId, actorReference, requestId, environment);
}

export async function runQuestionBankCli(args: readonly string[]): Promise<unknown> {
  if (args[0] === 'question-bank:validate') {
    const writeUnavailable = (): Promise<never> =>
      Promise.reject(new Error('Database write service is unavailable during validation'));
    return executeQuestionBankCommand(
      {
        activateRelease: writeUnavailable,
        importDraft: writeUnavailable,
        retireRelease: writeUnavailable,
        validateCsv: validateQuestionBankCsv,
      },
      args,
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    return await executeQuestionBankCommand(new QuestionBankImportService(prisma), args);
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
