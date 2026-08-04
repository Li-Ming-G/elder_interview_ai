# Project Iteration Journal

## Current Snapshot
- Product goal: 帮助倾听员可靠完成长者人生故事访谈，保存可追溯的原始资料，并由 AI 提供跨会话记忆和候选追问；MVP 不自动生成完整传记。
- Current stage: 探索期 MVP 核心纵向链路验证；DEV-002 已完成内部 seam，DEV-003A 候选在 GitHub REVIEW，CON-010 已通过 ADR-016 解决并解锁 DEV-003B。
- Architecture: 模块化单体；Node 24.18、pnpm 11.15 workspace、React/Vite、NestJS、Prisma 7/PostgreSQL；录音、ASR、AI 三条链路解耦。
- Constraints: 原始录音、原始转录和原始授权记录不可覆盖；AI/ASR 故障不得影响原始录音；AI 结论必须回链确定态转录；不得提前实现 MVP 外功能。
- Open questions: “拾光”是否为正式品牌名；ASR/LLM/对象存储最终供应商；CON-006/007；进入真实身份/试点前解决未知账号登录失败的合法审计 actor/载体（CON-008）。

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

### D-005 — 高风险候选先推送 GitHub，再由项目负责人独立审查
- Status: adopted
- Evidence: 用户于 2026-08-04 明确要求后续开发完成后先提交 GitHub，并由本人处理审查；`AGENTS.md`、`00`、`09`、`10` 与 CON-011 已同步。
- Reason: 项目负责人需要直接查看 GitHub diff、CI 和提交历史，并掌握最终审查结论。
- Tradeoff: 任务在本地测试和 push 后仍保持 `REVIEW`，必须等待负责人意见，交付节奏增加一次外部往返。
- Boundary: 实现者仍负责本地测试、迁移和交接；push/PR/CI 不等于通过；审查证据必须绑定 commit 与 PR。

## Assumptions to Validate

### A-001 — “拾光长者传记项目”与正式文档中的“AI 辅助长者访谈系统”是同一项目
- Evidence: 用户在当前工作区发出总控指令，但“拾光”未出现在正式项目文件中。
- Validation: 由项目负责人确认正式品牌名；确认前不改产品正式名称。
- Status: open

### A-002 — 当前目录应新建独立 Git 仓库
- Evidence: 首次检查未发现 `.git`，用户要求总控管理 Git，且后续任务要求提交级交接。
- Validation: 2026-08-04 已在当前登录账号创建 private `Li-Ming-G/elder_interview_ai`，设置 `origin`，推送 `main` 与 `codex/mvp-v01-vertical-slice`，并创建 Draft PR #1。
- Status: confirmed

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
- Implementation evidence: 提交 `fb99560`；全新 clone 的冻结安装、单元 6/6、集成 2/2、空库迁移幂等、build、真实资产 Web/API/PostgreSQL smoke、Chromium E2E 1/1 和干净 Git 状态；REV-006 PASS。
- Lesson: 可重复工具链不能依赖未声明的执行顺序；测试、构建和烟测应分别证明源码边界、产物边界与真实基础设施边界。
- Better future prompt: “请从冻结锁文件安装开始，分别验证源码测试、空库迁移幂等、构建产物启动和真实 PostgreSQL 健康检查；任何一步不得依赖未写入根脚本的前置动作。”

### 2026-08-02 — DEV-001B 身份安全基础实现
- User outcome: 不提前建立项目业务表，交付可撤销本地身份、服务端会话、浏览器安全边界和逐资源授权 seam。
- Review mode: Correction mode（唯一独立预审已在开工前完成）。
- Review finding: 真实项目隔离留给 DEV-002；未知账号失败无法按现有 audit actor 契约合法落表。
- Adopted decision: 只增加 user/session/throttle/audit 身份表；授权接收 actor/role/持久层派生 context；全局 Origin 和默认拒绝 CSRF 保护写路由；未知账号审计登记 CON-008，不把 throttle 冒充审计。
- Implementation evidence: auth 10/10、unit 6/6、integration 2/2、format/lint/typecheck/build/smoke、迁移首次/status/重复 deploy、prod audit 通过；总控沙箱外 Chromium 1/1（10.1s），端口无残留。
- Lesson: 安全事件能否审计取决于数据模型能否合法表达未知主体，不能滥用 system_operator 伪造 actor。

