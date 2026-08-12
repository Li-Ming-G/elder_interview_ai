# SPEC-DEV-008A 交接｜倾听员网页工作区、最小回顾与本机副本

## 基本信息

- 状态：`DONE`
- base：`origin/main@a349f8947eabe2eb5444ed2cf3c20e386c75bdb5`
- branch：`codex/spec-dev-008a-listener-workspace`
- PR：[PR #31](https://github.com/Li-Ming-G/elder_interview_ai/pull/31)，final head `0308aa9ef37be457aa41f23ea6113666ff2c1f97` / CI `31573583324` PASS；merge `91e5e7ed042f598359827ae63daf464e12e2ef76` / main CI `31573985661` SUCCESS
- 审查：项目负责人明确授权总控手动定向复审，P0/P1=0；正式记录见 [issuecomment-5263644971](https://github.com/Li-Ming-G/elder_interview_ai/pull/31#issuecomment-5263644971)

## 已完成

- 将历史 DEV-008 拆为 SPEC-DEV-008A、父 DEV-008A、A1/A2/A3 与独立 DEV-008D；
- 冻结统一 authenticated home/app shell、新建访谈完整授权入口、最小回顾和响应式视觉一致性；
- 冻结 assignment-safe `GET /projects/:id/sessions` 最小 read model；
- 冻结本机 archive 播放、容量/缺失投影、capture 共锁、fresh preflight、单事务 current+legacy 清理、最小回执和测试矩阵；
- 明确倾听员不导出、local deletion≠server deletion、DEV-007 不作前置、网页不做 PWA/App/封装；
- 新增正式 `local-audio-archive-v1` machine contract；
- CON-006/007 动态索引纠偏为已 RESOLVED；CON-023 转交 DEV-008D 且继续 OPEN。

## 关键契约

- A1 先 PASS/merge；之后 A2/A3 可由独立任务并行；
- A2 的 draft 不冒充可开始，必须走 project→service term→正式口头 consent→session/device-check/start；
- A2 的 project/service term/consent/session create 在首次请求前持久化各自稳定 request ID；同一 authoritative seam 绑定 actor/action/target-or-project-create-identity/canonical payload hash，响应未知只重放原 ID；
- A1 列表直接消费服务端 `home_state/primary_action/review_access` 唯一投影；processing 进入只读回顾而非继续，failed 按 NO_AUDIO_CAPTURED/complete manifest/其他失败分流；
- A3 播放只使用与 fresh server manifest 对应的完整本机 archive，当前无 server download；
- 删除使用 `elder-interview:capture:{session}` exclusive Web Lock；锁内核验 capture stopped、session processing/completed、server manifest complete、pending=0、无 active/dirty；
- 一个 IndexedDB transaction 清 archive/delivery/state/formal job/all reports/checkpoint/legacy chunks，并写无正文最小回执；abort 零部分清理，replay 稳定；
- 浏览器清站后原因不可证明，投影 `missing_unknown`；storage estimate 只为 origin-wide approximate；
- 本机 projection 唯一优先级为 active/dirty > pending > server unverified > receipt/empty > verified completeness；Schema 锁定 state/count/pending/playback，成功/replay 必有稳定 deleted_at，blocked/abort 必为 null；
- 服务器 audio/transcript/memory 继续保留，正式 privacy deletion 只由 DEV-008D 实现。

## iteration-coach

恰好一次独立只读复核，Learning mode，结论 `NO-PAUSE`。复核没有要求改变已确认产品方向、数据所有权、安全边界或公共契约；其授权入口、session read model、A1 依赖、capture lock、legacy/all-reports transaction、最小回执与容量建议均已吸收。

## 本地验证

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`git diff --check`：通过；
- formal `local-audio-archive-v1` 由 Ajv 2020 编译，12 个 projection/delete_result 正反 fixture 与 `expected_valid` 全部一致；
- docs-only 路径、修改文档内链、任务板/任务卡状态和 machine contract parse/structure：通过；
- unit：45 files / 290 tests；integration：13 files / 76 tests；auth：4 files / 23 tests；均通过；
- clean 临时 PostgreSQL：13 migrations deploy/status 通过，测试后精确删除临时库；
- build 与替代未占用端口的 Web/API/PostgreSQL smoke：通过；
- Chromium E2E：10 tests；auth Chromium E2E：4 tests；均通过。

首次使用共享测试库运行 integration 时命中其他运行遗留的固定题库版本，改用全新隔离临时库后通过；首次自定义 auth E2E API 端口与现有 Vite proxy 不一致导致连接拒绝，恢复仓库默认 API 端口后通过。两次均未修改代码/测试，临时库已清理。

## REV-041 old-head 审查与定向修复

- 项目负责人对 PR #31 exact head `19604291e751f1403272183d314d367c0de593b0`、CI `31571463898` SUCCESS 给出 `REQUEST_CHANGES`；P0=0、P1=3；该历史永久保留；
- P1-1：四个 A2 create 原无权威响应未知幂等 seam；当前候选补齐首次请求前持久 ID、项目 create identity、payload hash、同事务首次快照与冲突语义；
- P1-2：旧“未完成=继续、completed=回顾”与生命周期冲突；当前候选补齐 created 至 failed 的唯一首页动作、只读回顾/播放/删除边界；
- P1-3：旧 formal Schema 接受矛盾组合；当前候选补齐确定性 projection 优先级、条件 Schema、成功/失败 deleted_at 与 12 个正反 fixture；
- 以上候选随后由项目负责人授权总控对 final exact head 定向复审；旧 P1 在新 head 上关闭，但本节 old-head REQUEST_CHANGES 历史不被覆盖。

## REV-041 定向复审与最终接收

- final exact head `0308aa9ef37be457aa41f23ea6113666ff2c1f97` / exact-head CI `31573583324` completed / success；
- 项目负责人明确授权总控承担本目标手动审查，总控正式结论 `PASS`，P0/P1=0；P1-1/P1-2/P1-3 全部 CLOSED；
- PR #31 以 merge commit `91e5e7ed042f598359827ae63daf464e12e2ef76` 合入 main，main CI `31573985661` completed / success；
- SPEC-DEV-008A `DONE`、ADR-034 `Accepted`、DEV-008A1 `READY`；父 DEV-008A、A2、A3、008D 继续 `BLOCKED`，CON-023 继续 `OPEN`。

## 未实现与风险

- 本次没有业务代码、Prisma/migration、测试代码或部署改动；A1 仅转 `READY` 且尚未实现，父 A/A2/A3/008D 继续 `BLOCKED`；
- session list endpoint、UI、IndexedDB v5+ upgrade、回执 store/index、播放和删除均尚未实现/验证；
- 本机 archive 被浏览器清理时无法证明原因；没有 server audio download，因此本机缺失后不可播放；
- `navigator.storage.estimate()` 不是 session/设备磁盘事实；浏览器未承诺删除后立即回收等量空间；
- CON-023 正式 deletion runtime 继续 `NOT IMPLEMENTED / NOT VERIFIED`，真实试点仍被其阻塞；
- A1 可按本交接独立启动实现；A2/A3 在 A1 exact-head PASS/merge 前不得启动，008D 仍须独立安全计划并关闭 CON-023 才能解除真实试点门禁。

## 下一位必须先读取

DEV-008A1 执行任务必须先读取 `AGENTS.md`、`00/01/02`、`03/04/05/06/08/09/10`、本交接、SPEC/DEV-008A/A1/A2/A3/008D 任务卡、ADR-034、CON-023、`local-audio-archive-v1`，以及 DEV-003C/005R2C/005R2/005R4 最新交接。
