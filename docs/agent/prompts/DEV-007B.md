# DEV-007B v2 新任务提示词

你负责 `DEV-007B｜结构化访谈导演与工作台集成`。开始前完整读取 `AGENTS.md` 指定的全部文件、`01/03/04/05/07/08/09/10`、SPEC-QUESTION-DIRECTOR-001、DEV-007A/DEV-006/SPEC-AI-QUESTION-001 最新交接、CON-023、ADR-027-031 和本任务卡。

只有 SPEC-QUESTION-DIRECTOR-001 与 DEV-007A 均已由项目负责人 exact-head GitHub 审查 PASS/merge 时才可开工；否则停止并保持 BLOCKED。PR #25 old head 只作 REQUEST_CHANGES 历史，不在旧白名单契约上继续补丁。

实现范围严格限于：

- 用确定性后端读取 DEV-006 current memory/actual asked、可信转录/角色/边界、current/recent displayed 与 A 的 safe bank references/stage，冻结 `InterviewDirectorContextV1`；
- 调用一次结构化模型，允许采用、广泛改写或完全不用题库；验证 `InterviewDirectorOutputV1`、单问题、grounding、重复、风险和安全边界；
- 增加仓库内可编辑、不可变版本化 prompt bundle，并记录 prompt/context/output/context-builder/model-config version+digest；
- 只经 QuestionEvidence writer 发布，接入既有 current/history/next/request-status REST、无正文 WS 与工作台；
- 完成 `09` §7.6-§7.7、响应式、无障碍、安全和失败矩阵。

禁止直写 QuestionEvidence 表、复制 history、让模型直连数据库或修改题库/转录/memory/actual asked/边界等源事实、AI unavailable 时静态题库兜底、题库/记忆管理 UI、第二 planner agent、真实生产供应商、向量库或自动传记。没有负责人题库时可做虚构 internal demo，但不得宣称正式内容或问题质量可用。

完成后提交非 Draft PR，状态 REVIEW；不得自行 PASS/DONE/合并。
