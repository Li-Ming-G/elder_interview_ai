# Project Iteration Journal

## Current Snapshot
- Product goal: 帮助倾听员可靠完成长者人生故事访谈，保存可追溯的原始资料，并由 AI 提供跨会话记忆和候选追问；MVP 不自动生成完整传记。
- Current stage: 探索期 MVP 核心纵向链路验证；SPEC-DEV-005R、R1、R2C、R2 已完成，R2 的 OnePlus/Android Chrome 真机生命周期事实经 REV-024 通过；当前进入 R3 正式工作台恢复与安全结束体验，R4 最后做完整纵向收口。
- Architecture: 模块化单体；Node 24.18、pnpm 11.15 workspace、React/Vite、NestJS、Prisma 7/PostgreSQL；录音、ASR、AI 三链路解耦；正式访谈拟采用 session-scoped 单流 controller、浏览器 archive/delivery 分离和持久 capture generation。
- Constraints: 原始录音、原始转录和原始授权记录不可覆盖；AI/ASR 故障不得影响原始录音；AI 结论必须回链确定态转录；不得提前实现 MVP 外功能。
- Open questions: “拾光”是否为正式品牌名；ASR/LLM/对象存储最终供应商；CON-006/007/018/020/021/022；进入真实身份/试点前解决未知账号登录失败的合法审计 actor/载体（CON-008）。

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

### D-006 — 浏览器可靠上传必须持久化完整作业而非只有 Blob

- Status: adopted
- Evidence: `05` §3.6、`06` §3.5、ADR-015/017、DEV-003C；iteration-coach 独立预审指出 init/complete 响应丢失的恢复缺口。
- Reason: 服务端幂等只有客户端跨刷新复用稳定 request ID 才能闭合；ACK 会删除 Blob，因此 expected count 也不能从剩余队列推导。
- Tradeoff: IndexedDB 增加 upload job store、状态机和严格响应校验；换取刷新/响应丢失后不重复建对象且可确定恢复。
- Boundary: 一个 job 对应一个连续 audio object；内部虚构音频、有限重试，不引入 Service Worker、无限后台同步或多对象会话设计。

### D-007 — ASR 先锁定 final-only 证据核心再接实时传输与供应商

- Status: adopted
- Evidence: `00` 的 MVP-V01 允许内部确定态测试转录；`04` 至 `06`、ADR-018、DEV-004/004A；iteration-coach 独立预审指出 WebSocket、校准和供应商契约尚不足以并行实现。
- Reason: 后续记忆首先需要稳定 segment ID、不可覆盖原文和原角色；供应商、实时传输、校准与重连同时开工会把未决协议固化进核心模型。
- Tradeoff: DEV-004A 能解锁后端证据消费但不能演示浏览器实时字幕，父 DEV-004 仍需 B/C。
- Boundary: 只用虚构文本与 local/test fake；interim 不落库；不开放注入写 API，不接真实供应商、WebSocket、AudioWorklet 或校准/remap。

### D-008 — 首轮页面以转录优先的单问题三页闭环验证核心假设

- Status: adopted
- Evidence: 项目负责人在“前端页面与内容规划”对话中确认准备页、工作台、结束页及单问题/换一个方向，并要求总控写入未来规划；ADR-020、SPEC-FE-001。
- Reason: 核心学习是倾听员能否依靠实时对话上下文和一个最佳下一问完成更深入访谈，而不是先验证多项目管理、复杂编辑或建议操作统计。
- Tradeoff: 首轮不验证项目导航、完整回顾/导出 UI 和采用率；建议价值改用替换率、人工观察/访谈后评价、重复率和高风险问题率。
- Boundary: 页面不得弱化正式授权、原始数据可靠保存和安全结束；项目管理、回顾、导出/删除 UI 与多次访谈只是后置；替换的精确数据/API 契约由 SPEC-AI-QUESTION-001 冻结。

### D-009 — 安全结束由服务端事实驱动并分层实现

- Status: adopted
- Evidence: 项目负责人对 PR #6 head `e93db16` 的 REV-015；现有 `ProjectFoundationController/Service` 只到 start，`05` 的 stop/recover 只有路径占位，公共 session response 不含结束时间/时长；ADR-021、CON-019。
- Reason: 原始分片是否完整、final 转录是否收束和 session 何时完成不能由浏览器可靠决定；必须先有服务端状态机和跨链路事实，再由页面展示。
- Tradeoff: DEV-005 从 A/B 增加为 A/B/C/D，并新增一个契约任务；准备页仍可先行，但完整三页闭环需要等待服务端结束编排。
- Boundary: 当前只冻结任务责任和占位状态，不在页面规划 PR 中猜测 stop/recover 的精确字段；SPEC-SESSION-END-001 通过前不得实现或模拟完成。

### D-010 — 产品讨论门槛先于实现任务

- Status: adopted
- Evidence: 项目负责人明确要求从 DEV-005 起由总控设计和发放问题讨论提示词，在新的项目任务中讨论，完成后交回总控验收；`DISC-005D` 为首个门槛。
- Reason: 产品行为、失败处置和用户可观察验收不能由实现 Agent 静默决定，但纯工程细节也不应重复进入产品讨论。
- Tradeoff: 每个重大阶段多一次讨论与验收，但减少返工、口头结论漂移和实现者代替用户决策的风险。
- Boundary: 讨论窗口只提交候选决定包，不修改正式依据或开发；总控验收通过并写回后才下发实现。锁、索引、组件拆分等可回退实现细节不默认进入讨论。

### D-011 — 正式访谈由单流控制器和采集代贯穿 start 到 stop

- Status: adopted
- Evidence: 项目负责人批准 DISC-005-R0 与 A-R/B-R/C-R/D-R；现有正式准备页、audio harness、实时工作台和 DEV-005C finalization 各自通过但没有同一录音作业所有权；CON-020、SPEC-DEV-005R、ADR-023。
- Reason: 原始录音、上传和实时 PCM 若由不同页面/流临时拥有，就无法证明 stop 使用 start 创建的同一对象，也无法在刷新或意外中断后恢复一致时间轴。
- Tradeoff: 新增 capture generation、浏览器 archive 驻留、路由上层 controller 和分阶段实现；换取唯一对象、原始证据优先、显式中断与可审查纵向链路。
- Boundary: 当前仅内部虚构数据、单浏览器单标签、进程内服务；不承诺跨设备、永久本地备份、云存储、真实 ASR 或真实试点。CON-020 在真实 Chromium 实现 PASS 前保持 OPEN。

### D-012 — 页面注意力随访谈状态变化，Android Chrome 是首轮完整主设备

- Status: adopted
- Evidence: 项目负责人逐项确认 `DISC-005R-UI`；正式产品、流程、音频、验收规范及 SPEC-DEV-005R、DEV-005R2/R3/R4 已同步，ADR-024、CON-021、HO-040 记录边界。
- Reason: 正常录制的首要任务是持续阅读转录，中断和结束时的首要任务则是保护证据并完成处置；固定页面比例无法表达状态变化。手机也不是桌面的应急恢复入口，而是长者访谈的完整主设备。
- Tradeoff: R3 必须覆盖五个视口和全状态注意力层，R2/R4 必须增加 Android Chrome 真机生命周期证据；首轮不同时承诺 iPhone Safari。
- Boundary: 比例是视觉护栏，实现使用受控 header/footer 与中间 `1fr`，不得硬编码百分比。Android 后台、锁屏、页面隐藏和音频设备中断究竟继续采集还是进入 interrupted，必须由 R2 真机证据与正式契约冻结；CON-021 未解决前 R3 不得猜测。

### D-013 — Android 生命周期按采集健康事实而非页面可见性判定

- Status: adopted
- Evidence: REV-024；OnePlus GM1900 / Android 12 / Chrome 150 正式路由约 6 分 20 秒、372 片无缺口；旋转/后台/锁屏保持同一 controller，刷新与撤销麦克风权限分别以正式 reason 中断。
- Reason: `visibilitychange`、旋转或锁屏只是平台事件，不能单独证明音频仍在采集或已经失败；archive 连续性、track/recorder 状态和 controller identity 才是可验证事实。
- Tradeoff: 首个设备允许健康时继续，减少无意义中断；但不能把单台设备结果宣传成所有 Android 的后台保证，R4 和未来平台版本仍需复验。
- Boundary: 刷新必须 `page_recovery_detected` 且不自动请求麦克风；track ended 必须 `microphone_ended`；R3 只展示并驱动恢复/结束，不能改写 controller 判定。

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
- Implementation evidence: `134be76`、认证 E2E 稳定性修复 `7e95bdf`；Prisma audio migration、`apps/api/src/audio`、recorded_verbal 存储复核、48 个单元测试、Chromium 2/2；GitHub CI `30872055084` 补齐 migration/integration/auth/E2E 并 PASS。
- Boundary: 所有内容只使用合成或虚构字节；不代表真实麦克风、长时录音、云存储、真实试点或生产部署通过；DEV-003A/B 均保持 REVIEW。
- Lesson: 原始数据可靠性需要两类独立证据：浏览器 ACK 后仍保留序号/时间轴高水位，以及服务端 ACK 前确实完成不可变存储与元数据提交；任一端单独通过都不等于上传纵向链路已完成。
- Better future prompt: “请先把浏览器队列的失败保留/成功 ACK 语义接到已审查的 audio object API，并用稳定 request ID 或可安全采用 orphan 的协议验证响应丢失重试；不要扩展到 ASR。”

### 2026-08-04 — REV-010 项目负责人通过 DEV-003A/B

- Review evidence: 项目负责人确认 PR #1 head `936fd0408023ba074d2670576626e226f859923e` 未漂移，声明范围、实现和 CI 一致；结论 PASS，P0/P1 为 0。
- Closed scope: DEV-003A 原生浏览器录音/持久化内部原型与 DEV-003B 服务端可靠保存内部原型转 DONE；父 DEV-003 仍 IN_PROGRESS。
- Non-blocking findings: 临时文件 write/sync 失败清理与存储缺失冲突恢复列入下一实现批次；授权音频跨 `consent_text_version` 复用登记 CON-012，真实试点前决策。
- Lesson: 审查通过必须绑定不可漂移的 head，同时把“任务卡内通过”和“父链路/真实试点未通过”并列记录；非阻塞意见不能被 PASS 吞掉，也不能反向伪造为当前任务失败。

