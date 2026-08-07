# DEV-005C｜服务端会话安全结束编排

## 基本信息

- 状态：`REVIEW`
- 负责人：后端会话编排实现任务对话（定向修复中）
- 前置依赖：SPEC-SESSION-END-001 PASS、DEV-003C、DEV-004B2
- 交接对象：总控 Agent、DEV-005D

## 目标

严格按 SPEC-SESSION-END-001 实现会话 stop/recover 与服务端 finalization，使结束状态、实际时长、原始音频收束和转录降级成为可查询事实；不实现页面。

## 输入依据

`AGENTS.md`、`00` 至 `10`、SPEC-SESSION-END-001 最终契约、DEV-002/003C/004A/004B2、ADR-019/021/022、CON-019 最终记录、REV-017 与 HO-032。

## 允许修改

- `packages/contracts` 中已获批准的会话结束请求/响应类型；
- `apps/api/src/project-foundation/**` 的 stop/recover controller、validation、service 与直接测试；
- 仅为完成契约所需的 `apps/api/src/audio/**`、`apps/api/src/realtime-transcription/**` 最小编排 seam；
- 如最终契约确需，`apps/api/prisma` 的单一前向 migration；现有字段足够时不得制造空 migration；
- PostgreSQL integration、auth/权限和故障注入测试；
- 总控负责的任务状态、审查和交接收口。

## 禁止修改

- `apps/web/**`、正式页面和 AI/长期记忆/建议功能；
- 真实麦克风、真实 ASR/LLM、云对象存储、持久队列或生产部署；
- 覆盖原始音频、原始转录或授权记录；
- 让客户端直接提交 `completed`、`ended_at`、时长或链路成功事实；
- 在 SPEC-SESSION-END-001 之外自行改变状态机、权限或错误语义。

## 交付物

- 已鉴权、幂等且资源串行的 stop/recover 端点；
- 可查询的 session 结束状态、结束时间、时长和最小链路事实；
- 单一 interview audio object、`session_finalization`/commitment 前向 migration 和统一公共 snapshot；
- 原始分片/manifest 与 final 转录收束的内部编排；
- ASR/AI 故障不影响原始录音保存的自动证据；
- 修改文件、命令、测试、风险和 GitHub 交接。

## 验证与验收

- 按最终契约覆盖正常结束、相同 request 重放、不同 request 并发和非法状态；
- 未完成原始音频收束时不得进入 `completed`，且不得丢弃已产生分片；
- assignment/授权变化后停止继续采集，但安全收束已有原始数据；
- 授权在首次 snapshot 前撤回且 assignment 仍有效时，stop/`finalize_interrupted` 必须返回 403，不创建 finalization、commitments 或补传例外，并将/保持 session 为 `interrupted`；
- 只有撤权前已冻结的 snapshot 才允许原 actor 重新认证后在 commitment 范围内补传；
- stop/recover 请求、响应、幂等、并发、受限补传、状态转换和错误必须逐项覆盖 `05` §3.5；不得把普通 assignment 绕过实现成受限补传；
- ASR 故障有明确降级事实且不破坏录音、manifest 或 session 可恢复性；
- 普通读取只允许当前有效 assignment，restricted/data_admin 规则不退化；
- format、lint、typecheck、unit、migration、PostgreSQL integration、auth、build、smoke 和适用 E2E 通过；
- 至少实现并自动化 `09` §10.1 的服务端场景；无法在本任务自动化的浏览器断线场景必须明确交 DEV-005D，不能删除验收目标；
- 状态机与跨链路编排属于高风险任务，项目负责人或独立审查绑定最终 GitHub head 明确 PASS 后才能 `DONE`。

## Agent 决策权限与 Git 责任

- 实现 Agent 可在冻结契约内决定局部类名、事务组织和测试结构；
- 若必须改变字段、状态、错误码、权限、完成条件或新增依赖，停止并反馈总控；
- 实现 Agent 不修改无关模块，不代替审查者宣布 PASS；总控负责 Git、协作文档和审查收口。

## REV-019 首轮实现审查

