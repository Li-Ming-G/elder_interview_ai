# DEV-008D｜正式服务器隐私删除与统一 scope guard

- 状态：`BLOCKED`
- 前置：独立安全/数据治理实施计划；CON-006/007 已解决契约；CON-023 OPEN；相关 producer/consumer 和 migration 范围复核
- 目标：deletion request producer/read model、统一 `DeletionScopeReader`、project/session/segment-range scope、C2/AI/回顾回接、在线对象/数据库/临时导出/备份清理、不可逆最小审计、幂等与并发验收
- 禁止：用本机副本删除、project soft delete、no-op guard 或永久空 reader 冒充正式删除；静默降低 CON-023
- 状态边界：SPEC-DEV-008A 只完成任务拆分，不解锁本任务。真实试点前必须完成 `08` §14、`09` §8.2 与 CON-023 关闭条件，并由项目负责人或独立安全审查明确通过。
