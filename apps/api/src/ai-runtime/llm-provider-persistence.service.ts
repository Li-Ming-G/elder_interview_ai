import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type {
  LlmModelConfigManifestV1,
  LlmProviderCallReceiptV1,
  LlmProviderInvocationV1,
} from '@elder-interview/contracts';
import { Injectable } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { digestLlmModelConfigV1 } from '../question-orchestration/llm-provider-registry-semantics.js';

export interface LlmProviderCallRoundTripV1 {
  evaluation_status: 'judged' | 'unjudged';
  invocation: LlmProviderInvocationV1;
  provenance_status: 'complete' | 'incomplete';
  receipt: LlmProviderCallReceiptV1 | null;
}

@Injectable()
export class LlmProviderPersistenceService {
  private readonly validateReceipt = compileReceipt();
  private readonly validateModelConfig = compileModelConfig();

  public constructor(private readonly prisma: PrismaService) {}

  public async registerModelConfigManifest(
    manifest: LlmModelConfigManifestV1,
    expectedDigest: string,
  ): Promise<string> {
    if (!this.validateModelConfig(manifest)) {
      throw new Error('LLM_MODEL_CONFIG_MANIFEST_INVALID');
    }
    const digest = digestLlmModelConfigV1(manifest);
    if (digest !== expectedDigest) throw new Error('LLM_MODEL_CONFIG_DIGEST_MISMATCH');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.aiModelConfigManifest.findUnique({
        where: { modelConfigVersion: manifest.model_config_version },
      });
      if (existing !== null) {
        if (
          existing.modelConfigDigest !== digest ||
          digestLlmModelConfigV1(existing.manifestJson as unknown as LlmModelConfigManifestV1) !==
            digest
        ) {
          throw new Error('LLM_MODEL_CONFIG_IDENTITY_CONFLICT');
        }
        return existing.id;
      }
      const created = await tx.aiModelConfigManifest.create({
        data: {
          canonicalizationVersion: manifest.canonicalization_version,
          id: randomUUID(),
          manifestJson: manifest as unknown as Prisma.InputJsonValue,
          modelConfigDigest: digest,
          modelConfigVersion: manifest.model_config_version,
          schemaVersion: manifest.schema_version,
        },
      });
      return created.id;
    });
  }

  public async beginInvocation(
    aiJobId: string,
    callNo: number,
    invocation: LlmProviderInvocationV1,
  ): Promise<string> {
    if (invocation.call_kind === 'evaluation') {
      throw new Error('LLM_EVALUATION_DATABASE_WRITE_FORBIDDEN');
    }
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.aiJob.findUnique({ where: { id: aiJobId } });
      if (
        job === null ||
        job.requestedProviderId !== invocation.requested_provider_id ||
        job.requestedProviderModelId !== invocation.requested_provider_model_id
      ) {
        throw new Error('LLM_JOB_BINDING_NOT_FROZEN');
      }
      const manifest = await tx.aiModelConfigManifest.findFirst({
        where: {
          modelConfigDigest: invocation.model_config_digest,
          modelConfigVersion: invocation.model_config_version,
        },
      });
      if (manifest === null) throw new Error('LLM_MODEL_CONFIG_NOT_EXACTLY_ONE');
      const id = randomUUID();
      await tx.aiProviderCall.create({
        data: {
          aiJobId,
          callKind: invocation.call_kind,
          callNo,
          contextSchemaDigest: invocation.context_schema_digest,
          contextSchemaVersion: invocation.context_schema_version,
          deadlineAt: new Date(invocation.deadline_at),
          evaluationStatus: 'unjudged',
          id,
          inputHash: invocation.frozen_input_digest,
          modelConfigDigest: invocation.model_config_digest,
          modelConfigManifestId: manifest.id,
          modelConfigVersion: invocation.model_config_version,
          outputSchemaDigest: invocation.output_schema_digest,
          outputSchemaVersion: invocation.output_schema_version,
          promptBundleDigest: invocation.prompt_bundle_digest,
          promptBundleVersion: invocation.prompt_bundle_version,
          provenanceStatus: 'incomplete',
          requestedProviderId: invocation.requested_provider_id,
          requestedProviderModelId: invocation.requested_provider_model_id,
          startedAt: new Date(),
          status: 'running',
        },
      });
      return id;
    });
  }

  public async completeInvocation(
    callId: string,
    receipt: LlmProviderCallReceiptV1,
  ): Promise<void> {
    if (!this.validateReceipt(receipt)) throw new Error('LLM_PROVIDER_RECEIPT_INVALID');
    await this.prisma.$transaction(async (tx) => {
      const call = await tx.aiProviderCall.findUnique({ where: { id: callId } });
      if (
        call === null ||
        call.status !== 'running' ||
        call.requestedProviderId !== receipt.requested_provider_id ||
        call.requestedProviderModelId !== receipt.requested_provider_model_id ||
        call.modelConfigVersion !== receipt.model_config_version ||
        call.modelConfigDigest !== receipt.model_config_digest ||
        call.inputHash !== receipt.input_digest
      ) {
        throw new Error('LLM_PROVIDER_RECEIPT_BINDING_MISMATCH');
      }
      const updated = await tx.aiProviderCall.updateMany({
        data: {
          completedAt: new Date(receipt.completed_at),
          configApplicationStatus: receipt.config_application_status,
          connectionMode: receipt.connection_mode,
          dataRegion: receipt.data_region,
          endpointOrigin: receipt.endpoint_origin,
          errorCode: receipt.error_code,
          latencyMs: receipt.latency_ms,
          observedResponseModelId: receipt.observed_response_model_id,
          observedResponseModelIdSource: receipt.observed_response_model_id_source,
          outputHash: receipt.output_digest,
          providerRequestId: receipt.provider_request_id,
          providerRequestIdSource: receipt.provider_request_id_source,
          provenanceStatus: 'complete',
          sdkCorePackage: receipt.sdk_core_package,
          sdkCoreVersion: receipt.sdk_core_version,
          sdkProviderPackage: receipt.sdk_provider_package,
          sdkProviderPackageVersion: receipt.sdk_provider_package_version,
          sdkResponseId: receipt.sdk_response_id,
          sdkResponseIdSource: receipt.sdk_response_id_source,
          startedAt: new Date(receipt.started_at),
          status: receipt.status,
          tokenUsageJson: receipt.token_usage,
          warningsJson: receipt.warnings,
        },
        where: { id: callId, provenanceStatus: 'incomplete', status: 'running' },
      });
      if (updated.count !== 1) throw new Error('LLM_PROVIDER_RECEIPT_LATE_OR_REPLAYED');
    });
  }

  public async readRoundTrip(callId: string): Promise<LlmProviderCallRoundTripV1> {
    const call = await this.prisma.aiProviderCall.findUnique({ where: { id: callId } });
    if (call === null) throw new Error('LLM_PROVIDER_CALL_NOT_FOUND');
    const invocation = invocationFromRow(call);
    const persistedReceipt = call.provenanceStatus === 'complete' ? receiptFromRow(call) : null;
    if (persistedReceipt !== null && !this.validateReceipt(persistedReceipt)) {
      throw new Error('LLM_PROVIDER_PERSISTED_RECEIPT_INVALID');
    }
    return {
      evaluation_status: call.evaluationStatus as 'judged' | 'unjudged',
      invocation,
      provenance_status: call.provenanceStatus as 'complete' | 'incomplete',
      receipt: persistedReceipt as LlmProviderCallReceiptV1 | null,
    };
  }
}

