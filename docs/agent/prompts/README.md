# 新任务对话提示词

本目录保存已经由总控冻结、可复制到 Codex 新任务对话中的讨论或实现启动提示词。讨论提示词只形成候选决定包，实现提示词只在讨论门槛通过后下发；任务状态仍以 `../00-task-board.md` 为准，详细边界仍以对应 `../tasks/` 任务卡和正式 `00` 至 `10` 为准。

- 新任务开始前必须核对提示词引用的前置任务仍然有效；
- 提示词不能替代正式需求、技术规范、最新交接或 GitHub 审查；
- 实现任务不得自行把 `READY/REVIEW` 改为 `DONE`；
- 提示词过期时由总控更新，不在实现过程中静默扩大范围。

## 当前可下发

- [`SPEC-AI-QUESTION-001.md`](SPEC-AI-QUESTION-001.md)：自动最佳问题、手动“下一个问题”、展示历史导航与安全投影契约；只修改正式契约和任务治理，不实现代码。

## 历史提示词

- [`DISC-AI-QUESTION-001.md`](DISC-AI-QUESTION-001.md)：原单问题/一层撤销讨论提示词；项目负责人已暂停该框架并直接以 ADR-028 完成产品定稿，不得再次下发。
- [`SPEC-DEV-006.md`](SPEC-DEV-006.md)：后台 current memory、问题证据、跨会话 consumer、actual asked 与过程记录契约；REV-031 PASS/DONE。
- [`DISC-006.md`](DISC-006.md)：结构化长期记忆产品行为讨论；已定稿并写回 ADR-026，CON-024 已解决。
- [`DISC-005D.md`](DISC-005D.md)：安全结束页产品体验讨论，已由后续首次访谈重构收口。
- [`DEV-005D.md`](DEV-005D.md)：旧安全结束页薄集成提示词；任务已取消并由 DEV-005R3 取代。
- [`DEV-005A.md`](DEV-005A.md)：准备页与正式路由外壳，任务已完成，仅保留追溯用途。
- [`DEV-005B.md`](DEV-005B.md)：转录优先访谈工作台，REV-018 PASS/DONE；保留 impeccable 与真实浏览器验收要求供追溯。
- [`DEV-005C.md`](DEV-005C.md)：服务端会话安全结束编排，REV-019 PASS/DONE；保留三轮审查与修复边界供追溯。
- [`DEV-005R1.md`](DEV-005R1.md)：服务端 atomic start、capture generation 与中断/恢复生命周期。
- [`DEV-005R2C.md`](DEV-005R2C.md)：可并行的纯浏览器采集/归档核心，禁止改共享 DTO 和正式路由。
- [`DEV-005R2.md`](DEV-005R2.md)：R1/R2C PASS 后的正式 controller/API 集成。
- [`DEV-005R3.md`](DEV-005R3.md)：使用 impeccable 的工作台恢复与安全结束体验。
- [`DEV-005R4.md`](DEV-005R4.md)：真实 Chromium 虚构内容纵向验收与收口。
