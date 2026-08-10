# SPEC-QUESTION-JOURNEY-001 最终交接

## 状态

- 任务：`DONE`
- 分支：`codex/spec-question-journey-001`
- PR：[非 Draft PR #23](https://github.com/Li-Ming-G/elder_interview_ai/pull/23)
- final head：`5963af98b4a807e5fa1d00ff33f8ef6b6a0e6323`
- exact-head CI：`31380903831`，completed / success
- merge：`f0bff3f029716804175000fab0d4441ec6585bf4`
- 首轮审查：REV-034；old exact head `0f3034d27975cd0695e9963d5e29535d7d574dda`、CI `31371643597` SUCCESS、正式 `REQUEST_CHANGES`（P0=0/P1=3）永久保留
- 审查人：项目负责人在 GitHub 手动审查
- 最终结论：项目负责人定向复审 `PASS`，P0/P1=0；ADR-030 Accepted、CON-025 RESOLVED、DEV-007A READY。DEV-007B 继续等待 A。

## 本轮冻结

- 以 `rapport|life_outline|story_depth` 表达陌生关系下可保持、前进和退回的旅程，不以固定题数或固定时间硬切。
- `basic|deep` 题库是正常下一问的强制内容源；AI 只可逐字选择或基于可信事实轻度改写，不可自由编造。
- 内容负责人填写 UTF-8 CSV；系统全量校验、导入不可变 draft release，并原子 activate/retire。CSV 是交换/编辑格式，运行时数据库是权威事实。
- CSV 固定 14 列并含必填受控 purpose；`question_condition_v1` 固定 applicable all-of/AND、inapplicable any-of/OR、排除优先，空值/未知/空 token/重复/跨字段同码均有明确严格行为，fixture 无宽松旁路。
- `journey_policy_v1` 冻结完整 reason-code 集、单一判定顺序与稳定输出；硬安全、保守安全、reluctance、退回和连续讲述先于可深入信号，不使用固定题数/时间。
- `adaptation_reason_code_v1=surface_wording|grounded_slot_fill`；candidate/snapshot 保持原题 purpose，slot fill 必须回链实际可信 transcript/memory。
- 每条候选保留题库原题/release 与支撑选择或轻调的 transcript/memory 双重 provenance。
- 未核验许可的外部内容不可激活；synthetic fixture 只用于 test/internal demo，正式内部试用前必须导入负责人题库。
- 保留 current 自动更新、manual next、只读 history 和 displayed != actual asked；题库不作为 AI unavailable 静态兜底。
- DEV-007 拆为 A（题库基础设施、版本、阶段和确定性选择 seam）与 B（AI 选择/有据轻调、QuestionEvidence 与工作台集成）。

## 修改清单

- 正式依据：`01/03/04/05/07/08/09/10`。
- 内容资产：`docs/question-bank/README.md`、空白导入模板、极少量 synthetic fixture。
- 治理：task board、traceability、CON-025、ADR-030 候选、handoff、iteration journal。
- 执行拆分：SPEC/DEV-007/DEV-007A/DEV-007B 任务卡与 A/B 启动提示词。
- 未修改：Prisma schema/migration、业务代码、`packages/contracts`、runtime API/WS contracts、页面和测试代码。

## 验证

- docs-only：`git diff --check`、Prettier、115 个 Markdown 文件相对链接、REVIEW/BLOCKED/OPEN 与 scope 状态不变量、14 字段 CSV、3 条 synthetic fixture 的 purpose/条件/许可门禁均通过。
- 仓库全量 CI 等价命令：format、lint、typecheck、unit retry 232、专用库 11 migrations deploy/status、PostgreSQL integration 65、auth 13、build、smoke、Chromium E2E 9、auth Chromium E2E 4 均通过。unit attempt 1 有 1 个既有工作台 1 秒异步时序波动（231/232），未改测试或业务代码，原样重跑全绿。
- 本地共享默认测试库已有与本分支无关的 failed migration 记录，未修改；本轮使用专用空库 `elder_interview_spec_qj_001_c06a` 从零验证。默认 Web 端口 4173 被既有进程占用，smoke/E2E 改用 4273/4274；auth API 保持仓库代理约定的 3101。
- GitHub CI：旧 head `0f3034d` 的 `31371643597` SUCCESS 与 REQUEST_CHANGES 永久保留；final head `5963af98` 的 `31380903831` SUCCESS 已绑定最终 PASS。

## 冲突与审查重点

- CON-025 已按项目负责人 final-head PASS 转为 `RESOLVED`；后续若出现新的产品偏差，另建冲突，不复开本条。
- 三项 P1 已由项目负责人定向复审确认 3/3 CLOSED。
- 请重点定向复审：条件 AND/OR 与全部非法输入是否无歧义；journey reason/优先级/转移是否确定且保守优先；purpose 是否贯穿 14 列、item/reader/candidate/snapshot；两类 adaptation reason 是否足以约束 DEV-007B。
