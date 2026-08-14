# SPEC-REPEAT-INTERVIEW-001｜同项目连续访谈契约

## 基本信息

- 状态：`DONE`
- 负责人：独立 docs-only 契约任务 `codex/spec-repeat-interview-001`
- 基线：`origin/main@2f29cc7ef66563aebd2cd3d293606a5de6c20ca6`
- 审查：`REV-048`；non-Draft [PR #46](https://github.com/Li-Ming-G/elder_interview_ai/pull/46) accepted exact head `8d4a26263db7b75dd22469f767240d705d3ce5fe` / CI `31715348528` 获项目负责人 GitHub 手动审查 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/46#issuecomment-5287945749)，P0/P1=0；merge `54fb814e44ab2a405f78133e480d467577dbc7b8` / main CI `31757442056` SUCCESS
- 前置决定：项目负责人已明确首版响应式网页方向并授权真实可重复使用流程；不得重开战略方向
- iteration-coach：总控已对本轮执行恰好一次独立只读复核，结论 `Correction / NO-PAUSE`；本任务复用该结论，未启动第二次复核
- 依赖边界：DEV-008A4 / PR #44 已在 exact head `3824da7` PASS 并 merge `175e92e`；本 SPEC 已 exact-head PASS/merge，DEV-008B1/B2 机械转为 `READY`，但 runtime 仍未实现，且不得改 A4 runtime/UI

## 用户结果

第一次访谈结束后，倾听员在同一 project 卡点击“开始下一次访谈”，得到该 project 下新的 sequence session；每次录音、转录、校准、收尾和回顾独立，但第二次开场可消费此前 eligible current memory、published reliable actual asked、安全边界与可信 membership。AI/provider 不可用不阻塞创建、录音或回顾。

## 契约范围

1. ordinary project additive `repeat_interview` 权威动作；缺字段/null/restricted/deleted/assignment invalid 失败关闭，前端不猜 status；
2. project 卡 next-session、session 行 continue/review、全局 new-project 三类动作严格分离；
3. `POST /projects/:id/next-session` 稳定 request ID/canonical payload/replay、project 锁和 seq1→2 并发门禁；只创建新 session；
4. 新 session 重检 actor/assignment/consent/device/mic，建立全新 capture/audio/ASR/speaker/calibration runtime；
5. canonical completed 的稳定 post-analysis trigger 接通既有 `MemoryService.extract` 与 `QuestionEvidenceService.reconcileActualQuestions`；失败不回退 completed；
6. calibration gate terminal 只进入 waiting/ready 协调；basis session 的 memory/actual 两 lane 均 terminal 后才冻结 Context并稳定触发一次 `second_session_opening`；降级 lane/gate 诚实且不伪造当前角色；唯一 QuestionEvidence owner/current/history；displayed != actual asked；
7. 无记忆管理/摘要待确认 UI，无第二 AI/history，无真实 provider 选择，无 Prisma/migration/runtime 实现；
8. 权限、deletion、retention、membership/revision drift 和 provider unavailable 全部诚实失败关闭。

## Shared contract 接缝

- `RepeatInterviewProjectActionProjection`
- `CreateNextSessionRequest/Response`
- `PostSessionAnalysisProjection` 与 lane 状态
- `SecondSessionOpeningProjection` 的 waiting/ready/terminal 内容无关状态
- `ProjectListOrdinaryProjection.repeat_interview?`、`ProjectSessionListItem.post_session_analysis?`、`second_session_opening?` 仅为 contract-first rollout optional；缺失不得被解释为 eligible/succeeded/已触发。DEV-008B1/B2 runtime 接入时必须显式投影并补 mapper/API/browser tests。

## 明确现状与禁止声明

基线代码中 `MemoryService.extract` 和 `QuestionEvidenceService.reconcileActualQuestions` 没有生产调用者。当前 `session.create` 只按 project 最大 sequence 加一，也没有 repeat workflow/basis identity/并发 loser 契约。因此本 SPEC 或后续单独 UI 按钮均不能宣称跨访谈继承已经完成。

## 验收

- `09` §17 全矩阵被冻结；本任务只验证文档一致性、shared contract typecheck/build、format/lint/diff/link/命名证据；
- 不修改业务实现、Prisma/migration、页面/routes/styles、A4 completion/review/unknown-response、真实模型/provider；
- non-Draft PR exact head CI 全绿并取得项目负责人 PASS 后才可合并；本任务已满足该门禁并完成治理收口。

## 项目负责人审查重点

1. project/action/session 三层职责和 fail-closed eligibility 是否足够明确；
2. next-session 并发是否只能产生 seq2，且不会误建新 project/seq3；
3. post-analysis failure 是否与 completed/raw recording/review/next-session 完全解耦；
4. opening membership 是否只消费 same-project eligible current/published facts，并维持 displayed != actual asked；
5. 无新 memory UI、AI/history、DB ownership、privacy/deletion/retention 语义或个人身份硬编码；
6. 与 DEV-008A4/PR #44 的 exact-head PASS/merge 依赖是否阻止 Home/routes/styles 冲突。

## REV-048 首轮审查与定向修复

- 项目负责人代审严格绑定 old exact head `99e5d317f4e5ad62444148442329114840c58293`、CI `31709711887` SUCCESS，正式结论 `REQUEST_CHANGES`，P0=0/P1=1；[评论](https://github.com/Li-Ming-G/elder_interview_ai/pull/46#issuecomment-5281848055)。该 old-head 结论永久保留。
- 唯一 P1：calibration gate 可能在 basis post-analysis pending/running 时抢跑并消费 exact-once opening，导致之后成功的 memory/actual 输出永久缺席第二次开场。
- 定向修复：next-session/mic/recording/ASR/review 继续不等 AI；opening 在两 lane terminal 前只派生 waiting 且不创建 job/attempt/Context；两 lane terminal 后用 basis analysis trigger + calibration gate stable identity 至多一次冻结/触发；`unjudged|failed|cancelled|unavailable` 明确为诚实 terminal；`09` §17 增加 analysis-first/calibration-first/单 lane 降级/刷新重放并发矩阵。
- 定向复审严格绑定 accepted exact head `8d4a26263db7b75dd22469f767240d705d3ce5fe` / CI `31715348528` SUCCESS；项目负责人正式 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/46#issuecomment-5287945749)，P0/P1=0。定向修复关闭唯一 P1，old REQUEST_CHANGES 历史不被覆盖。

## 最终验收与接收

- accepted exact head `8d4a26263db7b75dd22469f767240d705d3ce5fe`，tree `a9df0737de73602c25c6384da2acdd13e449c037`；exact-head CI [31715348528](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31715348528) completed / SUCCESS，覆盖 format/lint/typecheck/build、unit、fresh PostgreSQL migration deploy/status、integration、auth、smoke、ordinary Chromium 与 auth Chromium。
- 项目负责人正式手动审查结论为 PASS，P0/P1=0；PR #46 以 merge commit `54fb814e44ab2a405f78133e480d467577dbc7b8` 合入 `main`，main CI [31757442056](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31757442056) completed / SUCCESS，verify 3m30s。
- merge commit parents 精确为 prior main `869556a2ae6616a3a236251371054fd28bee7059` 与 accepted head `8d4a26263db7b75dd22469f767240d705d3ce5fe`，merge tree 与 accepted head tree 相同。
- DEV-008A4 / PR #44 accepted exact head `3824da7c48f9f63b4ca71b0fb56f459d8c24fa7d` / CI `31711325876` 已获项目负责人 PASS（P0/P1/P2=0），merge `175e92e3bda76f4b180e85519e3bf8e62c356311` / main CI `31712044809` SUCCESS。A4 与本 SPEC 依赖均已关闭；B1/B2 已机械转为 `READY`。
- 本任务仅冻结 docs/shared-contract 契约；DEV-008B1/B2 现为 `READY` 但尚未实现。真实 LLM/provider、privacy/deletion/retention、DEV-008D/CON-023 与真实试点不由本结论完成。
