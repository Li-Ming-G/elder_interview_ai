import { createHash } from 'node:crypto';

import type {
  LlmJsonValue,
  LlmModelConfigManifestV1,
  LlmProviderCallReceiptV1,
  LlmProviderRegistryV1,
} from '@elder-interview/contracts';

export const LLM_PROVIDER_REGISTRY_SEMANTIC_ERROR_CODES = [
  'DUPLICATE_PROVIDER_IDENTITY',
  'DUPLICATE_MODEL_IDENTITY',
  'DUPLICATE_MODEL_CONFIG_IDENTITY',
  'DUPLICATE_MODEL_CONFIG_REFERENCE',
  'DUPLICATE_REGION_IDENTITY',
  'MODEL_CONFIG_DIGEST_MISMATCH',
  'MODEL_CONFIG_REFERENCE_NOT_EXACTLY_ONE',
  'ACTIVE_PROVIDER_NOT_EXACTLY_ONE',
  'ACTIVE_MODEL_NOT_EXACTLY_ONE',
  'ACTIVE_MODEL_CONFIG_NOT_EXACTLY_ONE',
  'ACTIVE_ENDPOINT_NOT_EXACTLY_ONE',
  'ACTIVE_REGION_NOT_EXACTLY_ONE',
  'ACTIVE_SECRET_REFERENCE_NOT_EXACTLY_ONE',
  'ACTIVE_ENVIRONMENT_NOT_EXACTLY_ONE',
  'ACTIVE_DATA_CLASS_NOT_EXACTLY_ONE',
  'ACTIVE_REAL_INTERVIEW_POLICY_DENIED',
  'ACTIVE_FOREIGN_PROCESSING_POLICY_DENIED',
] as const;

export type LlmProviderRegistrySemanticErrorCode =
  (typeof LLM_PROVIDER_REGISTRY_SEMANTIC_ERROR_CODES)[number];

export interface LlmProviderRegistrySemanticErrorV1 {
  code: LlmProviderRegistrySemanticErrorCode;
  path: string;
}

export interface LlmProviderRegistrySemanticValidationV1 {
  semantic_contract_version: 'llm-provider-registry-semantics-v1';
  valid: boolean;
  errors: LlmProviderRegistrySemanticErrorV1[];
}

export type EqualEffectiveConfigReasonV1 =
  | 'INSUFFICIENT_RECEIPTS'
  | 'MODEL_CONFIG_IDENTITY_MISMATCH'
  | 'CONFIG_DIVERGED'
  | 'CONFIG_EFFECT_UNKNOWN'
  | 'WARNING_PRESENT';

export interface EqualEffectiveConfigAssessmentV1 {
  equal_effective_config: boolean;
  reason_codes: EqualEffectiveConfigReasonV1[];
}

export function canonicalizeLlmModelConfigV1(manifest: LlmModelConfigManifestV1): string {
  return canonicalizeJsonValue(manifest as unknown as LlmJsonValue);
}

export function digestLlmModelConfigV1(manifest: LlmModelConfigManifestV1): string {
  return createHash('sha256').update(canonicalizeLlmModelConfigV1(manifest), 'utf8').digest('hex');
}

