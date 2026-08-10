import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import {
  InternalDemoQuestionSelector,
  QuestionBankImportService,
  QuestionBankReader,
} from '../../apps/api/src/question-bank/question-bank.service.js';
import { QuestionBankError } from '../../apps/api/src/question-bank/question-bank.types.js';

const operator = 'DEV-007A integration operator';
const runId = randomUUID();
const demoFixturePath = fileURLToPath(
  new URL('../../docs/question-bank/question-bank-internal-demo.fixture.csv', import.meta.url),
);

function productCsv(version: string, licenseStatus = 'project_original'): Uint8Array {
  const sourceType = licenseStatus === 'unverified' ? 'licensed_external' : 'project_original';
  const sourceReference =
    sourceType === 'project_original'
      ? 'DEV-007A integration test'
      : 'Synthetic unverified-source test';
  const licenseReference =
    licenseStatus === 'unverified' ? 'Not verified; draft-only test' : 'Project repository';
  return new TextEncoder().encode(
    [
      'question_id,bank,topic,question_text,purpose,applicable_when,inapplicable_when,sensitivity,source_type,source_reference,license_status,license_reference,bank_version,enabled',
      `basic-open,basic,synthetic,Synthetic open question?,detail,stage.rapport,response.reluctant,low,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},true`,
      `basic-person,basic,synthetic,Synthetic person question?,person,stage.rapport;context.person,,medium,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},true`,
      `deep-choice,deep,synthetic,Synthetic choice question?,choice,stage.story_depth;context.choice,response.reluctant;topic.exhausted,medium,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},true`,
      `deep-disabled,deep,synthetic,Synthetic disabled question?,detail,stage.story_depth,,low,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},false`,
    ].join('\n'),
  );
}

