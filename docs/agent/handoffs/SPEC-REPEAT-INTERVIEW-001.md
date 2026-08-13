# SPEC-REPEAT-INTERVIEW-001 候选交接

## 状态与审查边界

- 状态：`REVIEW`；REV-048；non-Draft PR 与 exact-head CI 待补。
- 分支：`codex/spec-repeat-interview-001`；base `origin/main@2f29cc7ef66563aebd2cd3d293606a5de6c20ca6`。
- iteration-coach：复用总控已完成的唯一 `Correction / NO-PAUSE` 独立只读复核；本任务没有启动第二次。
- 本交接不是 PASS/DONE/merge；执行 Agent 只整理人工审查包。

## 已冻结

1. ordinary project authoritative repeat action 与 restricted/deleted/assignment fail-closed；
2. project next-session、session continue/review、global new-project 职责分离；
3. stable next-session request/payload/replay、same-project basis 与 seq1→2 并发门禁；
4. 新 session capture/audio/ASR/speaker/calibration/runtime 全隔离；
5. stable post-analysis trigger、Memory/actual-question 生产调用与内容无关 retry projection；
6. calibration-gate-terminal opening exact once、same-project eligible Context、降级 gate 不伪造当前角色、唯一 QuestionEvidence/current/history；
7. LLM/ASR unavailable 不阻塞 raw recording/completed/review；
8. 无 memory UI、第二 AI/history、Prisma/migration、provider 选择或隐私/删除/retention 语义变化。

## 基线缺口证据

- `MemoryService.extract`：仅定义与模块导出，无生产调用；
- `QuestionEvidenceService.reconcileActualQuestions`：仅定义，无生产调用；
- 当前 `createSession`：同 project 最大 sequence+1，但无 repeat intent/basis payload、非终态 fence或不同 request 并发 loser 契约；
- 当前 project read model：无 project-level next-session action；只有 session-level `primary_action`。

因此后续必须同时完成 B1/B2，不能用 UI 按钮宣称继承完成。

## 依赖与边界

- `DEV-008B1`、`DEV-008B2` 在本 SPEC 项目负责人 PASS/merge 前 BLOCKED；
- 两者还必须等待 DEV-008A4 / PR #44 新 exact-head PASS/merge，避免 Home/routes/styles/completion/review 冲突；
- B2 deterministic seam 可先验收工程链路；真实 LLM/provider 与真实试点门禁保持未完成；
- CON-023/DEV-008D 不变。

## 验证与人工审查重点

本地已通过：`pnpm lint`、全 workspace `pnpm typecheck`、`pnpm build`、`pnpm format:check`、contracts 定向 typecheck/build、full unit `56 files / 341 tests`、`git diff --check`，以及 changed Markdown 相对链接检查。未运行 PostgreSQL integration/auth/Chromium，因为本任务没有 runtime/Prisma/UI 改动；non-Draft PR exact-head CI 仍须跑仓库完整 verify，不能用本地结果替代。

项目负责人重点审查：action eligibility、seq1→2 并发、post-analysis 非阻塞、Context membership、opening exact once、provider unavailable、A4 分界与无范围扩张。