export function validateLlmProviderRegistrySemanticsV1(
  registry: LlmProviderRegistryV1,
): LlmProviderRegistrySemanticValidationV1 {
  const errors: LlmProviderRegistrySemanticErrorV1[] = [];
  const addError = (code: LlmProviderRegistrySemanticErrorCode, path: string): void => {
    errors.push({ code, path });
  };

  duplicateValues(registry.providers.map((provider) => provider.provider_id)).forEach(
    (providerId) => {
      addError('DUPLICATE_PROVIDER_IDENTITY', `/providers/${pointer(providerId)}`);
    },
  );

  duplicateValues(
    registry.model_config_manifests.map((record) => record.manifest.model_config_version),
  ).forEach((version) => {
    addError('DUPLICATE_MODEL_CONFIG_IDENTITY', `/model_config_manifests/${pointer(version)}`);
  });

  registry.model_config_manifests.forEach((record, index) => {
    if (digestLlmModelConfigV1(record.manifest) !== record.model_config_digest) {
      addError(
        'MODEL_CONFIG_DIGEST_MISMATCH',
        `/model_config_manifests/${String(index)}/model_config_digest`,
      );
    }
  });

  registry.providers.forEach((provider, providerIndex) => {
    duplicateValues(provider.model_allowlist.map((model) => model.provider_model_id)).forEach(
      (modelId) => {
        addError(
          'DUPLICATE_MODEL_IDENTITY',
          `/providers/${String(providerIndex)}/model_allowlist/${pointer(modelId)}`,
        );
      },
    );
    duplicateValues(provider.processing_regions.map((region) => region.data_region)).forEach(
      (region) => {
        addError(
          'DUPLICATE_REGION_IDENTITY',
          `/providers/${String(providerIndex)}/processing_regions/${pointer(region)}`,
        );
      },
    );

    provider.model_allowlist.forEach((model, modelIndex) => {
      duplicateValues(
        model.model_config_refs.map((reference) => reference.model_config_version),
      ).forEach((version) => {
        addError(
          'DUPLICATE_MODEL_CONFIG_REFERENCE',
          `/providers/${String(providerIndex)}/model_allowlist/${String(modelIndex)}/model_config_refs/${pointer(version)}`,
        );
      });
      model.model_config_refs.forEach((reference, referenceIndex) => {
        const matches = registry.model_config_manifests.filter(
          (record) =>
            record.manifest.model_config_version === reference.model_config_version &&
            record.model_config_digest === reference.model_config_digest,
        );
        if (matches.length !== 1) {
          addError(
            'MODEL_CONFIG_REFERENCE_NOT_EXACTLY_ONE',
            `/providers/${String(providerIndex)}/model_allowlist/${String(modelIndex)}/model_config_refs/${String(referenceIndex)}`,
          );
        }
      });
    });
  });

  const binding = registry.routing.active_binding;
  if (binding !== null) {
    const providers = registry.providers.filter(
      (provider) => provider.provider_id === binding.requested_provider_id,
    );
    if (providers.length !== 1) {
      addError('ACTIVE_PROVIDER_NOT_EXACTLY_ONE', '/routing/active_binding/requested_provider_id');
    } else {
      const provider = providers[0];
      if (provider === undefined) throw new Error('UNREACHABLE_PROVIDER_RESOLUTION');
      const models = provider.model_allowlist.filter(
        (model) => model.provider_model_id === binding.requested_provider_model_id,
      );
      if (models.length !== 1) {
        addError(
          'ACTIVE_MODEL_NOT_EXACTLY_ONE',
          '/routing/active_binding/requested_provider_model_id',
        );
      } else {
        const model = models[0];
        if (model === undefined) throw new Error('UNREACHABLE_MODEL_RESOLUTION');
        const references = model.model_config_refs.filter(
          (reference) =>
            reference.model_config_version === binding.model_config_version &&
            reference.model_config_digest === binding.model_config_digest,
        );
        const manifests = registry.model_config_manifests.filter(
          (record) =>
            record.manifest.model_config_version === binding.model_config_version &&
            record.model_config_digest === binding.model_config_digest,
        );
        if (references.length !== 1 || manifests.length !== 1) {
          addError(
            'ACTIVE_MODEL_CONFIG_NOT_EXACTLY_ONE',
            '/routing/active_binding/model_config_version',
          );
        }
      }

      membershipCount(provider.endpoint_origins, binding.endpoint_origin, (count) => {
        if (count !== 1) {
          addError('ACTIVE_ENDPOINT_NOT_EXACTLY_ONE', '/routing/active_binding/endpoint_origin');
        }
      });
      membershipCount(
        provider.processing_regions.map((region) => region.data_region),
        binding.data_region,
        (count) => {
          if (count !== 1) {
            addError('ACTIVE_REGION_NOT_EXACTLY_ONE', '/routing/active_binding/data_region');
          }
        },
      );
      membershipCount(provider.secret_references, binding.secret_reference, (count) => {
        if (count !== 1) {
          addError(
            'ACTIVE_SECRET_REFERENCE_NOT_EXACTLY_ONE',
            '/routing/active_binding/secret_reference',
          );
        }
      });
      membershipCount(provider.environment_scopes, binding.environment_scope, (count) => {
        if (count !== 1) {
          addError(
            'ACTIVE_ENVIRONMENT_NOT_EXACTLY_ONE',
            '/routing/active_binding/environment_scope',
          );
        }
      });
      membershipCount(provider.allowed_data_classes, binding.data_class, (count) => {
        if (count !== 1) {
          addError('ACTIVE_DATA_CLASS_NOT_EXACTLY_ONE', '/routing/active_binding/data_class');
        }
      });

      if (binding.data_class === 'real_interview' && !provider.real_interview_policy.allowed) {
        addError('ACTIVE_REAL_INTERVIEW_POLICY_DENIED', '/routing/active_binding/data_class');
      }
      const matchedRegion = provider.processing_regions.find(
        (region) => region.data_region === binding.data_region,
      );
      if (
        binding.data_class === 'real_interview' &&
        matchedRegion?.jurisdiction === 'foreign' &&
        (!provider.real_interview_policy.allowed ||
          !provider.real_interview_policy.foreign_processing_allowed)
      ) {
        addError('ACTIVE_FOREIGN_PROCESSING_POLICY_DENIED', '/routing/active_binding/data_region');
      }
    }
  }

  const sortedErrors = uniqueErrors(errors).sort(
    (left, right) =>
      compareCodeUnits(left.path, right.path) || compareCodeUnits(left.code, right.code),
  );
  return {
    semantic_contract_version: 'llm-provider-registry-semantics-v1',
    valid: sortedErrors.length === 0,
    errors: sortedErrors,
  };
}

