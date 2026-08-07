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
- 决定：一个浏览器上传作业对应一个连续 `0..N-1` 的 audio object。IndexedDB 除不可变 Blob 和 seq/timeline 高水位外，还持久化 init/chunk/complete 的稳定 request ID、服务端 audio object ID、录制结束时冻结的 expected count 和作业状态。网络请求前先持久化 request ID；响应丢失或刷新后复用同一 ID；只有服务端 ACK 全字段匹配才删除本地 Blob。
- 原因：只保存 Blob 无法在 init 或 complete 响应丢失后确定服务端状态，刷新时可能重复创建对象、错误重放或从已 ACK 删除的剩余 Blob 算错分片总数。服务端 ADR-015 幂等只有客户端复用稳定 request ID 才能形成端到端恢复协议。
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

- 状态：Proposed（等待 SPEC-DEV-005R GitHub 审查）
- 决定：正式路由由 session-scoped `InterviewCaptureController` 独占一条 MediaStream，同时驱动 MediaRecorder 原始归档和 AudioWorklet 实时 PCM；每个 Blob 只写一次浏览器 archive，delivery queue 仅引用它，ACK 不删除 archive。服务端 atomic start 创建唯一 interview audio object 与 generation 0；显式中断/恢复使用持久 capture generation 和新 audio stream，但复用同一 session/object/local job。
- 原因：旧正式页面、audio harness 和实时工作台分别拥有开始、原始录音、上传和 PCM，无法向 stop 提供同一对象/作业/commitments，也无法区分刷新、实时断线与真实采集中断。
- 事实边界：原始录音、本浏览器 archive、服务端 manifest、转录和 session 是五类独立事实；WebSocket replay、URL、计时或最后 final 均不能证明原始录音完成。正常 stop 仍以 ADR-022 finalization 为服务端事实源。
- 恢复边界：短时 WS 重连复用当前 stream；显式 capture resume 创建下一 generation/stream，原始 timeline 延续、PCM sequence 重置并带 offset。零音频仅在服务端/PCM/本地 archive 均无证据时以 `NO_AUDIO_CAPTURED` 终结。
- 安全边界：同 session 单标签锁；撤权/撤 assignment 停止新采集但不丢已产生证据；浏览器 archive 仅用于内部虚构数据验证，真实试点前必须补本地备份管理/删除。
- 代价：增加前向 migration、浏览器敏感数据驻留、controller 生命周期和更多恢复状态；换取从 start 到 stop 的单一所有权与可验证纵向链路。当前不引 Redis/队列、云存储或跨设备接管。
- 重新评估条件：需要跨设备接管、多进程浏览器协作或永久离线备份时，引入显式租约/同步和用户可管理的本地数据产品能力，不得把当前 session lock 静默升级为跨设备保证。