### 2026-08-02 — DEV-001B REV-007 安全回归修复
- Review finding: 先查阻断再在另一事务计数会留下阈值并发竞态；不检查登出响应会把服务端失败伪装为本地退出；只有授权 service 而没有 Nest Guard 不能证明 HTTP 角色门禁。
- Adopted decision: 使用短事务 provisional reservation，在事务外执行 Argon2，再以短事务结算成功；Web 对陈旧 CSRF 轮换重试且失败保留登录态；已知 actor 的认证/权限失败同步审计；CLI 数据变化与审计同事务。
- Evidence: 预置 4 次失败后的并发真实 PostgreSQL 测试全部 401；auth 13/13、unit 8/8、integration 2/2 以及静态、构建、迁移和 smoke 门禁通过。
- Boundary: 未知账号审计仍由 CON-008 阻塞；不改正式契约、不创建 project/assignment，Chromium 与独立安全结论交总控和复审角色。

### 2026-08-03 — 探索期 MVP 优先级重基线
- User outcome: 先用最小纵向链路验证核心产品假设，治理和生产化门禁按当前风险分层，不让未来部署问题阻塞本地内部原型。
- Review mode: Correction mode；独立只读评估支持分层门禁与有限并行，并警告不得把 DEV-001B 或父 DEV-001 伪造为 DONE。
- Adopted decision: 新增 ADR-013；区分内部原型可集成、任务 DONE、真实试点可发布；固定 DEV-001B 候选 `ab9628b`，CON-008 只阻塞最终身份验收/真实部署；建立 MVP-V01，并有限并行 DEV-002 与 DEV-003A。
- Evidence: 正式入口、测试、协作、任务板、追溯、冲突、ADR、任务卡和交接同步；DEV-001B 收束时 format/lint/typecheck/unit 8/8/diff check/prod audit 通过，Docker daemon 未运行导致数据库与增强 Chromium 当次无法复跑并已登记。
- Lesson: “能继续验证”与“已经完成/可发布”必须分别陈述；探索期可以降低非当前风险的流程成本，但不能降低原始数据、授权和证据链底线。
- Better future prompt: “请指出该问题阻塞的是内部原型、任务最终验收还是真实试点，并只对受影响层级设置门禁；给出可回退的最小 seam 和证据。”

### 2026-08-03 — 首批有限并行实现与审查
- Outcome: DEV-002 在 CON-009 前只交付合同中立访问/start 策略；DEV-003A 交付浏览器本地可靠音频候选，不扩展到服务端上传。
- Review correction: 独立审查连续发现 creator-owner 越权、并发双 start、ACK 后序号复用及时间轴归零；均在提交前修复并加入回归测试。
- Evidence: `1085ae6`、`41d6104`；总控 format/lint/typecheck、10 files/45 tests、build、diff check、prod audit 通过；REV-008 最终内部候选 PASS、P0/P1=0。
- Boundary: DEV-002 因 CON-009 BLOCKED；DEV-003A 只进入 REVIEW，真实 Chromium 与长时/崩溃恢复仍为 P2，禁止真实访谈。
- Lesson: 原始分片可靠性不仅是“ACK 前不删”，还包括 ACK 后仍持久保存序号和时间轴进度；资源 `created_by` 也不能在 assignment 规则未定时隐含等于 owner。

### 2026-08-03 — CON-009 选择捆绑授权方案 A
- Decision: 用户明确选择 A；一次授权覆盖录音/转录/AI，项目创建与创建者 interviewer assignment 同事务。
- Guardrail: `created_by` 仍只作审计，不产生 owner 权限；正式 start 重新读取全部门禁，不能信任客户端 can_record。
- Prototype boundary: 虚构内部数据可用 electronic/written；真实试点必须回到口头授权音频和完整发布门禁。
- Rationale: 与现有单次固定文本授权流程一致，能用最少状态验证核心链路；分别授权留到出现明确产品或合规证据时再评估。

