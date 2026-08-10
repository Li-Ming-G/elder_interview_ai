# DEV-007A｜题库基础设施、旅程阶段与确定性选择 seam

## 基本信息

- 状态：`REVIEW`
- 负责人：Codex DEV-007A Agent
- 前置依赖：SPEC-QUESTION-JOURNEY-001 项目负责人 GitHub PASS
- 输入依据：`04` §4.35A-4.35B、`05` §3.9.0、`07` §10、`09` §7.7、ADR-030 Accepted
- 交接对象：DEV-007B、项目负责人 GitHub 审查

## 目标与范围

- 实现固定 14 列 CSV validator、原子 draft import、不可变版本、activate/retire、来源/许可与 fixture 环境门禁；purpose 必填且只接受既有 11 值；
- 实现 `question_condition_v1` 的 applicable all-of/AND、inapplicable any-of/OR、排除优先，以及空值/未知/空 token/重复/跨字段交集的严格行为；fixture 使用同一 validator；
- 实现 `QuestionBankImportService/QuestionBankReader/QuestionJourneyService` 和 deterministic selector/fake；reader 必须投影 purpose，journey 必须按 `journey_policy_v1` 固定优先级输出稳定 stage/reason codes/basis hash；
- 持久化 release/item 与阶段判定所需事实，提供稳定 service seam；
- 用极少量 synthetic fixture 覆盖 import/license/stage/selection 反例。

## 明确不做

- 不调用 LLM，不生成最终问题正文，不发布 candidate/snapshot，不修改工作台；
- 不实现题库管理 UI、普通公网导入 API、真实供应商、自由生成或第二套 question history；
- 不把 internal demo 当正式内部试用。

## 验收

逐项通过 `09` §7.7 中属于 A 的矩阵，特别覆盖条件真值表、所有非法条件、purpose、journey 各分支/信号冲突/顺序置换/重复执行，并提交 migration/unit/PostgreSQL/auth/CLI 或管理入口、fixture 隔离和全量 CI 证据。项目负责人 exact-head PASS 前不得 DONE；A PASS 前 B 保持 BLOCKED。

## 实现候选（2026-08-10）

- 基线：`origin/main@12021408242baeac99fdc89e00992bfdb0f14f1c`；分支：`codex/dev-007a-question-bank`；非 Draft [PR #24](https://github.com/Li-Ming-G/elder_interview_ai/pull/24)。
- 已实现 release/item migration、14 列 validator、受控 CLI、draft import、原子 activate/retire、active reader、`question_condition_v1`、`journey_policy_v1` 与 deterministic test selector。
- 既有 `docs/question-bank/question-bank-internal-demo.fixture.csv` 只用于 internal demo；项目负责人正式题库未提供，不阻塞 A 的基础设施审查，但阻塞任何产品内容可用或正式内部试用声明。
- 本地门禁：format/lint/typecheck/build、261 unit、12 migrations 空库 deploy/status、71 PostgreSQL integration、18 auth、smoke、9 Chromium E2E、4 real Web/API auth E2E 均通过。任务保持 REVIEW，等待 exact-head GitHub CI 与项目负责人手动审查。