### 2026-08-04 — DEV-003C 浏览器可靠上传纵向候选

- User outcome: 合并已通过的两端音频基线后，继续打通最小可靠上传，开发完成先提交 GitHub 由项目负责人审查。
- Review mode: Correction mode；独立只读预审指出只持久化 Blob 无法处理 init/complete 响应丢失，必须持久化完整 upload job。
- Adopted decision: IndexedDB v3 保存稳定 create/chunk/complete request ID、audio object、冻结 count 与状态；先解决两项存储 P2，再接顺序上传、严格 ACK 和 complete，不引入 Service Worker 或生产基础设施。
- Implementation evidence: `d47b56d`、`b3376d9`、`d85311a`、`2768ab1`、`7d7785a`；本地 unit 56/56、Chromium 3/3；PR #2 与 GitHub CI `30875678125` 全门禁 PASS。
- Correction learned from CI: 原生 `performance.now()` 是小数，而正式 API/PostgreSQL 时间字段为整数；真实 API E2E 在 mock E2E 之后发现该契约缝隙。采集端现生成连续且严格递增的整数毫秒，不放宽服务端契约。
- Boundary: 候选只覆盖内部虚构/合成音频；项目负责人未审查前 DEV-003C/父 DEV-003 不得 DONE；真实麦克风、长时、崩溃、多标签、云存储、ASR 和真实试点未覆盖。
- Lesson: mock E2E 适合证明重试状态机，但不能替代真实 API 纵向测试；跨层数值类型（小数时钟到数据库整数）必须在真实契约边界验证。
- Better future prompt: “请同时提供可控失败的 mock 浏览器 E2E 和连接正式 API/数据库的纵向 E2E；逐字段验证浏览器生成值是否满足服务端 DTO 与持久层类型。”

### 2026-08-04 — REV-011 项目负责人通过并合并 DEV-003C

- Review evidence: 项目负责人锁定 PR #2 head `1aa643a29a33fca00fb8e82d37ad3002b2a4fca5`，确认非 Draft、可合并且未漂移；最终 CI `30875834803` PASS；结论 PASS，P0/P1 为 0。
- Closed scope: DEV-003C 与父 DEV-003 在内部虚构/合成音频范围转 DONE；PR #2 以 merge commit `bdf29108d8a650fedeefbab70db4f8c37cb12c25` 合入 main。
- Boundary: 真实麦克风、长时、浏览器进程崩溃、多标签、真实配额、云存储、ASR 和真实试点仍未通过；CON-012/013 保持真实试点门禁。
- Non-blocking finding: 查询参数启用的内部 audio harness 在生产或真实试点前必须移除或严格限制；登记 CON-013，不阻塞 DEV-004 内部开发。
- Lesson: 审查后先合并锁定 head，再在 main 做收口文档，可以同时保持审查对象不可漂移和项目状态可追溯。

### 2026-08-04 — DEV-004 拆分与确定态证据优先

- User outcome: 在录音可靠链路通过后继续进入实时 ASR 与说话人阶段。
- Review mode: Correction mode。
- Review finding: DEV-004 是路线级工作包；当前 WebSocket 鉴权/PCM/恢复、校准 start 门禁、speaker 修正模型和真实供应商均未完整定义，不能一次性开工。
- Options considered: A）先 final-only 后端证据核心；B）同时加入业务 WebSocket 与 fake ASR；C）立即接真实供应商。
- Adopted decision: 采用 A，建立 DEV-004A；用供应商中立 adapter 与内部 fake 验证 final 幂等落库、interim 不落库、原文/原角色保留和故障隔离，再按 B/C 推进实时传输与校准。
- Implementation evidence: `04` 至 `06`、ADR-018、CON-014/015/016、DEV-004/004A 任务卡、任务板和 HO-017；代码与迁移尚未实现。
- Lesson: 实时 ASR 最危险的首个决策不是选供应商，而是定义哪些结果能成为不可变业务证据；先稳定证据身份和原始/修正边界，才能让供应商与传输可替换。
- Better future prompt: “请先实现供应商中立、final-only、幂等且保留原文/原角色的转录存储 seam；fixture 仅限测试，不开放写 API；WebSocket、AudioWorklet、校准和真实供应商另拆。”

### 2026-08-04 — DEV-004A 确定态转录证据核心候选

- User outcome: 继续 MVP 核心链路，在不引入真实供应商和实时协议的前提下，为后续记忆建立稳定、可追溯的 final segment。
- Review mode: Correction mode；开工前唯一独立只读预审已把路线级 DEV-004 收敛为 DEV-004A。
- Adopted implementation: 新增 append-only speaker mapping、final-only transcript segment、稳定 ingest key、供应商中立 result、local/test fake、受信 ingestion seam 和 assignment-aware 内部 query；不新增 REST/WS。
- Corrections during implementation: provider payload 被纳入 canonical 幂等比较但从 DTO 排除；受限项目即使仍有 assignment 也对普通角色失败关闭；interim 在门禁通过后明确零落库。
- Evidence: 实现与 CI 纠错提交截至 `b34205f`；format、ESLint、全仓 typecheck、Prisma generate/validate、全仓 build 通过；unit 14 files / 63 tests PASS；GitHub CI `30886820301` 的 migration、integration、auth、smoke 与 E2E 全部 PASS。
- CI corrections: 首轮发现动态 TranscriptionModule 未在自身作用域注册 `API_CONFIG`；次轮发现 PostgreSQL text 不接受 advisory lock key 中的 NUL。分别改为显式复用应用配置，以及固定 UUID 前缀加冒号的 PostgreSQL-safe lock key。
- Local limitation: 本机 Docker daemon 未运行且 `TEST_DATABASE_URL` 未配置，因此数据库验证证据来自 GitHub 隔离 PostgreSQL，而不是本机复跑。
- Lesson: 供应商中立不仅是字段命名中立；重放等价性、原始 payload 私密性、映射快照时点和 restricted 读取门禁也必须在持久化 seam 中固定，否则稳定 segment ID 仍可能掩盖证据漂移或越权。
- Boundary: 候选不代表 DEV-004 完成；真实 ASR、WebSocket、AudioWorklet、校准/remap、故障区间、补转录、真实数据与生产部署仍未覆盖。

### 2026-08-04 — REV-012 通过并合并 DEV-004A

- Review evidence: 项目负责人锁定 PR #3 head `917f88827b80c88bba8515f0fe9aa0d92bb430c2`，确认非 Draft、可合并且未漂移；最终 CI `30887031030` 全门禁 PASS；结论 PASS。
- Closed scope: DEV-004A 在内部虚构数据证据核心范围转 `DONE`，PR #3 以 merge commit `2098d9f41de92e61baa3079d7037e00022745899` 合入 `main`。
- Boundary: 父 DEV-004 保持 `IN_PROGRESS`；实时 WebSocket/PCM、前端事件、校准/remap、真实供应商、故障区间、离线补录和真实试点仍未通过。
- Follow-up hardening: 后续补同 ingest key 并发 PostgreSQL 测试，以及 provider payload 接近 64 KiB 时应用序列化与 `jsonb::text` 数据库约束的精确边界测试。
- Lesson: 数据核心通过后可以为实时链路提供稳定落点，但不能反向证明传输顺序、恢复、背压和用户体验；父任务状态必须按未验证的纵向链路继续保持开放。

### 2026-08-05 — DEV-004B 拆分与实时协议核心优先

- User outcome: 在 final-only 证据核心通过后继续打通实时 ASR 最小纵向链路。
- Review mode: Correction mode；唯一独立只读预审首次受平台额度中断，恢复同一 Agent 后完成，不另开第二个预审角色。
- Review finding: 同时实现服务端协议、浏览器 PCM、重连 UI、AudioWorklet 和真实供应商仍过大；现有 HTTP middleware 不自动保护 upgrade，动态 `:sessionId` path 也不能直接获得 HTTP controller 路由语义。
- Options considered: 动态 path + 自定义 upgrade router；静态 path + 强制 join；一次性交付前后端。采纳静态 `/ws/interviews` + join，并拆 B1 服务端/B2 浏览器。
- Adopted decision: B1 使用 Cookie/Origin upgrade、join 内存 CSRF、assignment/project/consent/session/单 producer 门禁；JSON/base64 16 kHz mono PCM s16le 100 ms 固定帧；20 帧背压；服务端事件严格序号；512 事件或 5 分钟进程内恢复；final 先经 DEV-004A 落库再发布。
- Tradeoff: base64 有约三分之一传输开销且 B1 不能演示浏览器字幕，但避免在核心业务语义未验证前固化二进制 header、自建动态 router 或引入持久 outbox。
- Boundary: B1 不改 Web UI/Prisma，不接真实供应商、麦克风、AudioWorklet、校准/remap、故障区间或离线补录；B2 在 B1 contracts 提交前不得并行。
- Evidence: `05` §5、`06` §4/§9/§11、ADR-019、DEV-004B1 任务卡、任务板与 HO-021。
- Lesson: WebSocket 的握手、join 和流内消息属于三个不同授权时点；沿用 HTTP 登录并不自动意味着 upgrade 与长连接内持续操作安全，必须显式定义每层门禁和撤销语义。
- Better future prompt: “请先实现静态 WebSocket 服务端协议核心，用合成 PCM 证明 join 鉴权、帧序/背压、final 落库后发布与短时恢复；共享 contracts 提交后再实现 Chromium 客户端，不接真实麦克风或供应商。”

### 2026-08-05 — DEV-004B1 实现与总控补强

- Implemented: Nest native WS、pre-101 Origin/Cookie、严格 8 KiB JSON/PCM、join 与逐帧撤销门禁、串行音频队列、单 producer、短时 replay、server-only fake 和 final 落库后发布。
- Correction during implementation: 初版异步 message handler 可并发越过 sequence，resume-only 无游标失败后也会继续执行；总控要求 promise 串行泵、关闭短路和明确 return，并以回归测试锁定。
- Evidence correction: 初版单测未覆盖 fake 故障、21 帧背压、ACK 回退/未来、错误/淘汰游标和无 assignment join；补齐后本地 unit 为 18 files / 87 tests。
- Verification boundary: 本地 format/lint/typecheck/build/unit/audit/diff PASS；无 Docker/5433，真实 WS/PostgreSQL 与 smoke 不能声称通过，转交 GitHub CI。
- Lesson: WebSocket 顺序契约不能仅依赖 JavaScript 单线程；每个 `message` 回调启动的 Promise 仍会并发，必须显式串行化并定义关闭时队列语义。恢复窗口也需要同时验证 stream identity 与游标保留范围。