### 2026-08-03 — DEV-002 最小项目—授权—会话纵向 seam
- User outcome: 把 A 方案变成可迁移、可调用、可并发验证的内部虚构数据业务链路，为录音服务提供稳定 project/session seam。
- Review correction: 初版只按 request ID 加锁和查审计，无法阻止不同键并发改变同一资源，还可能跨 actor/target 返回其他实体；总控另发现 assignment 撤销后不能允许旧键绕过当前授权。
- Adopted decision: 采用 ADR-015；持久化全局幂等绑定与首次响应快照，业务变化另按 project/session/consent 统一顺序串行，重放前仍检查当前 assignment。
- Evidence: `f16b82a`；REV-009 最终 PASS（P0/P1/P2=0）；migration deploy/status、integration 7/7、auth 13/13、unit 45/45、format/lint/typecheck/build/diff check/prod audit 全通过。
- Boundary: `recorded_verbal` 因 CON-010 失败关闭；当前 DONE 只代表 electronic/written 虚构数据内部范围，不代表真实试点授权、音频链路或生产部署通过。
- Lesson: 幂等键只能识别重放，不能代替资源并发控制；首次结果、操作者、目标和当前授权必须同时成立，才不会把“防重复”变成越权或竞态入口。

### 2026-08-04 — GitHub 人工审查与音频对象契约
- User outcome: 继续核心纵向开发；开发完成后先提交 GitHub，后续由项目负责人在 GitHub 审查并返回意见。
- Review mode: Correction mode。
- Review finding: GitHub 是交付/审查载体而非验收结论；优先关闭 CON-010 和服务端原始音频保存，比单独补浏览器证据更接近当前核心目标。
- Options considered: 先补 DEV-003A Chromium；绕过口头授权继续 AI fixture；先统一 audio object 契约并实现 DEV-003B，再做首次前后端 Chromium 集成。
- Adopted decision: 采用第三条；建立 private repo 和 Draft PR #1；高风险候选保持 REVIEW 等负责人结论；ADR-016 用项目级 audio object 分离 consent/interview purpose，避免授权录音循环。
- Implementation evidence: `AGENTS.md`、`00`、`04`、`05`、`06`、`09`、`10`、CON-010/011、ADR-016、DEV-003B 与 HO-011；GitHub `Li-Ming-G/elder_interview_ai` / PR #1。
- Lesson: “先 push 再审查”改变的是证据流和责任边界，不降低实现者的测试责任；授权前音频必须有独立于正式访谈 start 的对象生命周期。
- Better future prompt: “完成本地测试后推送到指定 private GitHub PR，保持 REVIEW；我按 commit SHA 返回审查结论。下一步优先解决授权音频与访谈音频的对象归属，再实现可靠分片。”

### 2026-08-04 — DEV-003A/B 两端可靠保存候选

- User outcome: 先建立能保护原始音频的最小两端能力，并将高风险候选交 GitHub 项目负责人审查。
- Review mode: Learning mode；只读预审建议先闭合授权音频对象和服务端可靠保存，再补真实 Chromium 证据。
- Adopted decision: 本批次固定为服务端 audio object/不可变分片/manifest 与浏览器原生 MediaRecorder/IndexedDB 证据；浏览器自动上传编排作为父 DEV-003 的下一小步，不临时扩大候选边界。
- Implementation evidence: `134be76`；Prisma audio migration、`apps/api/src/audio`、recorded_verbal 存储复核、48 个单元测试、Chromium 2/2；本地 PostgreSQL 因 Docker/5433 不可用未验，转由 GitHub CI 提供环境证据。
- Boundary: 所有内容只使用合成或虚构字节；不代表真实麦克风、长时录音、云存储、真实试点或生产部署通过；DEV-003A/B 均保持 REVIEW。
- Lesson: 原始数据可靠性需要两类独立证据：浏览器 ACK 后仍保留序号/时间轴高水位，以及服务端 ACK 前确实完成不可变存储与元数据提交；任一端单独通过都不等于上传纵向链路已完成。
- Better future prompt: “请先把浏览器队列的失败保留/成功 ACK 语义接到已审查的 audio object API，并用稳定 request ID 或可安全采用 orphan 的协议验证响应丢失重试；不要扩展到 ASR。”
