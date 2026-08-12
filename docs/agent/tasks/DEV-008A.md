# DEV-008A｜倾听员网页工作区与最小回顾父任务

- 状态：`IN_PROGRESS`
- 角色：A1/A2/A3 聚合任务，不直接实现
- 前置：SPEC-DEV-008A、A1 与 A2 exact-head PASS/merge 已满足；仍等待 A3 PASS/merge 及父任务聚合验收
- 子任务：DEV-008A1、DEV-008A2、DEV-008A3
- 不依赖：DEV-007 父项聚合验收、正式题库、AI 问题历史、完整回顾

父任务保持 `IN_PROGRESS`：A1/A2 已 DONE，A3 保持 `REVIEW` 并等待基于 A2 merge 后的新 main 完成整合、唯一 REV-ID 绑定与 exact-head 审查。只在 A3 完成正式验收后进入聚合验收；不得由 A1/A2 子任务 PASS、PR 或 CI 自动推导父任务 DONE。倾听员导出和 DEV-008D 正式服务器隐私删除不属于该父任务。
