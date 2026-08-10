# SPEC-QUESTION-JOURNEY-001 候选交接

## 状态

- 任务：`REVIEW`
- 分支：`codex/spec-question-journey-001`
- PR：待创建非 Draft PR 后补充
- exact head / CI：待最终推送与 GitHub CI 后补充
- 审查人：项目负责人在 GitHub 手动审查
- 限制：本交接不是 PASS；不得把 SPEC、ADR-030 或 CON-025 自行关闭，不得启动 DEV-007A/B。

## 本轮冻结

- 以 `rapport|life_outline|story_depth` 表达陌生关系下可保持、前进和退回的旅程，不以固定题数或固定时间硬切。
- `basic|deep` 题库是正常下一问的强制内容源；AI 只可逐字选择或基于可信事实轻度改写，不可自由编造。
- 内容负责人填写 UTF-8 CSV；系统全量校验、导入不可变 draft release，并原子 activate/retire。CSV 是交换/编辑格式，运行时数据库是权威事实。
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

- docs-only：`git diff --check`、Prettier、115 个 Markdown 文件相对链接、必需产物、REVIEW/BLOCKED 状态不变量、13 字段 CSV 与 3 条 synthetic fixture 门禁均通过。
- 仓库全量 CI 等价命令：format、lint、typecheck、unit 232、空库 11 migrations deploy/status、PostgreSQL integration 65、auth 13、build、smoke、Chromium E2E 9、auth Chromium E2E 4 均通过。
- 本地共享默认测试库已有与本分支无关的 failed migration 记录，未修改；本轮使用专用空库 `elder_interview_spec_qj_001_c06a` 从零验证。默认 Web 端口 4173 被既有进程占用，smoke/E2E 改用 4273/4274；auth API 保持仓库代理约定的 3101。
- GitHub CI：待 PR 创建后等待 exact final head 结果。

## 冲突与审查重点

- CON-025 保持 `OPEN`；本候选解决其中“问题旅程与内容来源”偏差，项目负责人 PASS 前不得标 RESOLVED。
- 请重点审查：三阶段是否足以指导首版但不形成硬切；CSV 最小字段和原子版本发布是否易于负责人维护；轻调边界与双重 provenance 是否足以阻止无依据编造；fixture/许可门禁能否阻止占位题进入正式试用；A/B 所有权是否保持 DEV-006/QuestionEvidence 单一事实源。
