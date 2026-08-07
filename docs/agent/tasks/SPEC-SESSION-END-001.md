# SPEC-SESSION-END-001｜会话安全结束与恢复契约

## 基本信息

- 状态：`REVIEW`
- 负责人：会话编排契约 Agent
- 前置依赖：SPEC-FE-001 产品行为、DEV-003/DEV-004B2 已验证 seam
- 交接对象：总控 Agent、DEV-005C/005D 实现任务对话

## 目标

在不提前实现代码的前提下，冻结一次访谈从 `recording|reconnecting` 安全进入 `stopping → processing → completed|failed` 的最小服务端契约，使原始录音、分片 manifest、final 转录和页面状态拥有同一套可执行事实来源。

## 输入依据

`01` §6/§8、`03` §12/§17.2、`04` §4.6/§4.8、`05` §3.5/§4/§5、`06` §3/§9-10、`08` 授权与访问边界、`09` 场景 A/§12.1、ADR-019/020/021、CON-019、DEV-003C、DEV-004A/B1/B2。

## 必须回答

1. stop/recover 的请求、响应、稳定 `request_id`、合法前置状态和重复/并发行为；
2. stop 时何时禁止新 PCM、何时停止 MediaRecorder、如何继续补传已产生的原始分片；
3. 音频 object manifest、final 转录 drain 和 session 状态之间的最小完成条件；
4. `stopping`、`processing`、`completed`、`interrupted`、`failed` 的服务端事实与可恢复边界；
5. assignment、登录或授权在结束期间变化时，如何禁止继续采集但仍安全保存已经产生的原始数据；
6. `ended_at`、`duration_seconds`、各链路处理事实和错误分类如何查询，哪些字段进入公共响应；
7. ASR/AI 故障如何不阻塞原始录音保存，何种故障允许 session 完成并以降级事实呈现；
8. 进程内 MVP 收束与未来持久任务/outbox 的替换 seam，避免把生产级基础设施变成本地验证前置。

## 允许修改

- `03` 至 `06`、`08`、`09` 中会话结束直接相关契约；
- ADR、冲突、追踪、任务卡与交接。

## 禁止修改

- 不修改 `packages/contracts`、controller、service、migration、页面或测试代码；机器可读 contract 只在契约获批后的 DEV-005C 实现；
- 不接真实麦克风、真实 ASR/LLM、云队列或生产部署；
- 不让 AI 成功成为原始录音保存或 session 合法完成的必要条件；
- 不弱化 assignment、授权撤回、原始证据不可覆盖或错误不泄密要求；
- 不把 WebSocket 短时 replay 等同于 session stop/recover。

## 交付物

- 可直接供 DEV-005C 实现的 REST/状态机/幂等/错误契约；
- 服务端完成事实与前端展示字段清单；
- 最小内部 MVP 与未来生产加固的明确分界；
- 覆盖正常、重复、并发、掉线、撤权、授权撤回、缺片、ASR 故障和进程故障的验收矩阵。

## 已冻结的正式候选

- 每个 session 一个 `purpose=interview` audio object；客户端停止 PCM/MediaRecorder 后提交稳定 stop request ID、expected count 和逐片不可变 commitment；
- 持久 `session_finalization` 是 session 状态、manifest、ASR drain、错误和 recover 的唯一聚合事实；
- stop 接受后拒绝新 PCM/新 object/commitment 外分片，只允许原 active actor 重新认证后的受限 evidence-finalization 补传；
- `stopping` 等待原始 manifest，`processing` 等待 ASR `drained|degraded|not_started`；raw complete + transcript terminal 才可 `completed`，AI 不参与；
- `interrupted` 可恢复，`completed|failed` 终态；runner/WS replay 可丢，持久事实可重驱；
- 公共 snapshot、错误码、并发/重放和完整矩阵见 `05` §3.5 与 `09` §10.1；数据与权限见 `04` §4.25-4.26、`08` §4.5。

## 验证与验收

- 正式文档对 stop/recover、状态转换、完成条件和降级语义一致；
- DEV-005C/005D 不需要自行猜测 API、数据库或页面成功条件；
- 原始录音优先保存，ASR/AI 故障不制造数据丢失；
- 未完成 manifest 或服务端事实未知时不能返回 `completed`；
- 属于状态机与跨模块契约，项目负责人或独立审查明确 PASS 后才能 `DONE`。
- 当前只进入 GitHub `REVIEW` 候选；不得自行宣布 PASS、关闭 CON-019 或解锁 DEV-005C。
