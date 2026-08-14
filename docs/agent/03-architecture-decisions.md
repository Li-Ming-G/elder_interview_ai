# 架构决策记录

## 文件用途

本文件记录重要技术决策的背景、候选方案、最终选择、代价和允许重新评估的条件。它解释“为什么这样做”，不替代 `02-项目开发规范.md` 和专项实现规范。

## ADR-001｜MVP 采用模块化单体

- 状态：Accepted
- 决定：使用模块化单体，不拆分微服务。
- 原因：当前业务规模小、事务关联强，首要目标是验证访谈链路和 AI 质量。
- 代价：未来规模扩大时可能需要拆分高负载模块。
- 重新评估条件：单体无法满足明确的部署隔离、独立扩缩容或团队边界需求。

## ADR-002｜录音、ASR、AI 三条链路解耦

- 状态：Accepted
- 决定：原始录音、实时转录、AI 分析分别运行和降级。
- 原因：AI 或 ASR 故障不能导致原始访谈资料丢失。
- 代价：需要维护更多状态和故障恢复逻辑。

## ADR-003｜业务数据库承担长期记忆

- 状态：Accepted
- 决定：不依赖模型会话保存跨访谈记忆。
- 原因：业务记忆必须可审计、可修订、可删除并关联原始证据。
- 代价：需要自行实现记忆提取、冲突和上下文构建。

## ADR-004｜AI 采用“访谈记录员＋采访导演”两阶段处理

- 状态：Accepted
- 决定：先提取和更新结构化信息，再根据记忆生成追问。
- 原因：避免只根据最近一句话生成低质量、重复或失去上下文的问题。
- 代价：模型调用次数和编排复杂度增加。

## ADR-005｜MVP 不引入独立向量数据库

- 状态：Accepted
- 决定：先使用 PostgreSQL 结构化查询；需要时再评估 pgvector。
- 原因：单个长者项目数据规模有限，独立向量设施会过早增加复杂度。
- 重新评估条件：结构化检索无法在可接受延迟内找到相关历史内容。

## ADR-006｜只有确定态转录进入长期记忆

- 状态：Accepted
- 决定：中间态只用于界面展示。
- 原因：中间态会被 ASR 后续修正，写入长期记忆会制造错误事实和重复更新。

## ADR-007｜固定 Node 24、pnpm workspace 与统一测试工具链

- 状态：Accepted
- 决定：使用 Node `>=24.11.0 <25`（开发基线 `24.18.0`）、pnpm `>=11.15.1 <12`（固定 `11.15.1`）和 pnpm workspace；采用 Vitest、Supertest、React Testing Library、Playwright；不引入 Nx/Turborepo 或双测试 runner。
- 原因：Node 24 是当前 LTS，pnpm 11 与其正式兼容；当前仅两个应用和少量共享包，不需要额外任务图平台；统一测试工具减少 ESM/TypeScript 配置分叉。
- 代价：NestJS 社区部分示例需要从 Jest 转换；Playwright 浏览器增加 CI 时间。
- 边界：依赖补丁版本由锁文件固定；主版本升级必须作为独立任务验证。

## ADR-008｜使用 Prisma 7 与前向迁移治理 PostgreSQL

- 状态：Accepted
- 决定：使用 Prisma ORM 7、Prisma Migrate 和 PostgreSQL 驱动适配器；复杂数据库能力允许使用经审查的迁移 SQL。
- 原因：类型安全和声明式 Schema 便于与 `04` 对照审查，迁移历史可进入 Git，适合小团队与 Agent 协作。
- 代价：ESM、生成客户端和驱动适配器增加初始化复杂度；部分原生约束需手写 SQL；不提供可依赖的自动 down migration。
- 边界：业务模块经模块服务访问数据；恢复依赖前向修复、备份恢复和可验证迁移，不用 `db push` 代替正式迁移。

## ADR-009｜同源 Web 使用服务端不透明会话

- 状态：Accepted
- 决定：MVP 使用 PostgreSQL 持久化的不透明会话、Argon2id 密码、HttpOnly `__Host-` Cookie、会话绑定 CSRF token、Origin 校验、数据库登录限流和服务层资源授权；浏览器不保存 JWT。production 用户通过受控交互式运维 CLI 创建、重置密码、停用和启用，启用不恢复历史会话；MVP 无公开注册或自助找回。
- 原因：账号停用、权限变更和敏感资料访问需要即时撤销；当前并发规模不需要 Redis 会话存储。
- 代价：写操作必须处理 CSRF；每次请求需要会话读取。
- 边界：仅 local/test 允许显式虚构身份 seed；production 拒绝默认账号和测试 seed；真实项目分配隔离在 `DEV-002` 验收，`DEV-001B` 只交付授权接口模式；若未来跨站或接入 OIDC，必须重新审查 Cookie、CORS、CSRF 与身份适配器。

## ADR-010｜延后 Redis、BullMQ 与 Nginx

- 状态：Accepted
- 决定：DEV-001 只编排 PostgreSQL；Redis/BullMQ 等到首个真实后台任务消费者出现，Nginx 等到 staging 部署链路可以验证 TLS、WebSocket 与上传限制时引入。
- 原因：当前没有队列消费者或部署入口，提前启用只增加运维面和失败模式。
- 代价：后续导出、删除、AI 后处理和部署任务需要增加基础设施变更。
- 重新评估条件：出现需要可靠异步执行的任务，或进入 staging 部署验证。

## ADR-011｜AI 边界采用控制上下文与内容上下文分离

- 状态：Accepted
- 决定：服务端分别维护本地策略状态、供应商可见的最小控制信封和许可内容上下文；`do_not_ask` 只发送人工确认的抽象禁区标签，不发送原始标记正文；模型输出还必须经过服务端边界过滤。
- 原因：完全排除拒绝边界会使 AI 无法避免重复追问，发送受限正文又违反数据最小化。
- 代价：需要独立的输入过滤、输出过滤、跨会话边界加载和失败安全逻辑。
- 边界：AI 不能确认、解除或覆盖人工边界；AI 候选保存在独立 `boundary_candidate`，仅对当前会话形成临时保守阻断，跨会话只读取正式 marker；无法安全构造控制标签或过滤器失败时返回“继续倾听”，录音与转录继续。

## ADR-012｜删除申请采用 scope 限制与显式状态流转

- 状态：Accepted
- 决定：非终态 `project` 删除申请停止整个项目 AI 并把项目置为 `restricted`；非终态 `session`、`segment_range` 只停止对应内容及派生记忆的新 AI 处理；任何非终态 scope 都拒绝项目级普通回顾和普通导出。`processing` 执行在线清理，清理证据和备份处理登记完成后才可转 `completed`；每次变化写 `deletion_request_transition` 和审计。
- 原因：内容处理应遵守申请范围，不能无依据停止未申请删除的其他会话；项目级导出无法在删除处理中可靠证明遗漏范围已完全排除，因此统一失败安全拒绝。
- 代价：需要状态机、幂等 transition 记录和按 scope 的 AI 过滤测试。
- 边界：`completed`、`rejected`、`withdrawn` 为终态；project scope 限制保留原项目状态，`rejected`/`withdrawn` 仅在没有其他限制原因时恢复，`completed` 不恢复；删除创建与 AI 写回竞态时丢弃命中 scope 的在途结果；完成后只保留不可恢复 project tombstone 或不可逆 scope 摘要与最小审计；删除候选或 marker 不等于删除申请已经成立或完成。

## ADR-013｜探索期采用分层门禁与有限纵向链路

- 状态：Accepted
- 决定：把“内部核心原型可集成”“单项任务 DONE”“真实试点可发布”拆为三个独立结论。探索期以虚构/脱敏数据推进最小纵向链路，后续任务可依赖已固定的最小 seam，而不等待父任务全部生产门禁关闭；真实试点仍必须满足 `09` 第 13 节。
- 原因：核心产品假设需要尽早通过端到端行为验证；将生产部署加固、完整独立审查覆盖和所有契约冻结设为业务原型前置，会延迟学习且不能降低当前实际风险。
- 不可降低的底线：原始录音/转录/授权不可覆盖；未授权不得开始；分片有序、幂等、可校验并生成 manifest；ASR/AI 故障不影响录音；AI 派生结果回链确定态转录；不得使用真实个人资料、真实密钥或公网暴露。
- 代价：任务板必须精确记录“可供内部集成的 seam”和仍未完成的最终门禁；夹具与真实实现必须有清晰替换点，避免原型债务被误当成生产能力。
- 重新评估条件：开始真实长者录音、真实付费服务、对公网开放或进入 staging/试点时，立即提升私有存储、访问隔离、授权、恢复、日志脱敏与独立验收门禁。

## ADR-014｜MVP 使用捆绑访谈处理授权并自动分配创建者

- 状态：Accepted
- 决定：一次 `recording_transcription_ai` 授权同时覆盖录音、转录和 AI 分析。倾听员创建项目时，项目与创建者的 `interviewer` assignment 在同一事务生成；访问始终依据有效 assignment，`created_by` 仅作审计来源。draft session 可在门禁完成前创建，正式 start 必须重新验证 assignment、服务说明、有效授权和设备检查。
- 原因：`03` 的 MVP 是一次固定文本口头授权流程；探索期拆成三套授权会增加交互、状态和测试成本，但尚无分别同意/撤回的产品证据。自动 assignment 保持倾听员新建项目主流程，同时不把审计字段误当授权。
- 代价：任一处理授权撤回会整体停止后续录音/转录/AI；若未来需要按处理目的分别授权，需要新增枚举、迁移、UI 和撤回规则。
- 边界：内部虚构数据可用 electronic/written 方法；真实试点仍要求保存合规口头授权音频。授权记录 append-only，撤回不删除历史，未满足 start gate 不得录音。
- 重新评估条件：产品验证证明用户需要分别同意录音、转录或 AI，或法律/供应商规则要求按处理目的拆分授权。

## ADR-015｜业务幂等绑定操作者与目标并独立串行业务资源

