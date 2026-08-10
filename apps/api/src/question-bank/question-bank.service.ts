import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AuditActorType } from '../generated/prisma/enums.js';
import { validateQuestionBankCsv } from './question-bank.csv.js';
import { QUESTION_BANK_DEPLOYMENT_ENVIRONMENT } from './question-bank.environment.js';
import {
  JOURNEY_STAGES,
  QUESTION_CONDITION_CODES,
  type EligibleQuestionBankItem,
  type JourneyStage,
  type QuestionBankEnvironment,
  QuestionBankError,
  type QuestionBankPolicyContext,
  type QuestionBankScope,
  type QuestionBankValidationResult,
  type QuestionConditionCode,
} from './question-bank.types.js';

type DatabaseClient = PrismaService | PrismaClient;
type TransactionClient = Prisma.TransactionClient;

interface ReleaseResult {
  bankVersion: string;
  contentDigest: string;
  environmentScope: QuestionBankScope;
  itemCount: number;
  releaseId: string;
  replayed: boolean;
  status: 'draft' | 'active' | 'retired';
}

interface OperationMetadata extends Prisma.InputJsonObject {
  action: 'activate' | 'import_draft' | 'retire';
  app_environment: QuestionBankEnvironment;
  binding_hash: string;
  bank_version: string;
  content_digest: string;
  environment_scope: QuestionBankScope;
  item_count: number;
  release_id: string;
  source_file_digest?: string;
  status: 'draft' | 'active' | 'retired';
  validator_version?: string;
}

@Injectable()
export class QuestionBankImportService {
  public constructor(
    @Inject(PrismaService) private readonly prisma: DatabaseClient,
    @Inject(QUESTION_BANK_DEPLOYMENT_ENVIRONMENT)
    private readonly deploymentEnvironment: QuestionBankEnvironment,
  ) {}

  public validateCsv(file: Uint8Array): QuestionBankValidationResult {
    return validateQuestionBankCsv(file, this.deploymentEnvironment);
  }

