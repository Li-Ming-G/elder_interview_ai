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
| CON-014 | 说话人校准是否为 session start 硬门禁 | 决定仍为 start 后同正式流校准；PR #17 首轮 REV-027 REQUEST_CHANGES，正在修不可变控制边界与统一 snapshot，定向 PASS 前保持 OPEN |
| CON-018 | “没用，换一个”的幂等、相似度与持久化契约 | SPEC-AI-QUESTION-001 为 DEV-007A 硬前置；不阻塞 DEV-005A 页面外壳 |

## 使用规则

- 新 Agent 先读本索引，再按冲突编号打开 `02-conflict-log.md` 的完整记录。
- 已解决冲突不从原日志删除；如重新打开，追加新状态和证据。