- 状态：Accepted
- 决定：需要 `request_id` 的业务写操作使用持久化 `idempotency_record`，全局唯一绑定 action、actor、target type/ID 和首次最小响应快照。相同绑定重放返回首次快照；跨 action、actor 或 target 复用稳定冲突。幂等键锁之外，状态变化按 project、session 或 consent 资源串行化，并保持统一锁顺序。
- 原因：只按 `request_id` 查询审计既可能跨项目返回其他实体，也不能阻止不同幂等键并发改变同一资源；读取当前实体也无法保证重放返回首次结果。
- 代价：每次适用写操作增加一条小型持久化记录和资源锁；后续动作接入时必须明确 target 与响应快照。
- 边界：重放前仍执行当前身份与 assignment 校验，幂等记录不能成为历史授权旁路；记录不保存访谈正文、录音、转录或模型输入。锁顺序必须在新增路径时复审，避免形成反向等待。
- 重新评估条件：出现跨服务写入、超出单库事务的任务或幂等记录生命周期显著增长时，评估 outbox/专用幂等存储与保留策略。

## ADR-016｜授权音频与访谈音频共用对象聚合但分离用途门禁

- 状态：Accepted
- 决定：新增项目级 `audio_object` 聚合，以 `purpose=consent|interview` 区分用途；不可变 `audio_chunk` 归属 audio object。consent 对象不绑定 session，可在正式访谈 start 前创建；interview 对象必须绑定同项目 session，并受录音状态门禁。授权只引用同项目、purpose=consent、manifest 完整且存储复核通过的对象。
- 原因：口头授权必须先于正式访谈 start；若强制授权音频归属 interview session，会形成“先授权才能录音、先录音才能授权”的循环。仅让 `audio_chunk.session_id` 可空又无法明确用途和完整对象边界。
- 代价：增加一层 audio object 与初始化/完成生命周期，上传需同时维护对象和分片状态。
- 边界：不引入照片、附件或通用媒体管理；purpose 仅两种。内部原型使用本地私有适配器和虚构音频，真实对象存储与签名上传留到试点门禁。
- 重新评估条件：出现新媒体用途、直传云存储或跨服务上传任务时，重新评估 purpose、生命周期和 outbox/清理机制。

## ADR-017｜浏览器上传以跨刷新持久化作业衔接本地分片与服务端幂等

- 状态：Accepted
- 决定：一个浏览器上传作业对应一个连续 `0..N-1` 的 audio object。IndexedDB 除不可变 Blob 和 seq/timeline 高水位外，还持久化创建对象、chunk、complete 的稳定 request ID、服务端 audio object ID、录制结束时冻结的 expected count 和作业状态。网络请求前先持久化 request ID；响应丢失或刷新后复用同一 ID。对正式访谈，本段“init 创建对象”和“ACK 后删除 Blob”的旧语义已由 ADR-023 部分取代：对象由 atomic start 创建；ACK 只清 delivery pending/reference，本浏览器 archive Blob 保留。consent 等非 interview 对象仍可使用独立 init。
- 原因：只保存 Blob 无法在创建对象或 complete 响应丢失后确定服务端状态，刷新时可能重复创建对象、错误重放或从 delivery 状态错误推算分片总数。服务端 ADR-015 幂等只有客户端复用稳定 request ID 才能形成端到端恢复协议；archive 保留则进一步保证 ACK 不会抹去本浏览器原始证据。
- 代价：IndexedDB 增加 upload job store 和前向版本迁移，客户端需要显式状态机、严格响应校验和有限重试；内部 harness/E2E 复杂度增加。
- 边界：本批只用合成/虚构音频和显式内部验证入口；不实现完整访谈 UI、Service Worker、无限后台同步、真实麦克风、云存储或 ASR。CON-012 不阻塞本决策。
- 重新评估条件：一个 session 需要多个 audio object、分片并行上传、跨设备续传或后台长期同步时，重新评估对象边界、租约和冲突合并。

## ADR-018｜先以 final-only 证据核心隔离 ASR 供应商与实时传输

- 状态：Accepted
- 决定：DEV-004 先拆出 DEV-004A，只实现供应商中立标准化结果、确定性 local/test fake、final-only 幂等落库、追加式会话内 speaker mapping 与内部查询 seam。真实供应商、业务 WebSocket、AudioWorklet、校准/remap、故障区间和补转录分别在后续子任务补齐契约后实现。
- 原因：当前最小纵向里程碑允许内部确定态测试转录，后续记忆首先需要稳定 segment ID 与不可覆盖证据；而供应商尚未选择，WebSocket 鉴权、PCM、背压、恢复和校准门禁契约均不完整。一次性实现会把供应商和传输细节固化进核心数据模型。
- 数据不变量：interim 不落正式库；`(session_id, ingest_key)` 唯一；相同 final 可幂等重放，冲突失败关闭；original text 与 original speaker role 永不覆盖；修正字段分离；未映射角色为 `unknown`；provider payload 受限且不进日志/普通响应。
- 代价：DEV-004A 完成后仍不能演示浏览器实时字幕，父 DEV-004 保持未完成；后续 WebSocket 与校准仍需独立契约和验证。
- 边界：fixture 只在 local/test 组合根存在，不形成公开写 API；只用虚构文本和隔离数据库；不接真实供应商或密钥，不改变原始录音链路。
- 重新评估条件：项目负责人明确真实供应商、数据地域/隐私、采样格式与预算，或下一核心验证必须是浏览器实时字幕时，启动 DEV-004B/后续 provider 任务。

## ADR-019｜实时链路先用静态 WebSocket join 与 JSON/base64 PCM 验证协议核心

- 状态：Accepted
- 决定：DEV-004B 拆为 B1 服务端协议核心和 B2 浏览器合成 PCM 纵向链路。使用静态 `/ws/interviews`，5 秒内首个 `session.join` 绑定 session、CSRF、assignment、授权、状态与单 producer；内部原型以 16 kHz/mono/PCM s16le、100 ms 固定帧的 JSON/base64 信封验证帧序、背压和 final 落库后发布。
- 原因：Nest 官方原生 WebSocket adapter 使用静态 path，动态 `:sessionId` 不具备 HTTP controller 路由语义；session ID 也不是授权依据。静态入口加 join 能复用现有 Cookie/CSRF/assignment seam，避免为内部原型自建 upgrade router。JSON/base64 虽有开销，但能先验证业务顺序、幂等和故障隔离，不提前固化二进制 header。
- 恢复边界：同一进程内每 session 保留最近 512 个事件或 5 分钟；以 `event_stream_id + server_sequence` ACK/恢复。跨进程持久 outbox、长时字幕恢复和 transcript snapshot 不在 B1/B2。
- 安全边界：Origin/Cookie 在 upgrade 前校验；CSRF 仅在 join 消息内存传递且不进日志；join 前不创建 adapter 或接收 PCM；项目 restricted、授权撤回、assignment 失效或非流式 session 失败关闭；fake 只由 local/test 服务端组合根注入，客户端不能指定输出文本。
- 代价：base64 增加约三分之一传输体积，且 B1 完成后仍没有真实浏览器展示；B2 必须在共享协议提交后再实现。AudioWorklet、真实麦克风、真实供应商、二进制帧和跨进程恢复后续重评估。
- 重新评估条件：内部纵向链路通过且真实麦克风/长时负载成为下一核心假设，或多实例部署要求跨进程恢复时，分别评估二进制帧、AudioWorklet 和持久事件存储。
- B2 加固补充（2026-08-07）：heartbeat/event ACK 在流内重新验证资源权限；未知内部或持久化故障使用 `REALTIME_UNAVAILABLE/4500`，不再伪装为 `FORBIDDEN`。这两项在浏览器状态展示前成为门禁；runtime 集合清理仍留到长时访谈前。

## ADR-020｜首轮产品验证采用转录优先的单问题三页闭环

- 状态：Accepted
- 决定：当前 MVP 优先交付“首次访谈准备页 → 转录优先工作台 → 安全结束页”。工作台使用顶部窄状态栏、约 80% 转录主体和底部单建议卡；同时只显示一个当前最佳问题及一句原因，或建议继续倾听；唯一显式反馈是“没用，换一个”。
- 原因：当前核心假设是倾听员在真实对话上下文中能否看懂实时转录并获得有价值的下一问。项目管理、复杂编辑和建议操作统计会扩大首轮交互面，却不是验证该假设的必要条件。
- 进入方式：内部首轮使用已分配、已预创建的单个虚构项目/会话深链，不临时增加第二套项目选择逻辑。
- 数据边界：不要求倾听员登记采用、已问、忽略、稍后或改写。内部仍保留问题、原因、证据和替换历史所需的可追溯载体；精确状态、API、幂等和相似问题排除由 SPEC-AI-QUESTION-001 冻结。
- 后续修订：本 ADR 中“唯一显式反馈是没用，换一个”及单次替换交互已被 ADR-028 部分取代；三页闭环、转录优先和单个当前问题的主体决定继续有效。
- 安全边界：准备页只展示和驱动正式授权流程，不能用勾选框替代版本化授权证据或服务端门禁；结束页在收束完成前必须显示 stopping/processing/failed；AI/ASR 故障不影响原始录音。
- 后置而非删除：项目列表/详情、多次访谈、完整回顾编辑、复杂标记、导出/删除 UI、记忆可视化和管理后台仍在后续切片。
- 代价：首轮无法验证多项目导航、建议采用率和完整资料整理工作流；建议价值改用替换率、人工观察/访谈后评价、重复率和高风险问题率衡量。
- 重新评估条件：首轮验证证明倾听员确实需要同时比较多个问题，或可靠性研究证明显式采用/已问状态对避免重复有显著增益时，再以新证据提案，不自动恢复旧流程。

## ADR-021｜安全结束采用“契约—服务端编排—前端薄集成”边界

