# SPEC-LLM-PROVIDER-001 交接

## 基本信息

- 状态：`REVIEW`；等待项目负责人 exact-head 手动 GitHub 审查
- base：`origin/main@6f6363f517a6588ff4eb31aee7996b7116092c03`
- branch：`codex/spec-llm-provider-001`
- PR：[PR #52](https://github.com/Li-Ming-G/elder_interview_ai/pull/52)（非 Draft）
- exact head / CI：以本次 PR 元数据回填提交后的 GitHub head 与 CI run 为准；任何 CI SUCCESS 不等于 PASS
- 正式旧审查：REV-050 绑定 `b7ae9a428530be92a95a5fb9d2fc6cc2fd2c5ede` / CI `31769677989` SUCCESS，项目负责人 `REQUEST_CHANGES`，P0=0/P1=3/P2=0；永久保留

## 已冻结

1. Vercel AI SDK 只作 TypeScript 应用内 provider-neutral adapter；direct vendor only，Gateway/LiteLLM/fallback/shadow disabled。
2. 正式 generation attempt 唯一 active binding；default registry 为空、真实数据 deny，客户端/Prompt 无 provider authority。
3. SDK `maxRetries=0`；项目既有 8 秒绝对 deadline + primary/最多一次完全同输入 retry 唯一；每次调用用剩余预算 abort，late result 无写回资格。
4. 真实 provider/model/model-config/package/request ID source/token/latency/region/direct mode provenance；SDK generated response ID 不冒充 provider ID。
5. Prompt `draft -> candidate -> formal -> active`；当前 loader/formal v1 不变，`v2-draft` 仅供项目负责人编辑。字段/枚举变化必须 Schema-first。
6. 固定 synthetic-v1 横评集；题库空/不用题库合法，后端 stage 权威。比较输出只写隔离 artifact，不写 current/history。
7. server-only secrets/endpoint/region/data-class allowlist fail closed；境外真实内容默认 deny。真实 runtime 等 DEV-ASR-PROVIDER-001 PASS。

## 边界

本交付没有安装 `ai` 或 provider package，没有选择厂商/模型/地区，没有读取或请求密钥，没有调用真实 provider，没有修改 Prisma/runtime loader/QuestionEvidence，也没有创建 formal v2。contract、fixture、CI 均不构成真实 provider PASS。

实现差距：当前 Prisma 缺正式 `ai_job.model_provider` 与逐调用 SDK/package/region/request-ID-source 字段。`04` 已先冻结目标；后续真实 runtime 必须以受审前向 migration、legacy incomplete/unjudged 和 provenance 联表测试关闭，不能只改 adapter 或继续写 `local-test`。

## iteration-coach

复用总控本轮唯一独立只读 Correction，未启动第二次。Prompt 生命周期、SDK no-retry/fallback、真实 provenance、评测隔离、region/secret fail closed 与 ASR 前置均已吸收。

## 审查重点

- default registry 是否确实无 provider/active binding且真实数据 deny；
- SDK 隐式 retry/Gateway/fallback 是否被机械禁止，项目 retry/deadline 是否仍唯一；
- receipt 是否区分 provider ID 和 SDK generated ID；
- v2 draft 是否不可加载，formal v1 是否保持；
- synthetic evaluation 是否通过正式 Context Schema、没有 business writer target；
- CON-031 是否诚实保留真实厂商/region/境外处理未决；
- scope 是否未越界到 runtime/provider/007/008/真实数据。

## 验证

本地最终验证（均为 contract/spec、现有 runtime 回归或 synthetic fixture，不构成真实 LLM/ASR provider PASS）：

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`：PASS；
- `pnpm test:unit`：57 files / 344 tests PASS；定向 SPEC：5/5 PASS；
- 独立 PostgreSQL `elder_interview_spec_llm_001`：14 migrations deploy/status PASS，integration 14 files / 82 tests PASS，auth 4 files / 23 tests PASS；
- `pnpm test:smoke`：PASS；普通 Chromium E2E 27/27 PASS；真实 Web/API synthetic auth E2E 5/5 PASS；
- `git diff --check`：PASS；package manifest/lockfile 未改，未安装 `ai` 或 provider package。

第一次数据库命令在专用数据库尚未创建时于 migration 前失败；随后显式创建隔离数据库并完成上述全套数据库门禁，没有改测试目标或产品代码。普通 E2E WebServer 启动窗口记录一次 `/api/v1/auth/me` 代理 `ECONNREFUSED`，27/27 用例仍通过，未形成失败或重跑。

PR #52 已创建且非 Draft；元数据回填提交后继续取得 exact head 与 CI run。只有项目负责人明确 PASS 后，治理 Agent 才可将任务 DONE、ADR-040 Accepted 并决定后续 provider 选择任务；执行 Agent 不得自行 merge。

## REV-050 定向修复交接

当前只允许关闭三项 P1：registry semantic reference/membership、四类 provenance identity、canonical model-config/warnings/equal-effective-config。不得重做已通过方向，不安装 SDK、不选厂商、不写真实 provider runtime/Prisma migration、不启动第二次 iteration-coach。修复完成后必须产生新的 exact head 与完整 CI SUCCESS，再由项目负责人定向复审；新绿灯不覆盖旧 REQUEST_CHANGES。
