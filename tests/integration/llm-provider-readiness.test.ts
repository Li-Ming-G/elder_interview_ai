/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type {
  LlmModelConfigManifestV1,
  LlmProviderCallReceiptV1,
  LlmProviderInvocationV1,
} from '@elder-interview/contracts';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LlmProviderPersistenceService } from '../../apps/api/src/ai-runtime/llm-provider-persistence.service.js';
import { LlmProviderReadinessService } from '../../apps/api/src/ai-runtime/llm-provider-readiness.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import type { Prisma } from '../../apps/api/src/generated/prisma/client.js';

describe('DEV-LLM-PROVIDER-001A PostgreSQL provenance round-trip', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let persistence: LlmProviderPersistenceService;
  let readiness: LlmProviderReadinessService;

  const actorId = randomUUID();
  const projectId = randomUUID();
  const jobId = randomUUID();
  const variantJobId = randomUUID();
  const legacyJobId = randomUUID();

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-llm-readiness-retention-pepper',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-llm-readiness-login-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    persistence = app.get<LlmProviderPersistenceService>(LlmProviderPersistenceService);
    readiness = app.get<LlmProviderReadinessService>(LlmProviderReadinessService);

    await prisma.user.create({
      data: {
        displayName: 'Fictional LLM readiness listener',
        email: `llm-readiness-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
    await prisma.elderProject.create({
      data: {
        createdBy: actorId,
        displayName: 'Fictional LLM project',
        id: projectId,
        status: 'active',
      },
    });
    await prisma.aiJob.createMany({
      data: [
        aiJob(jobId, {
          requestedProviderId: 'synthetic-provider',
          requestedProviderModelId: 'synthetic-requested-model',
          projectId,
          requestedBy: actorId,
        }),
        aiJob(variantJobId, {
          requestedProviderId: 'synthetic-provider',
          requestedProviderModelId: 'synthetic-requested-model',
          projectId,
          requestedBy: actorId,
        }),
        aiJob(legacyJobId, { projectId, requestedBy: actorId }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.aiProviderCall.deleteMany({
      where: { aiJobId: { in: [jobId, variantJobId, legacyJobId] } },
    });
    await prisma.aiModelConfigManifest.deleteMany({
      where: { modelConfigVersion: 'synthetic-comparison-v1' },
    });
    await prisma.aiJob.deleteMany({ where: { id: { in: [jobId, variantJobId, legacyJobId] } } });
    await prisma.elderProject.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await app.close();
  });

  it('round-trips the frozen invocation and four-way provider receipt without publishing business data', async () => {
    expect(readiness.snapshot().routing.active_binding).toBeNull();
    expect(() => readiness.requireActiveBinding()).toThrow('AI_PROVIDER_UNAVAILABLE');

    const vector = syntheticManifest();
    await persistence.registerModelConfigManifest(vector.manifest, vector.sha256);

    const invocation = providerInvocation(vector.sha256);
    const callId = await persistence.beginInvocation(jobId, 1, invocation);
    const receipt = providerReceipt(vector.sha256);
    await persistence.completeInvocation(callId, receipt);

    expect(await persistence.readRoundTrip(callId)).toEqual({
      evaluation_status: 'unjudged',
      invocation,
      provenance_status: 'complete',
      receipt,
    });
    expect(await prisma.questionGenerationAttempt.count({ where: { aiJobId: jobId } })).toBe(0);
    expect(await prisma.questionDisplaySnapshot.count()).toBe(0);

    const adjustedInvocation = providerInvocation(vector.sha256, 'same_input_retry');
    const adjustedCallId = await persistence.beginInvocation(jobId, 2, adjustedInvocation);
    const adjustedReceipt = adjustedProviderReceipt(vector.sha256);
    await persistence.completeInvocation(adjustedCallId, adjustedReceipt);
    expect(await persistence.readRoundTrip(adjustedCallId)).toEqual({
      evaluation_status: 'unjudged',
      invocation: adjustedInvocation,
      provenance_status: 'complete',
      receipt: adjustedReceipt,
    });

    const unknownInvocation = providerInvocation(vector.sha256, 'same_input_retry');
    const unknownCallId = await persistence.beginInvocation(variantJobId, 1, unknownInvocation);
    const unknownReceipt = unknownProviderReceipt(vector.sha256);
    await persistence.completeInvocation(unknownCallId, unknownReceipt);
    expect(await persistence.readRoundTrip(unknownCallId)).toEqual({
      evaluation_status: 'unjudged',
      invocation: unknownInvocation,
      provenance_status: 'complete',
      receipt: unknownReceipt,
    });

    await prisma.aiProviderCall.update({
      data: { providerRequestId: null, providerRequestIdSource: 'provider' },
      where: { id: unknownCallId },
    });
    await expect(persistence.readRoundTrip(unknownCallId)).rejects.toThrow(
      'LLM_PROVIDER_PERSISTED_RECEIPT_INVALID',
    );
  });

  it('rejects invalid manifests before any database write', async () => {
    const vector = syntheticManifest();
    const before = await prisma.aiModelConfigManifest.count();
    const missingField = structuredClone(vector.manifest) as Record<string, unknown>;
    Reflect.deleteProperty(missingField, 'generation');
    const extraField = { ...vector.manifest, unexpected_property: true };
    const invalidEnum = structuredClone(vector.manifest) as LlmModelConfigManifestV1;
    Reflect.set(invalidEnum.generation.reasoning, 'mode', 'unsupported-mode');

    await expect(
      persistence.registerModelConfigManifest(
        missingField as LlmModelConfigManifestV1,
        vector.sha256,
      ),
    ).rejects.toThrow('LLM_MODEL_CONFIG_MANIFEST_INVALID');
    await expect(
      persistence.registerModelConfigManifest(
        extraField as LlmModelConfigManifestV1,
        vector.sha256,
      ),
    ).rejects.toThrow('LLM_MODEL_CONFIG_MANIFEST_INVALID');
    await expect(
      persistence.registerModelConfigManifest(
        invalidEnum as LlmModelConfigManifestV1,
        vector.sha256,
      ),
    ).rejects.toThrow('LLM_MODEL_CONFIG_MANIFEST_INVALID');
    await expect(
      persistence.registerModelConfigManifest(vector.manifest, 'f'.repeat(64)),
    ).rejects.toThrow('LLM_MODEL_CONFIG_DIGEST_MISMATCH');
    expect(await prisma.aiModelConfigManifest.count()).toBe(before);
  });

  it('keeps legacy/local-test calls explicitly incomplete and unjudged', async () => {
    const legacyCall = await prisma.aiProviderCall.create({
      data: {
        aiJobId: legacyJobId,
        callKind: 'primary',
        callNo: 1,
        id: randomUUID(),
        inputHash: 'd'.repeat(64),
        startedAt: new Date(),
        status: 'succeeded',
      },
    });

    expect(legacyCall).toMatchObject({
      evaluationStatus: 'unjudged',
      provenanceStatus: 'incomplete',
      requestedProviderId: null,
      sdkResponseId: null,
    });
    await expect(persistence.readRoundTrip(legacyCall.id)).rejects.toThrow(
      'LLM_PROVIDER_INVOCATION_INCOMPLETE',
    );
  });

  it('refuses evaluation-lane database writes and receipt binding drift with zero mutation', async () => {
    const before = await prisma.aiProviderCall.count({ where: { aiJobId: jobId } });
    const evaluationInvocation: LlmProviderInvocationV1 = {
      ...providerInvocation('e'.repeat(64)),
      call_kind: 'evaluation',
    };
    await expect(persistence.beginInvocation(jobId, 2, evaluationInvocation)).rejects.toThrow(
      'LLM_EVALUATION_DATABASE_WRITE_FORBIDDEN',
    );
    expect(await prisma.aiProviderCall.count({ where: { aiJobId: jobId } })).toBe(before);
  });
});

function aiJob(
  id: string,
  binding: {
    projectId?: string;
    requestedBy?: string;
    requestedProviderId?: string;
    requestedProviderModelId?: string;
  } = {},
): Prisma.AiJobCreateManyInput {
  const now = new Date();
  return {
    contextBuilderVersion: 'llm-readiness-test-v1',
    expiresAt: new Date(now.getTime() + 3_600_000),
    id,
    inputHash: 'a'.repeat(64),
    jobType: 'question_generate' as const,
    modelName: 'provider-neutral-unavailable',
    policyRevision: 0,
    promptVersion: 'interview-director-prompt-v1',
    projectId: binding.projectId ?? '00000000-0000-4000-8000-000000000000',
    requestIdentityHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    requestId: randomUUID(),
    requestedBy: binding.requestedBy ?? '00000000-0000-4000-8000-000000000001',
    retentionPolicyVersion: 1,
    schemaVersion: 'interview-director-output-v1',
    status: 'running' as const,
    ...binding,
  };
}

function syntheticManifest(): { manifest: LlmModelConfigManifestV1; sha256: string } {
  return {
    manifest: {
      canonicalization_version: 'llm-model-config-canonical-json-v1',
      generation: {
        frequency_penalty: 0,
        max_output_tokens: 256,
        presence_penalty: 0,
        reasoning: { budget_tokens: null, effort: null, mode: 'disabled' },
        response_format: 'json_schema',
        seed: 42,
        stop_sequences: [],
        temperature: 0.2,
        tools: 'none',
        top_k: null,
        top_p: 1,
      },
      model_config_version: 'synthetic-comparison-v1',
      provider_options: {},
      schema_version: 'llm-model-config-v1',
    },
    sha256: 'eb9639c9ae5dd8e76547d8756c402717df75fb5b310f316babb5715ad6c583d0',
  };
}

function providerInvocation(
  modelConfigDigest: string,
  callKind: 'primary' | 'same_input_retry' = 'primary',
): LlmProviderInvocationV1 {
  return {
    call_kind: callKind,
    context_schema_digest: '1'.repeat(64),
    context_schema_version: 'interview-director-context-v1',
    deadline_at: '2026-08-15T01:00:08.000Z',
    frozen_input_digest: 'b'.repeat(64),
    model_config_digest: modelConfigDigest,
    model_config_schema_version: 'llm-model-config-v1',
    model_config_version: 'synthetic-comparison-v1',
    output_schema_digest: '2'.repeat(64),
    output_schema_version: 'interview-director-output-v1',
    prompt_bundle_digest: '3'.repeat(64),
    prompt_bundle_version: 'interview-director-prompt-v1',
    requested_provider_id: 'synthetic-provider',
    requested_provider_model_id: 'synthetic-requested-model',
  };
}

function providerReceipt(modelConfigDigest: string): LlmProviderCallReceiptV1 {
  return {
    completed_at: '2026-08-15T01:00:00.123Z',
    config_application_status: 'as_requested',
    connection_mode: 'direct_vendor',
    data_region: 'synthetic-test-region',
    endpoint_origin: 'https://synthetic.invalid',
    error_code: null,
    input_digest: 'b'.repeat(64),
    latency_ms: 123,
    model_config_digest: modelConfigDigest,
    model_config_schema_version: 'llm-model-config-v1',
    model_config_version: 'synthetic-comparison-v1',
    observed_response_model_id: 'synthetic-observed-model-revision',
    observed_response_model_id_source: 'provider_origin',
    output_digest: 'c'.repeat(64),
    provider_request_id: 'provider-request-1',
    provider_request_id_source: 'provider',
    requested_provider_id: 'synthetic-provider',
    requested_provider_model_id: 'synthetic-requested-model',
    schema_version: 'llm-provider-call-receipt-v1',
    sdk_core_package: 'ai',
    sdk_core_version: '7.0.65',
    sdk_provider_package: '@ai-sdk/synthetic',
    sdk_provider_package_version: '1.0.0',
    sdk_response_id: 'sdk-response-1',
    sdk_response_id_source: 'provider_origin',
    started_at: '2026-08-15T01:00:00.000Z',
    status: 'succeeded',
    token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    warnings: [],
  };
}

function adjustedProviderReceipt(modelConfigDigest: string): LlmProviderCallReceiptV1 {
  return {
    ...providerReceipt(modelConfigDigest),
    config_application_status: 'diverged',
    observed_response_model_id: 'synthetic-normalized-model',
    observed_response_model_id_source: 'sdk_normalized',
    sdk_response_id: 'sdk-generated-1',
    sdk_response_id_source: 'sdk_generated',
    warnings: [
      {
        classification: 'adjusted_setting',
        sanitized_code: 'TEMPERATURE_ADJUSTED',
        setting_path: '/generation/temperature',
      },
    ],
  };
}

function unknownProviderReceipt(modelConfigDigest: string): LlmProviderCallReceiptV1 {
  return {
    ...providerReceipt(modelConfigDigest),
    config_application_status: 'unknown',
    observed_response_model_id: null,
    observed_response_model_id_source: 'unavailable',
    provider_request_id: null,
    provider_request_id_source: 'unavailable',
    sdk_response_id: null,
    sdk_response_id_source: 'unavailable',
    warnings: [
      {
        classification: 'warning_visibility_unavailable',
        sanitized_code: 'WARNING_VISIBILITY_UNAVAILABLE',
        setting_path: null,
      },
    ],
  };
}