- 状态：Accepted
- 决定：保留“准备页 → 转录优先工作台 → 安全结束页”的产品路径，但不再把准备页和安全结束页塞入同一个纯前端任务。DEV-005A 只负责准备页与正式路由外壳，DEV-005B 负责工作台；SPEC-SESSION-END-001 先冻结结束契约，DEV-005C 实现服务端跨录音/上传/转录的会话收束，DEV-005D 只消费服务端事实呈现结束页。
- 原因：当前服务端没有 stop/recover 实现，API 文档也只有路径占位；前端无法合法决定原始分片是否完整、final 转录是否收束、何时 `completed`。把这些判断放在页面会制造“看起来完成但数据未收束”的错误事实。
- 最小并行：SPEC-FE-001 PASS 后 DEV-005A 可先行，SPEC-SESSION-END-001 可并行冻结；DEV-005B 等待 A 的页面外壳，DEV-005C 等待结束契约，DEV-005D 最后组合 B/C。生产级持久 outbox、云任务和长时后台编排不作为内部 MVP 前置。
- 安全边界：权限或授权变化后不得继续采集，但必须按正式契约安全保存此前已经产生的原始数据；ASR/AI 故障不能阻止原始录音收束。前端不得用固定延时、本地状态或 query harness 推算成功。
- 代价：增加一个契约任务和两个结束子任务，三页闭环不会在 DEV-005A 单任务中立即完成；换取清晰的前后端边界、可审查状态机和可信结束事实。
- 重新评估条件：只有当正式契约证明现有服务端 seam 已能原子提供全部结束事实，才可合并 C/D 的实现批次；不得仅为减少任务数量取消服务端事实来源。

## ADR-022｜会话结束以持久 finalization 聚合和冻结分片承诺为事实源

- 状态：Accepted（REV-017 对 PR #8 head `9c471d8` PASS）
- 决定：一次 session 只允许一个 interview audio object。客户端先停止 PCM 和 MediaRecorder、收取最终分片，再以稳定 stop request ID 提交 expected count 与逐片不可变 commitment。服务端原子冻结采集截止、时长和 `session_finalization` 后进入 `stopping`；只允许承诺范围内补传。manifest 完整后进入 `processing`；ASR 终结为 `drained|degraded|not_started` 后进入 `completed`，AI 不参与门禁。
- 原因：现有 session 总状态无法证明缺片、manifest、ASR drain 或进程故障恢复；所有上传都要求当前 assignment，又与撤权后保存已产生证据冲突。冻结 commitment 使撤权后的补传成为字节级受限能力，而不是普通资源权限旁路。
- 恢复边界：`interrupted` 是尚无完整 stop snapshot 的可恢复采集中断；`stopping|processing` 只依赖持久 finalization 重驱，WebSocket 512 事件/5 分钟 replay 不参与判断；`completed|failed` 为终态。
- 权限边界：首次 stop/`finalize_interrupted` 创建冻结边界时必须同时满足当前 assignment、最新授权有效且项目未受限；撤权前已成功冻结后，原操作者账号仍 active 且重新认证时，即使 assignment/授权随后变化，也只能补传冻结 object/sequence/metadata 并读取最小 snapshot。撤权发生在首次 snapshot 前时不得事后新建 commitments；任何阶段均不得匿名上传、下载正文、继续 PCM/AI 或扩大范围。授权撤回不等于物理删除。
- 内部 MVP 与未来 seam：DEV-005C 可用有界进程内 runner 和启动扫描；未来队列/outbox 只替换触发、租约和重试，不改变聚合、状态、幂等、完成门禁或公共响应。生产基础设施不是内部验证前置。
- 代价：需要一个前向 migration、finalization/chunk commitment 持久模型、公共 snapshot 和更严格的补传授权；stop payload 随分片数增长。换取进程重启可恢复、撤权不丢证据、页面不猜状态。
- 重新评估条件：产品需要一次 session 多个录音对象、跨设备续传或 stop payload 超出可接受限制时，改为 session-level manifest aggregate/分批 commitment 协议；不得静默移除冻结边界。

## ADR-023｜正式访谈采用单流控制器、浏览器归档与采集代

- 状态：Accepted（REV-021 对 PR #11 head `80ab84f` PASS）
- 决定：正式路由由 session-scoped `InterviewCaptureController` 独占一条 MediaStream，同时驱动 MediaRecorder 原始归档和 AudioWorklet 实时 PCM；每个 Blob 只写一次浏览器 archive，delivery queue 仅引用它，ACK 不删除 archive。服务端 atomic start 创建唯一 interview audio object 与 generation 0；显式中断/恢复使用持久 capture generation 和新 audio stream，但复用同一 session/object/local job。
- 原因：旧正式页面、audio harness 和实时工作台分别拥有开始、原始录音、上传和 PCM，无法向 stop 提供同一对象/作业/commitments，也无法区分刷新、实时断线与真实采集中断。
- 事实边界：原始录音、本浏览器 archive、服务端 manifest、转录和 session 是五类独立事实；WebSocket replay、URL、计时或最后 final 均不能证明原始录音完成。正常 stop 仍以 ADR-022 finalization 为服务端事实源。
- 恢复边界：短时 WS 重连复用当前 stream；显式 capture resume 创建下一 generation/stream，原始 timeline 延续、PCM sequence 重置并带 offset。零音频仅在服务端无分片、该 session 所有 generations 均无 PCM 接受证据且同一 local job 累计 archive 为零时以 `NO_AUDIO_CAPTURED` 终结。
- 安全边界：同 session 单标签锁；撤权/撤 assignment 停止新采集但不丢已产生证据；浏览器 archive 仅用于内部虚构数据验证，真实试点前必须补本地备份管理/删除。
- 代价：增加前向 migration、浏览器敏感数据驻留、controller 生命周期和更多恢复状态；换取从 start 到 stop 的单一所有权与可验证纵向链路。当前不引 Redis/队列、云存储或跨设备接管。
- 重新评估条件：需要跨设备接管、多进程浏览器协作或永久离线备份时，引入显式租约/同步和用户可管理的本地数据产品能力，不得把当前 session lock 静默升级为跨设备保证。
- R3 实现补充（2026-08-08）：页面消费 controller 的单一事实 projection：持久结束 handoff 优先于 session 可恢复状态，session/finalization 来自最近一次管理服务核验，archive/delivery 与 realtime 保持独立来源。只读 GET/焦点/online 可更新 projection 但不触发业务状态；`reconcile` 明确为用户动作。管理服务终态到达时 controller 先采信服务端 snapshot，再停止本地 runtime、完成 archive 并释放资源，不用页面猜测采集仍在继续。

## ADR-024｜工作台按业务状态分配注意力，Android Chrome 作为首轮移动主设备

- 状态：Accepted（REV-021 对 PR #11 head `80ab84f` PASS）
- 决定：正常录制保持“窄顶部—最大连续转录—低干扰单建议”的纵向结构；桌面以 8/79/13、390×844 以 9/73/18 为视觉护栏，异常和结束状态按用户处置任务重新分配重心。五类事实按来源分区，高密度转录在所有设备保持左元数据/右正文。手机是完整访谈主设备，首轮正式平台为 Android Chrome；iPhone Safari 延期。
- 原因：倾听员应主要关注长者和转录，但必须一眼知道原始录音是否可靠保存。固定 80% 不能同时服务正常访谈、中断处置和安全结束；把五类事实都堆在顶部会在手机上压缩核心内容。Android 作为主设备又要求采集可靠性与响应式 UI 同时成立。
- 行为边界：只有结束确认使用 modal；关键异常提升但不抢焦点；R3 只预留建议 replace/undo 状态，不实现 DEV-007。旋转只重排；后台、锁屏和设备中断的继续/中断结果必须由 R2 真机证据冻结，见 CON-021。
- 后续修订：建议区的一层 replace/undo 预留已被 ADR-028 的“自动替换 + 展示历史浏览 + 下一个问题”取代；移动端注意力、触控和单问题布局决定继续有效。
- 代价：增加五视口、全状态和 Android 真机验收，R2/R4 范围扩大；换取移动端不静默丢音频、页面层级可验收和后续 UI Agent 不自行猜测。
- 重新评估条件：实际试点需要 iPhone Safari、跨设备接管或后台长时录制保证时，单独讨论平台能力与产品降级，不得把 Android 证据外推为所有手机支持。
- 真机证据补充（REV-024）：OnePlus GM1900 / Android 12 / Chrome 150 上，旋转、约 20 秒后台和约 20 秒锁屏期间，单一 controller、archive 时间轴与同一 generation 持续健康，因此这些事件本身不触发中断；刷新以 `page_recovery_detected`、运行中撤销麦克风权限以 `microphone_ended` 显式进入 `interrupted`。这是首个目标设备基线，不构成所有 Android 或 iPhone 的平台保证；R4 仍负责完整恢复与安全结束复验。
- R3 页面证据补充（2026-08-08）：正常工作台在 1440×900 与 390×844 分别按既定比例护栏保留顶部、主转录与建议区；320×568 顶部不超过 72 px、建议不超过 120 px、主内容不低于 60%。五视口 × 七状态 Chromium 矩阵保持页面无纵向/横向滚动、转录为主滚动，手机元数据栏 52–64 px；状态面板只在业务事实需要处置时上提，结束确认仍是唯一 modal。

## ADR-025｜说话人映射按 provider stream 隔离，角色值与用户确认可信度分离

