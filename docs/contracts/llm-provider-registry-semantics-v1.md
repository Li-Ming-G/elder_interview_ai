# LLM Provider Registry Semantics V1 候选契约

状态：`CANDIDATE / REVIEW / REV-050`。JSON Schema 只负责结构；本语义契约负责跨数组引用和歧义失败关闭。参考实现为 `apps/api/src/question-orchestration/llm-provider-registry-semantics.ts`，尚未接入真实 provider runtime。

## 启动验证顺序

validator 对整个 registry 验证并返回确定性排序的 sanitized error list；任何 error 都使整个 registry 无调用资格，不允许忽略未激活的坏 profile/config 后继续运行。

1. `provider_id` 全局唯一；同一 provider 内 `provider_model_id` 唯一；全局 model-config manifest 的 `model_config_version` 唯一；同一 model 内 config ref version 唯一。
2. 每个 config ref 必须按 version+digest exactly-one 命中 manifest；每个 manifest digest 必须按 `llm-model-config-canonical-json-v1` 重算一致。
3. active binding 为 null 时不调用 provider；非 null 时必须 exactly-one 命中 provider，再在该 provider exactly-one 命中 model，再在该 model exactly-one 命中 config ref 和全局 manifest。
4. binding 的 endpoint、data region、secret reference、environment scope 与 data class 分别必须在所命中 profile 中 exactly-one membership；region identity 按 `data_region` 唯一，不能用不同 jurisdiction 制造歧义。
5. `data_class=real_interview` 还要求 profile policy `allowed=true`；foreign region 还要求 `foreign_processing_allowed=true` 和非空 cross-border decision。任何未知、缺失、重复或不一致均 fail closed。

错误只含稳定 code 与 JSON Pointer path，不含 secret value、Prompt、Context 或正文。完整 error code 与 JSON Patch 正反 fixtures 位于 [`fixtures/llm-provider-registry-semantics-v1.fixtures.json`](fixtures/llm-provider-registry-semantics-v1.fixtures.json)。fixtures 使用 RFC 6902 `add|replace|remove|copy` 构造单一变体；expected error codes 必须与实现返回的去重排序结果完全一致。
