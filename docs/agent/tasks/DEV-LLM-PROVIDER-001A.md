# DEV-LLM-PROVIDER-001A｜Provider-neutral persistence 与 fail-closed readiness

## 基本信息

- 状态：`REVIEW`
- 基线：`main@8eb34f9f4933ec69b097d91c1b46b9e5143a76ac` / CI `31829153177` SUCCESS
- 父任务：`DEV-LLM-PROVIDER-001`，继续保持 `BLOCKED`
- 分支：`codex/dev-llm-provider-001a-readiness`
- 审查：`REV-056 / PENDING`
- 负责人：独立实现 Agent

## 目标

在不选择或连接真实厂商的前提下，实现后续 direct-provider runtime 共同需要的持久化、registry readiness、deadline/abort、隔离评测与 formal Prompt loader 失败关闭基座。

## 范围

1. 前向 migration 增加 immutable model-config manifest 与逐调用完整 provenance/warning/config status 字段；既有和 local/test 调用保持 `incomplete|unjudged`。
2. 启动时执行 registry JSON Schema 与 deterministic semantic validation；默认空 registry 可以启动，但 provider call readiness 必须 unavailable。
3. 实现 typed invocation/receipt repository round-trip，并复用 canonical config digest/golden vector 与 equal-effective-config 规则。
4. 在 fake/unavailable seam 上传递 `AbortSignal`，保持共享绝对 deadline、primary 加最多一次同输入 retry、迟到结果零写回。
5. 以纯本地 guard 限制 evaluation artifact 仅写隔离目标，拒绝 QuestionEvidence/current/history。
6. runtime loader 只接受已接收 formal v1，明确拒绝 `v2-draft`。

## 明确不做

- 不安装 `ai`、`@ai-sdk/*` 或任何 provider package；
- 不选择 provider/model/region/endpoint，不建立 active binding，不索取、读取或注入 secret；
- 不调用网络或外部 provider，不处理真实数据，不形成真实 provider PASS；
- 不加载、发布或重命名 `v2-draft`，不创建 formal v2；
- 不改变 `DEV-LLM-PROVIDER-001` 的 `BLOCKED` 状态。

## iteration-coach

本任务开工前只尝试一次 iteration-coach。独立子 Agent 通道未返回可用报告且已无存活 reviewer，不记作独立结论；按 skill 回退为单 Agent 同 contract 只读审查，结论 `Clear`。关键不变量是 local/test fake 不得成为真实 fallback、完整 provenance 或 provider PASS。本任务不得再次启动 reviewer。

## 验收

- contract/type/unit 正反例；
- fresh/repeat PostgreSQL migration deploy/status 与 legacy `incomplete|unjudged`；
- repository PostgreSQL round-trip；
- integration/auth/build/smoke/ordinary Chromium/auth Chromium；
- package manifest/lockfile 无 AI SDK/provider dependency；
- non-Draft PR、exact-head 完整 CI SUCCESS；
- 保持 `REVIEW`，由总控按当前授权执行独立 exact-head 审查，不由实现 Agent 自行 PASS/DONE/merge。

## 本地验证记录

- `pnpm install --offline --frozen-lockfile`、`pnpm db:generate`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`：通过；package manifest/lockfile 未新增 AI SDK/provider 依赖。
- `pnpm test:unit`：67 files / 413 tests passed；`pnpm test:integration`：16 files / 97 tests passed；认证单元：4 files / 26 tests passed；smoke：通过。
- 隔离 PostgreSQL `elder_llm_readiness_20260815` 上 fresh 19 migrations deploy、repeat deploy/status up-to-date、repository round-trip/evaluation write guard：通过。
- ordinary Chromium E2E：27/27 passed；auth Chromium E2E（带隔离 `TEST_DATABASE_URL`）：5/5 passed。
- 首次未设置 `TEST_DATABASE_URL` 运行 auth E2E 的即时配置失败保留为失败历史；随后使用隔离数据库连接串重跑通过。
- implementation commit `780bdb8d5ae7078a9b1723f4310f5b65b21fdb17`（PR #62，non-Draft，OPEN，mergeable）在 exact base `8eb34f9f4933ec69b097d91c1b46b9e5143a76ac` 上获得 exact-head CI `31859395528` SUCCESS；项目负责人审查仍待完成。

## 定向修复历史

- 旧 exact head `d5d4d031a22d6446bcb7bf20c26fc0fb4001990c` / CI `31859633862` 的正式 `REQUEST_CHANGES`（P0=0/P1=2/P2=0）永久保留，详见 PR #62 评论；本轮不覆盖历史结论。
- 修复范围仅限 receipt 实际值/union fail-closed、正式 model-config Schema 校验与 invalid manifest 零写入回归；父任务与硬边界不变。

本轮本地验证：全新隔离 DB `elder_llm_fix_20260815` fresh/repeat/status 19 migrations、integration 16 files/98 tests、auth 26 tests、build/format/lint/typecheck/smoke、ordinary Chromium 27/27、auth Chromium 5/5 全部通过。旧复用 DB 的既有清理污染失败历史不改变本轮结论。

CI 失败历史 `31860539626` 仅为 lint 对新增测试 `structuredClone` 嵌套访问的类型解析问题，已用反射式 fixture mutation 修复；不涉及生产运行时。

当前待审 exact head：`73e167e535a88f4c656d147437944bfbc5c6c70c`，PR #62 CI `31860733748 SUCCESS`，仍保持 `REVIEW`。