- 状态：Accepted（REV-027 对 PR #17 final head `2a65b1f` PASS，merge `0b6c357`）
- 决定：原子 start 先建立正式录音/ASR，随后在同一正式 `speaker_stream_id` 内进行用户确认校准；校准不是录音硬门禁。`speaker_stream_id` 独立表示 provider speaker namespace，不等于 capture generation、`audio_stream_id` 或短时 `event_stream_id`。角色值与 authority 分离，只有用户确认校准或人工修正形成的 trusted effective role 可进入角色相关下游消费。
- 控制内容：服务端 calibration attempt 权威标记校准控制片段；客户端不能自行标记。控制片段保留原始证据，但排除故事记忆、真实已问问题、普通摘要和普通 AI 上下文。
- 不可变边界：begin/resolve 作为有序控制 marker 进入当前服务端 PCM 串行泵，在前方帧完成、后方帧继续前事务性冻结 sequence/session-timeline 半开区间。final 按同 speaker stream 的标准化时间重叠归类，不按到达时 attempt 状态归类；跨边界 final 整段保守排除。
- 修正边界：默认单段；批量只限同一 speaker stream/provider label/明确范围，使用持久稳定 preview、默认排除既有单段修正并全成全败。原始角色永不覆盖；成功修正产生 session revision 与受影响 segment membership。
- 下游边界：DEV-004C 只生产可信角色、revision 和 membership；独立 `SPEC-DEV-006` 必须先冻结跨 session watermark、job/segment/output provenance、stale 状态和查询过滤，DEV-006/007 再实现派生结果失效、重算与失败态。人工确认事实和人工边界不能被自动重算覆盖或解除。
- 传输投影：GET、begin、resolve、`session.ready` 和 `speaker.calibration.updated` 使用同一 canonical `SpeakerCalibrationSnapshot`；同 request ID、当前 GET 与 WS replay 保持相同 shape，但分别表达首次响应、当前事实和原事件事实。
- 原因：现有 `(session_id, speaker_provider_id)` 会在 provider/runtime 重建后把同名短 label 误套到新命名空间；现有 `corrected ?? original` 又无法区分 provider 推测和用户确认。两者会把倾听员话语错误写成长者记忆，属于 DEV-006 前必须关闭的数据污染风险。
- 代价：需要前向 migration、WS 1.1、校准 attempt、角色 authority、控制内容类型、修正 operation/membership 和更多并发测试；复杂批量 UI 延后到完整回顾页。
- 边界：内部 fake 只验证状态、隔离、幂等和消费门禁，不承诺真实供应商准确率、声纹、多人 diarization 或跨会话身份。
- 重新评估条件：真实供应商证明其 namespace 生命周期不同、需要多人/重叠语音或跨会话身份时，单独扩展 identity 模型；不得复用短 provider label 绕过本决策。

## ADR-026｜第一版后台记忆只服务问题，并分离展示快照与未来资格

- 状态：Accepted（DISC-006 项目负责人定稿，并于 2026-08-09 批准 CON-024 推荐拆分）
- 决定：第一版不建设记忆管理 UI。可信 elder final 产生的自动记忆可直接形成后台 current memory，最小范围只覆盖会改变当前下一问、第二次开场或安全边界的人物/关系、地点、事件、时间/范围、重要选择/原因线索和未讲完故事；冲突通过澄清问题表达，明确更正只改变未来 current view，原始证据和历史版本保留。
- 问题事实：问题分为不可变 `displayed snapshot` 与可变 `future eligibility`。普通说话人/文字/记忆修正、普通冲突和单独 `sensitive` 不自动重算或撤下已经展示的问题，但旧结果立即失去未来生成和跨会话资格；下一次换题或正常生成必须读取最新 current memory。
- 安全边界：`restricted`、`do_not_ask`、活动 deletion scope、授权或访问权限失效时，当前问题正文立即从普通 UI 撤下，查询/replay/刷新不得带回；只显示继续倾听或 AI 暂不可用，不自动生成替代问题。倾听员现场判断权不能替代软件的访问、禁问和删除义务。
- 实际问题：访谈中不增加 adopted/asked/ignored 操作。会后以可信 interviewer final 提取所有实际问题并与系统展示/换题历史匹配；只有证据支持的“实际问过”进入跨会话防重复，明确换掉、未观察到和证据不足不得冒充已问。
- 失败与评测：AI 失败不返回基础题、不无限后台重试；每次换题只发起一次新 attempt。首个内部切片用虚构/脱敏数据、完整过程记录和人工定性复盘，不以质量百分比作通过门槛；真实模型和试点前恢复正式指标。
- 代价：普通修正后屏幕可短暂保留基于旧理解的问题；用户接受该探索期取舍。后台模型必须额外保存 provenance、版本、冲突、future eligibility、实际问题匹配和过程记录，不能因 UI 简洁而省略。
- 边界：具体表、状态、API、任务调度、LLM/提示词/Schema、语义匹配和 DEV-006/007 所有权由 `SPEC-DEV-006` 与 `SPEC-AI-QUESTION-001` 冻结；不接真实供应商、不新增记忆列表、完整回顾或自动传记。
- 重新评估条件：内部试用证明错误记忆频繁产生不当问题、倾听员需要可见记忆控制，或真实数据治理要求更严格的即时撤回/人工确认时，重新评估候选确认 UI 和快照保留规则；不得降低硬安全边界。

## ADR-027｜跨会话 AI 消费采用范围水位、实际 membership 与动态资格

- 状态：Accepted（REV-031；PR #20 final head `4759633ed1e3d9031c8bbe32892d61293f9ec01c`、CI `31326717132` PASS，merge `6289c87009d4377ff190de74ad582e72597ba55a`）
- 决定：项目级 AI job 同时保存“评估过哪些 session/version”的 scope 行与“实际消费哪些 segment/memory”的 membership。零 eligible segment 的 session 仍写 scope；segment membership 冻结 text/role revision、trusted role/authority、content kind 与 digest。禁止用 trigger session 或单一 session revision 冒充跨会话水位。
- 记忆模型：不可变 claim/evidence、版本化 current resolution/member 与动态 future eligibility 分离。可信 elder 自动 claim 可 current；冲突形成 conflict set；明确更正只切换未来 current，原始证据保留；自动结果不得覆盖 human-confirmed authority。
- 问题模型：`QuestionEvidenceModule` 单一拥有 generation/display/actual-question 证据。displayed snapshot、future eligibility 和 display visibility 是三种事实；actual question 与 suggestion outcome 分离。DEV-006 建共享基座和可靠 actual-question catalog，DEV-007 只经 seam 编排生成、展示与换题。
- 输出关联：采用“每个独立业务输出一条 `ai_derived_output`”，不采用 output-set。automatic claim/resolution、question/boundary candidate、generated note、context snapshot 各自一对一；一个 job 的五条 claim 对应五条资格记录。actual-question 以整个 analysis 版本作为唯一 catalog 输出，任一 dependency 命中即撤下整版，子 question 不各建资格记录。跨表 deferred constraint 固定 type/business ID/project/job 一致性；expected count/manifest 防止依赖删除后空集误判有效。
- 并发：job 使用 freeze-call-recheck。冻结和写回按 request/trigger、project、sorted session 加锁；供应商调用不持锁；写回重新验证权限、授权、boundary、deletion、policy revision 和全部 membership，漂移即丢弃结果。查询 eligibility 是权威 version/anti-join/policy 谓词，物化 invalidation 只能辅助观察。
- 删除与保留：deletion scope 在冻结前、调用前、写回前、展示前检查；任一 job input 命中时清理整个 ai_job root，普通 correction 仍按业务输出最小失效；独立 display snapshot 另按其自身 scope 判断。provenance FK 不得阻塞清理。retention 只设 `ai_job`、`question_display_snapshot`、`memory_retention_root` 三类 root；children 继承 root，actual analysis 随 job。到期先隐藏并 detach current/published/display，再 CASCADE/显式幂等清理；失败保持隐藏并续跑，不恢复 eligibility。过程记录保存引用、版本、digest/manifest、状态和耗时，不复制完整转录/输入/输出。CON-023 在正式 producer/reader/C2 回接及并发测试完成前保持 OPEN。
- 失败默认：legacy 缺 provenance 的记录为 review-required/unjudged/future-ineligible，不推断 display、actual asked 或 trusted authority。AI unavailable 不回退基础题、不无限自动重试；一次换题一个新 attempt，同 job 最多一次 JSON/Schema repair。
- 原因：跨 session 消费、修正、删除和在途生成会并发；单表 current 状态或单水位无法证明输入范围，也无法同时满足历史可追溯、即时失败关闭与稳定 UI。
- 代价：增加多张 membership/版本表、动态查询成本和删除编排复杂度；换取可证明的 provenance、无双写 question history、普通修正与硬边界不混淆。
- 重新评估条件：只有测得动态 eligibility 查询成为瓶颈时才可增加物化投影或缓存；缓存仍必须由 revision/policy token 证明新鲜，不能成为权威放行源。向量检索、记忆 UI 与真实供应商仍需另案。

## ADR-028｜当前最佳问题自动更新，展示历史只读可回看

- 状态：Accepted
- 背景：原“一层撤销上次更换”试图避免问题尚未问出就消失，但会阻止系统及时使用更适合当前谈话的新问题，也把“恢复旧建议”和“查看旧内容”混为一个动作。
- 决定：工作台仍同时只显示一个问题。只要服务端判断存在更合适且仍具 future eligibility 的问题，即可自动替换 canonical current suggestion；每个真正展示过的问题及原因都必须形成不可变、稳定排序的本次会话展示快照。
- 导航：当前视图提供“上一个问题”和“下一个问题”。“下一个问题”每次只发起一次新的幂等建议请求；“上一个问题”进入只读历史浏览。历史视图使用“更早的问题 / 更新的问题 / 回到当前问题”，不让“下一个问题”同时承担历史前进和生成两个含义。
- 事实边界：历史浏览不触发模型、不改变 canonical current、不恢复排除、不改变 future eligibility，也不写入 actual-question 结论。“曾展示”与“实际问过”分离；实际问过仍只由可信倾听员 final 的会后分析证明。
- 安全边界：普通事实修正可保留展示快照，但硬边界命中后当前与历史投影均立即撤下正文，历史导航不得绕过授权、禁问或删除治理。
- 实现边界：自动替换的排序稳定/防抖、历史游标、手动请求单飞/幂等、相似度、REST/WS 和错误状态由 SPEC-AI-QUESTION-001 冻结；本 ADR 不选择模型、阈值、表名或传输协议。
- 取代关系：部分取代 ADR-020 的“没用，换一个”文案与 ADR-024 的一层 replace/undo 交互；不改变 ADR-027 的 QuestionEvidenceModule 所有权和 actual-question 目录。

## ADR-029｜问题内容以 REST 为权威，发布顺序、生成意图与安全可见性分离

