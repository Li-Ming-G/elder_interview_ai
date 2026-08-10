# 当前开放冲突索引

本文件是 `02-conflict-log.md` 的快速入口。完整冲突记录仍保存在原日志中；状态以原记录中的 `OPEN`、`RESOLVED` 或 `DEFERRED` 为准。

## OPEN

| 冲突 | 影响范围 | 当前处理方式 |
|---|---|---|
| CON-006 | DEV-008 备份延迟清理状态与重试契约 | DEV-008 开工前补正式状态机和测试；不阻塞当前音频/转录原型 |
| CON-007 | 删除范围摘要密钥版本与轮换策略 | DEV-008 开工前由数据治理角色决策；不阻塞当前音频/转录原型 |
| CON-008 | production 用户来源启停与最终安全验收 | DEV-001B 保持 REVIEW；不阻塞内部虚构身份原型 |
| CON-012 | consent audio object 跨 `consent_text_version` 复用规则 | 真实试点前确认并固化约束与测试 |
| CON-013 | 内部 audio harness 的生产启用限制 | 生产或真实试点前移除或严格限制查询参数入口 |
| CON-023 | C2 删除 scope 门禁缺少可执行的 deletion_request producer/read model | C2 不造半模型，先覆盖现有 project restricted/deleted；DEV-008 实现正式删除子系统时必须回接 C2 并补 scope/并发测试 |
| CON-025 | 问题旅程与内容来源曾偏离项目负责人预期 | 项目负责人已确认旅程优先、双题库、AI 选择/有据轻调方向；SPEC-QUESTION-JOURNEY-001 为 REVIEW，负责人 GitHub PASS 前仍保持 OPEN，DEV-007A/B 保持 BLOCKED |

## 使用规则

- 新 Agent 先读本索引，再按冲突编号打开 `02-conflict-log.md` 的完整记录。
- 已解决冲突不从原日志删除；如重新打开，追加新状态和证据。
