# 协作文档入口

本目录保存项目推进所需的任务状态、需求追踪、冲突、架构决定、审查索引和交接索引。历史证据放在对应归档目录，不删除、不改写。

## 当前工作先读

1. `00-task-board.md`：唯一的动态任务状态源。
2. 当前任务卡：从任务板链接进入 `tasks/`。
3. `01-requirement-traceability.md`：需求到任务和验证的高层映射。
4. `02-open-conflicts.md`：当前 OPEN 冲突快速索引；再按编号查看 `02-conflict-log.md` 详情。
5. `03-architecture-decisions.md`：涉及架构、数据或接口时读取相关 ADR。
6. `04-review-report.md`：当前审查索引；历史正文见 `reviews/`。
7. `05-handoff-log.md`：当前交接索引；历史正文见 `handoffs/`。

## 文件职责

- 任务状态只写入 `00-task-board.md`，其他文件引用任务状态，不复制维护。
- 审查结论以稳定的 `REV-ID` 和审查 head 为准。
- 交接只记录实际交接和当前接收对象；历史交接不作为当前状态源。
- 冲突在正式决定后仍保留原记录，并在顶部索引标记 OPEN、RESOLVED 或 DEFERRED。

## 归档约定

- `reviews/`：历史审查正文。
- `handoffs/`：历史交接正文。
- `tasks/`：当前仍保留原路径，待引用检查工具就绪后再区分 active/archive。

本入口不替代根目录 `AGENTS.md` 及正式产品、技术规范；它只说明协作文档从哪里开始读。