  public async importDraft(
    file: Uint8Array,
    actorReference: string,
    requestId: string,
  ): Promise<ReleaseResult> {
    assertActorAndRequest(actorReference, requestId);
    const validation = this.validateCsv(file);
    if (!validation.ok)
      throw new QuestionBankError(
        validation.errors[0]?.code ?? 'QUESTION_BANK_FIELD_INVALID',
        validation.errors,
      );
    const bindingHash = operationHash({
      action: 'import_draft',
      actorReference,
      appEnvironment: this.deploymentEnvironment,
      sourceFileDigest: validation.summary.sourceFileDigest,
      validatorVersion: validation.summary.validatorVersion,
    });
    return this.prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `question-bank-request:${requestId}`);
      const replay = await readReplay(tx, requestId, actorReference, bindingHash);
      if (replay !== null) return { ...replay, replayed: true };
      await advisoryLock(tx, `question-bank-version:${validation.summary.bankVersion}`);
      if (
        (await tx.questionBankRelease.findUnique({
          where: { bankVersion: validation.summary.bankVersion },
        })) !== null
      ) {
        throw new QuestionBankError('QUESTION_BANK_VERSION_EXISTS');
      }
      const now = new Date();
      const createdRelease = await tx.questionBankRelease.create({
        data: {
          bankVersion: validation.summary.bankVersion,
          contentDigest: validation.summary.contentDigest,
          environmentScope: validation.summary.environmentScope,
          importedAt: now,
          importedBy: actorReference,
          itemCount: validation.rows.length,
          sourceFileDigest: validation.summary.sourceFileDigest,
          validatorVersion: validation.summary.validatorVersion,
          items: {
            createMany: {
              data: validation.rows.map((row) => ({
                applicableConditionCodes: [...row.applicableConditionCodes],
                bank: row.bank,
                enabled: row.enabled,
                inapplicableConditionCodes: [...row.inapplicableConditionCodes],
                licenseReference: row.licenseReference,
                licenseStatus: row.licenseStatus,
                purpose: row.purpose,
                questionId: row.questionId,
                questionText: row.questionText,
                sensitivity: row.sensitivity,
                sourceReference: row.sourceReference,
                sourceType: row.sourceType,
                topic: row.topic,
              })),
            },
          },
        },
      });
      const release = await tx.questionBankRelease.update({
        data: { membershipSealedAt: now },
        where: { id: createdRelease.id },
      });
      const metadata: OperationMetadata = {
        action: 'import_draft',
        app_environment: this.deploymentEnvironment,
        bank_version: release.bankVersion,
        binding_hash: bindingHash,
        content_digest: release.contentDigest,
        environment_scope: release.environmentScope,
        item_count: release.itemCount,
        release_id: release.id,
        source_file_digest: release.sourceFileDigest,
        status: release.status,
        validator_version: release.validatorVersion,
      };
      await writeAudit(
        tx,
        actorReference,
        requestId,
        'question_bank.import_draft',
        release.id,
        metadata,
      );
      return projectRelease(release, false);
    });
  }

  public async activateRelease(
    releaseId: string,
    actorReference: string,
    requestId: string,
  ): Promise<ReleaseResult> {
    return this.changeReleaseState('activate', releaseId, actorReference, requestId);
  }

  public async retireRelease(
    releaseId: string,
    actorReference: string,
    requestId: string,
  ): Promise<ReleaseResult> {
    return this.changeReleaseState('retire', releaseId, actorReference, requestId);
  }

  private async changeReleaseState(
    action: 'activate' | 'retire',
    releaseId: string,
    actorReference: string,
    requestId: string,
  ): Promise<ReleaseResult> {
    assertActorAndRequest(actorReference, requestId);
    const bindingHash = operationHash({
      action,
      actorReference,
      appEnvironment: this.deploymentEnvironment,
      releaseId,
    });
    return this.prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `question-bank-request:${requestId}`);
      const replay = await readReplay(tx, requestId, actorReference, bindingHash);
      if (replay !== null) return { ...replay, replayed: true };
      const release = await tx.questionBankRelease.findUnique({
        include: { items: true },
        where: { id: releaseId },
      });
      if (release === null) throw new QuestionBankError('QUESTION_BANK_RELEASE_NOT_FOUND');
      assertEnvironmentCanOperateScope(this.deploymentEnvironment, release.environmentScope);
      await advisoryLock(tx, `question-bank-scope:${release.environmentScope}`);
      const now = new Date();
      if (action === 'activate') {
        if (release.status !== 'draft') {
          throw new QuestionBankError('QUESTION_BANK_RELEASE_INVALID_STATE');
        }
        assertActivatable(release.environmentScope, release.items);
        await tx.questionBankRelease.updateMany({
          data: { retiredAt: now, status: 'retired' },
          where: { environmentScope: release.environmentScope, status: 'active' },
        });
        await tx.questionBankRelease.update({
          data: { activatedAt: now, activatedBy: actorReference, status: 'active' },
          where: { id: release.id },
        });
      } else {
        if (release.status !== 'active') {
          throw new QuestionBankError('QUESTION_BANK_RELEASE_INVALID_STATE');
        }
        await tx.questionBankRelease.update({
          data: { retiredAt: now, status: 'retired' },
          where: { id: release.id },
        });
      }
      const updated = await tx.questionBankRelease.findUniqueOrThrow({ where: { id: release.id } });
      const metadata: OperationMetadata = {
        action,
        app_environment: this.deploymentEnvironment,
        bank_version: updated.bankVersion,
        binding_hash: bindingHash,
        content_digest: updated.contentDigest,
        environment_scope: updated.environmentScope,
        item_count: updated.itemCount,
        release_id: updated.id,
        source_file_digest: updated.sourceFileDigest,
        status: updated.status,
        validator_version: updated.validatorVersion,
      };
      await writeAudit(
        tx,
        actorReference,
        requestId,
        `question_bank.${action}`,
        updated.id,
        metadata,
      );
      return projectRelease(updated, false);
    });
  }
}

@Injectable()
export class QuestionBankReader {
  public constructor(
    @Inject(PrismaService) private readonly prisma: DatabaseClient,
    @Inject(QUESTION_BANK_DEPLOYMENT_ENVIRONMENT)
    private readonly deploymentEnvironment: QuestionBankEnvironment,
  ) {}

