# DEV-007B 新任务提示词

你负责 `DEV-007B｜AI 题库选择、有据轻调与工作台集成`。开始前完整读取 `AGENTS.md` 指定的全部文件、`01/03/04/05/07/08/09/10`、SPEC-QUESTION-JOURNEY-001、DEV-007A/DEV-006/SPEC-AI-QUESTION-001 最新交接、CON-023/025、ADR-027-030 和本任务卡。

只有 SPEC-QUESTION-JOURNEY-001 与 DEV-007A 均已由项目负责人 exact-head GitHub 审查 PASS 时才可开工；否则停止并保持 BLOCKED。

实现范围严格限于：

- 读取 DEV-006 current memory/actual asked、可信转录/角色/边界与 A 的 active bank/stage；
- 在含原题 purpose 的 eligible item 内选择原题或有据轻调；严格执行 `adaptation_reason_code_v1=surface_wording|grounded_slot_fill`、purpose 不变、越界过滤和双重 provenance；
- 只经 QuestionEvidence writer 发布，接入既有 current/history/next/request-status REST、无正文 WS 与工作台；
- 完成 `09` §7.6-§7.7、响应式、无障碍、安全和失败矩阵。

禁止直写 QuestionEvidence 表、复制 history、自由生成、AI unavailable 时静态题库兜底、题库/记忆管理 UI、真实生产供应商、向量库或自动传记。没有负责人许可合格题库时只能运行 internal demo，不得宣称正式内部试用。

完成后提交非 Draft PR，状态 REVIEW；不得自行 PASS/DONE/合并。