- 状态：Accepted（REV-032；PR #21 final head `af088ed6`，merge `10fcc5c`）
- 决定：REST current/history/next/request-status 是问题内容的 canonical 接口；WebSocket 1.2 只发布无正文 `suggestion.presentation.changed` revision notification。服务端分别维护单调 `presentation_revision`、`display_sequence` 和 `manual_intent_sequence`：前者裁决 current CAS，第二个形成不可变历史总序，第三个阻止旧 automatic 结果覆盖新的手动意图。
- 自动稳定性：采用版本化内部 comparator 与 `question-sim-v1`，默认分差 0.12、current dwell 15 秒、debounce 1500 ms、相似阈值 0.88；这些值配置化并随 attempt/snapshot 记录版本，不进入公共 DTO，也不把模型 confidence 当作产品事实。
- 手动与历史：manual next 绑定 actor/session/expected current/stable request ID，同 session 单飞并按 3 秒与 60 秒 6 次节流；只有 committed 结果可证明 explicitly replaced。history 以 `(display_sequence,id)` 签名 cursor/anchor 读取，浏览位置只在客户端，不写服务端业务状态、不触发 AI 或 actual-question。
- 安全：current/history/anchor/WS replay 均在调用时重检权限、授权、boundary、deletion、retention 和 policy。WS/cursor/幂等响应不授予持续读取权；硬撤下正文后只返回中性 projection，不自动替代或恢复。
- 原因：单一 last-write 时间无法同时表达供应商结果完成顺序、用户手动意图、权威发布顺序和之后发生的权限/删除变化；把三条时间轴折叠会导致旧自动结果覆盖手动请求、同毫秒历史丢失或 replay 回流撤下正文。
- 代价：增加 display-state CAS、intent fence、签名 cursor、批量 policy projection、内容无关 WS 通知和更多并发/无障碍测试；换取确定性发布、零副作用历史与硬边界失败关闭。
- 边界：不改变 ADR-028 产品行为、ADR-027 QuestionEvidence/actual-question 所有权、三类 retention root 或 CON-023 deletion runtime 状态；不选择真实模型/embedding 供应商，不实现业务代码、migration 或页面。

## ADR-030｜版本化双题库约束下一问，旅程阶段可进可退

- 状态：Accepted（PR #23 final head `5963af98`，REV-034 PASS，merge `f0bff3f`）
- 背景：既有契约冻结了问题发布、替换、历史、幂等与安全，却未冻结陌生关系下的破冰旅程和候选内容来源；`07` §10 曾把基础题库降为后续人工资源，与项目负责人确认的“题库作为正常内容源”方向冲突。
- 决定：正常下一问必须来自一个完整激活、不可变的题库 release；同一 release 同时包含 `basic|deep` 条目，按 `rapport|life_outline|story_depth`、当前确定态转录、可信角色、DEV-006 current memory、实际已问目录和安全事实筛选。AI 只能逐字选择或轻度改写 eligible 原题，不得脱离题库自由生成。
- 内容治理：内容负责人编辑固定 14 列 UTF-8 CSV，不直接编辑数据库；每题必填既有受控 `purpose`。`question_condition_v1` 固定为 applicable all-of/AND、inapplicable any-of/OR、排除优先，未知、空 token、重复或跨字段同码整批拒绝。导入先全量校验为 draft，再原子 activate，激活版本不可原地修改，只能新建 release，旧版可 retire。公开题库必须先核验来源与许可；`unverified` 不得激活。synthetic fixture 使用相同 validator 且仅允许显式 test/internal-demo 环境，不能成为产品内容或正式内部试用证据。
- 阶段语义：`journey_policy_v1` 以单一固定优先级处理硬安全、保守安全、不愿展开、低具体度/话题耗尽、连续讲述、可深入和生平轮廓信号；保守信号压过具体事件/可深入信号。阶段可保持、前进或退回；固定题数和固定时间不能进入决策。相同冻结输入、题库版本和策略版本必须得到相同阶段、稳定 reason codes、basis hash 与选择结果。
- 追溯：每条 verbatim/lightly-adapted candidate 同时保存 source question ID/release version/purpose，以及实际支撑选择或轻调的 transcript/memory dependency。`adaptation_reason_code_v1=surface_wording|grounded_slot_fill`；轻调只允许称谓、语序、口语化和证据支持的槽位填充，并保持 purpose；不得引入未经证实的人物/事件、把 basic 改成 deep、多问合一或提高敏感级别。
- 兼容：保留 ADR-028/029 的 canonical current、自动更新、manual next、只读历史和 displayed != actual asked。自动比较只在同一阶段判定基础内进行；旧 current 因阶段变化不再适用时只失去未来资格，不以普通阶段变化执行硬撤下，已展示历史仍保留。题库是正常内容源，不是 AI unavailable 时的静态 UI 兜底。
- 所有权：DEV-007A 拥有题库导入/版本/激活、阶段与确定性选择 seam；DEV-007B 消费该 seam 和 DEV-006 facts，经现有 QuestionEvidence writer 发布，不另建 question history。DEV-007A 已解锁；DEV-007B 仍等待 A 通过。
- 代价：增加内容发布治理、阶段判定与双重 provenance；换取可审计的问题来源、可迭代题库和从破冰到深入的产品节奏，且不要求负责人直接维护运行时数据库。
- 重新评估条件：真实倾听复盘证明三阶段不足、CSV 无法满足内容协作或确定性筛选质量不足时，可另案扩展；不得在首版预先引入管理后台、向量数据库、固定阶段时钟或自由生成兜底。

## ADR-031｜题库降为可选参考，实时下一问采用单次结构化自由生成

- 状态：Accepted（PR #26 final head `8938d525` 项目负责人 PASS，merge `d320f642`）
- 背景：项目负责人进一步明确，题库用于提供破冰/深入访谈方法和灵感，但真正的下一问应由模型综合当前可信对话、长期记忆、实际已问、近期展示和阶段自由决定；可大幅改写，也可生成题库未覆盖的问题。ADR-030 的白名单/轻调约束把模型错误收缩为选择器。
- 决定：确定性后端按唯一 Context Schema 构造并冻结 `InterviewDirectorContextV1`，一个实时 Director 返回一个问题或继续倾听，服务端按唯一 `InterviewDirectorOutputV1` 做 Schema、ID/subset、重复和安全等基础硬校验后经 QuestionEvidence 追加发布。模型不访问数据库，不负责权限、查询范围、事务或写回；第一版不建设复杂自然语言事实验证器或第二个 planner/critic。
- 题库关系：active/licensed/safe 题库条目是 0..N 可选参考，模型可以原样使用、广泛改写或完全不用。frozen Context membership 记录实际发送/看过，candidate reference 只记录模型声明使用的 seen 子集；事实 grounding 和运行时发布资格再分别保存。无 reference 是合法状态，题库 FK 不再是 candidate 资格门禁。
- 数据边界：题库、转录、memory、actual-question、授权和边界是只读源事实；generation attempt、candidate、display snapshot/history、幂等和过程记录是 append-only 建议事实。保留 ADR-027/028/029 的所有权、displayed != actual asked、current/history/manual-next、REST/WS、安全投影、retention 和 freeze-call-recheck。
- Prompt：首版使用仓库内可编辑、不可变版本化 bundle，不建设在线管理 UI。两份 JSON Schema 是 AI 实际输入/输出的唯一技术结构，Prompt 不复制平行字段定义。job/attempt 在 Context 之外保存 prompt/context/output/context-builder/model-config 等 version+digest 与 membership/hash，不在技术日志复制完整 prompt、Context 或 provider 原文。
- Retry：一次逻辑生成先执行 primary；transport/timeout 或第一次返回未过基础硬校验时最多一次完全相同 Prompt、frozen Context、Output Schema 与 model config 的 retry，不传前次输出、错误或修复提示。权限/安全/deletion/重复/writeback 漂移不 retry；第二次仍失败不创建 candidate、不修改 current/history，等待新的用户动作。
- 取代关系：部分取代 ADR-030 的“题库强制来源、只允许 verbatim/lightly_adapted、无 eligible 原题不得生成、原题 purpose/adaptation reason 为资格门禁”；ADR-030 的题库版本/许可/fixture/导入治理和三阶段旅程继续有效。
- 代价：自由生成扩大问题质量与事实前提风险，需要严格 Context、Schema、grounding、相似度与真实实践复盘；换取模型真正根据谈话生成最合适下一问，不让题库覆盖范围限制产品价值。
- 重新评估条件：单次调用在脱敏/真实实践中出现可量化的上下文丢失或质量不足后，才评估检索调用或独立 critic；不得因“数据库需要协调”预先引入第二 planner agent。

## ADR-032｜腾讯实时 ASR V2 采用供应商中立 adapter v2 与连接级 speaker namespace

- 状态：Accepted（SPEC-ASR-PROVIDER-001 final head `84a2173c` 获项目负责人手动 PASS，PR #28 merge `d7b318f`）
- 背景：既有 `StreamingAsrAdapter` 同步 `accept(frame)->result[]` 与 void drain 只能支撑 deterministic fake，无法表达腾讯 V2 独立握手、异步结果、连接级 voice ID、结构化 drain 和 late-result fence；首帧还受 250ms deadline 且在首次证据事务内。
- 决定：保留供应商中立注入边界，但由 DEV-ASR-PROVIDER-001 原子迁移到 v2 lifecycle/result sink/drain evidence port；v1 不得保留为并行生产真相源。业务 `session.ready` 与 provider ready 分离，不新增公共产品状态或数据库枚举。
- namespace：每个新腾讯 `voice_id` 对应新 provider namespace 和新 `speaker_stream_id`；旧 stream 关闭、sink fence、用户重新校准。`enable_speaker_context=0` 且不发送 context ID；provider label 永远不直接等于业务角色。
- drain/completeness：当前 voice `final=1`、截至 accepted sequence 的 PCM 已获得终态且相关 final 完成 ingestion，只形成 attempt 级结构化 receipt；close、最后一句、超时或 void resolve 均不成立。runtime 另行维护 session/capture 级单调 completeness：任一未回补 gap 或 coverage evidence 丢失即 sticky incomplete，后续 voice success 不得清除；只有整场无 gap、attempt 边界连续且最后 receipt 完整才把既有 finalization 投影为 `drained`，否则为 `degraded|not_started`。
- 供应商：首版唯一候选腾讯实时 ASR V2，标准普通话，目标 `16k_zh_en_speaker_2.0`。内部 `diarization_required=true`，但当前官方未证明 `speaker_diarization=1` wire 参数，禁止发送未证实参数；双人稳定 label 只能由真实三次 replay 验收。
- 代价：需要 DEV 同时改 adapter/gateway/runtime/finalization/config/metrics/test，重连后用户需重新校准，且进程重建丢失 coverage evidence 时会保守 `degraded`；换取不由后续成功掩盖缺口、可追溯、fail-closed、录音优先的真实 provider 生命周期。
- 边界：本 ADR 不授权 Prisma migration、第二 provider/diarizer、gap/backfill、真实 LLM、真实长者数据或部署；若实现必须改变数据库权威事实、公共状态或校准体验，先另做契约审查。