  public async listEligible(
    stage: JourneyStage,
    contextFacts: readonly QuestionConditionCode[],
    policyContext: QuestionBankPolicyContext,
  ): Promise<readonly EligibleQuestionBankItem[]> {
    if (
      !JOURNEY_STAGES.includes(stage) ||
      !['product', 'internal_demo'].includes(policyContext.environmentScope)
    ) {
      throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
    }
    if (policyContext.policyDecision === 'blocked') {
      throw new QuestionBankError('QUESTION_BANK_POLICY_BLOCKED');
    }
    if (policyContext.policyDecision !== 'allowed') {
      throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
    }
    assertEnvironmentCanOperateScope(this.deploymentEnvironment, policyContext.environmentScope);
    const conditionSet = normalizeRuntimeFacts(stage, contextFacts);
    const release = await this.prisma.questionBankRelease.findFirst({
      include: { items: { where: { enabled: true } } },
      where: { environmentScope: policyContext.environmentScope, status: 'active' },
    });
    if (release === null) {
      throw new QuestionBankError('QUESTION_BANK_ACTIVE_RELEASE_UNAVAILABLE');
    }
    const eligible = release.items.filter((item) => {
      if (!runtimeLicenseAllowed(release.environmentScope, item.sourceType, item.licenseStatus)) {
        return false;
      }
      const excluded = item.inapplicableConditionCodes.some((code) => conditionSet.has(code));
      if (excluded) return false;
      return item.applicableConditionCodes.every((code) => conditionSet.has(code));
    });
    return eligible
      .sort((left, right) =>
        compareEligible(
          stage,
          left.bank,
          left.sensitivity,
          left.questionId,
          right.bank,
          right.sensitivity,
          right.questionId,
        ),
      )
      .map((item) => ({
        applicableConditionCodes: item.applicableConditionCodes as QuestionConditionCode[],
        bank: item.bank,
        bankVersion: release.bankVersion,
        inapplicableConditionCodes: item.inapplicableConditionCodes as QuestionConditionCode[],
        itemId: item.id,
        licenseStatus: item.licenseStatus as EligibleQuestionBankItem['licenseStatus'],
        purpose: item.purpose,
        questionId: item.questionId,
        questionText: item.questionText,
        sensitivity: item.sensitivity,
        sourceType: item.sourceType,
        topic: item.topic,
      }));
  }
}

@Injectable()
export class InternalDemoQuestionSelector {
  public readonly version = 'question-bank-internal-demo-selector-v1';

  public select(
    stage: JourneyStage,
    eligible: readonly EligibleQuestionBankItem[],
  ): { basisHash: string; item: EligibleQuestionBankItem | null; selectorVersion: string } {
    const sorted = [...eligible].sort((left, right) =>
      compareEligible(
        stage,
        left.bank,
        left.sensitivity,
        left.questionId,
        right.bank,
        right.sensitivity,
        right.questionId,
      ),
    );
    return {
      basisHash: operationHash({
        eligibleItemIds: sorted.map(({ itemId }) => itemId),
        selectorVersion: this.version,
        stage,
      }),
      item: sorted[0] ?? null,
      selectorVersion: this.version,
    };
  }
}

function assertActivatable(
  scope: QuestionBankScope,
  items: readonly { bank: string; licenseStatus: string; sourceType: string }[],
): void {
  if (!items.some(({ bank }) => bank === 'basic') || !items.some(({ bank }) => bank === 'deep')) {
    throw new QuestionBankError('QUESTION_BANK_RELEASE_INVALID_STATE');
  }
  if (
    items.some(({ licenseStatus, sourceType }) =>
      scope === 'internal_demo'
        ? sourceType !== 'synthetic_fixture' || licenseStatus !== 'fixture_only'
        : !['project_original', 'verified'].includes(licenseStatus),
    )
  ) {
    throw new QuestionBankError('QUESTION_BANK_LICENSE_COMBINATION_INVALID');
  }
}

function assertEnvironmentCanOperateScope(
  environment: QuestionBankEnvironment,
  scope: QuestionBankScope,
): void {
  if (scope === 'internal_demo' && ['formal_internal', 'production'].includes(environment)) {
    throw new QuestionBankError('QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED');
  }
}