export function assessEqualEffectiveConfigV1(
  receipts: readonly LlmProviderCallReceiptV1[],
): EqualEffectiveConfigAssessmentV1 {
  const reasons = new Set<EqualEffectiveConfigReasonV1>();
  if (receipts.length < 2) reasons.add('INSUFFICIENT_RECEIPTS');

  const first = receipts[0];
  if (
    first !== undefined &&
    receipts.some(
      (receipt) =>
        receipt.model_config_version !== first.model_config_version ||
        receipt.model_config_digest !== first.model_config_digest,
    )
  ) {
    reasons.add('MODEL_CONFIG_IDENTITY_MISMATCH');
  }
  for (const receipt of receipts) {
    if (receipt.config_application_status === 'diverged') reasons.add('CONFIG_DIVERGED');
    if (receipt.config_application_status === 'unknown') reasons.add('CONFIG_EFFECT_UNKNOWN');
    if (receipt.warnings.length > 0) reasons.add('WARNING_PRESENT');
  }

  const reasonCodes = [...reasons].sort(compareCodeUnits);
  return { equal_effective_config: reasonCodes.length === 0, reason_codes: reasonCodes };
}

function canonicalizeJsonValue(value: LlmJsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error('LLM_MODEL_CONFIG_NON_CANONICAL_NUMBER');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJsonValue).join(',')}]`;

  const entries = Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalizeJsonValue(nested)}`)
    .join(',')}}`;
}

function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort(compareCodeUnits);
}

function membershipCount<T>(
  values: readonly T[],
  target: T,
  consume: (count: number) => void,
): void {
  consume(values.filter((value) => value === target).length);
}

function uniqueErrors(
  errors: readonly LlmProviderRegistrySemanticErrorV1[],
): LlmProviderRegistrySemanticErrorV1[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const identity = `${error.path}\u0000${error.code}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
