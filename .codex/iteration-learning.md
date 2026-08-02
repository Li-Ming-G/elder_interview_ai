# Project Iteration Journal

## Current Snapshot
- Product goal: 帮助倾听员可靠完成长者人生故事访谈，保存可追溯的原始资料，并由 AI 提供跨会话记忆和候选追问；MVP 不自动生成完整传记。
- Current stage: MVP 研发基线建立阶段；首次总控审计已完成，正式业务代码尚未开始，关键冲突待项目负责人决定。
- Architecture: 模块化单体；React + TypeScript + Vite 前端、NestJS + TypeScript 后端、PostgreSQL，录音、ASR、AI 三条链路解耦。
- Constraints: 原始录音、原始转录和原始授权记录不可覆盖；AI/ASR 故障不得影响原始录音；AI 结论必须回链确定态转录；不得提前实现 MVP 外功能。
- Open questions: 工程技术栈的推荐项如何正式落地；敏感与禁止追问内容如何进入控制上下文；后续任务的真实依赖；是否存在需要关联的远端 Git 仓库；“拾光”是否为正式品牌名。

## Adopted Decisions

### D-001 — 按风险分级验收
- Status: adopted
- Evidence: 用户在 2026-08-02 的总控授权中明确规定独立审查按风险决定；`AGENTS.md`、`09-测试与验收规范.md`、`10-研发协作与交接规范.md` 已同步。
- Reason: 低风险文档和配置无需制造形式化审查成本，高风险业务/安全/契约和 MVP 发布仍需角色分离。
- Tradeoff: 总控必须更明确记录自检证据，并对风险分级承担判断责任。
- Boundary: 核心架构、关键业务规则、权限、安全、状态机、核心数据模型、跨模块契约、大规模合并和 MVP 发布不能由实现者自验关闭。

## Assumptions to Validate

### A-001 — “拾光长者传记项目”与正式文档中的“AI 辅助长者访谈系统”是同一项目
- Evidence: 用户在当前工作区发出总控指令，但“拾光”未出现在正式项目文件中。
- Validation: 由项目负责人确认正式品牌名；确认前不改产品正式名称。
- Status: open

### A-002 — 当前目录应新建独立 Git 仓库
- Evidence: 首次检查未发现 `.git`，用户要求总控管理 Git，且后续任务要求提交级交接。
- Validation: 已在本地初始化 `main` 并形成基线提交；仍需确认是否存在应关联的远端仓库。
- Status: open

## Iteration Log

### 2026-08-02 — 首次总控基线审计
- User outcome: 建立可信、可追溯、可继续推进的协作基线，并判断是否可开发或并行。
- Review mode: Correction mode
- Review finding: 项目将文档基线标为完成、工程初始化标为就绪，但没有 Git、验收证据、完整任务卡或已批准的关键工程选择。
- Options considered: 直接启动 DEV-001；保留所有任务一律独立验收；先纠正状态、按风险统一治理、建立 Git 并补任务边界。
- Adopted decision: 采用第三条路径；暂停功能开发和并行分发，低风险基线整理由总控完成，高影响冲突交项目负责人决定。
- Implementation evidence: `docs/agent/00-task-board.md`、`docs/agent/02-conflict-log.md`、`docs/agent/tasks/DEV-001.md`、`AGENTS.md`、`09-测试与验收规范.md`、`10-研发协作与交接规范.md`，以及本地 `main` 的基线提交 `921d426`。
- Lesson: “有一份任务表”不等于任务可执行；可执行任务必须同时具备可信依赖、已批准决策、明确边界、验证命令和可恢复版本基线。
- Better future prompt: “请先验证 DOC-001 的验收证据和 Git 基线；只有当 DEV-001 的技术选型、允许范围、禁止范围及验证命令均已正式记录时，才把它设为 READY。”
