# DEV-007A｜题库基础设施、旅程阶段与确定性选择 seam

## 基本信息

- 状态：`BLOCKED`
- 负责人：待分配
- 前置依赖：SPEC-QUESTION-JOURNEY-001 项目负责人 GitHub PASS
- 输入依据：`04` §4.35A-4.35B、`05` §3.9.0、`07` §10、`09` §7.7、ADR-030 候选
- 交接对象：DEV-007B、项目负责人 GitHub 审查

## 目标与范围

- 实现 CSV validator、原子 draft import、不可变版本、activate/retire、来源/许可与 fixture 环境门禁；
- 实现 `QuestionBankImportService/QuestionBankReader/QuestionJourneyService` 和 deterministic selector/fake；
- 持久化 release/item 与阶段判定所需事实，提供稳定 service seam；
- 用极少量 synthetic fixture 覆盖 import/license/stage/selection 反例。

## 明确不做

- 不调用 LLM，不生成最终问题正文，不发布 candidate/snapshot，不修改工作台；
- 不实现题库管理 UI、普通公网导入 API、真实供应商、自由生成或第二套 question history；
- 不把 internal demo 当正式内部试用。

## 验收

逐项通过 `09` §7.7 中属于 A 的矩阵，并提交 migration/unit/PostgreSQL/auth/CLI 或管理入口、fixture 隔离和全量 CI 证据。项目负责人 exact-head PASS 前不得 DONE；A PASS 前 B 保持 BLOCKED。