### 2026-08-06 — REV-013 通过并合并 DEV-004B1

- Review evidence: 项目负责人锁定 PR #4 head `80ff1c7294ad984e6173967705dde4b422eac474`，确认非 Draft、可合并且未漂移；最终 CI `30969408276` 全门禁 PASS；P0/P1 为 0。
- Closed scope: DEV-004B1 在服务端内部合成 PCM 协议核心范围转 `DONE`，PR #4 以 merge commit `13350a487c3754272f01b67a9b060db54a27184b` 合入 `main`。
- Boundary: 父 DEV-004 仍 `IN_PROGRESS`；B2、浏览器字幕、真实麦克风/ASR、AudioWorklet、校准/remap、持久/跨进程恢复、长时性能和生产部署未通过。
- Follow-up hardening: 长时前清理 runtime frame/final-ID 集合；B2/长连接前 heartbeat/ACK 重验 assignment；B2 错误展示前区分不泄密的内部/持久化失败。
- Lesson: 短时 replay 的事件窗口不自动约束所有运行时集合；权限撤销也必须覆盖不携带业务数据但会维持资源占用的心跳路径。错误分类应同时满足不泄密与可运维，不能把所有内部失败伪装成权限拒绝。

### 2026-08-06 — 协作文档当前态与历史态分离

- User outcome: 降低 Agent 接手时的阅读成本，同时保留审查和交接的完整追溯证据。
- Review mode: 机械治理整理；未改变产品或技术契约。
- Adopted decision: 保留原文件名作为当前索引；原审查/交接正文整体迁移到 `docs/agent/reviews/` 和 `docs/agent/handoffs/`；新增协作入口和 OPEN 冲突快速索引。
- Implementation evidence: `AGENTS.md`、`00-项目说明与执行入口.md`、`docs/agent/README.md`、`docs/agent/04-review-report.md`、`docs/agent/05-handoff-log.md`、`docs/agent/02-open-conflicts.md`、`docs/agent/handoffs/DOC-002.md`。
- Tradeoff: 暂不把历史卷拆成大量单篇文件，避免当前引用迁移和编码风险；后续可按任务逐步拆分。
- Lesson: 协作记录的关键不是删除历史，而是把动态状态、当前入口和审计证据分成不同层级。

### 2026-08-07 — DEV-004B2 浏览器实时纵向链路预审

- User outcome: 每个明确 DEV 阶段由新的实现 Agent 承接，总控冻结提示词、边界、验证与 Git，使历史留在任务卡、提交和交接中。
- Review mode: Correction mode；唯一独立只读预审确认 B2 适合启动，但不能只做字幕演示。
- Review finding: heartbeat/event ACK 撤权复核与内部错误分类已到触发时点，必须随 B2 关闭；runtime 集合清理只在长时访谈前成为门禁。
- Options considered: 单独后端加固后再启前端 Agent；或由一个 B2 纵向实现 Agent完成两项小型服务端加固与浏览器客户端。采用后者，避免额外任务卡/分支/PR，同时保持一张冻结任务卡对应一个实现 Agent。
- Adopted decision: B2 使用真实 Chromium、合成 PCM、独立 transport/state machine 和薄 harness，验证 interim/final、ACK、20 帧背压和同页面短时恢复；新增 `REALTIME_UNAVAILABLE/4500`，长连接非音频消息重验资源权限；不接真实麦克风、AudioWorklet、真实供应商或正式工作台。
- Implementation evidence: 当前仅有正式契约、任务卡、ADR-019 补充和 HO-026；代码实现与测试证据待实现 Agent 交付后补充。
- Lesson: 新 Agent 能隔离执行上下文，但不能自动保存历史；稳定历史来自冻结任务卡、唯一责任人、commit/PR 和结构化交接。
- Better future prompt: “请按已冻结的 DEV-004B2 任务卡启动一个新的纵向实现 Agent；只做真实 Chromium 合成 PCM、字幕、背压和短时恢复，并关闭已到触发点的撤权复核与内部错误分类，完成后交总控验证和 GitHub 审查。”

### 2026-08-07 — DEV-004B2 实现候选与总控收口

- User outcome: 独立项目任务对话完成 B2 后，由总控锁定实现、补齐证据并准备 GitHub 审查。
- Review mode: Review-and-fix，主模式 integration；执行者结果不代替项目负责人独立 PASS。
- Review finding: 实现范围与任务卡一致；总控发现客户端未严格核对 ready/audio ACK 的 `audio_stream_id`，且真实 Chromium 场景未直接查询 final 持久化和 ASR 故障前后音频数据快照。
- Adopted decision: 拒绝跨 stream ACK；auth Chromium 直接读取隔离 PostgreSQL 形成最终落库与数据不变证据；保持无公开注入、无真实麦克风/ASR边界。
- Implementation evidence: 独立实现 `b3d1678`，纯 B2 分支等价实现 `87dd225`，总控补强 `ce67549`；本地 format/lint/typecheck/build、unit 103、普通 Chromium 4/4 PASS。
- Verification boundary: 无 TEST_DATABASE_URL/PostgreSQL/Docker；smoke 因 API/database 未 ready 失败，migration/integration/auth/auth Chromium/smoke 交 GitHub CI，REV-014 保持 PENDING。
- Lesson: ACK 不只是“序号够不够大”，还必须与当前 stream identity 绑定；否则重连或服务端串流错误可能让客户端错误丢弃仍未确认的数据。
- Better future prompt: “请在浏览器实时链路中分别验证 audio/event cursor，并要求所有 ready/ACK 同时匹配 stream identity；真实 E2E 必须直接证明 final 已持久化且故障不改原始音频数据。”

### 2026-08-07 — REV-014 首轮 NEEDS_CHANGES 与协议终止语义修复

- Review evidence: 项目负责人锁定 PR #5 head `70b8f2d` 和 CI `31140269703`，确认整体链路接近通过，但两项 P1 违反明确验收标准。
- Failure 1: join 鉴权失败前没有绑定请求 session，错误信封使用 NIL UUID而被客户端忽略；随后 close 被当作可重连网络故障，最终误报 internal。
- Failure 2: 客户端先推进 event cursor 再应用事件；跨 stream ready/ACK 或 sequence gap 虽标记失败，仍会 ACK、重发 PCM 并维持 socket/timer。
- Adopted fix: 已通过格式校验的 join 立即绑定 session 仅用于安全错误信封；事件必须成功 apply 才推进 cursor/ACK/重发；terminal/reset 成为不可继续的本地状态，关闭 socket、清理 timer 并拒绝后续 frame；close code 作为错误信封丢失时的分类后备。
- Evidence: 修复 `6fd228f`；定向 33 tests、全仓 109 unit、format/lint/typecheck/build、Chromium 4/4 和 diff check 本地 PASS；新 head 数据库门禁仍交 GitHub CI。
- Lesson: “检测到协议错误”不等于“失败关闭”。顺序型客户端必须让验证、状态应用、游标提交和副作用形成明确提交点；错误信封也必须在 join 尚未成功时具备可关联的请求身份。
- Better future prompt: “请用完整 transport 流程验证 join 错误和协议违例：失败后不得推进 cursor、ACK、重发、心跳、重连或新增帧；不要只测试分类函数或 UI error 字段。”

### 2026-08-07 — REV-014 定向复审 PASS 并合并 DEV-004B2

- Review evidence: 项目负责人锁定 PR #5 final head `73a07cb676a9787ca0fa25d1b1c3297c44cffa0a`，确认非 Draft、可合并且两项 P1 均闭环；CI `31143035668` 全部门禁 PASS；未发现新增 P0/P1。
- Closed scope: DEV-004B2 在内部虚构/合成 PCM 浏览器纵向链路范围转 `DONE`，PR #5 以 merge commit `49949fc51eedbada51b76a51090da8b665c206bc` 合入 `main`。
- Boundary: 父 DEV-004 保持 `IN_PROGRESS`；真实麦克风/ASR、AudioWorklet、校准/remap、长时、跨进程恢复、正式工作台和生产部署仍未通过。
- Lesson: 定向复审应锁定最终 head 并验证失败后的负副作用确实消失；CI 全绿不能代替协议终止语义审查，但能在修复后补齐数据库和浏览器组合证据。

### 2026-08-07 — 首次访谈页面与内容规划收敛

- User outcome: 先审阅独立对话“前端页面与内容规划”，再把已批准结论写入或修订未来规划。
- Review mode: Correction mode；iteration-coach 要求的唯一独立只读审阅确认不能只改一篇页面说明，必须阻止 DEV-005/007 继续消费旧三栏和采用生命周期。
- Options considered: 只新增一篇 UI 规划；直接在页面规划中重写数据库/API；分层同步产品路线并另设追问契约任务。采用第三种。
- Adopted decision: 当前优先切片为准备页、转录优先工作台和安全结束页；单次只显示一个问题及一句原因，或继续倾听；唯一操作是“没用，换一个”；项目管理、完整回顾、导出/删除 UI 和多次访谈后置。
- Contract handling: 本轮同步 `00/01/03/09/10/MVP-V01`，冻结 `04/05/07` 中旧动作作为实现依据；建立 SPEC-AI-QUESTION-001 关闭幂等、相似度和持久化细节，硬阻塞 DEV-007A。
- Task split: DEV-005A 准备/结束，DEV-005B 转录工作台，DEV-007A 后续接单问题建议；内部从预创建且已分配的虚构项目深链进入。
- Safety boundary: 页面确认不替代正式授权和服务端门禁；结束处理中不提前报成功；AI/ASR 故障不影响原始录音。
- Lesson: UI 决策一旦改变用户需要表达的状态，就会影响指标、数据和 API；应先冻结产品行为，再用独立契约任务解决实现细节，不能让页面 Agent 猜数据库。
- Better future prompt: “请按 SPEC-AI-QUESTION-001 只冻结一个当前最佳问题、继续倾听和幂等替换契约；真实已问问题从 final 转录识别，不恢复采用/已问按钮，不实现代码。”