## ADR-033｜腾讯 V2 话者分离 wire 参数纳入实际 query 与签名

- 状态：Accepted（SPEC-ASR-WIRE-PARAM-001 / PR #29 exact head `650f856c918639a7b992294b805873d7052ab44e` 获项目负责人手动 PASS，merge `1e18ea83cd5a1d4953bb92fd251637ed6107c322`）
- 背景：ADR-032 在当时已核对的 V2 通用参数表未列出 `speaker_diarization` 的前提下，保守记录“wire 参数未证明、禁止发送”。后续腾讯官方会议话者分离指南明确 `speaker_diarization=1`，官方 Go SDK 固定 commit `257f9f56bcd592bff1faea9b4ce0f1ef90cea803` 进一步证明该 key 与 speaker context key 被序列化、排序并纳入签名；原供应商事实前提已过时。
- 决定：目标 `16k_zh_en_speaker_2.0` 与内部 `diarization_required=true` 不变。腾讯实际 query 必发 `speaker_diarization=1`、`enable_speaker_context=0`，两者都进入 canonical query；`speaker_context_id` 从实际 query 与 canonical query 完全省略，不传空值。先构造除 `signature` 外的实际 query map，按 parameter name 字典序 canonicalize，再 HMAC-SHA1/base64，最后 URL encode signature 并追加。
- 取代关系：只部分取代 ADR-032 中“`speaker_diarization=1` 未证明、禁止发送”的供应商事实，以及与之直接相关的 context query 表达；ADR-032 的 Accepted 状态与历史正文永久保留。adapter v2、连接级 namespace、新 voice 新 speaker stream 并重新校准、attempt drain、sticky completeness、unknown fail-closed、安全和真实验收决定全部继续有效。
- 诊断边界：本 ADR 获项目负责人 exact-head PASS 后，DEV 可用同一虚构 TTS PCM、同一账号/endpoint/engine/其余 query、单连接、`reconnect=0` 做一次受控诊断连接。该结果不能证明 close 1005 因果，也不替代双人 label、三次 replay、Android、主动断线、账单或完整 provider PASS；仍失败时停止参数试错并转腾讯支持。
- 代价与风险：`speaker_context_id` 的省略与空值会形成不同 canonical query；实现与 fixture 必须机械区分。新增必发参数可能改变供应商响应，但不改变产品状态、数据库、权限或授权边界。

## ADR-034｜统一响应式倾听员工作区，并分离本机副本删除与服务器隐私删除

- 状态：`Accepted`；REV-041 final head `0308aa9ef37be457aa41f23ea6113666ff2c1f97` / CI `31573583324` 经项目负责人授权总控手动复审 PASS（P0/P1=0），PR #31 merge `91e5e7ed042f598359827ae63daf464e12e2ef76` / main CI `31573985661` SUCCESS。
- 背景：DEV-005 已证明预创建深链的首次访谈纵向链路，但登录后首页仍只能提示使用深链；历史 DEV-008 又把项目入口、完整回顾、倾听员导出和服务器删除错误聚合。当前 IndexedDB archive 已在 ACK 后保留，服务端 complete audio object/manifest 是长期权威副本。
- 决定：当前产品只做一套响应式网页。唯一 authenticated home/app shell 承载新建、项目/访谈列表、继续和已结束访谈回顾；新建必须完成 project→service term→正式有效口头 consent→session/device-check/start，draft 不冒充可开始。A1 先提供共享 shell/read model/routes，A1 PASS/merge 后 A2/A3 可并行。
- UI：复用 `apps/web/src/styles.css` 的 OKLCH tokens、排版、context-label、primary/secondary/danger、focus-visible、44px 和 reduced-motion；HomeShell/ListRow/StatusBadge 等价语义、空错状态与词汇只有一套。工作区、新建和回顾不得各建导航或视觉体系。
- 本机副本：当前 origin IndexedDB 不是普通文件、跨设备档案或永久备份。播放只读完整 archive。删除共用 capture Web Lock，锁内 fresh 验证 session/manifest/pending/active/dirty，并在一个 transaction 清理当前/legacy 全部 session payload与恢复事实、原子写最小回执；失败零部分清理。storage estimate 仅为 origin-wide approximate。
- 隐私边界：本机删除明确保留服务器 audio/transcript/memory，不创建 deletion request，不关闭 CON-023。正式服务器隐私删除与统一 `DeletionScopeReader` 独立归 DEV-008D。倾听员导出取消，其他角色未来需要时另立受控任务。
- 平台边界：不做 PWA、Service Worker 安装体验、Capacitor/WebView 或 Android App；未来 Android 软件仅在网页 MVP 经真实实践验证后作为独立产品阶段重新设计。
- 取舍：A1 增加最小 project-session read model，A3 增加 IndexedDB 前向 upgrade、session 索引/回执和跨标签页事务测试；换取普通用户无需深链、UI 只有一个事实来源，并防止本机清理被误解为隐私删除。
- 审查边界：本 ADR 只接收 docs/machine-contract 决定，不代表 A1/A2/A3/008D 已实现或通过；DEV-007 当前状态不作为本切片前置。
- 接收边界：本 ADR 的契约已接收，但只解锁 DEV-008A1；A2/A3 继续等待 A1 PASS/merge，DEV-008D 与 CON-023 不因本决定解锁或关闭。

## ADR-035｜restricted 首页使用独立最小投影，并隔离 evidence-finalization 例外

- 状态：`Accepted`；REV-042 绑定 PR #33 exact head `81f0bba3d30139e458e919da969d40386231cc62` / CI `31586889712`，项目负责人正式 PASS（P0/P1/P2=0）；merge `18ba7381f7ba747c2fb3beefe28297c6d063a174` / main CI `31587442461` SUCCESS。
- 背景：ADR-034/`05` 已要求仍有 assignment 的 restricted 项目在首页显示中性受限投影，但 shared `ProjectResponse` 必含长者称呼、出生年龄、籍贯、城市和 `created_by`，没有可安全实现的受限分支。DEV-008A1 的唯一独立只读 Correction 在编码前阻断，并同时发现普通 session 详情可能把 finalization/session `created_by` 当 assignment fallback、restricted prepare 深链仍可读取项目/服务/授权正文。
- 决定：`GET /projects` 使用判别联合 `ProjectListProjection`。ordinary 分支只服务普通可见项目；restricted 分支固定只含 opaque `project_id`、`projection=restricted`、`status=restricted`、`display_label=受限项目`、`status_label=当前不可访问`，无 session 行、统计、正文或主动作。deleted、软删除与 assignment 失效完全无行。
- Cursor：session page cursor 是签名 opaque token，绑定 `project_id + created_at + id`、方向、page size 与过滤版本；跨项目、篡改、过期、参数或权限漂移失败关闭，不降级首页。
- 权限分层：普通 Home 之外的 project/service-term/consent/session 详情与 prepare/workbench/review 始终要求当前有效 assignment 和 ordinary project visibility，`created_by` 不产生读取权。限制前已经冻结 stop snapshot 的原操作者只可通过 `EvidenceFinalizationResponse` 收束 commitment 范围内证据；该响应无 project/transcript/页面事实，不能成为普通读取旁路。
- 数据边界：本决定只增加 read model/shared DTO，不新增表、migration、项目状态、授权语义、deletion scope 或产品页面。业务实现和测试仍归 DEV-008A1。
- 复核边界：复用 DEV-008A1 已完成的唯一 Correction，不启动第二次 iteration-coach；本 ADR 接收后 A1 恢复 `READY`，但 handler/repository/cursor/UI 与安全反例仍须由 A1 实现并验收。
- 接收边界：只接收 docs/shared-contract 安全接缝；不代表 DEV-008A1 已实现或通过。父 DEV-008A、A2、A3、008D 继续 `BLOCKED`，CON-023 不受影响。

## ADR-036｜finalization 总字节复用 AudioObject 权威事实并按未证明失败关闭

- 状态：`Accepted`；REV-044 绑定 PR #37 exact head `70167688202117364e5cab74c9a320e0a7d76742` / CI `31597563095`，项目负责人手动独立审查 PASS（P0/P1/P2=0）；merge `60f60cb6b5c8f70c9fca9840aa6c495f6e2318d8` / main CI `31598183784` SUCCESS。
- 背景：`05` §3.6.1 已要求 A3 fresh delete preflight 将 manifest 的 chunk count/total bytes 与 session finalization 对照，但公共 `SessionFinalizationSnapshot` 没有 total bytes。DEV-008A3 开工前唯一 iteration-coach Correction 在零改动阶段阻断；现有 `AudioObject.totalSizeBytes` 与 `AudioManifestResponse.total_size_bytes` 已提供数据库和 manifest 权威事实。
- 决定：公共 `SessionFinalizationSnapshot` additive 增加 optional+nullable `total_size_bytes`。值只从同一 finalization 关联的 `AudioObject.totalSizeBytes` 投影，不新增 Prisma 字段/migration，不复制到 `session_finalization`，不从客户端、本机 archive、commitment 或已上传数量反推。optional 只用于 contract-first 兼容旧 typed producer；A3 runtime 后 ordinary canonical GET 必须显式带键。
- lifecycle：`awaiting_upload|verifying|unrecoverable` 与任何未证明/legacy/unsafe 事实返回 null；正常 `complete` 返回精确非负 safe integer。正常 `processing|completed` 与 `failed + complete manifest` 必须非空。complete+缺键/null/unsafe/mismatch 不使整个只读 session 不可见，但必须关闭 A3 播放和本机删除，绝不能按 0 处理。
- 白名单：只扩 `InterviewSessionResponse.finalization` / `SessionFinalizationSnapshot`。A1 `ProjectSessionListItem` 不需要容量且不扩 Pick；restricted `EvidenceFinalizationResponse` 也不扩。A3 只可在当前 assignment + ordinary visibility 下读取 canonical session GET，`created_by` 与本机 archive 不授予权限。
- 一致性：A3 必须 fresh 证明 session/finalization/manifest identity、expected/manifest/local count、finalization/manifest/chunk-sum/local bytes、checksum 与逐片元数据全部一致；任一 missing/null/stale/mismatch 都为 `blocked_server_unverified`，零回执、零部分删除、零服务端写入。
- 取舍：分阶段 optional 让 docs/contract PR 不越界修改业务 mapper且 CI 可通过，但若没有 A3 exact-key 白名单测试会有永久漏发风险；因此 runtime 显式 key 与 legacy/null 反例是解锁后的硬门禁。
- 边界：不改变 local deletion≠server deletion、权限、删除范围、CON-023、DEV-008D、首页动作矩阵或 evidence-finalization 例外；不实现 A3、IndexedDB、页面、服务端下载或服务器删除。
- 接收边界：只接受 contract-first total bytes 接缝并解锁 DEV-008A3 runtime；ordinary mapper 显式 key、safe integer、权限白名单与 fresh/legacy 失败关闭仍须由 A3 实现和验收。父 DEV-008A、DEV-008A2、DEV-008D 与 CON-023 状态不因本 ADR 改变。