describe('DEV-007A PostgreSQL question-bank release and eligible seam', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let imports: QuestionBankImportService;
  let reader: QuestionBankReader;
  let selector: InternalDemoQuestionSelector;
  let firstReleaseId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-dev-007a-policy-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-dev-007a-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    imports = app.get(QuestionBankImportService);
    reader = app.get(QuestionBankReader);
    selector = app.get(InternalDemoQuestionSelector);

    for (const active of await prisma.questionBankRelease.findMany({
      where: { status: 'active' },
    })) {
      await imports.retireRelease(active.id, operator, randomUUID(), 'test');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports an immutable draft and replays only an exactly bound request', async () => {
    const beforeInvalid = await prisma.questionBankRelease.count();
    await expect(
      imports.importDraft(
        new TextEncoder().encode('not,the,formal,header'),
        operator,
        randomUUID(),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_HEADER_INVALID' });
    await expect(prisma.questionBankRelease.count()).resolves.toBe(beforeInvalid);

    const requestId = randomUUID();
    const file = productCsv(`dev-007a-${runId}-v1`);
    const imported = await imports.importDraft(file, operator, requestId, 'test');
    firstReleaseId = imported.releaseId;
    expect(imported).toMatchObject({
      environmentScope: 'product',
      replayed: false,
      status: 'draft',
    });
    await expect(imports.importDraft(file, operator, requestId, 'test')).resolves.toMatchObject({
      releaseId: firstReleaseId,
      replayed: true,
    });
    await expect(
      imports.importDraft(productCsv(`dev-007a-${runId}-different`), operator, requestId, 'test'),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_REQUEST_ID_REUSED' });

    await expect(
      prisma.questionBankRelease.update({
        data: { contentDigest: '0'.repeat(64) },
        where: { id: firstReleaseId },
      }),
    ).rejects.toThrow();
    const item = await prisma.questionBankItem.findFirstOrThrow({
      where: { questionBankReleaseId: firstReleaseId },
    });
    await expect(
      prisma.questionBankItem.update({ data: { enabled: false }, where: { id: item.id } }),
    ).rejects.toThrow();
  });

  it('imports and selects the explicit synthetic fixture only in the internal-demo scope', async () => {
    const imported = await imports.importDraft(
      await readFile(demoFixturePath),
      operator,
      randomUUID(),
      'test',
    );
    expect(imported.environmentScope).toBe('internal_demo');
    await imports.activateRelease(imported.releaseId, operator, randomUUID(), 'test');
    const eligible = await reader.listEligible('rapport', [], {
      environmentScope: 'internal_demo',
      policyDecision: 'allowed',
    });
    expect(selector.select('rapport', eligible).item).toMatchObject({
      licenseStatus: 'fixture_only',
      questionId: 'fixture-basic-rapport-001',
      sourceType: 'synthetic_fixture',
    });
    await imports.retireRelease(imported.releaseId, operator, randomUUID(), 'test');
  });

  it('activates atomically and preserves the old active release when replacement is blocked', async () => {
    await imports.activateRelease(firstReleaseId, operator, randomUUID(), 'test');
    const blocked = await imports.importDraft(
      productCsv(`dev-007a-${runId}-unverified`, 'unverified'),
      operator,
      randomUUID(),
      'test',
    );
    await expect(
      imports.activateRelease(blocked.releaseId, operator, randomUUID(), 'test'),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_LICENSE_COMBINATION_INVALID' });
    await expect(
      prisma.questionBankRelease.findUniqueOrThrow({ where: { id: firstReleaseId } }),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      prisma.questionBankRelease.findUniqueOrThrow({ where: { id: blocked.releaseId } }),
    ).resolves.toMatchObject({ status: 'draft' });

    const replacement = await imports.importDraft(
      productCsv(`dev-007a-${runId}-v2`),
      operator,
      randomUUID(),
      'test',
    );
    await imports.activateRelease(replacement.releaseId, operator, randomUUID(), 'test');
    await expect(
      prisma.questionBankRelease.findUniqueOrThrow({ where: { id: firstReleaseId } }),
    ).resolves.toMatchObject({ status: 'retired' });
    firstReleaseId = replacement.releaseId;
  });

  it('applies all-of, any-of, exclusion-first, policy gates, and purpose projection', async () => {
    const allowed = { environmentScope: 'product', policyDecision: 'allowed' } as const;
    const rapport = await reader.listEligible('rapport', ['context.person'], allowed);
    expect(rapport.map(({ questionId }) => questionId)).toEqual(['basic-open', 'basic-person']);
    expect(rapport.find(({ questionId }) => questionId === 'basic-person')).toMatchObject({
      purpose: 'person',
    });
    expect(
      (await reader.listEligible('rapport', [], allowed)).map(({ questionId }) => questionId),
    ).toEqual(['basic-open']);
    expect(
      (
        await reader.listEligible('story_depth', ['context.choice', 'topic.exhausted'], allowed)
      ).map(({ questionId }) => questionId),
    ).not.toContain('deep-choice');
    await expect(
      reader.listEligible('story_depth', ['context.choice'], {
        ...allowed,
        policyDecision: 'blocked',
      }),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_POLICY_BLOCKED' });
    await expect(reader.listEligible('rapport', ['stage.rapport'], allowed)).rejects.toBeInstanceOf(
      QuestionBankError,
    );
  });

  it('exposes a deterministic selector seam without publishing QuestionEvidence', async () => {
    const eligible = await reader.listEligible('rapport', ['context.person'], {
      environmentScope: 'product',
      policyDecision: 'allowed',
    });
    const first = selector.select('rapport', eligible);
    const second = selector.select('rapport', [...eligible].reverse());
    expect(first).toEqual(second);
    expect(first.item?.questionId).toBe('basic-open');
    expect(await prisma.questionGenerationAttempt.count()).toBe(0);
    expect(await prisma.questionDisplaySnapshot.count()).toBe(0);
  });

  it('retires the active release and then fails closed when no active runtime fact exists', async () => {
    await imports.retireRelease(firstReleaseId, operator, randomUUID(), 'test');
    await expect(
      reader.listEligible('rapport', [], {
        environmentScope: 'product',
        policyDecision: 'allowed',
      }),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_ACTIVE_RELEASE_UNAVAILABLE' });
  });
});
