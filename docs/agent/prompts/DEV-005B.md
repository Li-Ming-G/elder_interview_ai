# DEV-005B 新任务对话启动提示词

请在 Codex 创建的独立 worktree 中实现 `DEV-005B｜转录优先访谈工作台`，不得切回总控 `main`。DEV-005C 正在另一 worktree 并行开发；本任务不得修改后端或依赖它尚未合并的代码。

## 开工要求

1. 核对 worktree、分支、干净状态和基线包含 `main@aa9f836`，先 fetch 但不要修改总控工作区。
2. 依次完整读取 `AGENTS.md`、根目录 `00` 至 `10`、协作入口与任务板、DEV-005B、MVP-V01、SPEC-FE-001、DEV-004B2/005A、ADR-019/020/021、CON-018/019、REV-014/016、HO-031/033。
3. 按全局 iteration-coach 规则启动恰好一次独立只读预审，预审不得修改文件。
4. 用户明确要求使用 `$impeccable`：完整读取 `C:\Users\TR\.agents\skills\impeccable\SKILL.md`，在项目根运行 `node C:\Users\TR\.agents\skills\impeccable\scripts\context.mjs --target apps/web`，读取 `reference/product.md`，并检查现有 CSS、准备页和 workbench shell。当前缺少 PRODUCT.md 不阻塞这个已有代码上的明确范围任务，不转去 init。
5. 继承现有设计令牌和组件语言；视觉判断不得改变正式需求或恢复后置功能。

## 目标与必须交付

- 用真实 session/WebSocket 服务端事实替换基于 pathname 的工作台占位状态；
- 授权提示统一为最新授权记录，与服务端 start 门禁一致；
- 顶部窄状态栏和以转录为绝对中心的主体；
- interim/final、长者/倾听员/unknown 清楚可辨；
- 自动跟随、回看暂停、新内容计数和“回到最新”；
- 单个建议/继续倾听的稳定展示 seam，不实现真实 AI；
- 为 DEV-005D 保留结束动作挂载位置，但不调用 stop/recover、不推算完成。

## 允许与禁止范围

- 只修改 `apps/web/**` 的正式工作台、实时客户端适配、局部样式和直接测试；可在不改变 wire contract 的前提下复用/抽取 B2 transport。
- 禁止修改后端、Prisma、REST/WS contract、权限和状态机；禁止真实麦克风/ASR/LLM、建议持久化、“换一个”、多建议、项目管理、回顾、复杂标记、导出/删除。
- ASR/AI 故障不得停止或误报原始录音；不得用本地 transport、URL 或计时器伪造服务端业务事实。
- 不新增依赖；若冻结目标确实无法完成，先停止并报告总控。

## impeccable 质量边界

- 这是长时间访谈中的专业产品工具：安静、可信、适合持续阅读，设计服务于任务。
- 继承现有 OKLCH 令牌、单字体和组件词汇；正文对比度至少 4.5:1，focus 可见，状态不只靠颜色。
- 动效只表达状态并支持 reduced-motion；动态转录的 live-region 不得反复打断屏幕阅读器。
- 桌面和窄屏都保留状态、转录、回到最新与结束挂载动作。
- 禁止渐变文字、玻璃拟态、装饰网格、相同卡片阵列、嵌套卡片、过度圆角、宽阴影加边框和无意义页面入场动画。
- 必须在真实浏览器检查桌面/窄屏、长内容滚动、焦点、错误、重连、空状态和 reduced-motion，并记录观察结果。

## 验证和交接

- 如实运行并记录 format、lint、typecheck、unit、build、适用 integration/auth/smoke 和真实 Chromium 合成数据 E2E。
- 记录修改文件、关键设计决定、浏览器验证、未解决问题和风险；推送分支并创建非 Draft PR。
- 只能作为 `REVIEW` 候选，不得自行宣布 PASS/DONE；最终结论由项目负责人 GitHub 审查。
