# DEV-007B｜结构化访谈导演与工作台集成

## 基本信息

- 状态：`BLOCKED`
- 负责人：待分配
- 前置依赖：SPEC-QUESTION-DIRECTOR-001 项目负责人 PASS/merge、DEV-007A PASS、DEV-006 DONE、SPEC-AI-QUESTION-001 DONE
- 输入依据：`03` §9/§11、`04` §§4.36-4.39、`05` §3.9、`07` §§5-10、`09` §7.6-§7.7、ADR-027-031
- 交接对象：父 DEV-007、项目负责人 GitHub 审查

## 目标与范围

- 由确定性后端读取 DEV-006 current memory、可靠 actual asked、可信转录/角色/边界、current/recent displayed，以及 A 的 safe bank references/stage，冻结 `InterviewDirectorContextV1`；
- 用一次结构化模型调用返回一个问题或继续倾听；题库是 0..N 可选参考，允许广泛改写或完全不用；服务端验证 `InterviewDirectorOutputV1`、grounding、单问题、重复、风险与安全边界；
- 通过既有 QuestionEvidence writer 发布 candidate/current/history，接入既有 REST、无正文 WS 和工作台；
- 保留自动替换、manual next、历史锚点、displayed != actual asked、hard withdrawal 和失败降级。
- prompt 使用仓库内可编辑、不可变版本化 bundle；job 保存 prompt/context/output/context-builder/model-config 版本与 digest，不保存完整真实模型输入。

## 明确不做

- 不直写 QuestionEvidence 表或复制 repository/history；
- 不让模型直连数据库或决定读写范围，不以 basic 题做 AI unavailable 兜底，不引入第二 planner agent，不选择真实生产供应商；
- 不实现题库管理 UI、记忆 UI、向量库、自动传记或 deletion producer；
- 未导入负责人题库时仍可用虚构可信上下文验证自由生成工程链路，但不得宣称正式题库内容或问题质量已经可用。

## 验收

逐项通过 `09` §7.6 与 §7.7 中属于 B 的矩阵；必须证明无题库引用可合法生成、可选参考不冒充 grounding、具体事实前提有可信 ID、源事实只读、prompt/schema 版本可复盘，并通过现有响应式/无障碍/权限/失败门禁。项目负责人 exact-head PASS 前不得 DONE。