function invocationFromRow(row: ProviderCallRow): LlmProviderInvocationV1 {
  if (
    row.requestedProviderId === null ||
    row.requestedProviderModelId === null ||
    row.modelConfigVersion === null ||
    row.modelConfigDigest === null ||
    row.promptBundleVersion === null ||
    row.promptBundleDigest === null ||
    row.contextSchemaVersion === null ||
    row.contextSchemaDigest === null ||
    row.outputSchemaVersion === null ||
    row.outputSchemaDigest === null ||
    row.deadlineAt === null ||
    !['primary', 'same_input_retry'].includes(row.callKind)
  ) {
    throw new Error('LLM_PROVIDER_INVOCATION_INCOMPLETE');
  }
  return {
    call_kind: row.callKind as 'primary' | 'same_input_retry',
    context_schema_digest: row.contextSchemaDigest,
    context_schema_version: row.contextSchemaVersion,
    deadline_at: row.deadlineAt.toISOString(),
    frozen_input_digest: row.inputHash,
    model_config_digest: row.modelConfigDigest,
    model_config_schema_version: 'llm-model-config-v1',
    model_config_version: row.modelConfigVersion,
    output_schema_digest: row.outputSchemaDigest,
    output_schema_version: row.outputSchemaVersion,
    prompt_bundle_digest: row.promptBundleDigest,
    prompt_bundle_version: row.promptBundleVersion,
    requested_provider_id: row.requestedProviderId,
    requested_provider_model_id: row.requestedProviderModelId,
  };
}