### 2026-08-07 — REV-015 安全结束任务可执行性修正

- User outcome: 接受 PR #6 的页面方向，但要求任务卡不能让前端撞上未实现的 stop/recover；授权按审查意见修正。
- Review mode: Correction mode；iteration-coach 的独立只读预审确认安全结束是跨录音、上传、转录和 session 状态的服务端编排，不属于纯前端或 DEV-004 ASR 子任务。
- Review finding: controller/service 只实现到 start；数据模型虽有结束字段和状态，公共响应未暴露结束时间/时长；`05` 只有 stop/recover 路径占位，原 DEV-005A 的范围与验收互相矛盾。
- Options considered: 让 DEV-005A 模拟结束；把结束实现塞进 DEV-004；分为契约、服务端编排和前端薄集成。采用第三种。
- Adopted decision: 新增 SPEC-SESSION-END-001、DEV-005C、DEV-005D；DEV-005A 缩为准备页/路由外壳，DEV-005B 只保留结束挂载位置；stop/recover 在契约通过前明确不可调用。
- Implementation evidence: `05` 的占位警示、ADR-021、CON-019、DEV-005A/B/C/D 与 SPEC-SESSION-END-001 任务卡、任务板/追踪/审查/交接同步；本轮没有实现代码。
- Lesson: 状态枚举和路由名字不等于业务能力。只有服务端能够证明跨链路完成条件时，前端才有资格显示“完成”。
- Better future prompt: “请先核对安全结束是否已有可执行服务端契约和实现；若没有，将准备页、结束契约、后端收束和结束页分别拆卡，前端不得推算 completed。”

### 2026-08-07 — REV-015 定向复审 PASS 与前端实现解锁

- Review evidence: 项目负责人锁定 PR #6 final head `47f7b35b71a1621dd731c5e79384752b20c5121e`，确认非 Draft、可合并且 REV-015 P1 闭环；CI `31153878655` 全部门禁 PASS。
- Closed scope: PR #6 以 merge commit `474c647307b1ed3e949da31c4e490ee0b0b192c7` 合入 `main`；SPEC-FE-001 在页面规划和任务可执行性范围转 `DONE`。
- Next execution: DEV-005A 转 `READY`，启动提示词保存在 `docs/agent/prompts/DEV-005A.md`；SPEC-SESSION-END-001 保持 `READY`，可作为独立契约任务推进。
- Boundary: CON-019 保持 OPEN；DEV-005C/D 与父 DEV-005 保持 `BLOCKED`；页面规划 PASS 不代表 stop/recover、完整工作台或三页纵向闭环已经实现。
- Lesson: 解锁应发生在最小可独立验收的叶子任务，而不是为了表现进度把父任务或后续依赖一起改成 READY。

### 2026-08-07 — DEV-005A 开发期间的并行路线判断

- User outcome: 判断准备页开发期间是否应等待，或并行推进另一条能够缩短首次访谈纵向闭环的任务。
- Review mode: Learning mode；唯一独立只读预审核对任务板、任务卡、工作树和共享契约修改范围。
- Review finding: DEV-005A 已在独立 worktree 开工并集中修改 `apps/web`；`SPEC-SESSION-END-001` 已为 `READY`，只冻结服务端结束契约，二者前置事实稳定且主要文件边界不重叠。两个契约任务同时推进会共同修改 `04/05/08/09`，不适合并行。
- Options considered: 等待 DEV-005A；并行结束契约；改为并行单问题建议契约或续跑旧 DEV-006A 分支。
- Adopted decision: pending user choice；推荐 DEV-005A 与 `SPEC-SESSION-END-001` 两线并行。A 通过后启动 DEV-005B，结束契约通过后启动 DEV-005C，B/C 届时可前后端并行，最后由 DEV-005D 薄集成。
- Implementation evidence: 本轮只读核对 `main@322d2a0`、任务板、DEV-005A/B/C/D、ADR-021、CON-019 和 Codex 独立 worktree；未启动第二个项目任务、未改变任务状态或业务代码。
- Lesson: 是否并行不取决于任务名字不同，而取决于前置事实是否稳定、修改范围是否重叠，以及是否同时改变同一份契约。
- Better future prompt: “请检查当前任务板和 worktree，选择一个与正在开发任务文件边界独立、能缩短 MVP 关键路径的 READY 任务；先给并行建议，不要自动创建新对话。”

### 2026-08-07 — SPEC-SESSION-END-001 会话结束契约冻结

- User outcome: 让 DEV-005C/005D 不再猜 stop/recover、完成状态、撤权后的原始证据保全或失败语义，同时不提前实现代码和生产队列。
- Review mode: Correction mode；恰好一次独立只读预审指出现有 session 字段、普通 assignment 上传权限和短时 WS replay 无法同时证明 stop 前证据边界、撤权补传与进程重启恢复。
- Review finding: 必须先冻结唯一 interview audio object、MediaRecorder 停止后的逐片 commitment、持久 finalization/ASR terminal 和受限 evidence-finalization 权限；薄 DTO 会把核心竞态留给实现 Agent。
- Options considered: 只提交 object/count；继续要求当前 assignment；持久 finalization + commitments。前两者分别无法拒绝 stop 后新字节或会在撤权后丢失已产生证据，采用第三种。
- Adopted decision: pending project-owner review；候选规定 `stopping` 等 manifest、`processing` 等 ASR `drained|degraded|not_started`，raw complete + transcript terminal 才 completed；AI 不参与；runner/outbox 只替换调度 seam。
- Implementation evidence: `03` §12/§17.2、`04` §4.25-4.26、`05` §3.5、`06` §9-11、`08` §4.5、`09` §10.1、ADR-022、HO-032；本轮无业务代码或 migration。
- Lesson: 撤权后的“保存已有数据”不是放宽上传权限，而是把允许保存的字节集合在撤权前冻结；恢复协议需要持久业务事实，短时事件 replay 只能恢复显示。
- Better future prompt: “请先冻结 stop 时唯一录音对象、最终分片 count/commitment、撤权后的字节级补传权限和 ASR terminal；completed 只由持久服务端事实决定，进程内 runner 可替换但不能成为事实源。”

### 2026-08-07 — DEV-005A 首次访谈准备页与正式路由外壳

- User outcome: 倾听员从已分配虚构项目深链进入准备页，明确看到服务、授权和设备状态，只有服务端最终门禁允许时才能进入可供 DEV-005B 接续的工作台外壳。
- Review mode: Learning mode；唯一独立只读预审确认方向符合 ADR-020/021 与 CON-019，无需暂停。
- Review finding: 准备页必须采用客户端预判与服务端 start 最终判定的两级门禁；设备预检不能复用正式录音器，组件挂载不能自动创建 session。
- Options considered: 挂载即创建 session；复用 BrowserAudioRecorder 做设备检测；用户动作中短时检测并惰性创建 session。采用第三种，避免刷新堆积 draft session、start 前写录音分片或以页面状态替代授权事实。
- Adopted decision: 使用无新依赖的 pathname/history 薄路由；project 深链在成功设备预检后惰性创建 session 并替换为可恢复的 session 深链；短时 Web Audio analyser 检测结束立即释放 tracks；start request ID 在当前重试流程稳定复用。
- Implementation evidence: `apps/web/src/interview/`、`apps/web/src/app.tsx`、`apps/web/src/styles.css`、`tests/e2e/preparation.spec.ts`；unit 21 files/121 tests、build 与 Chromium 虚构主链路通过，最终完整门禁以 DEV-005A 任务卡和 PR 为准。
- Lesson: 准备页的核心不是把三个绿色状态相加，而是让客户端降低误操作、服务端在最后一刻重读 assignment/授权/session 并生成事实；浏览器设备可用也不等于业务获准开始。
- Better future prompt: “设备预检只短时持有 MediaStream、不创建录音分片；客户端状态仅预判，POST start 失败不得导航；session 在用户动作中惰性创建并在同页复用。”

### 2026-08-07 — REV-016 通过并合并 DEV-005A

- Review evidence: 项目负责人锁定 PR #7 final head `ea6c20f5cf88de6ab017ef2262217dd3eb423a1e`，确认非 Draft、可合并且未漂移；CI `31161076538` 全部门禁 PASS；P0/P1 为 0。
- Closed scope: PR #7 以 merge commit `066c424113c76da8ec15654a7216ac57aac2affe` 合入 `main`；DEV-005A 在内部虚构数据准备页和正式路由外壳范围转 `DONE`，DEV-005B 转 `READY`。
- Follow-up: DEV-005B 必须以真实 session/WebSocket 服务端事实替换 URL 占位状态，并按最新授权记录展示授权状态；两项均为不阻塞 A 的 P2。
- Boundary: 父 DEV-005、安全结束、完整工作台、真实麦克风/授权资料、真实 ASR/LLM、真实试点与生产部署仍未完成。
- Lesson: 占位路由可以先稳定页面边界，但不能成为业务事实来源；状态展示和权限提示必须最终与服务端采用同一条事实选择规则。

### 2026-08-07 — REV-017 首审发现撤权前后冻结边界冲突

- Review evidence: 项目负责人锁定 PR #8 head `e8fa20f39903aaf9f84a4dc4672d10ff25058933`，CI `31162831225` 全部门禁 PASS，结论 `REQUEST_CHANGES`，P0=0、P1=1。
- Review finding: `08` 禁止授权在首次 snapshot 前撤回后由客户端新建补传例外，但 `05` 首次 stop 未明确复核最新授权和项目限制；assignment 仍有效时可能事后创建 commitments。
- Adopted correction: 首次 stop 与无 finalization 的 `finalize_interrupted` 在同一 session 锁内复核最新授权有效、项目未受限；失败不创建 finalization/commitments，只保留服务端已可靠接收分片并进入/保持 `interrupted`。只有撤权前已经冻结的 snapshot 才启用受限补传。
- Implementation evidence: 定向修改 `05` §3.5.2/3.5.4、`08` §4.5、`09` §10.1 及 REV-017/CON-019/任务/交接记录；业务代码仍未实现。
- Lesson: assignment 证明“谁原本能操作项目”，授权证明“此刻是否还能建立新的处理边界”；两者不能互相替代。撤权后的证据保全必须依赖撤权前已冻结的允许列表。
- Better future prompt: “首次 finalization 与后续受限补传分开鉴权：前者要求当前 assignment、最新授权有效且项目未受限；后者只允许撤权前已冻结 commitments 内的原 actor 补传。”

