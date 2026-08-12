# DEV-008A｜倾听员网页工作区与最小回顾父任务

- 状态：`IN_PROGRESS`
- 角色：A1/A2/A3 聚合任务，不直接实现
- 前置：SPEC-DEV-008A 与 A1 exact-head PASS/merge 已满足；仍等待 A2/A3 各自 PASS/merge 及父任务聚合验收
- 子任务：DEV-008A1、DEV-008A2、DEV-008A3
- 不依赖：DEV-007 父项聚合验收、正式题库、AI 问题历史、完整回顾

父任务保持 `IN_PROGRESS`：A1 已 DONE，A2/A3 已 READY 但尚未实现。只在 A2/A3 均完成正式验收后进入聚合验收；不得由 A1 或任一后续子任务、PR、CI 自动推导 DONE。倾听员导出和 DEV-008D 正式服务器隐私删除不属于该父任务。
