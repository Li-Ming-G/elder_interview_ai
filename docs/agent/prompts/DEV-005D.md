# DEV-005D 新任务对话启动提示词

请在 Codex 创建的独立 worktree 中实现 `DEV-005D｜安全结束页薄集成`。基线使用启动时最新 `origin/main`，不得在总控主工作区开发。

## 开工要求

1. 完整读取 `AGENTS.md`、根目录 `00` 至 `10`、协作入口与任务板、DEV-005D、SPEC-SESSION-END-001、DEV-005A/B/C、ADR-020/021/022、CON-019、REV-018/019、HO-034/035。
2. 这是前端流程、状态和错误体验的重大迭代，按全局规则执行 iteration-coach，并启动恰好一次独立只读预审。
3. 前端任务使用 impeccable：完整读取其 `SKILL.md`，运行 context 脚本定位 `apps/web`，读取 product register 并继承现有设计令牌、工作台组件与无障碍约束。
4. 完成后创建非 Draft PR；只能作为 REVIEW 候选，不得自行宣布 PASS/DONE。

## 目标

- 把 DEV-005B 工作台结束挂载位接到 DEV-005C 已通过的 stop/recover；
- 用统一 session snapshot 展示 `stopping/processing/failed/completed`、实际时长、录音上传 manifest 与转录 `drained|degraded|not_started` 独立事实；
- 支持重复点击保护、响应丢失、刷新/短时断线恢复和失败关闭；
- 提供“查看本次记录”和“完成离开”，但不提前实现完整回顾页。

## 允许与禁止范围

- 只修改 `apps/web` 的结束动作、结束页、最小 API client、样式和直接测试；使用既有正式路由与公共 contract。
- 禁止修改后端、Prisma、REST/WS contract、权限、录音可靠性或三个 REV-019 服务端 P2。
- 不用固定延时、localStorage、刷新次数、WebSocket replay、本地分片数或最后 final 推算 completed。
- 不把 ASR/AI 降级显示为录音失败；不隐藏原始音频未完成事实。
- 不实现项目列表、完整回顾、导出/删除、真实麦克风、真实 ASR/LLM 或生产部署。

## 验证

- stop 使用稳定 request ID，响应丢失和刷新后复用；重复点击不得并发制造结束动作。
- 页面只消费统一 snapshot；未知状态不猜测，权限/授权/session 错误不泄密。
- Chromium 覆盖正常结束、processing、ASR degraded、completed/failed 稳定重放、响应丢失、刷新/短断线和受限补传展示。
- 执行 format、lint、typecheck、unit、build、适用 smoke/integration/auth 和真实 API Chromium；如实记录未执行项。