## ADR-037｜首次访谈使用授权前当前页设备检查、正式流校准与自动收尾

- 状态：`Accepted`；REV-047 绑定 PR #44 accepted exact head `3824da7c48f9f63b4ca71b0fb56f459d8c24fa7d` / CI `31711325876`，项目负责人手动审查 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/44#issuecomment-5281992260)（P0/P1/P2=0）；merge `175e92e3bda76f4b180e85519e3bf8e62c356311` / main CI `31712044809` SUCCESS。旧失败 head/CI 与用户实测发现历史永久保留。
- 背景：A1/A2/A3 已按旧路径完成，但普通流程仍把 ServiceTerm 同时作为 UI 与 start/readiness gate，麦克风检查晚于授权，校准与工作台同屏，complete ACK 未落本地 complete，正常收尾依赖三个手动动作。
- 决定：普通链路冻结为 `project → early session → current-page mic/input → consent audio/consent → formal start/stream → dedicated calibration → workbench → automatic closeout → completed/review`。ServiceTerm API/表/历史 dormant，不在普通 UI 创建或展示，也不参与 ready/start/capture current gate；consent 仍是 ready 与 start 的正式门禁。
- 校准边界：已有 collecting attempt 的 degraded continue 必须经 server skip marker 收束，无 attempt + provider unavailable 才可本地 bypass；WS interim 由服务端按持久 attempt 半开时间区间发布 `content_kind`，不让客户端用 revision/到达顺序猜测。
- 完成投影：服务端 canonical `completed` 直接切换为独立完成 DOM，不在转录/建议工作台上叠加可收起 panel；仍保留 4 秒 canonical verify 使 processing 自动进入 completed。
- 设备事实：服务端 device_check 可复用既有状态机，但当前页面 passed 只存于组件生命周期，刷新必重检。formal start 的 getUserMedia 继续作为开始当下重验。
- 校准与正文：校准仍由正式 provider stream/attempt 权威绑定，不成为 raw recording 硬门禁。失败/跳过/不可用时角色不可信且录音继续。校准证据保留，但 ordinary realtime/transcript/review/AI context 不含其正文。
- 收尾与 A3：controller 持有 complete ACK→local job complete 的唯一写权。exact ACK 后才能落 complete；自动 reconcile/verify 使用稳定幂等 ID、单 in-flight 与状态水位。回顾可有界重新投影，但不放宽 fresh manifest + archive 全门禁。本机删除仍不影响服务器，DEV-008D/CON-023 不变。
- 迁移与范围：无需 Prisma migration 或新状态枚举。不实现真实 ASR/LLM、题库、server deletion、导出、部署、PWA 或 App。
- 取代关系：本 ADR 只取代 ADR-034 中普通新建必须 project→service term→consent→prepare/device-check/start 以及同屏校准/手动 happy-path 收尾的部分；ADR-034/035/036 的统一 shell、权限失败关闭、本机删除边界和严格 A3 门禁继续有效，历史正文永久保留。
- 用户实测补充（2026-08-13）：`stopping/processing` 的自动恢复以 canonical session 为触发事实，不得依赖页面内存中的 `endHandoff`；存在 handoff 时重放 exact complete，缺失时直接以跨刷新稳定的 reconcile identity 追认服务端事实并 verify。unknown create 同样以持久原 request ID/payload 自动 replay，普通文案不暴露实现身份；客户端不得用固定超时主动制造 status=0 未知响应。
- 同源回顾补充（2026-08-13）：A3 门禁仍以 fresh server manifest 与当前 `location.origin` 的 IndexedDB archive identity/count/bytes/checksum/dirty/pending 为唯一依据。页面可有界、可见重投影，但跨 origin/主机名/端口只给诊断，禁止合并存储或放宽删除门禁。

## ADR-038｜连续访谈采用项目级权威动作、完成后双分析与校准后单次开场

- 状态：`Accepted`；REV-048 绑定 PR #46 accepted exact head `8d4a26263db7b75dd22469f767240d705d3ce5fe` / CI `31715348528`，项目负责人手动审查 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/46#issuecomment-5287945749)（P0/P1=0）；merge `54fb814e44ab2a405f78133e480d467577dbc7b8` / main CI `31757442056` SUCCESS。ADR-037 已由并行 DEV-008A4 / PR #44 占用。
- 背景：数据模型已有 project/session sequence、Memory current view、actual-question catalog、context snapshot 与 `second_session_opening` attempt kind，但 Home 没有 project-level repeat action，`MemoryService.extract`/`reconcileActualQuestions` 没有生产调用者。只加按钮会创建新 session 却没有真实继承。
- 决定：普通 project read model 投影唯一 `start_next_session` action；服务端按当前权限/assignment/project/consent/deletion 与 session 集合失败关闭，前端不猜 status。全局 new-interview 继续创建新 project，session 行继续只处理当前 session。
- 创建：新增显式 next-session workflow，stable request/canonical payload 绑定 existing project + latest completed basis；project 锁和 sequence 唯一性保证不同 request 并发至多创建一个 sequence+1。新 session 的 capture/audio/ASR/speaker/calibration/runtime 全新且重新 gate。
- 会后：canonical completed 提交产生稳定 trigger root，分别调用既有 Memory owner 和 QuestionEvidence actual-question owner。两 lane 非阻塞、独立投影 status/retry evidence；失败不回退 completed、不阻塞 raw recording/review/next session。terminal 固定为 succeeded/unjudged/failed/cancelled/unavailable。
- 开场：sequence>=2 的 calibration gate terminal 后若 basis 任一分析 lane 非 terminal，只派生 waiting，不创建 opening job/attempt/Context、不消费 gate；两 lane terminal 后才以 basis analysis trigger + calibration gate stable identity 至多一次冻结并触发。confirmed gate 可含当前 stream trusted membership，failed/skipped/no-attempt provider-unavailable gate 只使用先前 session 的可信资料；成功 lane eligible output 必须纳入，降级 lane 如实留空并记录 outcome。Context 只冻结 same-project eligible current memory、published reliable actual asked、边界与可信 membership。displayed != actual asked；继续复用唯一 Director/QuestionEvidence/current/history。
- 降级：provider unavailable 不回退基础题、不阻塞创建或录音；analysis/opening 如实 failed/unjudged/unavailable。GET/render/WS replay 不产生 job。
- UI/治理：不新增 memory/summary/pending-confirmation UI，不引入第二 AI/history、Prisma/migration、DB ownership、privacy/deletion/retention 或网页方向变化。称呼来自 `AuthUser.display_name`。
- 依赖：DEV-008A4 / PR #44 与本 ADR/SPEC 均已 exact-head PASS/merge；B1/B2 机械转为 `READY`，但 runtime 尚未实现，且不得改写 A4 Home/routes/styles/completion/review。
- 代价：增加一类 project action、显式 workflow 和两个系统触发身份；换取可证明的 same-project sequence、真实生产 caller、可审计 membership 与 AI 故障不伤录音。未来若需 memory UI、新 AI 或删除语义，必须另立决策。
- 审查历史：old exact head `99e5d317f4e5ad62444148442329114840c58293` / CI `31709711887` 获项目负责人 `REQUEST_CHANGES`（P0=0/P1=1），指出 calibration-first 抢跑 post-analysis；双前置定向修复内容 head `0623b5ff7c8af1669fcf6b79ed72a3b4c66f1eaa` / CI `31711566144` SUCCESS。final accepted head `8d4a26263db7b75dd22469f767240d705d3ce5fe` / CI `31715348528` 获项目负责人 PASS（P0/P1=0），唯一 P1 已关闭；旧结论与修复历史永久保留。

## ADR-039｜同项目使用持续授权并在每次正式录音前提供版本化轻提醒

