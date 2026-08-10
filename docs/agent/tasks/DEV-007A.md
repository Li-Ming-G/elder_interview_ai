# DEV-007A｜题库基础设施、旅程阶段与确定性选择 seam

## 基本信息

- 状态：`BLOCKED`
- 负责人：待分配
- 前置依赖：SPEC-QUESTION-JOURNEY-001 项目负责人 GitHub PASS
- 输入依据：`04` §4.35A-4.35B、`05` §3.9.0、`07` §10、`09` §7.7、ADR-030 候选
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