### 2026-08-07 — REV-017 定向复审 PASS 与 DEV-005C 解锁

- Review evidence: 项目负责人锁定 PR #8 final head `9c471d81d783c902ae389c50500cafac0b187202`，确认非 Draft、可合并且上轮唯一 P1 闭环；CI `31163777417` 全部门禁 PASS。
- Closed scope: PR #8 以 merge commit `9af96c1be61936e7eef7665d313e44a6f0c6c2bf` 合入 `main`；SPEC-SESSION-END-001 转 `DONE`，ADR-022 转 `Accepted`，CON-019 在“契约缺失”范围转 `RESOLVED`。
- Next execution: DEV-005C 转 `READY`，按正式 stop/recover、持久 finalization、逐片 commitment 和撤权前后两类门禁实现服务端结束编排；DEV-005D 继续等待 C 的最终 PASS。
- Boundary: 契约 PASS 不代表 stop/recover、页面结束状态或父 DEV-005 已完成；真实麦克风/ASR/LLM、云队列和生产部署仍不在当前实现前置。
- Lesson: 冲突可以在契约明确后关闭，但实现任务仍需独立测试与审查；“冲突已解决”和“功能已完成”必须保持两条状态线。

### 2026-08-07 — DEV-005C 服务端会话安全结束编排

- User outcome: 让 stop/recover、实际时长、raw manifest 与 ASR 降级成为持久、可查询、可重驱且不扩大撤权前证据边界的服务端事实。
- Review mode: Learning mode；恰好一次独立只读预审确认正式契约无需修改，migration 为确定交付物。
- Review finding: 权限判定时刻与允许写入的字节集合必须在同一 session 锁提交点冻结；普通 assignment 与冻结后的 evidence-finalization 是两套权限。
- Options considered: 复用普通 assignment 上传；依赖 WebSocket runtime；持久 finalization + commitments + 精确补传。采用第三种。
- Adopted decision: 单 migration 增加数据库唯一性与聚合；stop/finalize_interrupted 同锁复核最新授权；recover 只读持久事实，runtime 无法证明 drain 时明确降级。
- Implementation evidence: `session-finalization.service.ts`、audio/realtime seam、migration `20260807190000_session_finalization`、unit 123/123、PostgreSQL integration、auth 13/13、build/smoke；任务进入 REVIEW 等待 GitHub 审查。
- Lesson: 撤权后的证据保全不是继续授予项目访问，而是只完成撤权前冻结的不可变字节集合。
- Better future prompt: “请分别测试首次建立 finalization 与已有 snapshot 后补传：前者同锁复核最新授权，后者仅允许 active 原 actor 对 frozen commitment 做最小写入。”

### 2026-08-07 — DEV-005B 与 DEV-005C 并行启动

- User outcome: 在服务端安全结束编排开发期间同步推进转录优先工作台，并明确要求前端使用 impeccable。
- Parallel boundary: DEV-005B 只修改 `apps/web/**` 并消费现有 session/WS seam；DEV-005C 负责后端 stop/recover、finalization 和 migration。两者使用独立 worktree，B 不依赖 C 的未合并代码，DEV-005D 仍等待 C PASS。
- Impeccable context: `apps/web` 已有绿色 OKLCH 令牌、准备页和工作台壳；项目没有 PRODUCT.md。当前属于已有代码上的明确范围任务，因此不以 init 阻塞，采用 product register 并继承现有设计系统。
- Required quality: 转录是视觉中心；长内容回看不能被自动滚动打断；桌面/窄屏、键盘焦点、对比度、live-region、错误/重连/空状态和 reduced-motion 必须经真实浏览器验证。
- Boundary: impeccable 只提高信息层级、可用性和视觉完成度，不得恢复三栏、多建议、真实 AI、stop/recover 或其他后置功能。

### 2026-08-07 — REV-018 PASS 与 REV-019 四项状态机 P1

- Frontend result: 项目负责人对 PR #9 head `c73e7ad0499c02af532670f350e62b34bf73cd87` 给出 PASS，CI `31166457093` 全绿；以 merge `647a6b4ffb1ca5f95fcfb7ff537390d109b84acf` 合入 main，DEV-005B DONE。
- Backend review: PR #10 head `738898a9d18dbb77d5fefec78d5daef90fcd5a48` 虽 CI `31167044756` 全绿，仍有四项 P1：结束相关操作未共锁、ASR final drain 缺失、重启后 ASR 事实误报、终态/stop request 幂等不稳定。
- Adopted correction: DEV-005C 保持 REVIEW，只做统一锁与 barrier 测试、最小 ASR ending seam、持久接收证据判定、终态和首次响应稳定重放；不扩真实供应商、队列或前端。
- Lesson: 状态机的顺序不能由“每个操作各自有锁”推导，只有共享资源锁和锁内重读才能建立跨模块线性化点；CI 覆盖已有路径，不代表未建模的并发窗口不存在。
- Boundary: DEV-005D 继续 BLOCKED，父 DEV-005 不因工作台通过而完成。

### 2026-08-07 — DEV-005C REV-019 定向修复

- Review correction: 跨模块事务只有共享 `project → session → audio` 锁序并在锁后重读，才能把撤权、冻结和补传变成线性化事实；每条路径“各自有锁”仍会留下授权与字节集合竞态。
- Adopted implementation: stop/recover、revoke、upload/complete 统一资源锁序；manifest 与 commitments 逐片全量比对；ASR ending 通过回调强制 final 先经 DEV-004A ingestion，再完成 adapter close；runtime 丢失依持久接收序号降级。
- Idempotency lesson: 资源终态与请求响应是两个不同事实。终态不可重写或复活；每个 request ID 必须保存其首次可见 snapshot，即使后台状态随后推进也只能重放原响应。
- Evidence: PostgreSQL barrier 覆盖 stop/revoke 双顺序与 stop/upload 扩集；ASR 成功、不可用、超时、final-first、runtime loss 和 completed/failed/replay 回归；完整本地门禁通过。
- Boundary: 不接真实 ASR、云存储、队列或前端；REV-019 三项 P2 保持登记，DEV-005C 仍为 REVIEW，DEV-005D 仍为 BLOCKED。

### 2026-08-07 — REV-019 第二轮发现 ASR drain runner 重入

- Review evidence: 项目负责人锁定 PR #10 head `33c9a33cc1b7ff54af30ac8eb205ad0e20ddc063` 与 CI `31172641955`；首轮四项 P1 全部关闭，但结论仍为 REQUEST_CHANGES。
- New finding: 持久 `draining` 允许崩溃恢复，但同一进程中没有 single-flight 时，并发 recover/reconcile/stop 会重复调用外部 `drainAndClose()`；数据库最终状态保护无法约束供应商副作用。
- Adopted correction: 按 finalization ID 复用一个进程内 advance Promise，完成后清理；进程重启后 Map 丢失，由持久状态重新驱动。补阻塞 fake 和并发 barrier 测试。
- Boundary: 仅修 single-runner，不改数据库、不引队列、不处理三个 P2、不接真实 ASR。DEV-005C REVIEW、DEV-005D BLOCKED。
- Lesson: “状态为 draining”既是持久恢复信号，又不能单独承担同进程互斥；可恢复状态和进程内 single-flight 是两个互补层次。

### 2026-08-07 — DEV-005C ASR runner single-flight

- Adopted implementation: `advance()` 按 finalization ID 返回同一个进程内 Promise，`advanceOnce()` 保持持久重驱逻辑；清理只删除仍指向当前 Promise 的 Map 项，避免旧 runner 删除后继登记。
- Evidence: 阻塞 adapter 下，相同 ID recover、不同 ID reconcile 与匹配 stop 并发只调用一次外部 drain；释放后响应重放稳定且终态 drained/completed。首次推进拒绝后相同 finalization ID 可重新驱动。
- Lesson: 持久状态解决崩溃恢复，single-flight 解决同进程外部副作用互斥；两者不能互相替代。
- Boundary: Map 不承载业务事实；未增加数据库、migration、队列、依赖、真实 ASR 或三个 P2。

### 2026-08-07 — REV-019 第三次定向复审 PASS

- Review evidence: 项目负责人锁定 PR #10 final head `36f534a45367eb19d19d19d05f0edcda317dbde9` 与 CI `31174226564`，确认 single-flight P1 关闭，P0/P1=0。
- Closed scope: PR #10 以 merge commit `9691dadb7117aadea81eeb9516a40d5f8cb81ba0` 合入 main；DEV-005C 在内部 MVP 服务端安全结束范围转 DONE。
- Next execution: DEV-005D 转 READY，只消费统一 snapshot 完成安全结束页薄集成；父 DEV-005 等待 D 通过。
- Deferred risk: 三个 REV-019 P2 保留，不阻塞当前范围；真实 ASR、持久队列、云存储和生产部署仍未覆盖。
- Lesson: single-flight 解决同进程副作用重入，持久状态解决崩溃恢复；两者通过不同生命周期协作，不能互相替代。

### 2026-08-07 — DEV-005 以后的用户讨论门槛

