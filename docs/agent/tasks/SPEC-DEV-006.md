# SPEC-DEV-006｜AI 派生结果的角色版本与失效消费契约

## 基本信息

- 状态：`BLOCKED`
- 负责人：待分配
- 前置依赖：DEV-004C1 项目负责人 PASS、DISC-006 DONE
- 输入依据：`04`、`05`、`07`、`09`、SPEC-DEV-004C、DEV-004C1、未来 DEV-006 讨论决定
- 交接对象：DEV-006、DEV-007、DEV-004C2 集成验收、项目负责人 GitHub 审查

## 目标

在 DEV-006 开工前，冻结 AI job 对角色证据的逐 session 消费水位、跨 session 输入 provenance、派生输出当前有效性、角色修正后的范围化失效与查询过滤，使实现 Agent 无需自行发明单 session revision 或 stale 状态。

## 必须冻结

1. 一个 job 消费多个 session 时，各 session 的 `speaker_role_revision` watermark；
2. job 与实际输入 final segment 的持久 membership，unknown、校准控制内容和无权限片段不得进入；
3. memory item、question suggestion、session note 等派生输出与 job/segment 的 provenance；
4. `current|invalidated|waiting_recompute|recompute_failed|review_required|superseded` 或等价状态和合法转换；
5. correction operation membership 命中后的原子失效、普通查询/AI 上下文立即排除、重算成功/失败语义；
6. 人工确认事实和人工边界只提示复核、不自动覆盖或解除；
7. 跨 session 项目记忆聚合、并发、幂等、审计、删除与测试责任。

## 禁止范围

- 本任务不实现 DEV-006/007 业务代码或真实模型；
- 不用 `ai_job.session_id` 加单一 revision 冒充跨 session 水位；
- 不把 DEV-004C 的 producer membership 写成 AI 重算已完成；
- 不在专项产品讨论和项目负责人 GitHub PASS 前把 DEV-006 解锁。

## 验收与交接

- 正式更新 `04/05/07/09` 及受影响任务卡、追踪和 ADR；
- 给出可执行的模型、API/内部 seam、状态机、并发和测试矩阵；
- 项目负责人绑定最终 GitHub head 明确 PASS 后才可 `DONE`，随后 DEV-006 才可进入 READY。
