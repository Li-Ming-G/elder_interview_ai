# SPEC-AI-QUESTION-001 交接

## 基本信息

- 任务：SPEC-AI-QUESTION-001｜单问题自动更新、手动下一问与展示历史契约
- 状态：REVIEW
- 分支：`codex/spec-ai-question-001`
- 基线：`main@1d2b4daf207f21d25ab8df4d1f5d9b1f22ced299`
- PR：待创建非 Draft PR；exact final head/CI 由 PR Checks 与源总控任务消息绑定，避免提交自引用
- 审查权：仅项目负责人可在 GitHub 对 exact final head 给出 PASS；执行 Agent 不自验关闭、不合并

## 契约候选

- 权威发布：`presentation_revision` 裁决 canonical current CAS，`display_sequence` 给不可变展示历史严格总序，`manual_intent_sequence` 阻止旧 automatic 结果覆盖新手动意图；
- 自动替换：内部 `question-select-v1` 默认最小分差 0.12、current dwell 15 秒、debounce 1500 ms，全部配置化并随事实记录版本；模型 confidence 不作为公共产品事实；
- 手动下一问：绑定 actor/session/expected revision/snapshot/stable request ID，同 session 单飞，默认 3 秒最短间隔、60 秒最多 6 次、8 秒 deadline；未知响应重放同 ID，不回退基础题、不无限重试；
- 排除与相似度：按硬安全、current、最近 20 个 displayed、可靠 actual-question catalog、current memory/人工 boundary、attempt 内去重的顺序处理；`question-sim-v1` 默认阈值 0.88，不选择真实 matcher/model 供应商；
- 展示历史：签名不透明 cursor 绑定 session/方向/锚点/page/filter，按 `(display_sequence,snapshot_id)` 稳定分页；anchor 刷新恢复，浏览状态仅在客户端且零业务副作用；
- API/实时：REST current/history/anchor/next/request-status 是正文权威面；WS 1.2 `suggestion.presentation.changed` 仅含 revision/kind/snapshot/change kind，收到后重新拉取安全 REST；
- 事实与安全：`manual_next_requested` 只证明接受，只有 `manual_next_committed` 可支撑 `explicitly_replaced`；displayed 不等于 actual asked。硬边界在 current/history/anchor/replay 一致撤下正文且不自动替代/恢复；
- 所有权：`QuestionEvidenceModule` 继续单一拥有 generation/display/actual-question 证据，DEV-007 只通过 seam 编排；不改变 ADR-027/028、三类 retention root、derived-output cardinality 或 CON-023 状态。

## 修改范围

- 正式规范：`03`、`04`、`05`、`07`、`08`、`09`、`10`；
- 治理：任务板、追踪矩阵、CON-018、ADR-029、任务卡、本交接、当前交接索引与 iteration journal；
- 未修改业务代码、Prisma schema/migration、页面、测试实现或真实模型调用。

## 验证与独立复核

- iteration-coach 恰好一次独立只读复核：Learning mode；重点发现 publication 顺序、manual intent fence、稳定 cursor/CAS、requested 与 committed 分离、无正文 WS 和历史浏览焦点风险，均已吸收；
- 本地通过：`git diff --check`、15 个受影响 Markdown 文件相对链接检查、ADR/CON/任务引用检查、`pnpm format:check`、lint、typecheck、build、unit 225/225、PostgreSQL integration 57/57、auth 13/13、migration deploy/status、Web/API/PostgreSQL smoke、Chromium 9/9、真实 Web/API auth Chromium 4/4；
- 本机 4173 被 `C:\Users\TR\Documents\elder_interview_ai` 的 Vite 进程占用，未终止不属于本 worktree 的进程。smoke、普通 Chromium 和 auth Chromium 只在内存/临时未提交 config 中改用 4175，逻辑与原门禁相同；GitHub 隔离环境仍执行仓库原始 4173 命令；
- exact-head CI 结果在 PR checks 完成后由交接消息绑定；本文件不写自引用 commit；
- `09` §7.6 已列自动/手动竞态、幂等、相似度 fixture、历史零副作用、hard withdrawal、REST/WS、错误与 1440/390/320 无障碍矩阵。

## 风险与未决项

- 当前状态仅 REVIEW。项目负责人尚未对 exact final head/CI 给出 GitHub 手动审查结论；不得标记 PASS/DONE 或合并；
- CON-018 在项目负责人 PASS 前继续 OPEN，DEV-007 继续 BLOCKED；
- CON-023 deletion runtime 仍 `NOT IMPLEMENTED / NOT VERIFIED`，本任务只保留失败关闭契约，没有伪造 producer/read model；
- 真实 LLM/embedding、固定供应商、试点质量门槛、生产部署和页面实现均未授权；默认阈值需在 DEV-007 内部虚构/脱敏 fixture 上校准，不能被解释为生产质量承诺。

## 下一位必须先读取

`AGENTS.md`、根目录 `00-10`、本交接、SPEC-AI-QUESTION-001/DEV-007 任务卡、ADR-027/028/029、CON-018/023，以及非 Draft PR 的 exact final head checks 和项目负责人 GitHub review。