function receiptFromRow(row: ProviderCallRow): Record<string, unknown> {
  return {
    completed_at: requiredDate(row.completedAt).toISOString(),
    config_application_status: requiredString(row.configApplicationStatus),
    connection_mode: requiredString(row.connectionMode),
    data_region: requiredString(row.dataRegion),
    endpoint_origin: requiredString(row.endpointOrigin),
    error_code: row.errorCode,
    input_digest: row.inputHash,
    latency_ms: requiredNumber(row.latencyMs),
    model_config_digest: requiredString(row.modelConfigDigest),
    model_config_schema_version: 'llm-model-config-v1',
    model_config_version: requiredString(row.modelConfigVersion),
    observed_response_model_id: row.observedResponseModelId,
    observed_response_model_id_source: requiredString(row.observedResponseModelIdSource),
    output_digest: row.outputHash,
    provider_request_id: row.providerRequestId,
    provider_request_id_source: requiredString(row.providerRequestIdSource),
    requested_provider_id: requiredString(row.requestedProviderId),
    requested_provider_model_id: requiredString(row.requestedProviderModelId),
    schema_version: 'llm-provider-call-receipt-v1',
    sdk_core_package: requiredString(row.sdkCorePackage),
    sdk_core_version: requiredString(row.sdkCoreVersion),
    sdk_provider_package: requiredString(row.sdkProviderPackage),
    sdk_provider_package_version: requiredString(row.sdkProviderPackageVersion),
    sdk_response_id: row.sdkResponseId,
    sdk_response_id_source: requiredString(row.sdkResponseIdSource),
    started_at: row.startedAt.toISOString(),
    status: row.status,
    token_usage: row.tokenUsageJson,
    warnings: row.warningsJson,
  };
}

type ProviderCallRow = Prisma.AiProviderCallGetPayload<Record<string, never>>;

function requiredString(value: string | null): string {
  if (value === null) throw new Error('LLM_PROVIDER_PERSISTED_RECEIPT_INCOMPLETE');
  return value;
}

function requiredNumber(value: number | null): number {
  if (value === null) throw new Error('LLM_PROVIDER_PERSISTED_RECEIPT_INCOMPLETE');
  return value;
}

function requiredDate(value: Date | null): Date {
  if (value === null) throw new Error('LLM_PROVIDER_PERSISTED_RECEIPT_INCOMPLETE');
  return value;
}

function compileReceipt(): ValidateFunction {
  const root = findRepositoryRoot();
  const AjvConstructor = Ajv2020 as unknown as new (options: {
    allErrors: boolean;
    strict: boolean;
  }) => {
    addFormat(name: string, format: RegExp): void;
    compile(schema: object): ValidateFunction;
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  ajv.addFormat('uri', /^https:\/\/[^\s]+$/u);
  ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u);
  return ajv.compile(
    JSON.parse(
      readFileSync(join(root, 'docs/contracts/llm-provider-call-receipt-v1.schema.json'), 'utf8'),
    ) as object,
  );
}

function compileModelConfig(): ValidateFunction {
  const root = findRepositoryRoot();
  const AjvConstructor = Ajv2020 as unknown as new (options: {
    allErrors: boolean;
    strict: boolean;
  }) => {
    compile(schema: object): ValidateFunction;
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  return ajv.compile(
    JSON.parse(
      readFileSync(join(root, 'docs/contracts/llm-model-config-v1.schema.json'), 'utf8'),
    ) as object,
  );
}

function findRepositoryRoot(): string {
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'docs/contracts/llm-provider-call-receipt-v1.schema.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('LLM_PROVIDER_SPEC_ARTIFACTS_NOT_FOUND');
}
