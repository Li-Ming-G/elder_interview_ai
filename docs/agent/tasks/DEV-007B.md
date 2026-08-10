# DEV-007B｜AI 题库选择、有据轻调与工作台集成

## 基本信息

- 状态：`BLOCKED`
- 负责人：待分配
- 前置依赖：SPEC-QUESTION-JOURNEY-001 PASS、DEV-007A PASS、DEV-006 DONE、SPEC-AI-QUESTION-001 DONE
- 输入依据：`03` §9/§11、`04` §§4.36-4.39、`05` §3.9、`07` §§5-10、`09` §7.6-§7.7、ADR-027-030
- 交接对象：父 DEV-007、项目负责人 GitHub 审查

## 目标与范围

- 读取 DEV-006 current memory、可靠 actual asked、可信转录/角色/边界，以及 A 的 active bank/stage；
- 只在 eligible item 集合内选择 `verbatim|lightly_adapted`，执行轻调越界过滤与双重 provenance；
- 通过既有 QuestionEvidence writer 发布 candidate/current/history，接入既有 REST、无正文 WS 和工作台；
- 保留自动替换、manual next、历史锚点、displayed != actual asked、hard withdrawal 和失败降级。

## 明确不做

- 不直写 QuestionEvidence 表或复制 repository/history；
- 不自由生成、不以 basic 题做 AI unavailable 兜底、不选择真实生产供应商；
- 不实现题库管理 UI、记忆 UI、向量库、自动传记或 deletion producer；
- 未导入负责人题库时只允许 internal demo，不得宣称正式内部试用。

## 验收

逐项通过 `09` §7.6 与 §7.7 中属于 B 的矩阵，以及现有响应式/无障碍/权限/失败门禁。项目负责人 exact-head PASS 前不得 DONE。