- 审查绑定 PR #10 head `738898a9d18dbb77d5fefec78d5daef90fcd5a48`，CI `31167044756` PASS；结论 `REQUEST_CHANGES`，P0=0、P1=4。
- P1-1：stop/`finalize_interrupted`、撤权和 audio upload/complete 未共享同一资源锁，存在撤权后仍创建 finalization 及 stop 检查后并发扩大字节集合的窗口；统一固定锁序并补真实 barrier 并发测试，complete 防御性全量核对 commitments。
- P1-2：ASR final drain 未实现；增加最小 ending seam，覆盖 drain 成功为 `drained`、不可用/超时为 `degraded`，且最后 final 必须先落库再完成。
- P1-3：runtime 丢失时未使用持久 `asr_last_audio_sequence_accepted`，把曾运行过 ASR 的重启场景误报为 `not_started`；曾接收 PCM 但无法证明 drain 时必须为 `degraded`。
- P1-4：`completed|failed` 终态没有稳定返回，且新 stop request ID 的首次响应未持久化，导致响应丢失后的同 ID 重试结果漂移；终态不得被 reconcile 改写，每个 request ID 必须重放自己的首次响应。
- P2：stop 的 202/200、malformed finalization 的 422 `INVALID_SESSION_FINALIZATION`、非原 actor complete 的权限错误语义已登记为非阻塞偏差，不纳入本轮四项 P1 定向修复，避免扩大范围。
- DEV-005C 保持 `REVIEW`，DEV-005D 保持 `BLOCKED`；只需修复上述四项 P1 后提交新 final head 定向复审。

## REV-019 定向修复候选（2026-08-07）

- 结束相关写路径统一使用 `project → session → audio` 资源锁序并在锁内重读；audio complete 全量核对实际 manifest 与冻结 commitments。
- 新增最小 `drainAndClose` ASR ending seam；final 通过 DEV-004A ingestion 落库后 adapter 才能结束，成功记 `drained`，不可用/超时记 `degraded`。
- runtime 丢失时使用持久 `asr_last_audio_sequence_accepted`：无接收证据为 `not_started`，存在接收证据但无法证明完整 drain 为 `degraded`。
- `completed|failed` 终态稳定，`completed_at` 不重写且 failed 不可复活；每个新 stop request ID 持久自己的首次响应并稳定重放。
- PostgreSQL integration 增加真实 barrier 竞态、ASR ending、重启事实与终态/幂等回归；本地 format、lint、typecheck、unit 127/127、integration 29/29、auth 13/13、migration deploy/status、build、smoke 均通过。
- 三项 REV-019 P2 仅保留登记，未扩大实现；状态保持 `REVIEW`，等待新 final head CI 与项目负责人定向复审。

## REV-019 第二轮定向复审

- 复审绑定 PR #10 head `33c9a33cc1b7ff54af30ac8eb205ad0e20ddc063`，CI `31172641955` PASS；旧四项 P1 已全部关闭。
- 新增唯一 P1：`advance()` 在事务外执行 ASR `drainAndClose()` 时，另一个并发 recover、reconcile 或匹配同一 snapshot 的 stop 看见 `draining` 后仍会启动第二个外部 runner；同一 request ID 在首次响应持久化前也可能重复触发。
- 定向修复：在 `SessionFinalizationService` 内按 `finalizationId` 建立进程内 `Map<id, Promise<void>>` single-flight。已有 Promise 时等待同一 Promise；没有时创建 `advanceOnce()`，完成后在 `finally` 删除。进程重启后 Map 为空，持久 `draining` 仍允许重新驱动。
- 必测：阻塞 fake adapter 的第一次 drain；同时发起相同 request ID recover、不同 request ID recover/reconcile，以及匹配同一 frozen snapshot 的 stop，断言外部 `drainAndClose` 调用数始终为 1；释放后所有响应稳定、session completed、transcript drained、幂等响应不漂移。
- 本轮不得修改数据库模型或 migration，不引入 Redis/BullMQ/队列，不接真实 ASR；三个既有 P2 继续不处理。DEV-005C 保持 `REVIEW`，DEV-005D 保持 `BLOCKED`。