- User outcome: 用户希望从 DEV-005 开始，产品行为和关键取舍先在独立项目任务中讨论，认为讨论完成后再由总控验收，不再由实现任务默默代替用户做产品决定。
- Review mode: Correction mode；独立只读复核认为“每个 DEV 都讨论”过于机械，真正需要的是覆盖用户价值、业务行为、风险边界和可观察验收的阶段决策门槛。
- Review finding: DEV-005D 和 DEV-005 整体验收后，还需要分别讨论 DEV-004C 说话人流程、内容边界与标记、DEV-006 长期记忆、DEV-007 单问题建议、项目入口/回顾、工作记录/多次访谈、导出、删除/撤回、内部验收和真实试点前加固；DEV-008 必须拆分，不能作为一个讨论或实现包。
- Options considered: 每个子任务强制讨论；只在用户临时想到时讨论；按阶段设置讨论门槛。推荐第三种，避免纯工程事项重复讨论，同时不遗漏横跨多个 DEV 的产品决定。
- Adopted decision: 用户已确认采用“总控设计并发放讨论提示词 → 用户在新项目任务讨论 → 总控验收候选决定 → 写回正式依据/拆任务 → 实现窗口 → GitHub 审查”；首个讨论任务为 DISC-005D。
- Implementation evidence: 本轮只读核对 `00`、`01`、`03`、`06`、`07`、`09`、`10`、任务板、追溯矩阵、OPEN 冲突、MVP-V01、DEV-004/005D 与 SPEC-AI-QUESTION-001；未改业务代码或任务状态。
- Lesson: 需要人决定的是“产品要呈现什么、失败时怎么办、什么算通过”；锁顺序、索引和组件拆分等可回退实现细节由专业任务在冻结边界内决定。
- Better future prompt: “请为下一个产品阶段准备讨论提纲：只列需要我决定的用户行为、风险边界和验收场景，不讨论可回退的纯实现细节；讨论完成后由总控验收，通过后再写回正式文档并拆实现任务。”

### 2026-08-07 — DISC-005D 安全结束页讨论提示词

- User outcome: 由总控先设计安全结束体验的讨论提示词，用户在新项目任务中逐项讨论并提交候选结论，再由总控验收后解锁 DEV-005D 实现。
- Review mode: Correction mode；独立只读复核发现现有契约没有冻结 `processing` 时能否离开，以及“查看本次记录/完成并离开”的真实目标，直接实现会迫使前端 Agent 猜产品行为。
- Review finding: 讨论必须先回答录音是否安全、转录是否完整、用户现在要做什么；不得把录音成功但转录降级压成单一成功/失败，也不得借死按钮提前扩完整回顾页。
- Options considered: 直接下发现有 DEV-005D；让实现 Agent 临场决定；新增 DISC-005D 候选决定门槛。采用第三种。
- Adopted decision: DISC-005D 转 READY，DEV-005D 暂转 BLOCKED；讨论窗口不写项目，只在用户定稿时输出候选决定包交总控验收。
- Implementation evidence: 新增 `docs/agent/tasks/DISC-005D.md` 与 `docs/agent/prompts/DISC-005D.md`，同步任务板、追踪、提示词入口和 DEV-005D 前置；顺手修正 `05` 中 DEV-005C 尚未实现的过期说明。未修改业务代码。
- Lesson: 服务端状态机可以已经正确，但页面仍可能缺少“现在能否离开”和“下一步去哪里”这类产品语义；技术完成不自动等于交互闭环。
- Better future prompt: “请一次只和我讨论安全结束页的一个产品决定；先说明对应服务端事实，再给最多三个方案。定稿时只输出候选决定包，不改文件、不开发，交回总控验收。”

### 2026-08-07 — DISC-005-R0 首次访谈纵向链路重构总纲

- User outcome: DEV-005 及 A/B/C/D 不再按既有局部切片直接继续开发；先逐阶段讨论并形成一致结果，全部讨论完成后再按最终技术标准统一重构，同时保留旧 PR/CI/PASS 历史。
- Review mode: Correction mode；唯一独立只读复核要求从完整“准备→录音/转录→安全收束→结果”链路出发，而不是分别重写旧 A/B/C。
- Review finding: 正式准备页不会创建访谈录音作业，正式工作台只消费合成 PCM 实时转录，而 DEV-005C stop 必须收到唯一 audio object、expected count 和逐片 commitments；当前组合缺少从 start 到 stop 持有/恢复同一录音上传作业的责任，登记为 CON-020。
- Options considered: 直接修改旧 A/B/C；先分别讨论 A/B/C；先做 R0 总纲再串行讨论 A-R/B-R/C-R/D-R。采用第三种，避免再次出现局部通过但组合不闭合。
- Adopted decision: 旧 DEV-005A/B/C 保持 DONE 和原审查证据；新增 DISC-005-R0，只形成候选总纲，不改业务代码或正式产品/技术规范；旧 DISC-005D 结论保留为未来 D-R 输入，原 DEV-005D 暂停。
- Implementation evidence: `docs/agent/tasks/DISC-005-R0.md`、`docs/agent/prompts/DISC-005-R0.md`、HO-037、CON-020、任务板和追踪入口；未修改旧 DEV-005A/B/C/D 任务卡或业务代码。
- Lesson: 模块分别 PASS 只能证明各自边界，不能证明纵向链路已有唯一责任人把开始阶段产生的证据一直交到结束阶段；重构先冻结端到端所有权，再划分子任务。
- Better future prompt: “请先讨论一次首次访谈从开始到结束必须由谁持续持有 session、麦克风、录音上传作业和实时流，以及发生刷新/断网时哪些事实必须恢复；总纲通过后再拆阶段，不改写旧任务历史。”

### 2026-08-07 — DEV-005R 讨论收口与实施基线

- User outcome: A-R/B-R/C-R/D-R 全部无异议后开始开发；UI 统一使用 impeccable；总控设定最终目标并持续推进，新任务完成后主动通知总控复核。
- Review mode: Correction mode；唯一独立只读复核确认可以继续开发，但必须先把聊天决定写回正式契约，且未经项目负责人 PASS 不得夜间自行合并 main 或标 DONE。
- Review finding: 共享 API、Prisma、工作台入口和中央治理文档不能由多个 worktree 同时拥有；后端 R1 与严格限界、不改共享 DTO/路由的 R2C 可以并行，其余必须按 R1/R2C→R2→R3→R4 推进。
- Options considered: 所有功能一个大 PR；多 Agent 同时改共享契约；短暂 SPEC 基线后有限并行和 stacked candidates。采用第三种。
- Adopted decision: SPEC-DEV-005R/ADR-023 正式承接批准决定；旧 DEV-005A/B/C 历史保持；旧未实施 DEV-005D 由 R3 取代；CON-020 等 R4 真实 Chromium PASS 后关闭。实现任务必须主动通知总控，提供 final head/PR/CI/命令/风险。
- Implementation evidence: `03/04/05/06/08/09/10`、SPEC-DEV-005R、DEV-005R1/R2C/R2/R3/R4 任务卡、提示词、任务板、追踪、CON-020、ADR-023、HO-038；当前为契约候选，业务代码尚未实现。

- Contract correction: R1 预审发现 `NO_AUDIO_CAPTURED` 发生时依法没有 finalization，而旧公共失败字段只嵌在 finalization。采用 session 顶层 `capture_failure_code`，只允许空采集失败并与 finalization failure 互斥；不创建伪 finalization。
- Evidence correction: realtime runtime 是进程内状态，不能在重启后证明零 PCM；generation 增加一次性 `first_pcm_accepted_at`，第一帧被 adapter 接受时写入，空录音放弃要求其为空，不引入每帧数据库写放大。
- R1 implementation evidence: PostgreSQL barrier 证明 request→project→session→audio 同序可串行 start/stop/upload/PCM/revoke；runtime 清理必须发生在事务提交后，并把首次受影响 session ID 作为脱敏审计事实，才能让响应丢失后的幂等重放补做清理而不误伤后来会话。
- Lesson: 并行的前提不是任务名称不同，而是每一份事实只有一个拥有者；先冻结所有权，再并行不会共享同一 API/路由/状态机的模块。

### 2026-08-08 — DEV-005R 页面内容占比讨论前置

- User outcome: 在继续开发前补齐准备页、正常工作台、中断与结束状态的内容占比和注意力层级，避免 DEV-005R3 自行猜测。
- Review mode: Correction mode；独立只读 UX 复核确认“转录约 80%”只覆盖正常态粗略方向，尚未冻结视口口径、窄屏、五类事实布局和状态变化后的重分配。
- Options considered: 全状态固定 80% 转录；改为左右仪表盘；保持纵向结构并按业务状态改变比例。推荐第三种。
- Adopted decision: pending user choice；已创建独立讨论任务 `DISC-005R-UI 页面内容占比与注意力层级`，从桌面 `8/79/13`、窄屏 `9/73/18` 和 interrupted/结束态重分配候选开始逐项确认。
- Implementation evidence: 无；本轮只启动产品讨论，DEV-005R1 后端检查点与 R2C/R2 技术边界不变，DEV-005R3 UI 实现继续等待讨论结论。
- Lesson: 页面比例应表达用户在当前业务状态下的首要任务；正常录制时转录居中，中断或结束时安全处置必须取得视觉主导，不能让一个静态百分比贯穿所有状态。
- Better future prompt: “请分别给正常录制、中断、保存处理中和完成状态定义桌面/窄屏的内容比例、常驻事实、折叠事实与验收视口，再开始页面实现。”
- Better future prompt: “先把已批准的端到端决定写成正式契约，再按单一事实拥有者拆 worktree；允许纯核心模块并行，但共享 DTO、路由和中央文档只能由指定任务修改，所有任务交付到 GitHub REVIEW 后主动通知总控。”

### 2026-08-08 — DISC-005R-UI 页面占比与移动端边界定稿

- User outcome: 在 DEV-005R3 开发前冻结不同业务状态的页面内容占比、手机信息结构、高密度转录、建议占位和结束面板行为，并把手机提升为完整访谈主设备。
- Review mode: Correction mode；用户明确纠正“手机仅应急兼容”和“手机转录元数据放正文上方”两个初始假设，最终选择 Android Chrome 一等支持、所有设备统一左元数据右正文。
- Review finding: 正常录制可用桌面约 `8/79/13`、390×844 约 `9/73/18` 作为视觉护栏，但 interrupted 与结束状态必须把状态事实和处置动作提升为视觉主导；五类事实不能铺成五个同权 chip。
- Options considered: 固定比例贯穿全状态；手机降级为恢复入口；状态驱动注意力并将 Android Chrome 纳入完整纵向链路。采用第三种。
- Adopted decision: 覆盖 1440×900、1024×768、768×1024、390×844、320×568；正常页仅转录主区滚动；顶部常驻长者/时长/安全摘要/结束，五类事实进入保存明细并按异常提升；高密度转录保持左元数据右正文；建议只预留单问题容器和一层撤销语义；结束确认是唯一 modal，processing/completed 可最小化。
- Implementation evidence: `01`、`03`、`06`、`09`、SPEC-DEV-005R、DEV-005R2/R3/R4、SPEC-AI-QUESTION-001、ADR-024、CON-021、HO-040；本轮未修改业务代码。
- Deferred decision: Android Chrome 的后台、锁屏、页面隐藏、旋转和设备中断行为必须由 R2 真机证据冻结；如果现有 interruption reason 不足，先改公共契约。iPhone Safari 明确延期。
- Lesson: 响应式设计不只是缩窄布局；当手机承担完整录制时，生命周期可靠性、状态解释和真机验收都成为产品契约，而不是 CSS 细节。

