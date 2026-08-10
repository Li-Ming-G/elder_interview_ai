# DEV-007B 实现交接

## 状态与审查

- 状态：`REVIEW`，不得由实现 Agent 自行改为 `PASS/DONE`，不得合并。
- 分支：`codex/dev-007b-interview-engine`
- base：`e8f3055d757426da063d4216ffb4d789dbc56c14`
- PR：[GitHub PR #25](https://github.com/Li-Ming-G/elder_interview_ai/pull/25)，非 Draft。
- 可审计拆分：服务端/数据/API/WS `ddb24e2`；工作台薄集成 `0c8580b`；history anchor 恢复契约补齐 `3f0e62c`；治理记录另行提交。
- 独立复核：iteration-coach 要求的独立只读复核恰好执行一次。结论为 Correction mode：正式契约足够实现，无需暂停；采用“服务端事实链”和“UI 薄集成”分提交，便于项目负责人逐层审查。

## 实现范围

### 数据与唯一所有权

- migration `20260810223000_dev007b_question_presentation` 为既有 `question_generation_attempt`、`question_candidate`、`question_display_snapshot` 增补 source bank、purpose、selection/adaptation、journey policy/basis provenance；数据库约束和 deferred trigger 防止 candidate/snapshot provenance 漂移。
- `QuestionPresentationService` 实现既有 `QuestionEvidenceWriter`，generation、candidate、display snapshot/state/event、automatic replacement、manual next、current/history 全部经唯一 QuestionEvidence owner 写入；未建立第二套 question history。
- displayed snapshot 不写 actual-question；integration 明确验证展示后 `ActualAskedReader` 仍为空。

### 选择、轻调与证据

- 编排只消费 DEV-007A `QuestionBankReader.listEligible`、`QuestionJourneyService.evaluate`，以及 DEV-006 `CurrentMemoryReader`、可信 final transcript freeze、`ActualAskedReader`。
- local/test deterministic director 只返回 eligible bank item：默认 verbatim；仅允许冻结的 `surface_wording` 变换或 `grounded_slot_fill`。生产 director 明确 unavailable，不接真实 LLM/embedding。
- writer 在 commit 前重验 active/enabled/source/license、source item/version/bank、purpose、selection/adaptation、recent/current similarity、frozen dependency membership；grounded slot 值必须能在 current memory 或可信 transcript dependency 中证明。
- 无 eligible 成功发布 `continue_listening`；AI/provider unavailable 发布 `unavailable`；release/policy/权限/授权/boundary/deletion/retention 无法证明时 fail closed，不把基础题库当静态兜底，不影响录音或转录。

### 并发、幂等与传输

- manual next 使用 stable request ID、expected revision/snapshot、request→project→session advisory lock、manual intent fence、同 session admission/single-flight、3 秒与 60 秒 6 次节流；首次 429 拒绝按 request ID 持久化并返回可重复 `Retry-After`。
- automatic 使用 final transcript notification、1500ms debounce、稳定 trigger UUID、20 秒间隔、15 秒 dwell、0.12 score delta、basis CAS 与 manual fence；旧结果不能 last-writer-wins。
- canonical REST：current、history page、`history/:snapshotId` 只读锚点恢复、manual next、request status；history item 带签名的 older/newer cursor，清理或不可安全定位返回 410 `SUGGESTION_HISTORY_ITEM_UNAVAILABLE`；WebSocket 1.2 仅发布无问题正文的 `suggestion.presentation.changed` revision notification，客户端收到后重新 GET current。

### 工作台与可访问性

- 工作台问题区为单个当前问题与原因；当前态为“上一个问题 / 下一个问题”，历史态为“更早的问题 / 更新的问题 / 回到当前问题”。历史浏览只读，不创建 job/attempt/event，不改变 current、排除集或 actual asked。
- history 浏览时收到新 revision 只播报“当前问题已更新”，不跳回 current、不移动焦点；手动请求 ID 在首个网络请求前写入 `sessionStorage`，响应未知复用原 ID。
- impeccable 仅影响信息层级、交互、触控、可访问性和视觉质量，未改变正式产品语义。移动端隐藏次要原因以维持固定 120px 问题区，按钮最小 44px。

## 验证证据

- 13 migrations 在独立空 PostgreSQL 数据库 `elder_interview_dev007b` 从零部署成功。
- `pnpm test:unit`：41 files / 279 tests PASS。
- `pnpm test:integration`：13 files / 74 tests PASS；DEV-007B 定向 1/1、DEV-006/QuestionEvidence 回归 8/8。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm format:check`、`git diff --check` PASS。
- 首次全量 integration 复用了已有 fixture 的数据库，DEV-007A 固定 bank version 命中 `QUESTION_BANK_VERSION_EXISTS`，73/74 通过；未重置该库。随后创建全新隔离库 `elder_interview_dev007b_final`，从零部署全部 13 migrations 并完整重跑 74/74 PASS。
- 通用 Chromium E2E 9/9 PASS。PR 首个 exact-head CI `31411505196` 的前置门禁全部通过，但旧 workbench harness 未处理新增 canonical current GET，导致 E2E 6/9；随后只补齐该只读 mock，并把旧 `.suggestion-seam` 尺寸断言切到正式 `.suggestion-panel` 与 390px/120px 窄范围，本地完整复跑 9/9。该失败 run 永久保留，最终结论只采用后续 exact head CI。
- Chromium CLI：1440×900、390×844、320×568；current/history/focus 共 5 张截图，页面横向与纵向 overflow 均为 0；当前态/历史态按钮高度均为 44px；320px 历史三按钮宽约 98.7px 并完整可见；Tab 可聚焦“更新的问题”且 `:focus-visible=true`。
- 本地截图位于 `output/playwright/dev007b-*.png`（按仓库规则忽略，不进入产品包）。浏览器控制台仅有既有 `/favicon.ico` 404，无应用异常。

## fixture、真实题库与未实现边界

- 浏览器 harness 与 PostgreSQL 测试均明确标注 `SYNTHETIC FIXTURE · NOT PRODUCT CONTENT`；只证明 local/test internal demo 工程链路。
- 项目负责人正式 14 列题库尚未提供。因此本 PR 不构成正式产品内容、正式内部试用、题库许可/质量或 AI 质量验收。
- 未实现真实 LLM/embedding、完整回顾、导出、删除 producer、生产部署；未修改 DEV-007A release membership/许可所有权，未修改 DEV-006 数据所有权。
- CON-023 必须保持 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`；当前 local/test deletion fixture 只用于反例，生产缺权威 reader 时失败关闭。

## 项目负责人手动审查重点

1. migration trigger/约束是否足以保证 source bank 与 snapshot provenance 不漂移，且不改变 DEV-007A/DEV-006 所有权。
2. surface wording 白名单和 grounded slot 值级证明是否严格保持原 purpose/单一意图，没有自由生成路径。
3. hard withdrawal 在 current/history/replay 上是否一致中性投影，解除边界后是否保持不自动恢复。
4. manual admission、数据库锁、stable 429、request replay、automatic/manual fence 是否满足并发和幂等契约。
5. WS 是否始终无正文，REST 是否为唯一 canonical 正文读取面，history GET 是否无写副作用。
6. 工作台 320/390/desktop 的信息层级、44px 目标、焦点不抢占和 fixture 标识是否可接受。
