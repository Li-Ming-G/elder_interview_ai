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
| CON-014 | 说话人校准是否为 session start 硬门禁 | 保持 DEV-004C 关闭；内部虚构数据允许 `unknown` 回退 |
| CON-018 | “没用，换一个”的幂等、相似度与持久化契约 | SPEC-AI-QUESTION-001 为 DEV-007A 硬前置；不阻塞 DEV-005A 页面外壳 |
| CON-020 | 正式工作台没有 stop 所需的唯一录音上传作业所有权 | R4 已取得同一 object 从正式 start、刷新恢复到 491 段 manifest/completed 的 REVIEW 候选；保持 OPEN，等待项目负责人绑定 PR final head PASS |
| CON-021 | Android Chrome 后台与设备生命周期 | R2 生命周期证据与 R4 正式页面 resume/安全结束候选已齐；保持 OPEN，等待项目负责人绑定 PR final head PASS |
| CON-022 | 准备页低音量输入容易被误判为无声 | R4 已在 OnePlus/Android 12/Chrome 150 复验普通音量多次可用、安静失败；保持 OPEN，等待项目负责人绑定 PR final head PASS |

## 使用规则

- 新 Agent 先读本索引，再按冲突编号打开 `02-conflict-log.md` 的完整记录。
- 已解决冲突不从原日志删除；如重新打开，追加新状态和证据。