function normalizeRuntimeFacts(stage: JourneyStage, contextFacts: unknown): Set<string> {
  if (!Array.isArray(contextFacts)) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  const known = new Set<string>(QUESTION_CONDITION_CODES);
  const facts = new Set<string>([`stage.${stage}`]);
  for (const fact of contextFacts) {
    if (typeof fact !== 'string' || !known.has(fact) || fact.startsWith('stage.')) {
      throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
    }
    facts.add(fact);
  }
  return facts;
}

function runtimeLicenseAllowed(
  scope: QuestionBankScope,
  sourceType: string,
  licenseStatus: string,
): boolean {
  return scope === 'internal_demo'
    ? sourceType === 'synthetic_fixture' && licenseStatus === 'fixture_only'
    : licenseStatus === 'project_original' || licenseStatus === 'verified';
}

function compareEligible(
  stage: JourneyStage,
  leftBank: string,
  leftSensitivity: string,
  leftQuestionId: string,
  rightBank: string,
  rightSensitivity: string,
  rightQuestionId: string,
): number {
  const preferredBank = stage === 'story_depth' ? 'deep' : 'basic';
  const bankDifference = Number(leftBank !== preferredBank) - Number(rightBank !== preferredBank);
  if (bankDifference !== 0) return bankDifference;
  const sensitivity = new Map([
    ['low', 0],
    ['medium', 1],
    ['high', 2],
  ]);
  const sensitivityDifference =
    (sensitivity.get(leftSensitivity) ?? 9) - (sensitivity.get(rightSensitivity) ?? 9);
  return sensitivityDifference || leftQuestionId.localeCompare(rightQuestionId);
}

async function advisoryLock(tx: TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function readReplay(
  tx: TransactionClient,
  requestId: string,
  actorReference: string,
  bindingHash: string,
): Promise<Omit<ReleaseResult, 'replayed'> | null> {
  const audit = await tx.auditLog.findFirst({
    where: { entityType: 'question_bank_release', requestId },
  });
  if (audit === null) return null;
  const metadata = audit.metadata;
  if (
    audit.actorReference !== actorReference ||
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata) ||
    metadata.binding_hash !== bindingHash ||
    typeof metadata.release_id !== 'string' ||
    typeof metadata.bank_version !== 'string' ||
    typeof metadata.content_digest !== 'string' ||
    typeof metadata.environment_scope !== 'string' ||
    !['product', 'internal_demo'].includes(metadata.environment_scope) ||
    typeof metadata.item_count !== 'number' ||
    !Number.isInteger(metadata.item_count) ||
    metadata.item_count <= 0 ||
    typeof metadata.app_environment !== 'string' ||
    typeof metadata.status !== 'string' ||
    !['draft', 'active', 'retired'].includes(metadata.status)
  ) {
    throw new QuestionBankError('QUESTION_BANK_REQUEST_ID_REUSED');
  }
  return {
    bankVersion: metadata.bank_version,
    contentDigest: metadata.content_digest,
    environmentScope: metadata.environment_scope as QuestionBankScope,
    itemCount: metadata.item_count,
    releaseId: metadata.release_id,
    status: metadata.status as ReleaseResult['status'],
  };
}

async function writeAudit(
  tx: TransactionClient,
  actorReference: string,
  requestId: string,
  action: string,
  releaseId: string,
  metadata: OperationMetadata,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      action,
      actorReference,
      actorType: AuditActorType.system_operator,
      entityId: releaseId,
      entityType: 'question_bank_release',
      metadata,
      requestId,
    },
  });
}

function projectRelease(
  release: {
    bankVersion: string;
    contentDigest: string;
    environmentScope: QuestionBankScope;
    id: string;
    itemCount: number;
    status: ReleaseResult['status'];
  },
  replayed: boolean,
): ReleaseResult {
  return {
    bankVersion: release.bankVersion,
    contentDigest: release.contentDigest,
    environmentScope: release.environmentScope,
    itemCount: release.itemCount,
    releaseId: release.id,
    replayed,
    status: release.status,
  };
}

function operationHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function assertActorAndRequest(actorReference: string, requestId: string): void {
  if (actorReference.trim().length === 0 || actorReference.length > 200) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)
  ) {
    throw new QuestionBankError('QUESTION_BANK_REQUEST_ID_REUSED');
  }
}
