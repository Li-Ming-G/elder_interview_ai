import type { LlmProviderCallReceiptV1, LlmProviderRegistryV1 } from './index.js';

type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;
type IsAssignable<Candidate, Contract> = Candidate extends Contract ? true : false;

type DefaultRegistry = {
  contract_version: 'llm-provider-registry-v1';
  artifact_status: 'candidate';
  sdk: {
    family: 'vercel_ai_sdk';
    core_package: 'ai';
    verified_version: '7.0.65';
    verified_on: '2026-08-14';
    license: 'Apache-2.0';
    node_engine: '>=22';
    dependency_policy: 'exact_reviewed_versions';
    max_retries: 0;
    structured_output: 'output_object_json_schema';
  };
  routing: {
    connection_mode: 'direct_vendor';
    gateway_enabled: false;
    litellm_enabled: false;
    fallback_enabled: false;
    shadow_traffic_enabled: false;
    active_binding: null;
  };
  runtime: {
    absolute_deadline_ms: 8000;
    coordinator_same_input_retry_max: 1;
    abort_required: true;
    late_result_writeback: 'deny';
    formal_attempt_active_binding_count: 1;
  };
  safety: {
    configuration_authority: 'server_only';
    secret_injection: 'server_reference_only';
    real_interview_data_default: 'deny';
    foreign_real_content_default: 'deny';
    unknown_configuration: 'fail_closed';
    asr_provider_pass_required: 'DEV-ASR-PROVIDER-001';
  };
  prompt: {
    active_formal_bundle: 'interview-director-prompt-v1';
    editable_draft_path: 'docs/prompts/interview-director/v2-draft';
    draft_runtime_loadable: false;
    lifecycle: readonly ['draft', 'candidate', 'formal', 'active'];
    schema_first: true;
  };
  evaluation: {
    allowed_data_classes: readonly ['synthetic', 'deidentified'];
    frozen_inputs_required: true;
    artifact_target: 'isolated_evaluation_artifact';
    prohibited_publish_targets: readonly ['question_current', 'question_history'];
  };
  providers: [];
};

export type FailClosedDefaultIsAccepted = AssertTrue<
  IsAssignable<DefaultRegistry, LlmProviderRegistryV1>
>;
export type GatewayCannotBeEnabled = AssertFalse<
  IsAssignable<
    Omit<DefaultRegistry, 'routing'> & {
      routing: Omit<DefaultRegistry['routing'], 'gateway_enabled'> & { gateway_enabled: true };
    },
    LlmProviderRegistryV1
  >
>;
export type SdkRetriesCannotBeEnabled = AssertFalse<
  IsAssignable<
    Omit<DefaultRegistry, 'sdk'> & {
      sdk: Omit<DefaultRegistry['sdk'], 'max_retries'> & { max_retries: 2 };
    },
    LlmProviderRegistryV1
  >
>;
export type DraftCannotBecomeRuntimeLoadable = AssertFalse<
  IsAssignable<
    Omit<DefaultRegistry, 'prompt'> & {
      prompt: Omit<DefaultRegistry['prompt'], 'draft_runtime_loadable'> & {
        draft_runtime_loadable: true;
      };
    },
    LlmProviderRegistryV1
  >
>;

type ProviderReceipt = {
  schema_version: 'llm-provider-call-receipt-v1';
  provider_id: 'provider-a';
  provider_model_id: 'model-a';
  model_config_version: 'model-config-v1';
  model_config_digest: 'digest';
  sdk_core_package: 'ai';
  sdk_core_version: '7.0.65';
  sdk_provider_package: '@ai-sdk/provider-a';
  sdk_provider_package_version: '1.2.3';
  connection_mode: 'direct_vendor';
  endpoint_origin: 'https://api.example.test';
  data_region: 'synthetic-test-region';
  provider_request_id: 'provider-request-1';
  provider_request_id_source: 'provider';
  sdk_response_id: 'sdk-response-1';
  token_usage: { input_tokens: 10; output_tokens: 5; total_tokens: 15 };
  latency_ms: 100;
  status: 'succeeded';
  error_code: null;
  started_at: '2026-08-14T00:00:00.000Z';
  completed_at: '2026-08-14T00:00:00.100Z';
  input_digest: 'input-digest';
  output_digest: 'output-digest';
};

export type ProviderReceiptIsAccepted = AssertTrue<
  IsAssignable<ProviderReceipt, LlmProviderCallReceiptV1>
>;
export type SdkGeneratedIdCannotMasqueradeAsProviderId = AssertFalse<
  IsAssignable<
    Omit<ProviderReceipt, 'provider_request_id_source'> & {
      provider_request_id_source: 'sdk_generated';
    },
    LlmProviderCallReceiptV1
  >
>;
