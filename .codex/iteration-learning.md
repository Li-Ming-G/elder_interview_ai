# Project Iteration Journal

## Current Snapshot
- Product goal: 帮助倾听员可靠完成长者人生故事访谈，保存可追溯的原始资料，并由 AI 提供跨会话记忆和候选追问；MVP 不自动生成完整传记。
- Current stage: DEV-001A 工程骨架已完成本地实现与门禁并进入 REVIEW；正式业务功能仍未开始，等待总控审查和提交。
- Architecture: 模块化单体；Node 24.18、pnpm 11.15 workspace、React/Vite、NestJS、Prisma 7/PostgreSQL；录音、ASR、AI 三条链路解耦。
- Constraints: 原始录音、原始转录和原始授权记录不可覆盖；AI/ASR 故障不得影响原始录音；AI 结论必须回链确定态转录；不得提前实现 MVP 外功能。
- Open questions: 是否存在需要关联的远端 Git 仓库；“拾光”是否为正式品牌名；ASR/LLM/对象存储最终供应商；DEV-008 前的备份清理状态与删除摘要密钥轮换策略（CON-006/007）。

## Adopted Decisions

### D-001 — 按风险分级验收
- Status: adopted
- Evidence: 用户在 2026-08-02 的总控授权中明确规定独立审查按风险决定；`AGENTS.md`、`09-测试与验收规范.md`、`10-研发协作与交接规范.md` 已同步。
- Reason: 低风险文档和配置无需制造形式化审查成本，高风险业务/安全/契约和 MVP 发布仍需角色分离。
- Tradeoff: 总控必须更明确记录自检证据，并对风险分级承担判断责任。
- Boundary: 核心架构、关键业务规则、权限、安全、状态机、核心数据模型、跨模块契约、大规模合并和 MVP 发布不能由实现者自验关闭。

### D-002 — 固定可重复工程工具链
- Status: adopted
- Evidence: `02` §3、ADR-007/008/010、REV-003 PASS。
- Reason: 后续任务需要单一 Node/pnpm/ORM/测试/CI 根门禁，避免 Agent 各自固化不兼容偏好。
- Tradeoff: Prisma 7 ESM/driver adapter 和 Playwright 增加初始化成本；Redis/BullMQ/Nginx 延后到有真实消费者或部署验证时。
- Boundary: DEV-001A 只交付工程骨架，不实现身份或业务表。

### D-003 — 同源 Web 使用可撤销服务端会话
- Status: adopted
- Evidence: `02` §3.5、`04` §4.1/4.19/4.20、`05` §3.0、ADR-009、REV-003 PASS。
- Reason: 账号启停、敏感访问和权限变化要求即时撤销，浏览器不应持有长期 JWT。
- Tradeoff: 需要 Cookie、Origin、CSRF、数据库限流和 production 运维 CLI 的完整安全契约。
- Boundary: DEV-001B 等待 A；真实项目级 A/B 隔离由 DEV-002 验收。

### D-004 — AI 边界与删除工作流由服务端强制
- Status: adopted
- Evidence: `03`、`04`、`05`、`07`、`08`、`09`、ADR-011/012、REV-003 PASS。
- Reason: 提示词不能独立保证隐私；marker 行为语义、内容权限、删除 scope、在途 AI 结果和物理清理必须由可审计状态机约束。
- Tradeoff: 增加候选载体、输入/输出过滤、删除 transition、scope 快照、tombstone 和竞态测试。
- Boundary: completed 内容不可恢复；CON-006/007 必须在 DEV-008 前闭合。

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
- Implementation evidence: `docs/agent/00-task-board.md`、`docs/agent/02-conflict-log.md`、`docs/agent/tasks/DEV-001.md`、`AGENTS.md`、`09-测试与验收规范.md`、`10-研发协作与交接规范.md`，以及本地 `main` 的初始导入提交 `921d426`、治理纠偏提交 `aa1a615`。
- Lesson: “有一份任务表”不等于任务可执行；可执行任务必须同时具备可信依赖、已批准决策、明确边界、验证命令和可恢复版本基线。
- Better future prompt: “请先验证 DOC-001 的验收证据和 Git 基线；只有当 DEV-001 的技术选型、允许范围、禁止范围及验证命令均已正式记录时，才把它设为 READY。”

### 2026-08-02 — DEC-001 工程与安全契约收敛
- User outcome: 在不静默改变 MVP 的前提下，由总控决定是否启用专业 Agent，并推进到可执行工程任务。
- Review mode: Correction mode
- Review finding: 可以并行做只读工程与安全研究，但直接启动 DEV-001 会把未闭合的身份、删除、AI 边界和任务依赖交给实现者猜测。
- Options considered: 立即并行开发 A/B；只批准工程选型并延后安全契约；先由总控写回全部正式契约、连续独立复审，再单线程启动 A。
- Adopted decision: 采用第三条路径；工程顾问和边界顾问只读并行，独立审查角色与实现角色分离；REV-001/002 的 P1 全部修复，REV-003 PASS 后只放行 DEV-001A。
- Implementation evidence: `02` 至 `10`、ADR-007 至 ADR-012、CON-003 至 CON-007、REV-001 至 REV-003、DEV-001/A/B 任务卡和任务板。
- Lesson: “安全方向合理”不等于契约可实现；scope、终态、在途任务、FK 清理、可恢复软删与隐私删除必须一直追问到数据库和竞态层。
- Better future prompt: “请先用独立审查验证每个状态的进入、退出、并发和物理清理证据；P1 为 0 后才允许实现 Agent 开工。”

### 2026-08-02 — DEV-001A 可重复工程骨架实现
- User outcome: 建立后续开发可复用的 Web/API/PostgreSQL 工程入口与统一根门禁，不提前实现身份或业务功能。
- Review mode: Learning mode
- Review finding: 只读顾问未发现阻塞性偏离，并要求用真实 Web/API/PostgreSQL 路径、进程级缺失配置失败、空业务迁移和根 CI 脚本证明边界。
- Options considered: 只提供静态脚手架；测试依赖预先构建的 workspace `dist`；让测试直接解析 workspace 源码并以构建产物做独立 smoke。
- Adopted decision: 采用第三条路径；单元/集成测试显式解析工作区源码，构建后 smoke 单独启动 API 产物，并实际连接 PostgreSQL 18。
- Implementation evidence: 根 workspace/锁文件/CI/Compose，`apps/web`、`apps/api`、`packages/*`、空 Prisma 迁移，以及单元 4/4、集成 2/2、迁移幂等、build 和 Web/API/PostgreSQL smoke 结果。
- Lesson: 可重复工具链不能依赖未声明的执行顺序；测试、构建和烟测应分别证明源码边界、产物边界与真实基础设施边界。
- Better future prompt: “请从冻结锁文件安装开始，分别验证源码测试、空库迁移幂等、构建产物启动和真实 PostgreSQL 健康检查；任何一步不得依赖未写入根脚本的前置动作。”
