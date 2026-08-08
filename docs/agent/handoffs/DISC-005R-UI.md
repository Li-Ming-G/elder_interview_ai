# HO-040｜DISC-005R-UI 页面占比与移动平台交接

- 日期：2026-08-08
- 来源：独立讨论任务 `019fdee4-c4b0-7073-b652-0f0caea99cdc`
- 状态：讨论 `DONE`；正式 SPEC-DEV-005R 仍为 `REVIEW`
- 接收对象：DEV-005R2、DEV-005R3、DEV-005R4、SPEC-AI-QUESTION-001、总控 Agent

## 已确认

- Android Chrome 是首轮完整访谈移动主设备，iPhone Safari 延期。
- 正常桌面以 8/79/13、390×844 以 9/73/18 为比例护栏；320×568 保证转录不低于 60%。
- 五类事实分区、异常提升、高密度左右转录、interrupted/结束态重分配、只有结束确认使用 modal。
- 建议区加入“只撤销最近一次更换”的用户语义；R3 只留容器，业务交 SPEC-AI-QUESTION-001/DEV-007。
- stopping 状态面板不可最小化；processing/completed 可收起为持续状态条，刷新默认展开。

## 未完成与边界

- Android Chrome 后台、锁屏、可见性、旋转与音频设备中断需 R2 真机证据，登记 CON-021。
- processing 只查看当前已加载转录；刷新后完整转录读取仍属后续回顾。
- 本次未改业务代码、未运行功能测试；正式契约变更随 PR #11 等待项目负责人 GitHub 审查。
