# DEV-005D｜安全结束页薄集成

## 基本信息

- 状态：`READY`
- 负责人：待创建的前端安全结束实现任务对话
- 前置依赖：DEV-005A、DEV-005B、DEV-005C PASS
- 交接对象：总控 Agent、纵向集成/产品验证角色

## 目标

把工作台结束动作接到 DEV-005C 的真实 stop/completion 契约，并用服务端事实展示 `stopping/processing/failed/completed`、实际时长和各链路结果；不在前端推算成功。

## 输入依据

`AGENTS.md`、`00` 至 `10`、SPEC-SESSION-END-001 最终契约、DEV-005A/B/C、ADR-020/021/022、CON-019、REV-019、HO-034 及最新交接。

## 允许修改

- `apps/web` 中结束动作、结束页、最小 API client、局部样式和直接测试；
- 使用现有正式路由外壳和 DEV-005C 公共 contract；
- Chromium 虚构数据纵向场景；
- 总控负责的任务状态、审查和交接收口。

## 禁止修改

- 不改 Prisma、服务端状态机、WebSocket wire contract、录音可靠性或授权规则；
- 不用固定延时、页面刷新次数、localStorage 或 query harness 推算完成；
- 不把 ASR/AI 故障笼统显示为录音失败，也不隐藏原始音频未完成事实；
- 不实现项目列表、完整回顾、导出/删除、真实麦克风或生产部署。

## 交付物

- 工作台结束操作及重复点击保护；
- `stopping/processing/failed/completed` 的真实状态展示；
- 长者、服务端实际时长、录音采集/上传 manifest/转录 `drained|degraded|not_started` 独立事实、“查看本次记录”和“完成离开”；
- 刷新/短时断线后的状态恢复与明确错误；
- unit、Chromium、修改文件、命令、风险和 GitHub 交接。

## 验证与验收

- stop 请求使用稳定 request ID，响应丢失/刷新后不重复制造结束动作；
- 服务端未完成时页面不显示成功，未知状态不猜测；
- 页面只消费统一 session snapshot；不得并行拼接 manifest、最后 final、WebSocket replay 或本地分片数形成完成结论；
- 原始音频成功但 ASR 降级时分别如实展示；
- 权限、授权或 session 状态错误失败关闭且文案不泄密；
- unit、typecheck、build 和真实 API Chromium 虚构数据场景通过；
- 浏览器场景覆盖 stop 响应丢失、刷新/短时断线、重新认证后的受限补传、ASR degraded 与 completed/failed 终态重放；
- 完成后提交 GitHub，由项目负责人审查。

## Agent 决策权限与 Git 责任

- 可在冻结 contract 内决定页面组件和局部交互结构；
- 若需改变 API、状态、错误、权限或新增依赖，停止并反馈总控；
- 实现 Agent 不修改后端和治理文档，不代替审查者宣布 PASS；总控负责 Git 与收口。
