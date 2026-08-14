# SPEC-LLM-PROVIDER-001 交接

## 基本信息

- 状态：`REVIEW`；accepted 内容已获项目负责人 PASS，latest-main integration 待窄复审
- base：`origin/main@6f6363f517a6588ff4eb31aee7996b7116092c03`
- branch：`codex/spec-llm-provider-001`
- PR：[PR #52](https://github.com/Li-Ming-G/elder_interview_ai/pull/52)（非 Draft）
- accepted exact head / CI：`77fb3a860ccd372f1fdc3465654f86d931688a89` / `31783061076` SUCCESS；项目负责人正式 `PASS`，P0=0/P1=0/P2=0
- 正式旧审查：branch-local REV-050 绑定 `b7ae9a428530be92a95a5fb9d2fc6cc2fd2c5ede` / CI `31769677989` SUCCESS，项目负责人 `REQUEST_CHANGES`，P0=0/P1=3/P2=0；永久保留
- canonical review identity：main 的 `REV-050` 已由 DEV-008B1 占用；本任务治理索引使用 `REV-051（branch-local REV-050）`，不改 accepted LLM contract/schema/fixtures 中的历史注释

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
- `pnpm test:unit`：57 files / 349 tests PASS；REV-050 定向 SPEC：10/10 PASS；
- 独立 PostgreSQL `elder_interview_spec_llm_001_rev050`：14 migrations deploy/status PASS，integration 14 files / 82 tests PASS，auth 4 files / 23 tests PASS；
- `pnpm test:smoke`：PASS；普通 Chromium E2E 27/27 PASS；真实 Web/API synthetic auth E2E 5/5 PASS；
- `git diff --check`：PASS；package manifest/lockfile 未改，未安装 `ai` 或 provider package。

第一次数据库命令在专用数据库尚未创建时于 migration 前失败；创建后首轮 integration/auth 已全绿。为避免既有 question-bank 固定 version 在同库重跑造成 `QUESTION_BANK_VERSION_EXISTS`，最终证据改用新建空库 `elder_interview_spec_llm_001_rev050` 单次运行并全绿，没有清理共享数据、修改测试目标或产品代码。普通 E2E WebServer 启动窗口记录一次 `/api/v1/auth/me` 代理 `ECONNREFUSED`，27/27 用例仍通过，未形成失败或重跑。

PR #52 已创建且非 Draft。accepted 内容已获项目负责人明确 PASS；由于 PR #51 与本 PR 的治理文件存在 latest-main 冲突，当前只完成机械整合并生成新的 integration exact head/CI。项目负责人完成 integration 窄复审前，任务保持 REVIEW，ADR-040 不转 Accepted，CON-031 不关闭，执行 Agent 不得 DONE 或 merge。

## branch-local REV-050 定向修复与 accepted PASS 交接

当前只允许关闭三项 P1：registry semantic reference/membership、四类 provenance identity、canonical model-config/warnings/equal-effective-config。不得重做已通过方向，不安装 SDK、不选厂商、不写真实 provider runtime/Prisma migration、不启动第二次 iteration-coach。修复完成后必须产生新的 exact head 与完整 CI SUCCESS，再由项目负责人定向复审；新绿灯不覆盖旧 REQUEST_CHANGES。

三项修复已形成并通过：新增 deterministic semantic validator contract/reference/fixtures；拆分四类 provenance 并同步共享类型与 `04/05/07/09/10`；冻结 canonical model-config manifest/digest golden vector、sanitized warnings 与 equal-effective-config 判定。项目负责人已对 `77fb3a860ccd372f1fdc3465654f86d931688a89` / CI `31783061076` 正式 PASS；旧 REQUEST_CHANGES 不被覆盖。

## latest-main integration

- PR #51 accepted head `30975626f00be0526da2d17d200fd1744b9a721c` 已以 main merge SHA `6e546853672c687c70a4112bf07d1dfe1763c75f` 合入；main CI `31785578105` attempt 2 SUCCESS，attempt 1 ordinary Chromium unknown-project 时序 flake永久保留。
- 已证文件冲突仅 `docs/agent/01-requirement-traceability.md`、`docs/agent/04-review-report.md`、`docs/agent/handoffs/index.md`，均机械保全 DEV-008B1 与 SPEC-LLM-PROVIDER-001 双方事实。另发现 review ID 并行占用，按 canonical `REV-050`=DEV-008B1、`REV-051（branch-local REV-050）`=LLM 记录，不改 accepted LLM 技术契约。
- integration 本地全门禁：format/lint/typecheck/build/smoke PASS；unit 61 files / 372 tests、LLM 定向 10/10、fresh PostgreSQL 14 migrations deploy/status、integration 14 files / 84 tests、auth 4 files / 23 tests、ordinary Chromium 27/27、auth Chromium 5/5 均 PASS；`git diff --check` PASS。accepted LLM semantic validator/contract tests、`docs/contracts`、synthetic-v1、v2-draft、shared contract 与 package manifest/lockfile 相对 `77fb3a8` 无差异。
- 真实本地失败历史：第一次 migration 前的 PowerShell 空查询返回 `null`，导致新数据库未创建，migration 因目标库不存在退出；显式创建同一空库后，从 migration 开始单次全绿。首次 auth E2E 命令因新 shell 未注入 `TEST_DATABASE_URL` 在测试启动前退出；改用另一全新空库并显式注入后 5/5。两次均未修改产品代码、测试目标或共享数据。ordinary E2E 记录一次 Vite `/api/v1/auth/me` 启动窗口 `ECONNREFUSED`，27/27 仍通过，未重跑普通 E2E。
- integration exact head 与完整 CI SUCCESS 取得后只请求项目负责人做 main integration 冲突窄复审。PR #52 继续 OPEN/REVIEW/未合并；不提前联合收口。
