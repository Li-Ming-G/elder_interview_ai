# DEV-005C｜服务端会话安全结束编排

## 基本信息

- 状态：`READY`
- 负责人：待创建的后端会话编排实现任务对话
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
