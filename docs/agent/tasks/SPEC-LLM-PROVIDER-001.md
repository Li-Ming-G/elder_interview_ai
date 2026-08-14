# SPEC-LLM-PROVIDER-001｜LLM 多供应商、Prompt 发布与隔离横评契约

## 基本信息

- 状态：`REVIEW`
- 负责人：独立执行 Agent
- base：`origin/main@6f6363f517a6588ff4eb31aee7996b7116092c03`
- branch：`codex/spec-llm-provider-001`
- PR：[PR #52](https://github.com/Li-Ming-G/elder_interview_ai/pull/52)（非 Draft；等待最终 metadata head CI）
- 前置决定：项目负责人已选择 Vercel AI SDK、厂商直连、正式单 active provider/model、隔离多模型横评；不使用 Gateway/LiteLLM
- 审查：高影响契约任务；只由项目负责人对非 Draft PR exact head/CI 手动给结论。执行 Agent 不得 PASS/DONE/merge

## 目标

在不选择或实现第一家真实 LLM 厂商、不索取密钥、不修改 runtime dependency 的前提下，冻结 provider registry/config、direct connection、data-region/secret/allowlist、单 active binding、AI SDK no-retry/fallback、共享 deadline/abort、真实 provenance、Prompt draft/candidate/formal 生命周期和 synthetic multi-model evaluation 隔离。

## 已知正式边界

1. 正式访谈一次只启用一个 active provider/model/model-config；无 binding 时 fail closed。
2. AI SDK 每次显式 `maxRetries=0`，无 Gateway、LiteLLM、provider/model fallback、shadow call 或 tools/multi-step；项目 8 秒绝对 deadline、primary/最多一次完全同输入 retry 是唯一重试真相。
3. 题库 0..N 且可完全不使用；`journey_stage` 由后端权威提供，Director 服从、不另建阶段。
4. 当前 loader 继续指向 formal v1。`v2-draft` 可编辑但不可加载；candidate 固定字节/digest/Schema/config 并运行固定 synthetic evaluation；项目负责人接收后才能新增 immutable formal v2，loader 切换另行受审。
5. 横评只使用 synthetic/deidentified 数据，对模型发送同一冻结 Context/Prompt/Schema/config；输出只写隔离评测工件，不写 current/history。
6. provider/model/config/package/request ID/token/latency/region/direct mode 必须形成真实 provenance。SDK generated response ID 不能冒充 provider request ID，缺失时明确 unavailable/incomplete。
7. registry 对真实访谈内容默认 deny；secret/server injection、provider/endpoint/region/data-class allowlist 任一未知即 fail closed。未决定境外处理前禁止向境外厂商发送真实内容。
8. 真实 LLM runtime 开工仍等待 `07` §17 的 `DEV-ASR-PROVIDER-001` 正式 PASS；本 SPEC 与离线 scaffold 不构成 provider PASS。

当前实现缺口已显式冻结：Prisma 尚未实现正式 `ai_job.model_provider`，也没有逐调用 SDK/package/region/request-ID-source 字段。后续真实 runtime 必须先提交契约一致的前向 migration、legacy fail-closed 与联表 provenance 测试；本 SPEC 不越界修改 Prisma。

## 唯一 iteration-coach Correction

总控已在本轮完成唯一独立只读 Correction；本执行任务不启动第二次。已吸收：Prompt 发布生命周期、v1 不覆盖、Schema-first、SDK `maxRetries=0`/no fallback、真实 provenance、虚构横评隔离、region/secret fail closed 和 ASR 前置。

## 官方核验（2026-08-14）

- `pnpm view ai version license engines dist-tags --json`：latest `7.0.65`、Apache-2.0、Node `>=22`；本 SPEC 不安装依赖。实现任务须重新核验并 exact pin core/provider package。
- [AI SDK generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)：默认 retry 为 2，`maxRetries=0` 禁用；支持 `abortSignal`、structured output、usage/response/provider metadata。
- [Provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)：`createProviderRegistry` 可注册 direct provider imports；本项目明确不注册 `gateway`。
- [Structured Output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output)：使用 `Output.object({ schema })`；项目正式 Output Schema 与服务端硬校验继续是发布权威。
- [Provider architecture](https://ai-sdk.dev/docs/foundations/providers-and-models) 与 [OpenAI direct provider 示例](https://ai-sdk.dev/providers/ai-sdk-providers/openai)：官方 provider package 可直接创建实例并连接厂商 API。
- [Vercel AI SDK LICENSE](https://github.com/vercel/ai/blob/main/LICENSE)：Apache-2.0。

## 交付

- `00/01/02/04/05/07/08/09/10` 的正式 contract-first 增量；
- `docs/contracts/llm-provider-registry-v1.schema.json`、fail-closed default manifest、call receipt Schema；
- `packages/contracts` candidate types 与编译期反例；
- `docs/prompts/interview-director/v2-draft` 编辑区，runtime v1 不变；
- 固定 `docs/evaluations/interview-director/synthetic-v1`；
- ADR-040、CON-031、REQ-019、测试/验收矩阵与交接。

## 明确不做

真实 provider/runtime、密钥、线上管理面板、第二 AI critic、LiteLLM、Vercel Gateway、题库重做、DEV-007/008 业务流、真实数据评测、Prisma/migration、自动 winner/fallback、formal v2 或 loader 切换。

## 验收

按 `09` §19 完成 JSON Schema/fixture、shared typecheck、v1 loader、定向 unit 和仓库全门禁验证；创建非 Draft PR 并取得 exact-head CI SUCCESS。任务保持 REVIEW，等待项目负责人手动审查。

本地结果：format/lint/typecheck/build PASS；unit 57 files / 344 tests、定向 SPEC 5/5、integration 14 files / 82 tests、auth 4 files / 23 tests、smoke、Chromium E2E 27/27、auth E2E 5/5 均 PASS；14 migrations 在隔离 PostgreSQL deploy/status PASS。PR #52 已创建且非 Draft；最终 metadata head CI 仍待补齐，当前结果不构成真实 provider PASS。

## REV-050 正式 REQUEST_CHANGES

- reviewed exact head：`b7ae9a428530be92a95a5fb9d2fc6cc2fd2c5ede`；CI `31769677989` SUCCESS；项目负责人正式结论 `REQUEST_CHANGES`，P0=0/P1=3/P2=0。
- P1-1：补 active binding → exactly one provider/model/config 与 endpoint/region/secret/environment/data-class membership 的 deterministic semantic validator；重复 identity/缺失/歧义全部 fail closed，并用正反 fixtures 固定。
- P1-2：拆分 requested model、observed response model+source、provider request ID+source、SDK response ID+source四类 provenance；同步 receipt/shared types 与 `04/05/07/09/10`。
- P1-3：新增 `llm-model-config-v1` canonical manifest/schema、精确 digest 算法与 golden vector；冻结真实 generation/provider options，receipt/persistence 增加 sanitized warning 与 effective-config 状态，横评不得把 warning/unknown 当同配置。
- old head/CI/REQUEST_CHANGES 永久保留；定向修复候选仍保持 REVIEW，ADR-040 Proposed/REVIEW、CON-031 OPEN，不得 PASS/DONE/merge。
