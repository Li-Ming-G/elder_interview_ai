import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import type { Prisma } from '../../apps/api/src/generated/prisma/client.js';
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
      `basic-open,basic,synthetic,这是一条 UTF-8 synthetic open question?,detail,stage.rapport,response.reluctant,low,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},true`,
      `basic-person,basic,synthetic,Synthetic person question?,person,stage.rapport;context.person,,medium,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},true`,
      `deep-choice,deep,synthetic,Synthetic choice question?,choice,stage.story_depth;context.choice,response.reluctant;topic.exhausted,medium,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},true`,
      `deep-disabled,deep,synthetic,Synthetic disabled question?,detail,stage.story_depth,,low,${sourceType},${sourceReference},${licenseStatus},${licenseReference},${version},false`,
    ].join('\n'),
  );
}

function directProductItem(
  releaseId: string,
  questionId: string,
): Prisma.QuestionBankItemUncheckedCreateInput {
  return {
    applicableConditionCodes: [],
    bank: 'basic' as const,
    enabled: true,
    id: randomUUID(),
    inapplicableConditionCodes: [],
    licenseReference: 'Project repository',
    licenseStatus: 'project_original' as const,
    purpose: 'detail' as const,
    questionBankReleaseId: releaseId,
    questionId,
    questionText: 'Synthetic direct insert must fail?',
    sensitivity: 'low' as const,
    sourceReference: 'DEV-007A integration test',
    sourceType: 'project_original' as const,
    topic: 'synthetic',
  };
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
      await imports.retireRelease(active.id, operator, randomUUID());
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
      ),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_HEADER_INVALID' });
    await expect(prisma.questionBankRelease.count()).resolves.toBe(beforeInvalid);

    const requestId = randomUUID();
    const file = productCsv(`dev-007a-${runId}-v1`);
    const imported = await imports.importDraft(file, operator, requestId);
    firstReleaseId = imported.releaseId;
    expect(imported).toMatchObject({
      environmentScope: 'product',
      itemCount: 4,
      replayed: false,
      status: 'draft',
    });
    await expect(imports.importDraft(file, operator, requestId)).resolves.toMatchObject({
      releaseId: firstReleaseId,
      replayed: true,
    });
    await expect(
      new QuestionBankImportService(prisma, 'production').importDraft(file, operator, requestId),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_REQUEST_ID_REUSED' });
    await expect(
      imports.importDraft(productCsv(`dev-007a-${runId}-different`), operator, requestId),
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

    const release = await prisma.questionBankRelease.findUniqueOrThrow({
      include: { items: true },
      where: { id: firstReleaseId },
    });
    const [digest] = await prisma.$queryRaw<Array<{ content_digest: string }>>`
      SELECT calculate_question_bank_release_content_digest(${firstReleaseId}::uuid) AS content_digest
    `;
    expect(release.membershipSealedAt).not.toBeNull();
    expect(release.itemCount).toBe(release.items.length);
    expect(digest?.content_digest).toBe(release.contentDigest);
  });

  it('seals membership in draft, active, and retired states at the database boundary', async () => {
    const imported = await imports.importDraft(
      productCsv(`dev-007a-${runId}-sealed-states`),
      operator,
      randomUUID(),
    );
    await expect(
      prisma.questionBankItem.create({
        data: directProductItem(imported.releaseId, 'direct-draft'),
      }),
    ).rejects.toThrow(/QUESTION_BANK_RELEASE_MEMBERSHIP_SEALED/u);

    await imports.activateRelease(imported.releaseId, operator, randomUUID());
    await expect(
      prisma.questionBankItem.create({
        data: directProductItem(imported.releaseId, 'direct-active'),
      }),
    ).rejects.toThrow(/QUESTION_BANK_RELEASE_MEMBERSHIP_SEALED/u);

    await imports.retireRelease(imported.releaseId, operator, randomUUID());
    await expect(
      prisma.questionBankItem.create({
        data: directProductItem(imported.releaseId, 'direct-retired'),
      }),
    ).rejects.toThrow(/QUESTION_BANK_RELEASE_MEMBERSHIP_SEALED/u);
  });

  it('rolls back an unsealed or mismatched creation window without a half release', async () => {
    const unsealedVersion = `dev-007a-${runId}-unsealed`;
    await expect(
      prisma.$transaction((tx) =>
        tx.questionBankRelease.create({
          data: {
            bankVersion: unsealedVersion,
            contentDigest: '0'.repeat(64),
            environmentScope: 'product',
            importedAt: new Date(),
            importedBy: operator,
            itemCount: 1,
            sourceFileDigest: '1'.repeat(64),
            validatorVersion: 'question-bank-validator-v1',
          },
        }),
      ),
    ).rejects.toThrow(/QUESTION_BANK_RELEASE_COMMIT_INTEGRITY_FAILED/u);
    await expect(
      prisma.questionBankRelease.count({ where: { bankVersion: unsealedVersion } }),
    ).resolves.toBe(0);

    const mismatchVersion = `dev-007a-${runId}-seal-mismatch`;
    await expect(
      prisma.$transaction(async (tx) => {
        const release = await tx.questionBankRelease.create({
          data: {
            bankVersion: mismatchVersion,
            contentDigest: '0'.repeat(64),
            environmentScope: 'product',
            importedAt: new Date(),
            importedBy: operator,
            itemCount: 2,
            sourceFileDigest: '1'.repeat(64),
            validatorVersion: 'question-bank-validator-v1',
          },
        });
        await tx.questionBankItem.create({
          data: directProductItem(release.id, 'mismatch-only-item'),
        });
        await tx.questionBankRelease.update({
          data: { membershipSealedAt: new Date() },
          where: { id: release.id },
        });
      }),
    ).rejects.toThrow(/QUESTION_BANK_RELEASE_MEMBERSHIP_MISMATCH/u);
    await expect(
      prisma.questionBankRelease.count({ where: { bankVersion: mismatchVersion } }),
    ).resolves.toBe(0);

    const fixtureBypassVersion = `dev-007a-${runId}-fixture-bypass`;
    await expect(
      prisma.$transaction(async (tx) => {
        const release = await tx.questionBankRelease.create({
          data: {
            bankVersion: fixtureBypassVersion,
            contentDigest: '0'.repeat(64),
            environmentScope: 'product',
            importedAt: new Date(),
            importedBy: operator,
            itemCount: 1,
            sourceFileDigest: '1'.repeat(64),
            validatorVersion: 'question-bank-validator-v1',
          },
        });
        await tx.questionBankItem.create({
          data: {
            ...directProductItem(release.id, 'fixture-bypass'),
            licenseStatus: 'fixture_only',
            sourceType: 'synthetic_fixture',
          },
        });
      }),
    ).rejects.toThrow(/QUESTION_BANK_RELEASE_SCOPE_LICENSE_MISMATCH/u);
    await expect(
      prisma.questionBankRelease.count({ where: { bankVersion: fixtureBypassVersion } }),
    ).resolves.toBe(0);
  });

  it('imports and selects the explicit synthetic fixture only in the internal-demo scope', async () => {
    const fixture = await readFile(demoFixturePath);
    const imported = await imports.importDraft(fixture, operator, randomUUID());
    expect(imported.environmentScope).toBe('internal_demo');
    const beforeRestrictedImport = {
      audits: await prisma.auditLog.count({ where: { entityType: 'question_bank_release' } }),
      releases: await prisma.questionBankRelease.count(),
    };
    for (const deploymentEnvironment of ['formal_internal', 'production'] as const) {
      const restrictedImports = new QuestionBankImportService(prisma, deploymentEnvironment);
      await expect(
        restrictedImports.importDraft(fixture, operator, randomUUID()),
      ).rejects.toMatchObject({ code: 'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED' });
      await expect(
        restrictedImports.activateRelease(imported.releaseId, operator, randomUUID()),
      ).rejects.toMatchObject({ code: 'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED' });
    }
    await expect(prisma.questionBankRelease.count()).resolves.toBe(beforeRestrictedImport.releases);
    await expect(
      prisma.auditLog.count({ where: { entityType: 'question_bank_release' } }),
    ).resolves.toBe(beforeRestrictedImport.audits);
    await imports.activateRelease(imported.releaseId, operator, randomUUID());
    const eligible = await reader.listEligible('rapport', [], {
      environmentScope: 'internal_demo',
      policyDecision: 'allowed',
    });
    expect(selector.select('rapport', eligible).item).toMatchObject({
      licenseStatus: 'fixture_only',
      questionId: 'fixture-basic-rapport-001',
      sourceType: 'synthetic_fixture',
    });
    const beforeRestrictedRuntimeWrites = await prisma.auditLog.count({
      where: { entityType: 'question_bank_release' },
    });
    for (const deploymentEnvironment of ['formal_internal', 'production'] as const) {
      const restrictedImports = new QuestionBankImportService(prisma, deploymentEnvironment);
      const restrictedReader = new QuestionBankReader(prisma, deploymentEnvironment);
      await expect(
        restrictedImports.retireRelease(imported.releaseId, operator, randomUUID()),
      ).rejects.toMatchObject({ code: 'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED' });
      await expect(
        restrictedReader.listEligible('rapport', [], {
          environmentScope: 'internal_demo',
          policyDecision: 'allowed',
        }),
      ).rejects.toMatchObject({ code: 'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED' });
    }
    await expect(
      prisma.auditLog.count({ where: { entityType: 'question_bank_release' } }),
    ).resolves.toBe(beforeRestrictedRuntimeWrites);
    await imports.retireRelease(imported.releaseId, operator, randomUUID());
  });

  it('activates atomically and preserves the old active release when replacement is blocked', async () => {
    await imports.activateRelease(firstReleaseId, operator, randomUUID());
    const blocked = await imports.importDraft(
      productCsv(`dev-007a-${runId}-unverified`, 'unverified'),
      operator,
      randomUUID(),
    );
    await expect(
      imports.activateRelease(blocked.releaseId, operator, randomUUID()),
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
    );
    await imports.activateRelease(replacement.releaseId, operator, randomUUID());
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
    await imports.retireRelease(firstReleaseId, operator, randomUUID());
    await expect(
      reader.listEligible('rapport', [], {
        environmentScope: 'product',
        policyDecision: 'allowed',
      }),
    ).rejects.toMatchObject({ code: 'QUESTION_BANK_ACTIVE_RELEASE_UNAVAILABLE' });
  });
});
