# SPEC-QUESTION-JOURNEY-001｜陌生访谈旅程、双题库与有据轻调契约

## 基本信息

- 状态：`DONE`
- 负责人：专项契约 Agent（分支 `codex/spec-question-journey-001`）
- 前置依赖：DEV-006 DONE、SPEC-AI-QUESTION-001 DONE、CON-025 产品方向已由项目负责人确认
- 输入依据：`01/03/04/05/07/08/09/10`、ADR-026/027/028/029、CON-025、DEV-006 与 SPEC-AI-QUESTION-001 任务卡/交接
- 输出：正式规范、CSV 模板与虚构 fixture、ADR-030 候选、DEV-007A/B 任务拆分、治理与 journal 更新
- 交接对象：项目负责人 GitHub 手动审查、DEV-007A/B

## 目标

冻结陌生倾听员与长者从破冰、生平轮廓到故事深入的可进可退旅程，并把 `basic|deep` 题库升级为第一版正常问题生成的强制内容源。AI 只能选择原题或基于可信转录/DEV-006 current memory 做有据轻调，不得自由编造。

## 必须冻结

1. `rapport|life_outline|story_depth` 的状态、进入/保持/退回信号、reason code 与可复盘输入；固定题数/时间不得单独推进。
2. UTF-8 CSV 交换模板与运行时数据库事实分层；内容负责人不直接编辑数据库。
3. 最小 14 字段（含必填受控 purpose）、`question_condition_v1` 的 AND/OR/排除优先与非法输入行为、全量校验、不可变 bank version、draft/active/retired 和原子激活。
4. `project_original|verified|unverified|fixture_only` 的许可门禁；公开可访问不等于可复制/改写/导入。
5. `verbatim|lightly_adapted`、`adaptation_reason_code_v1`、purpose 保持的允许/禁止边界，以及题库原题与 transcript/memory 的双重 provenance。
6. 阶段变化与既有 selection score/自动替换的最小兼容规则；保留 current/history/manual-next/displayed != actual asked。
7. AI unavailable、无 eligible item、policy/license unavailable 的不同降级；均不自由生成。
8. DEV-007A/B 所有权、依赖和验收边界。
9. `journey_policy_v1` 的完整 reason code、保守信号优先级、单一决定分支和稳定转移输出。

## 明确不做

- 不修改 Prisma、业务代码、`packages/contracts` 等 runtime contracts、页面或测试实现；
- 不选择真实 LLM/embedding 供应商，不建设向量库、题库管理后台或自由生成兜底；
- 不推翻 DEV-006 provenance/retention/QuestionEvidence 基础，不另建 question history；
- 不把 fixture 或未知许可内容当产品题库，不自行关闭 CON-025。

## 验收

- `01/03/04/05/07/08/09/10`、任务板、追踪、CON-025、ADR、handoff、journal 与模板一致；
- docs-only 检查和仓库全量 CI 通过；
- 创建非 Draft PR，状态保持 `REVIEW`；
- 只有项目负责人对 exact final head 的 GitHub 手动审查明确 PASS 后才能转 `DONE`、更新 ADR/CON 状态并解锁 DEV-007A；本 Agent 不得自行 PASS/DONE/合并。

## iteration-coach 复核

- 初始候选曾执行一次独立只读复核；本次 P1 定向修复又按重大迭代要求恰好执行一次独立只读复核，主模式 `Learning mode`；
- 本次已吸收严格拒绝歧义条件、固定优先级单一 journey 决策、purpose 贯穿与两值 adaptation reason 的修正；
- 复核不替代项目负责人最终审查。
