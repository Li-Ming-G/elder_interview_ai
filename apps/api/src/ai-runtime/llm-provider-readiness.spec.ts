import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LlmProviderRegistryV1 } from '@elder-interview/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertIsolatedLlmEvaluationArtifact,
  type LlmEvaluationArtifactEnvelopeV1,
} from './llm-evaluation-artifact.guard.js';
import {
  LlmProviderReadinessService,
  validateLlmProviderRegistryV1,
} from './llm-provider-readiness.service.js';

describe('DEV-LLM-PROVIDER-001A fail-closed readiness', () => {
  it('starts with the valid empty registry but denies every provider call', () => {
    const readiness = new LlmProviderReadinessService();
    expect(readiness.snapshot().providers).toEqual([]);
    expect(readiness.snapshot().routing.active_binding).toBeNull();
    expect(() => readiness.requireActiveBinding()).toThrow('AI_PROVIDER_UNAVAILABLE');
  });

  it('fails closed when an active binding does not resolve to exactly one provider', () => {
    const registry = structuredClone(
      new LlmProviderReadinessService().snapshot(),
    ) as LlmProviderRegistryV1;
    registry.routing.active_binding = {
      data_class: 'synthetic',
      data_region: 'synthetic-region',
      endpoint_origin: 'https://synthetic.invalid',
      environment_scope: 'test',
      model_config_digest: 'a'.repeat(64),
      model_config_version: 'synthetic-config-v1',
      requested_provider_id: 'missing-provider',
      requested_provider_model_id: 'missing-model',
      secret_reference: 'SYNTHETIC_KEY',
    };

    expect(validateLlmProviderRegistryV1(registry)).toMatchObject({
      semantic_errors: [
        {
          code: 'ACTIVE_PROVIDER_NOT_EXACTLY_ONE',
          path: '/routing/active_binding/requested_provider_id',
        },
      ],
      structural_errors: [],
      valid: false,
    });
  });

  it('accepts only isolated synthetic/deidentified artifacts and has no business writer import', () => {
    const artifact: LlmEvaluationArtifactEnvelopeV1 = {
      artifact_target: 'isolated_evaluation_artifact',
      contains_real_personal_data: false,
      data_class: 'synthetic',
      prohibited_publish_targets: ['question_current', 'question_history'],
      publish_targets: ['isolated_evaluation_artifact'],
    };
    expect(() => {
      assertIsolatedLlmEvaluationArtifact(artifact);
    }).not.toThrow();
    expect(() => {
      assertIsolatedLlmEvaluationArtifact({
        ...artifact,
        publish_targets: ['question_current'],
      });
    }).toThrow('LLM_EVALUATION_ARTIFACT_TARGET_INVALID');

    const source = readFileSync(
      join(import.meta.dirname, 'llm-evaluation-artifact.guard.ts'),
      'utf8',
    );
    expect(source).not.toContain('question-evidence');
    expect(source).not.toContain('question_current writer');
  });
});