### 2026-08-08 — SPEC-DEV-005R 首轮审查四项契约缝隙修订

- User outcome: 不推翻 DEV-005R 总体设计，只定向关闭 interview init、ACK/archive、全 generation PCM 空录音判断和 resume DTO 四个 P1，并在必要时极小修正 R1。
- Review mode: Correction mode；独立只读复核确认四项均成立，且全 generation PCM 同时是 PR #13 的实现缺陷；未发现第五个阻塞项。
- Review finding: 新总契约已形成正确方向，但旧 `05`、`06` 与 Accepted ADR-017 仍保留历史实现语义；若只改 SPEC 摘要，后续 Agent 仍会从正式来源得到相反答案。
- Options considered: 只改四句；推翻重写整套契约；同步所有相邻权威来源并让 R1 只修一项。采用第三种。
- Adopted decision: interview object 只能由 atomic start 创建；ACK 只清 delivery、不删 archive；`NO_AUDIO_CAPTURED` 要求该 session 所有 generations 均无 PCM 接受证据；resume 的 archive count/timeline 是同一 local job 累计高水位。ADR-017 的正式访谈旧语义由 ADR-023 部分取代，R4 同时负责 CON-020/021。
- Implementation evidence: `04`、`05`、`06`、`09`、SPEC-DEV-005R、DEV-005R1/R4、ADR-017/023、REV-021 与治理索引已修订；PR #13 原任务已收到 all-generation 查询与 PostgreSQL 回归的定向修复要求。
- Lesson: “零证据”是聚合级断言，不是当前子状态断言；只要历史 generation 留下任何持久证据，就不能由最新 generation 的空值覆盖整个 session 的事实。
- Better future prompt: “请把空录音条件定义为 session 聚合不变量，列出服务端分片、所有 capture generations 的 PCM 证据和同一 local job 累计 archive 三个独立检查，并覆盖跨 generation 反例。”

### 2026-08-08 — SPEC-DEV-005R 定向复审与基线收口

- User outcome: 四项 P1 修订通过后正式解除 stacked 契约门禁，但不把实现 PR 一次性合入 main。
- Review mode: Learning mode；项目负责人定向复审确认四项 4/4 关闭，未发现新 P0/P1。
- Review finding: 契约、旧 ADR 与验收矩阵现在对 interview object 创建、archive 保留、全 generation PCM 和 resume DTO 给出一致答案。
- Options considered: 契约与实现一起批量合并；只登记 PASS 不合并基线；先合并契约、再逐项重放实现审查。采用第三种。
- Adopted decision: PR #11 先合入 main；SPEC-DEV-005R DONE，ADR-023/024 Accepted。R1 继续修唯一实现缺陷，R2C 独立收口，随后才进入 R2。
- Implementation evidence: PR #11 head `80ab84f8970dcb68fb85d39e71c22f9aa6ec61bf`、CI `31244954185`、merge `c572490b29dc7f3f1ce1191a7ea4a2e38c459dc3`、REV-021 PASS。
- Lesson: stacked 开发应先合并权威契约，再让每个实现分支 rebase 并按自身风险复审；这能把“规则是否正确”和“实现是否符合规则”分成两个可验证问题。
- Better future prompt: “契约 PASS 后先合入 main，再逐个 rebase 实现 PR；每个实现只复审受新契约影响的差异，不批量合并。”

### 2026-08-08 — DEV-005R1 PCM 与幂等副作用代际边界

- User outcome: ASR/adapter 挂起不得阻塞原始录音 stop/revoke；旧 revoke/report 请求重放不得清理合法 resume 后的新 producer。
- Review mode: Correction mode。
- Review finding: 原实现把外部 adapter 放在每帧业务锁事务内，并把 replay cleanup 只绑定长期 session ID；二者分别造成无限阻塞与跨 generation 误杀。
- Options considered: 每帧短事务；outbox/队列；首帧有界 single-flight + 后续快路径 + runtime producer lease。采用第三种，避免扩大 R1 模型。
- Adopted decision: 首帧最多持锁 250 ms，成功接受后原子写证据；后续帧无业务事务。所有 post-commit/replay runtime cleanup 绑定 session + audio stream，并以 producer lease 阻止迟到 ACK。
- Implementation evidence: `apps/api/src/realtime-transcription/capture-pcm-evidence.service.ts`、`realtime-runtime.service.ts`、`realtime.gateway.ts`、`apps/api/src/project-foundation/project-foundation.service.ts`、`session-capture.service.ts`；unit 26/136、PostgreSQL integration 7/40、auth 3/13、build/smoke 全通过。
- Lesson: 持久业务幂等不意味着进程内副作用可以无条件重放；补偿副作用必须绑定当次资源租约身份，而非长期实体 ID。
- Better future prompt: “请分别定义业务事实的事务线性化点与进程内 producer 租约；外部调用必须有 deadline，幂等重放的 cleanup 必须按 generation/audio_stream 条件匹配，并验证旧请求不会影响新代际。”

### 2026-08-08 — DEV-005R1 跨 generation 零证据聚合

- User outcome: 防止历史 generation 已接受 PCM 时，最新空 generation 被错误 abandon 为 `NO_AUDIO_CAPTURED`。
- Review mode: Correction mode。
- Review finding: 实现和 `05` 局部文字都把证据判断缩窄到当前 generation，但单 session 复用唯一 audio object，`NO_AUDIO_CAPTURED` 必须是 session 全历史的聚合事实。
- Options considered: 只看当前 generation；新增冗余 session 证据字段；在既有锁内对 generation 表做存在性查询。采用第三种，不改 schema 或公共契约形状。
- Adopted decision: `abandonEmpty` 在已有四级锁内查询 `sessionId + firstPcmAcceptedAt not null`，任一命中即 409，其他成功/失败语义不变。
- Implementation evidence: `apps/api/src/project-foundation/session-capture.service.ts` 与 `tests/integration/session-capture.test.ts`；PostgreSQL 定向 10/10、完整 integration 7/41、unit 26/136、auth 3/13、Chromium 4/4、build/smoke 全通过。
- Lesson: “空”若用于终结共享聚合对象，就必须对该对象的完整历史求证，不能只检查最新一次尝试。
- Better future prompt: “请把 NO_AUDIO_CAPTURED 定义为 session 全 capture generations 的聚合不变量，并测试早期 generation 有证据、最新 generation 为空的反例。”

### 2026-08-08 — DEV-005R2C realtime teardown 与 checkpoint 活性修复

- User outcome: 关闭 PR #12 中 realtime 永不完成、checkpoint 写失败和 Web Locks 请求拒绝导致原始 archive finalization 或所有权释放悬挂的失败路径，同时隔离 stop→start 后旧 PCM generation 的迟到结果。
- Review mode: Correction mode；独立只读子 Agent 因 refresh token 被撤销而失败，本轮明确使用主 Agent 回退审查。
- Review finding: archive final write 不能位于任何 realtime await 之后；串行持久化需要把单次失败返回给调用者，同时把内部 tail 恢复为可继续状态；复用 producer 时仅有共享 disabled 布尔值不足以隔离旧异步任务。
- Options considered: 给整个 stop 增加超时；只让 producer.stop 不等待 delivery；archive-first cleanup 加 producer generation token。采用第三种，因为它同时保护原始证据优先、明确 teardown 上限和 resume 隔离。
- Adopted decision: `BrowserCaptureCore` 先完成 recorder final archive，并在 finally 非阻塞停止 realtime、释放 track/lock；checkpoint 尾链吸收既往失败但当前写仍 reject；`PcmAudioWorkletProducer` 使用单调 generation，旧 frame completion 静默退出；Web Lock request 前置拒绝直接传给 acquire 且不毒化 release。
- Implementation evidence: `browser-capture-core.ts/.spec.ts`、`pcm-audio-worklet-producer.ts/.spec.ts`、`session-browser-lock.ts/.spec.ts`；定向 unit 9/9、全量 unit 141/141、Chromium 6/6、音频 repeat 9/9、integration 30/30、auth 13/13、auth Chromium 4/4。
- Lesson: “停止时不等待旧 Promise”只解决当前 teardown 活性；若对象会复用，还必须用 generation identity 防止旧 Promise 在新一代启动后重新获得写状态的能力。
- Better future prompt: “所有可复用的异步 producer 在 stop/resume 测试中必须覆盖旧 generation 的 resolve、reject 和事件迟到；旧任务不得改变新 generation 状态，证据链 finalization 不得等待辅助链路。”

### 2026-08-08 — DEV-005R2 controller 的跨事实提交点与 Android 证据边界

- User outcome: 把 R1 服务端采集生命周期和 R2C 浏览器核心接成正式 session-scoped controller，同一麦克风单流驱动 archive 与 realtime，并在刷新、中断和恢复后保持同一 job/audio object 的可审计事实。
- Review mode: Learning mode；iteration-coach 的唯一独立只读预审建议用显式持久状态机、所有权锁先于副作用、沿用 IndexedDB v4 的应用层协议，以及从不可变 archive 生成安全结束交接。
- Review finding: controller 与 delivery pump 都会更新同一 upload job；若继续 read-modify-put，后到的 delivery 写入会覆盖 confirm/resume 稳定 request ID。Android visibility/background/lock screen 的真实行为没有目标设备证据，不能靠页面事件推断。
- Adopted decision: 在既有 v4 `upload-jobs` store 内加入事务级原子更新，不升级 schema；formal job 禁止另建 interview object；顺序固定为 lock/storage→单次麦克风→atomic start→archive/checkpoint→confirm→realtime。刷新只持久报告 interrupted，不自动申请麦克风；显式 resume 才产生新 generation。
- Implementation evidence: unit 32 files/168 tests、普通 Chromium 7/7、auth Chromium 4/4、integration 41、auth 13、migration/status/build/smoke/format/lint/typecheck/diff 均通过；测试暴露并关闭了 upload job 覆盖竞态。
- Verification boundary: 执行环境没有 `adb` 且未发现 Android PnP 设备；5–10 分钟、后台、锁屏、visibility、权限/设备中断全部未验证，CON-021 保持 OPEN，未修改公共 reason/snapshot。
- Lesson: 跨本地持久化、服务端幂等与实时副作用的状态机，可靠性取决于每个提交点是否原子且可恢复；“字段彼此不同”并不意味着并发整对象写安全。平台生命周期结论也必须来自目标设备证据，而不是 CSS 或浏览器事件名称。
- Better future prompt: “请把 controller 每个可重放步骤的稳定 request ID、持久提交点、锁顺序和 generation fencing 画成状态转换表，并用并发写、响应丢失、刷新和旧代迟到反例验证；平台 continue/interrupted 只采信目标设备观测。”

