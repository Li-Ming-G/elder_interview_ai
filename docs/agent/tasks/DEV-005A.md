# DEV-005A｜首次访谈准备页与正式路由外壳

## 基本信息

- 状态：`DONE`
- 负责人：前端实现任务对话
- 前置依赖：DEV-002、DEV-003、SPEC-FE-001 审查通过
- 交接对象：总控 Agent、DEV-005B、DEV-005D

## 目标

使用已分配、已预创建的单个虚构项目，建立正式业务页面路由外壳和首次访谈准备页；不依赖项目列表，也不承担尚未实现的会话安全结束。

## 输入依据

`AGENTS.md`、`00` 至 `10`、MVP-V01、SPEC-FE-001、DEV-002/003C、ADR-020/021、CON-019、最新相关交接，以及当前正式项目/授权/session/audio 客户端 seam。

## 允许修改

- `apps/web` 中正式页面路由、页面组件、局部样式和直接测试；
- 调用现有项目/授权/session create/get/device-check/start seam 的最小客户端层；
- 对应 Chromium 虚构数据场景；
- 本任务卡末尾的实现交接证据；不得自行修改任务状态、任务板、审查或冲突结论；
- 如发现准备页缺少只读聚合接口，只能登记并提请总控冻结契约，不能自行扩 API。

## 禁止修改

- 不实现项目列表/新建项目、完整工作台、安全结束页、AI 引擎、回顾/导出/删除 UI；
- 不改 Prisma、WebSocket wire contract、录音可靠性语义或授权规则；
- 不调用当前仅占位的 stop/recover，不模拟 `stopping/processing/completed`；
- 不用 query 参数 harness 作为正式入口；
- 不声称真实麦克风、真实试点或生产完成。

## 交付物

- 准备页：长者、预计时长、简短说明、正式授权状态、麦克风/输入状态、开始操作；
- 开始门禁错误的明确显示；
- 工作台与未来结束页可挂载的正式页面路由外壳；
- 页面路由与测试交接。

## 验证与验收

- 未分配、无有效授权、错误 session 状态和麦克风失败不能开始；
- 页面勾选不替代授权证据；
- unit、typecheck、build 和适用 Chromium 场景通过；
- 完成后提交 GitHub，由项目负责人审查。

## Agent 决策权限与 Git 责任

- 可在已冻结页面内容与现有 REST contract 内决定组件拆分、路由参数命名和局部样式；
- 若需新增 API、字段、依赖或改变 start/授权/录音语义，停止并反馈总控；
- 实现 Agent 不修改后端和治理文档，不代替审查者宣布 PASS；总控负责 Git 与收口。

## 2026-08-07 实现候选交接

- 实际修改：重构 `apps/web/src/app.tsx` 登录壳并加入 pathname/history 薄路由；新增 `apps/web/src/interview/` 下正式路由、最小 API client、短时麦克风输入检测、准备页与工作台外壳；重写局部设计 token/响应式样式；补充组件、路由和 Chromium 虚构数据测试。
- 正式路径：`/projects/:projectId/interview/prepare` 在用户主动设备检测且本地输入通过后惰性创建 session，并替换为 `/projects/:projectId/interview/:sessionId/prepare`；start 成功后进入 `/projects/:projectId/interview/:sessionId/workbench`。挂载时不创建 session，query harness 不作为正式入口。
- 关键边界：设备预检只短时持有 `MediaStream` 和 Web Audio analyser，检测结束立即停止 tracks；不创建 `MediaRecorder`、IndexedDB 分片或上传作业。客户端状态只作预判，`POST /sessions/:id/start` 仍是最终门禁；无 stop/recover 调用，无 stopping/processing/completed 模拟，无项目列表、安全结束、完整工作台或 AI。
- 防重复与错误：create/device-check/start 共享同一 in-flight 锁；start 的 `request_id` 在当前重试流程稳定复用；未登录、未分配、授权无效、项目/session 状态错误、麦克风 denied、无输入、device-check/start 失败均保留在准备页并显示不泄密的可操作提示。
- 设计标准：按用户指定的 `impeccable` product register 使用克制单色策略、固定字号、语义状态、骨架加载、完整 hover/focus/disabled/loading/error、reduced-motion 和结构化窄屏布局；本地 detector 对页面/样式返回 `[]`，桌面实际渲染已人工检查，Chromium 覆盖 390px 无横向溢出。
- 已执行且通过：`pnpm --filter @elder-interview/web typecheck`；定向 Vitest 15/15；`pnpm lint`；`pnpm format:check`；`pnpm test:unit`（21 files / 121 tests）；`pnpm build`；定向 Chromium 准备页 1/1。全量 Chromium 首轮因新测试选择器歧义失败，修复后第二轮因测试 mock 缺少 session GET 失败；补齐后定向场景通过，最终全量复跑结果见本任务最终提交/PR 交接。
- 未验证与风险：未接真实麦克风、真实授权、真实个人信息、真实 ASR/LLM 或 production；设备输入阈值仅为浏览器本地预检 seam，不改变服务端契约；项目仅有 project 深链时刷新不会恢复尚未显式创建的 session，创建后 URL 含 sessionId 可恢复。正式授权和 start 门禁仍完全以服务端事实为准。
- 交接：DEV-005B 可直接接管 `workbench-shell.tsx` 与 workbench 路径，不需重写准备页；DEV-005D 后续在 DEV-005C 真实结束事实通过后另接结束路由。本记录只是 `REVIEW` 候选证据，不修改任务状态，不宣布 PASS/DONE。

### 最终门禁复跑

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test:unit`（21 files / 121 tests）、`pnpm build`、`pnpm test:e2e --project=chromium`（5/5）和 `git diff --check` 全部通过。
- Chromium 运行时仅出现 baseline 场景刻意不启动 API 时的预期代理 `ECONNREFUSED` 日志；该场景仍验证未登录入口并通过，不影响准备页 mock API 纵向场景。

### REV-016 收口

- 项目负责人锁定 PR #7 final head `ea6c20f5cf88de6ab017ef2262217dd3eb423a1e`，核对 CI `31161076538` 全部门禁 PASS，结论 `PASS`，P0/P1 为 0。
- PR #7 以 merge commit `066c424113c76da8ec15654a7216ac57aac2affe` 合入 `main`；本任务在内部虚构数据准备页/路由外壳范围转 `DONE`。
- P2 转 DEV-005B：工作台状态必须由真实 session/WebSocket 事实驱动；准备页/工作台授权显示应与服务端一致地读取最新授权记录，不得由任意历史 `valid` 记录推断。
- 范围仍不含完整工作台、安全结束、真实麦克风、真实授权资料、真实 ASR/LLM、真实试点或生产部署。