- 状态：`Accepted`；REV-049 绑定 PR #49 accepted exact head `1d241a4b8c40827a93eefe1c9825021b6859df74` / CI `31764584701`，项目负责人手动定向复审 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/49#issuecomment-5288833214)（P0/P1/P2=0）；merge `712b4ff46acbff5168453c79b2d02375a84fa017` / main CI `31764903272` SUCCESS。
- 背景：ADR-037 固化首次口头授权，ADR-038 固化同 project 多 session，但旧规范把“每个新 session 重检 consent”留成可被误解为每次重录完整授权的空白，也未定义开始按钮、轻提醒与正式 consent 的边界。CON-012 同时未关闭跨文本版本复用风险。
- 决定：一位长者一个 project、多次 session。首次访谈在当前页 mic 检查后录制完整 `recorded_verbal` 授权；正式文本必须覆盖同 project 当前及未来计划内访谈，并说明可随时暂停、停止或撤回。普通后续 session 复用仍适用的原 consent record，不重录授权音频、不追加 consent record、不重复完整授权页。
- 每次录音：每个 formal start 前由服务端 snapshot 返回版本化、逐字轻提醒和“开始访谈”动作；客户端原样显示，倾听员显式点击并回传 reminder version。该动作是本次录音启动事实，不是新授权，不创建 consent/audio，也不能修复无效授权。
- 动态门禁：next-session 与 start 都重新检查 active actor、有效 assignment、project restriction/deletion、当前适用 consent 与政策版本；start 还检查当前 reminder version。刷新、普通时间间隔、有效 assignment 内更换倾听员不要求重授权；更换设备只重做当前页 mic/device。旧 Home/cache/幂等响应均不提供持续权限。
- 重授权：`revoked|expired`、文本版本不兼容、处理目的扩大、访问主体扩大、供应商处理地区扩大、公开/训练用途扩大，或原文本未覆盖未来访谈时，必须使用当前新版本全文重新取得正式授权。新版本必须有与该版本一致的新授权音频；禁止跨版本复用旧音频。兼容性只能来自服务端显式版本政策，缺失或无法证明时失败关闭。
- 数据与范围：不新增 Prisma 字段、表、migration 或持久“提醒确认”记录；继续使用 consent 追加历史和 start/idempotency 审计。ServiceTerm 保持 dormant。不改变 ASR/LLM、删除/retention、A4 completion/review 或网页方向。
- 取代关系：本 ADR 只澄清并部分取代 ADR-037/038 中把“当前版本 consent”简单理解为逐 session 新授权的可能性；它不改写两 ADR 的历史正文、首次 mic→consent→start、repeat action、会后分析或 opening 决定。
- 代价：需要维护服务端 consent version compatibility policy 和 recording reminder version；换取授权证据与实际文本一致、后续访谈低摩擦，并能在版本/用途/访问范围漂移时确定性失败关闭。
- 确定性修订：repeat action 按 access/project → non-terminal session → no completed → consent unavailable → reauthorization → eligible 的固定优先级取首个命中；非终态 session 与 reauthorization 同时成立时只能 `session_in_progress/null action`。shared contracts 使用交叉 discriminated unions 机械约束 continuation 与 repeat reason/action/basis。
- 可交付前置：真实 `covered` 状态须等待独立 SPEC-CONSENT-TEXT-POLICY-001 接收有权主体提供的正式正文、版本/digest 与 machine scope。Agent 不代写或批准法律文本；local/test fixture 如未来采用，只能显式虚构且生产/真实路径继续失败关闭。
- 审查历史：old head `4095e570d17d8ecae94d630d62bca9ab0205917d` / CI `31762375878` 的 REV-049 REQUEST_CHANGES（P1=3）永久保留；accepted head `1d241a4b8c40827a93eefe1c9825021b6859df74` / CI `31764584701` 关闭三项 P1 并获 PASS。Accepted 只接收契约方向；真实 `covered` 仍依赖 BLOCKED 的 SPEC-CONSENT-TEXT-POLICY-001，runtime 尚未实现。

## ADR-040｜LLM 采用应用内 AI SDK 直连、单 active binding 与隔离横评

- 状态：`Accepted`；accepted content 与 latest-main integration exact head/CI 均获项目负责人 PASS，PR #52 已合并且 main CI 成功。
- 背景：DEV-007B 已以 deterministic local/test Director 验证唯一 Context/Output Schema、单 Director、共享 8 秒 deadline 与同输入 retry，但 staging/production 仍 provider unavailable。项目负责人需要随时调整 Prompt、比较不同模型，同时不希望在当前阶段部署 Gateway/LiteLLM 或把横评结果混入业务历史。
- 决定：TypeScript 应用内使用 Vercel AI SDK Core 与 direct provider packages；不使用 Vercel AI Gateway，不部署 LiteLLM。正式 generation attempt 冻结唯一 active provider/model/model-config，registry 只查找显式 binding，不承担 fallback/order/shadow routing。AI SDK `maxRetries=0`，项目既有 primary/最多一次 same-input retry 与 8 秒绝对 deadline/abort 是唯一调用编排。
- Prompt：采用 `draft -> immutable candidate -> fixed synthetic/deidentified evaluation -> immutable formal+digest -> explicit active switch`。当前 formal/runtime v1 不覆盖，`v2-draft` 不可加载。Prompt 需要新字段/枚举时必须先变更正式 Context/Output Schema。
- 横评：同一轮把完全相同的冻结 Context/Prompt candidate/Schema/model-config policy 发给显式选择的模型。输出、token、latency 和 provenance 只进入隔离 evaluation artifact，不写 QuestionEvidence current/history，不自动选择 winner 或成为 fallback；题库可空/不用，后端 stage 仍权威。
- 安全：provider/model/config/endpoint/region/data-class allowlist 与 secret reference 仅后端注入，真实访谈内容默认 deny，任一未知 fail closed。provider request ID、SDK response ID 来源分离，真实 provider/model/config/package/token/latency/region/direct mode 可复盘，禁止用 `local-test` 补缺。未决定境外处理前不得发送真实内容。
- 依赖：真实 runtime 开工等待 `DEV-ASR-PROVIDER-001` 正式 PASS，并另需项目负责人选择实际 provider/model/region/data policy；本 SPEC 不安装 SDK、不索取密钥、不调用 provider。`ai@7.0.65`/Apache-2.0/Node>=22 只是 2026-08-14 核验基线，后续实现重新核验并 exact pin。
- 代价：短期内仍没有真实 LLM；每个 provider 需维护独立 profile/合规证据，Prompt promotion 与横评增加治理步骤。换取 retry/fallback 单一真相、供应商可替换、Prompt 可控试验、真实 provenance 和评测/业务数据严格隔离。
- 不做：真实 provider、在线 Prompt 管理、第二 critic、LiteLLM、Gateway、题库重做、DEV-007/008 流、真实数据横评、Prisma/migration 或 formal v2 切换。
- iteration-coach：复用总控本轮唯一独立只读 Correction，未启动第二次；其 Prompt lifecycle、SDK no-retry/fallback、provenance、隔离横评、region/secret 与 ASR 门禁修正已吸收。
  - 审查历史：REV-051（accepted contract 中 branch-local 标记 REV-050）绑定 PR #52 old exact head `b7ae9a428530be92a95a5fb9d2fc6cc2fd2c5ede` / CI `31769677989` SUCCESS 的 `REQUEST_CHANGES`（P0=0/P1=3/P2=0），以及 accepted exact head `77fb3a860ccd372f1fdc3465654f86d931688a89` / CI `31783061076` SUCCESS 的项目负责人内容 `PASS`（P0/P1/P2=0）。old head/CI/结论永久保留；integration exact head `a324e2bcc1e5250ff5e43fa977ecd4c2b4aeec9a` / CI `31787175381` SUCCESS 又获项目负责人窄 integration `PASS`（P0/P1/P2=0），PR #52 merge/main `99ce83d001ffca5075d63f60c26067a2f9f2de59` / main CI `31789810221` attempt 1 SUCCESS，故 ADR 转为 `Accepted`。
  - 已接收定向修复：以独立 deterministic semantic validator contract/reference 锁定跨数组 exactly-one/membership/duplicate 语义；以四类独立 identity/source 锁定调用 provenance；以 `llm-model-config-v1` canonical manifest/digest、sanitized warning 与 `as_requested` 判定锁定横评的 equal-effective-config。该接收未接 runtime；真实实现仍由 BLOCKED 的 DEV-LLM-PROVIDER-001 在 ASR、provider/model/region、DPA/data policy 与 secret 门禁关闭后另行受审。

## ADR-041｜Cloudflare 外围准入与应用身份分离，代理 IP 默认失败关闭

- 状态：`Proposed`；等待 SEC-AUTH-PUBLIC-001 非 Draft PR exact-head CI 与项目负责人安全审查，不能由实现者自行转 Accepted。
- 背景：ADR-009 的本地应用账号、不透明 session 与资源授权仍是当前权威；网页方向已经确定为响应式 Web，部署方向为 Cloudflare。DEV-001B 只交付内部候选，staging 仍使用 local Cookie，CON-008 的匿名失败审计未形成真实关闭事实，部署层的可信代理和客户端 IP 语义尚未冻结。
- 决定候选：`staging|production` 统一使用外部 HTTPS `__Host-` Secure Cookie；Cloudflare Access 只作外围网络准入，不创建应用 principal，不授予角色/assignment，不成为审计 actor，也不替代 session rotation/revocation。未知账号失败使用窄 `anonymous` audit actor 与用途分隔 HMAC 摘要，已知账号保持 user actor，客户端响应一致。
- 代理边界：应用只拥有 `ClientIpResolver` 窄 port。默认实现只取 TCP 直接对端并忽略全部转发 header。只有 SPEC-STAGING-DEPLOY-001 同时冻结受信入口、origin 直连阻断、可信代理集合、唯一 IP header、hop 与异常规则后，才可新增部署 adapter；本 ADR 不选择 Tunnel/Nginx、header、CIDR 或 hop。
- 会话边界：登录总是新建 session/CSRF，不复用请求旧 token；authenticate touch、CSRF rotate/verify 与 revoke 必须以持久 session 仍有效为条件，撤销/过期先提交时后续动作失败关闭。改密、停用、权限安全事件与管理员撤销继续撤销全部相关 session。
- 原因：把边缘准入与应用授权分开，可保留即时停用、逐资源 assignment、审计归属和供应商可替换性；默认不信任转发 header 避免 origin 可直连或代理配置漂移时伪造 IP 绕过限流。
- 代价：部署契约接收前，反向代理后的所有请求可能按直接代理对端聚合限流，不能宣称公网容量/公平性通过；需要后续受审 adapter 才能恢复真实客户端 IP 粒度。
- 重新评估：跨源部署、允许绕过 Cloudflare 直连 origin、Access identity 替代应用账号、引入 OIDC，或可信代理无法形成唯一可验证入口时，重开 ADR-009/041 与 Cookie/CORS/CSRF/审计契约。
- iteration-coach：本任务恰好一次独立只读复核为 `Clear / NO-PAUSE`；最重要不变量是任何边缘 metadata 只有在部署证明受信入口后才可成为安全上下文，且即使可信也不能授予应用身份或权限。