### 2026-08-08 — DEV-005R2 REQUEST_CHANGES 的资源 owner 与 orphan 减权记录

- User outcome: 关闭 start/resume 失败时首因覆盖与 Web Lock 泄漏，并在完整 local job 丢失时仍把服务端 active/preparing generation 持久、安全、幂等地降为 interrupted。
- Review mode: Correction mode；独立只读预审确认三个 P1 均成立，且 P1-3 缺的是浏览器本地持久载体，不需要修改公共 reason/snapshot/API。总控随后授权 IndexedDB v4 独立 orphan report 记录。
- Review finding: “服务端 generation 已提交”和“runtime 已接管 lock”是不同提交点，原实现用 `requiredJob()` 和 `runtime !== null` 推断 cleanup，既会覆盖 storage/MIME 首因，也会在 resume 麦克风拒绝时留下 controller-owned lock。local job missing 又不能通过伪造 MIME/job 来取得稳定 request ID。
- Adopted decision: start/resume 显式跟踪 controller/runtime lock owner、server bound 与 runtime takeover；所有 cleanup best-effort 且最终抛 primary error。在 v4 `upload-jobs` store 以独立 `capture-interruption-report-v1` discriminant 和 session+generation+stream key 原子 get-or-create最小 report record，upload job 路径严格拒绝该类型。
- Implementation evidence: 直接 controller/workbench/IndexedDB/upload runner 4 files/40 tests、全量 unit 32 files/182 tests、format/lint/typecheck/build PASS；覆盖真实 Web Locks 新 owner、响应丢失/刷新/并发稳定 ID、代际隔离、损坏/冲突 fail closed、终态不发送、ack 写失败幂等重放。
- Verification boundary: Android Chrome 仍无设备，CON-021 OPEN；orphan report 只负责减权 interruption，不声称 archive/job 可 resume 或可完整 finalize，记录清理并入未来 archive cleanup。
- Lesson: 资源 cleanup 必须依据“当前 owner”而不是“对象是否非空”；完整恢复资料丢失也不等于什么都不能做，可以凭服务端白名单 identity 执行最小减权动作，但持久记录必须与可恢复 job 类型隔离。
- Better future prompt: “请为每个失败点列出 lock/stream/runtime/server-generation 的 owner 和提交点，并证明 cleanup 次生失败不覆盖首因；full job 丢失时只持久化 server identity + stable report ID，不构造可 resume 的假 job。”

### 2026-08-08 — DEV-005R2 Android Chrome 真机生命周期收口

- User outcome: 在已连接手机上完成 R2 真机门禁，弄清旋转、后台、锁屏、刷新和麦克风撤权后的真实行为，并决定是否能继续 R3。
- Review mode: Correction mode；独立只读复核指出不能要求 R2 先实现归 R3 所有的恢复/安全结束 UI，否则形成循环依赖。
- Review finding: OnePlus GM1900 / Android 12 / Chrome 150 正式录制约 6 分 20 秒，372 片 archive 连续；旋转、后台、锁屏保持同一 generation。刷新以 `page_recovery_detected`、撤销权限以 `microphone_ended` 明确中断。旧工作台仍显示“服务端进行中”是 R3 事实展示缺口；低音量检测偏严是 P2。
- Options considered: 因 R3 页面未完成继续阻塞 R2；直接关闭 R2 与 CON-021；R2 DONE、R3 READY，但 CON-021 留给 R4 完整恢复/结束。采用第三种。
- Adopted decision: DEV-005R2 DONE，DEV-005R3 READY；冻结本设备生命周期基线，不外推所有 Android。CON-021 保持 OPEN 到 R4；新增 CON-022 跟踪低音量检测。
- Implementation evidence: REV-024、`06` Android 生命周期补充、`09` 真机基线、DEV-005R2 task/handoff；本轮无业务代码修改。临时截图仅用于本地核对后清理，结构化测量已写入项目记录，未提交真实音频或 Blob。
- Lesson: 平台生命周期事件不是业务事实；只有持续 archive、资源 identity 和服务端 snapshot 能证明继续或中断。任务应按事实所有权验收，下游 UI 缺失不能反向阻塞上游 controller，但必须保留最终纵向门禁。
- Better future prompt: “请在目标 Android Chrome 上分别记录旋转、后台、锁屏、刷新和 track ended 前后的 controller identity、archive 连续性与服务端 snapshot；按事实冻结 continue/interrupted，再由页面任务消费，不用 visibility 直接推断。”

### 2026-08-08 — DEV-005R3 工作台单一事实 projection 与安全结束 UI

- User outcome: 正式工作台在同一 URL 准确呈现采集、中断和安全结束全状态；刷新不申请麦克风，手机仍以转录为主，页面不得伪造服务端成功。
- Review mode: Learning mode；iteration-coach 的唯一独立只读预审建议先建立 controller 单一事实 projection，并让持久结束 handoff 优先于任何仍可恢复的旧 session/capture snapshot。
- Review finding: 初次 load 的 session 与页面本地状态都不能证明持续采集；只读 GET 可以核验事实，但 POST `reconcile` 是业务动作，不能伪装为刷新。local archive 为零只构成客户端必要条件，`NO_AUDIO_CAPTURED` 仍由服务端全 generation/PCM/分片证据裁决。
- Options considered: 在现有页面继续拼接静态 session/chip；由页面维护一套结束状态机；扩展 controller projection 并让页面只消费来源明确的事实。采用第三种。
- Adopted decision: projection 同时持有完整 server session/finalization、核验时间/错误、本地 archive/delivery、realtime 与 persisted end handoff；优先级为 frozen handoff → server session → capture/archive/realtime。只有用户点击 resume 才申请麦克风，只有结束确认进入 modal；管理服务终态会关闭仍存的本地 runtime，但不由 UI 推断终态。
- Implementation evidence: `interview-capture-controller.ts`、`workbench-shell.tsx`、`styles.css` 与对应 unit/Chromium；全量 unit 197、integration 41、auth 13、普通 Chromium 8/8、auth Chromium 4/4，五视口 × 七状态 35 张截图和比例/滚动/触控断言 PASS。
- Verification boundary: 桌面 Chromium 与合成音频不能替代 Android 真机；CON-020/021 留给 R4，CON-022 动态噪声基线算法也等待目标 Android 普通音量复验。本任务只到 REVIEW。
- Lesson: 页面可信度来自“每句话能指出事实源”，而不是状态数量更多；当结束边界已经持久化，任何可恢复提示都必须让位，否则一次过时 snapshot 就可能诱导用户向已冻结访谈追加录音。
- Better future prompt: “请先定义页面唯一 projection、每类事实的来源/核验时间和冲突优先级，再列出每个按钮允许触发的业务副作用；刷新只能读，resume/finalize/reconcile 必须由用户明确点击并复用稳定 identity。”

### 2026-08-09 — DEV-005R3 总控内部预检的尝试边界与认证失效修复

- User outcome: 不推翻既有工作台与后端契约，定向关闭 reconcile 永久重放旧 stopping、认证失效无法真正回登录、三类结束入口焦点丢失、假完成文案、delivery 事实误导和侧边告警线。
- Review mode: Learning mode；iteration-coach 的唯一独立只读校正确认总控交付完整性/内部预检清单中的六项均为已复现缺陷，方向与 SPEC-DEV-005R/ADR-023/024 一致；补充指出 load 401 可能复用准备页留下的活跃 controller，不能只清 React 身份状态。该内部清单与校正均不是项目负责人的正式 GitHub 审查结论，不登记 REV。
- Review finding: 幂等 ID 的生命周期不是按钮或组件生命周期，而是一次业务尝试生命周期；结果未知时必须重用，权威结果已知后必须轮换。AUTHORITY_LOST 又混合 401 与 403/授权失效，UI 不能把所有失败都解释成“重新登录即可恢复”。
- Options considered: 每次点击都生成新 ID；整个页面永久复用一个 ID；按 attempt 在未知结果时保留、成功后释放。采用第三种。认证方面采用 controller 权威核验清理 + App 内存身份清空；401 提供返回登录，403/授权失效只提供安全离开。
- Adopted decision: reconcile 成功投影 snapshot 后条件清空本次 ID，catch 保留；App 持有可清空 controller registry，load/verify 401 提供真实登录 seam；结束 modal 恢复实际 `event.currentTarget`；deliveryError 只在非 authority 且 archive 正常时表达“本地仍保存、管理服务交付异常”。
- Implementation evidence: `433e098a19787bc24c4f2832f395eaf7e295f9d0`；full unit 212、integration 41、auth 13、普通 Chromium 8/8、auth Chromium 4/4，工作台五视口 × 七状态截图与 interrupted Escape 焦点回归通过；未改后端/Prisma/contracts。
- Lesson: 可重放写操作要明确区分“transport outcome unknown”和“authoritative outcome known”；前者复用同一 identity 防重复副作用，后者释放 identity 让下一次用户意图真正启动新业务尝试。认证错误也必须按可恢复手段分型，而不是由一个聚合错误码决定文案。
- Better future prompt: “请为每个用户发起的 reconcile attempt 分配稳定 request ID：transport outcome unknown 时保留，validated authoritative response 后释放；同时把 401 与 403/授权失效分别定义为回登录和只读安全离开。”
