# DEV-005A 新任务对话启动提示词

将以下内容完整复制到本项目下的新 Codex 任务对话中：

---

你是拾光长者传记项目的 DEV-005A 前端实现 Agent。本任务只实现“首次访谈准备页与正式路由外壳”，不实现安全结束、完整工作台或 AI。

## 基线与 Git

- 项目根目录：以新任务实际打开的 `elder_interview_ai` 仓库为准。
- 开始前执行 `git fetch origin`，确认工作基线包含 PR #6 merge commit `474c647307b1ed3e949da31c4e490ee0b0b192c7` 以及其后的 SPEC-FE-001 收口提交。
- 使用独立 worktree 和分支 `codex/dev005a-prep-shell`；如果 Codex 已为本任务创建专用 worktree，只需确认分支和工作树干净，不要再嵌套创建。
- 先检查 Git 状态、未提交修改、相关实现和依赖，不覆盖用户或其他任务的修改。

## 开始前必须完整读取

依次读取：

1. `AGENTS.md`
2. `00-项目说明与执行入口.md`
3. `01-产品需求文档.md`
4. `02-项目开发规范.md`
5. `docs/agent/README.md`
6. `docs/agent/00-task-board.md`
7. `03-业务流程与交互规范.md`
8. `05-API与实时事件契约.md`
9. `06-实时音频与转录规范.md`
10. `08-安全隐私与数据治理.md`
11. `09-测试与验收规范.md`
12. `10-研发协作与交接规范.md`
13. `docs/agent/tasks/DEV-005A.md`
14. `docs/agent/handoffs/HO-030.md`
15. 与 DEV-002、DEV-003C、ADR-020/021、CON-019 相关的最新任务、决策和交接。

这是页面、路由和交互的实质迭代，按项目全局要求先使用 iteration-coach，并完成一次独立只读预审。预审不得代替实现。

## 目标

使用已分配、已预创建的单个虚构项目，建立正式业务页面路由外壳和首次访谈准备页，使倾听员能够：

1. 从正式深链进入一个已分配项目；
2. 看见长者称呼、预计时长、简短访谈说明和正式授权状态；
3. 看见麦克风权限与输入检测状态；
4. 只有在 assignment、正式授权、session 状态和设备检查均允许时才能开始；
5. start 成功后进入正式工作台路由外壳，供 DEV-005B 接续。

## 允许修改

- `apps/web` 中正式路由、准备页组件、局部样式和最小 API client；
- 复用现有项目、授权、session create/get/device-check/start 和音频设备 seam；
- 与本任务直接相关的 unit、component 和 Chromium 虚构数据测试；
- 完成时只在 `docs/agent/tasks/DEV-005A.md` 末尾追加实际修改文件、命令、测试结果、风险和交接信息，不自行改变任务状态。

## 禁止修改

- 不实现或调用 `POST /sessions/:id/stop`、`recover`；它们当前只是路径占位；
- 不模拟 `stopping/processing/completed`，不实现安全结束页；
- 不实现完整转录工作台、真实 AI 建议、“没用，换一个”、项目列表/新建项目、完整回顾、导出或删除 UI；
- 不修改 Prisma、后端 API、WebSocket wire contract、录音可靠性语义、授权规则或全局协作文档状态；
- 不把 query 参数 harness 当作正式入口；
- 不接真实麦克风试点、真实个人信息、真实 ASR/LLM 或生产部署能力；
- 不新增依赖，除非现有栈确实无法完成且先向总控说明。

## 实现要求

- 先检查现有登录壳、audio/realtime harness 和 API contracts，优先复用，不重复造状态层；
- 页面不能用勾选框代替版本化授权证据，start 前必须依赖服务端门禁；
- 未分配、无有效授权、错误 session 状态、麦克风拒绝或无输入时，阻止开始并显示可理解且不泄密的错误；
- loading、空数据、失败、可开始、提交中和 start 成功状态必须明确；重复点击不得并发创建或启动多个 session；
- 不在 URL、日志、错误或测试快照中放入敏感正文、token 或完整授权内容；
- 路由和组件边界要让 DEV-005B、DEV-005D 后续接入时无需重写准备页。

## 验证与验收

至少覆盖：

- 有效虚构项目正常加载并开始；
- 未登录、未分配、授权无效、错误 session 状态；
- 麦克风 denied、输入未检测、device-check/start 失败；
- 重复点击和响应等待期间按钮禁用；
- start 成功只进入工作台外壳，不调用 stop/recover；
- 页面无项目列表、结束完成模拟或内部 harness 正式化。

执行适用的 format、lint、typecheck、unit、build 和 Chromium E2E。无法执行的环境检查必须如实记录，不得声称通过。

## GitHub 与交接

- 完成后检查 diff，确认没有越界文件、密钥或真实数据；
- 提交并推送 `codex/dev005a-prep-shell`，创建非 Draft PR；
- 报告最终 commit、PR、实际命令、测试结果、未验证项和风险；
- 状态只能进入 `REVIEW` 候选，不得自行标记 `DONE` 或宣布 PASS；项目负责人将在 GitHub 审查。

---
