# Project Iteration Journal

## Current Snapshot
- Product goal: 帮助倾听员可靠完成长者人生故事访谈，保存可追溯的原始资料，并由 AI 提供跨会话记忆和候选追问；MVP 不自动生成完整传记。
- Current stage: 探索期 MVP 核心纵向链路验证；DEV-005/006/007A/007B 的 fake/synthetic 工程链路已完成，父 DEV-007 暂停在聚合验收且不作为 008A 前置。统一响应式网页 A、DEV-008A4、DEV-008B1/B2 与 DEV-ASR-PROVIDER-001 已在各自 accepted 范围 DONE；Repeat Interview、Continuing Consent、LLM Provider、Staging Deployment SPEC 与 SEC-AUTH-PUBLIC 已 PASS/merge/收口，DEV-001B 在应用身份/会话基础范围 DONE。DEV-STAGING-DEPLOY-001 继续 BLOCKED，尚无公网部署且 trusted ingress/proxy/header/origin 防直连未实现。真实 `covered` 完成仍被 SPEC-CONSENT-TEXT-POLICY-001 阻塞；DEV-LLM-PROVIDER-001 仅解除 ASR 工程依赖后仍因 provider/model/region/data-policy/secret/migration 等独立门禁 BLOCKED，DEV-008D 继续 BLOCKED，CON-023/027 继续 OPEN。真实授权文本/长者 PII/真实数据试点、正式题库、补转录、云存储、iPhone Safari、PWA/App、真实 LLM 与生产部署后置。
- Architecture: 模块化单体；Node 24.18、pnpm 11.15 workspace、React/Vite、NestJS、Prisma 7/PostgreSQL；录音、ASR、AI 三链路解耦；正式访谈采用 session-scoped 单流 controller、浏览器 archive/delivery 分离和持久 capture generation。LLM provider-neutral 契约已接受 Vercel AI SDK direct-provider、单 active binding、no fallback、共享 deadline/abort 与隔离横评；真实 runtime/active binding 尚未实现。
- Constraints: 原始录音、原始转录和原始授权记录不可覆盖；AI/ASR 故障不得影响原始录音；AI 结论必须回链确定态转录；不得提前实现 MVP 外功能。
- Open questions: “拾光”是否为正式品牌名；真实 ASR 数据处理与 CON-027；LLM provider/model/region/DPA/data policy 与对象存储最终供应商；CON-013/023；正式持续授权正文与 machine policy。CON-006/007/008/012/031 原日志已 RESOLVED 并从开放索引移除；其中 CON-008 只关闭匿名失败审计/应用身份基础，不关闭 trusted ingress 或部署，CON-031 只关闭 provider-neutral 契约未冻结。真实 LLM 外部门禁由 BLOCKED 的 DEV-LLM-PROVIDER-001 继续承接，部署边界由 BLOCKED 的 DEV-STAGING-DEPLOY-001 承接。补转录由 HARDEN-ASR-001 后置。

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

### D-014 — 说话人角色的值、来源流与可信度必须分别建模

- Status: adopted；SPEC-DEV-004C REV-027 对 PR #17 final head `2a65b1f` PASS，merge `0b6c357`。
- Evidence: 项目负责人已在 DISC-004C 逐项定稿；正式契约同步到 `01/03/04/05/06/07/09`、ADR-025、CON-014 与 SPEC/C1/C2 任务卡，并经项目负责人 GitHub 定向复审通过。
- Reason: 同一个 provider 短 label 在重建后的流中可能代表不同的人；provider 自动返回 `elder` 也不等于倾听员确认。若只保存角色值或只按 session 关联映射，会把错误角色带入长期记忆和已问问题判断。
- Tradeoff: 增加持久 `speaker_stream_id`、authority、PCM 串行边界、统一 snapshot、服务端 calibration attempt、控制内容类型、修正 revision/membership 和批量稳定预览；换取可审计的可信角色门禁与范围化失效。
- Boundary: 校准发生在原子 start 后同一正式录音/ASR 链路，失败或跳过不影响录音；DEV-004C 只产出角色事实与失效 producer seam，跨 session AI consumer 必须先经 `SPEC-DEV-006`，再由 DEV-006/007 实现重算。真实供应商准确率、声纹、跨会话身份和多人 diarization 不在当前范围。

### D-015 — 补转录后置，内部 MVP 先验证记忆与追问

- Status: adopted
- Evidence: 项目负责人于 2026-08-09 明确“现阶段无需考虑补转录，先尽快把能用的产品做出来”；`00/03/06/09/10`、DEV-004、HARDEN-ASR-001 与任务板同步；iteration-coach 独立只读复核支持该分层。
- Reason: 当前核心未知是结构化记忆和单问题追问能否帮助倾听员，而不是生产级 ASR 缺失区间能否自动补齐。原始录音与安全结束已经允许转录降级，补转录继续作为前置只会延迟核心价值验证。
- Tradeoff: 内部演示可能存在明确的转录缺口，不能宣称完整转录、真实供应商可靠性或真实试点就绪；换取 DISC-006/DEV-006/007 更快开始。
- Boundary: ASR 故障仍不得影响原始录音、manifest 或安全结束，必须显示 `degraded|not_started` 且不得伪造 final。故障区间持久化、真实供应商重连与离线补转录由 HARDEN-ASR-001 在完整 MVP/真实试点前另行契约和验收。

### D-016 — 第一版记忆在后台工作，问题快照与未来资格分离

- Status: adopted
- Evidence: 项目负责人完成 DISC-006 并批准 CON-024 推荐拆分；`01/03/04/05/07/08/09/10`、ADR-026、DISC/SPEC/DEV 任务卡与追踪已同步。
- Reason: 当前核心验证是后台记忆能否改善“下一问”和第二次访谈开场，而不是先建设记忆管理 UI。已经展示的问题是一次屏幕快照，普通事实修正不必让现场界面突然跳动；但安全边界和未来生成资格必须由服务端立即强制。
- Tradeoff: 普通说话人、文字或记忆修正后，屏幕上的旧问题可能短暂基于旧理解，直到倾听员换题或正常更新；换取更稳定的现场体验。该快照不得再作为未来生成、跨会话继承或当前记忆事实。
- Boundary: `restricted`、`do_not_ask`、活动 deletion scope、授权或访问失效属于硬边界，必须立即隐藏问题正文，刷新、GET 和 WS replay 也不得恢复；只显示中性的“继续倾听”或“AI 暂不可用”，且不自动生成替代问题。DEV-006 开工仍依赖 SPEC-DEV-006 项目负责人 PASS。

### D-017 — 跨会话 AI 输入用 scope + membership 证明，资格由查询动态裁决

- Status: adopted；REV-031 对 PR #20 final head `4759633` PASS，merge `6289c87`。
- Evidence: `04` §§4.28-4.43、`05` §§3.9-3.10、`07` §5.8-5.9、ADR-027；iteration-coach 恰好一次独立只读复核。
- Reason: 单一 session revision 既不能证明项目 job 检查过哪些 session，也不能证明实际消费了哪些文字/角色版本；异步 invalidation 也不能承担隐私查询放行。
- Tradeoff: 增加 scope/membership/dependency 表、动态 anti-join/policy 查询和 deletion 编排；换取跨 session provenance、修正即时失效、在途写回丢弃和历史快照稳定。
- Boundary: display snapshot、future eligibility、visibility 分开；QuestionEvidenceModule 是唯一 question history owner；CON-023 在 producer/read model/C2 回接前仍 NOT IMPLEMENTED/NOT VERIFIED。DEV-006 可实现契约基座，但不得用 no-op guard 冒充 deletion coverage。

### D-018 — 更合适问题自动更新，历史浏览取代一层撤销

- Status: adopted
- Evidence: 项目负责人暂停原 DISC-AI-QUESTION-001，明确“只要判断有更合适的问题就应当替换”，增加“上一个问题”，并将“换一个”改为“下一个问题”；ADR-028 与 `01/03/04/05/07/08/09/10` 已同步。
- Reason: 强制保持当前问题会错过谈话中新出现的更佳追问；一层撤销把“看回旧问题”误写成“恢复旧问题为当前”。不可变展示历史可以保留可找回性，同时让系统继续适应对话。
- Tradeoff: 页面和契约增加历史导航、稳定排序与防抖要求；倾听员可回看旧问题，但旧问题不会因此恢复为 current 或重新获得 future eligibility。
- Boundary: “曾展示”不是“实际问过”；历史导航不触发 AI、不改变 current/排除/eligibility。硬安全边界命中后，历史也必须撤下正文。具体排序、防抖、cursor、REST/WS 与幂等由 SPEC-AI-QUESTION-001 冻结。

### D-019 — 版本化双题库约束下一问，旅程阶段可进可退

- Status: adopted；formal contract 已由项目负责人 exact-head PASS，ADR-030 Accepted。
- Evidence: 项目负责人于 2026-08-10 明确要求先做可试用第一版，以基础/深入题库承载破冰、生平轮廓和深层故事，由 AI 结合确定态转录、可信角色、DEV-006 current memory、阶段和安全事实选择或有据轻调；iteration-coach 恰好一次独立只读 Correction 复核补充原子版本发布、可验收阶段判定和轻调双重 provenance。
- Reason: 既有契约能可靠发布和替换问题，却没有规定问题内容从哪里来、陌生关系如何渐进，也无法阻止模型在内容真空中自由生成。把内容治理和旅程先冻结，才让排序、记忆与自动更新有明确优化目标。
- Tradeoff: 增加 CSV 校验、不可变 release、阶段判断和 provenance；换取内容负责人可直接维护、问题来源可审计、首版可用 fixture 快速打通且不冒充产品内容。
- Boundary: CSV 只作交换/编辑，数据库才是运行时事实；题库是正常内容源，不是 AI unavailable 静态兜底。固定题数/时间不能单独切阶段；synthetic fixture 仅限 test/internal demo，正式内部试用前必须导入负责人题库。DEV-007A 只交付基础设施与确定性 seam，B 在 A PASS 前不启动。

### D-020 — 统一响应式倾听员工作区，本机副本删除与服务器隐私删除分离

- Status: adopted；SPEC-DEV-008A 已获 exact-head PASS/merge，A1 已完成；A3 total bytes 接缝的窄补充仍在 REVIEW。
- Evidence: 用户明确当前只做响应式网页、登录后不再长期依赖深链、A1→A2/A3 拆分、倾听员不导出、本机删除不等于 server deletion；当前代码的 home 仅提示深链，IndexedDB v4 保留 archive/legacy 数据，服务端 manifest 是长期权威。
- Reason: 把 home、新建、回顾和删除继续聚在 DEV-008 会让 DEV-007/题库/导出错误阻塞实际可用入口，也会诱使本机清理冒充隐私删除。
- Tradeoff: A1 需新增受 assignment 约束的 session read model，A3 需 IndexedDB 前向 upgrade、capture 共锁、单事务 legacy/all-report 清理和最小回执；换取唯一网页导航、诚实的数据所有权与可验证刷新语义。
- Boundary: 当前不做 PWA/Capacitor/WebView/Android App；A2 不绕过正式口头授权；A3 不新增 server audio download 或 deletion request；DEV-008D 与 CON-023 保持独立真实试点门禁。

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

### 2026-08-11 — 将真实 ASR 调整为真实 LLM 的前置

- User outcome: 先让系统获得真实访谈中的可靠转录，再用真实转录验证长期记忆和下一问，避免在 deterministic fake 上过早调试 LLM。
- Review mode: Correction mode；独立只读复核确认顺序纠正成立，但真实 provider、双人临时 speaker label 与 gap/backfill 应拆分，不能做成一个巨型任务。
- Review finding: 现有 mono/16k/s16le PCM、StreamingAsrAdapter、interim/final、幂等落库、speaker stream、timeline offset、drain 与工作台已具备；production 仍绑定 UnavailableStreamingAsrAdapter。真实 LLM 接入应依赖真实流式 ASR PASS，但不必等待离线补转录。
- Options considered: 先接 LLM；ASR provider 与全部 backfill 一次完成；先做真实流式 ASR+双人标签，backfill 后置。采用第三种。
- Adopted decision: 启动独立可见 DISC-ASR-PROVIDER-001；先确定语言/地区/保留/speaker 门槛和供应商试验，再分别进入 SPEC、DEV。真实 LLM provider 后置到真实 ASR PASS。
- Implementation evidence: 本轮仅调整任务顺序并创建讨论窗口，没有实现供应商 adapter、提交密钥或使用真实访谈资料。
- Lesson: 先让上游事实真实，再评价下游智能；但“真实上游”不等于首轮必须同时完成全部离线恢复可靠性。
- Better future prompt: “请先讨论并选择支持普通话、常见口音和单声道双人临时标签的实时 ASR；首版只接流式 provider 和有限重连，gap/backfill 后置，完成后再接真实 LLM。”

### 2026-08-10 — SPEC-AI-QUESTION-001 单问题契约 REVIEW 候选

- User outcome: 在不重开 ADR-027/028、不实现代码的前提下，给 DEV-007 冻结可执行的自动更新、手动“下一个问题”、只读展示历史、安全投影和跨模块所有权契约。
- Review mode: Learning mode；iteration-coach 恰好一次独立只读复核，重点挑战 publication/生成意图/安全可见性三条时间轴、cursor 总序、requested 与 committed 事实边界及历史浏览交互。
- Review finding: 仅按完成时间或 last-writer-wins 会让旧 automatic 覆盖新的手动意图；历史仅按时间排序会碰撞；把 WS replay 当正文载体会绕过动态安全；`manual_next_requested` 不能证明已经换题；浏览历史时的新自动更新不得移动锚点或抢焦点。
- Options considered: WS 直接携带正文或只发 revision；服务端保存 browse position 或客户端持有 anchor；单一 revision 或 publication/manual intent 分离。采用 REST canonical + 无正文 WS、客户端 anchor、`presentation_revision/display_sequence/manual_intent_sequence` 三分。
- Adopted decision: 项目负责人对 PR #21 final head `af088ed6165c979e8de2e469900ee6519fafe183`、CI `31352681061` attempt 2 手动审查 PASS，P0/P1=0；ADR-029 Accepted、CON-018 RESOLVED、SPEC-AI-QUESTION-001 DONE，merge `10fcc5c`。
- Implementation evidence: 更新 `03/04/05/07/08/09/10`、任务板、追踪矩阵、CON-018、ADR-029、任务卡、交接与本 journal；未修改业务代码、Prisma schema/migration、页面或真实模型。本地 format/link/reference/diff、lint/typecheck/build、unit 225、integration 57、auth 13、migration、smoke、Chromium 9 与 auth Chromium 4 均通过；exact final head/CI 由最终交接消息绑定。
- Verification boundary: DEV-007 的问题契约前置完成，但仍等待 DEV-006 current memory/QuestionEvidence/actual-asked seam；CON-023 deletion runtime 仍 NOT IMPLEMENTED/NOT VERIFIED。真实 matcher/LLM、生产阈值与试点质量门槛均未决定。CI attempt 1 的既有 1 秒时序 flake 保留，attempt 2 同 exact head 全绿。
- Lesson: generation intent order、canonical publication order 与读取时安全 visibility 是三种事实；将它们拆开，才能同时证明手动优先、历史稳定和撤下正文不会从 replay 回流。
- Better future prompt: “请先分别定义生成意图、权威发布与读取时安全投影的版本轴；手动请求只证明 intent，只有原子 publication 才证明换题；历史 cursor 与 WS 都不得携带持续读取授权。”

### 2026-08-10 — 下一场单问题产品讨论边界

- User outcome: 继续下一阶段讨论，并沿用“新项目对话逐项讨论、完成后回传候选决定”的协作方式。
- Review mode: Learning mode；独立只读复核确认两个 READY 项并不都需要产品讨论：DEV-006 已有可执行 PASS 契约，只有 SPEC-AI-QUESTION-001 仍缺用户可感知行为。
- Review finding: 若泛泛讨论“AI 追问”，会重开已冻结的记忆、QuestionEvidenceModule、安全和 actual-question 所有权，或让用户决定 REST/WS、锁和算法阈值。真正未决的是已展示问题何时自动变化、换题期间行为、无合格新问题和撤销失效窗口。
- Options considered: 重开 DEV-006 实现讨论；直接下发完整 SPEC-AI；先做窄范围 DISC-AI-QUESTION-001。采用第三种作为讨论入口，DEV-006 的正式范围保持不变。
- Adopted decision: 项目负责人暂停原讨论，纠正为“更合适问题自动替换 + 展示历史可回看 + 下一个问题手动请求”；旧一层撤销被明确取代。DISC-AI DONE，SPEC-AI READY，CON-018 继续等待技术契约。
- Implementation evidence: 同步 `01/03/04/05/07/08/09/10`、ADR-028、任务板、追踪、冲突、任务卡、提示词、交接与 journal；没有实现业务代码、数据库或 API。
- Lesson: “防止问题没问就丢失”不等于“禁止当前问题变化”。把 canonical current 与 immutable displayed history 分开，能同时获得实时适应性和可找回性。产品讨论提示若把旧方案中的“撤销”当成既定前提，会让用户重复回答已经明确的目标。
- Better future prompt: “请基于已确认的自动最佳问题和展示历史，冻结自动替换稳定性、下一个问题幂等、历史 cursor/安全投影；不要重新询问是否自动更新，也不要把历史浏览做成撤销或实际已问。”

### 2026-08-09 — DISC-006 定稿写回的安全边界校正

- User outcome: 采用 questions-only 的后台最小记忆，尽快验证记忆能否改善当前下一问和第二次开场，同时保留完整过程记录。
- Review mode: Correction mode；独立只读复核认可主体方向，但确认“硬边界命中后仍保留已展示问题”与现行删除、restricted、do_not_ask 和权限失败关闭规则直接冲突。
- Review finding: “已展示屏幕快照”可以和“未来生成 eligibility”分离，但软件不能用倾听员现场判断权替代自身的删除、禁问和访问控制义务。普通事实修正与硬安全边界必须分开建模。
- Options considered: 所有变化都保留当前问题；所有变化都立即撤下；普通事实修正保留快照、硬安全边界立即撤下。独立复核推荐第三种，项目负责人已批准。
- Adopted decision: 普通说话人/文字/记忆修正只取消旧结果的未来资格，已展示问题保留到换题或正常更新；`restricted|do_not_ask|active deletion scope|consent/access loss` 立即隐藏正文，不自动生成替代问题。CON-024 已解决，DISC-006 完成，SPEC-DEV-006 可进入契约设计，DEV-006 仍等待 SPEC PASS。
- Implementation evidence: 已同步 `01/03/04/05/07/08/09/10`、ADR-026、`02-conflict-log.md`、DISC/SPEC/DEV 任务卡、任务板、追踪、交接与启动提示词；本轮仅冻结产品与契约输入，没有业务代码、数据库或运行时实现。
- Lesson: 现场 UX 的“不要跳动”与数据治理的“不得继续展示”不是同一等级的规则；可以保留历史展示事实，但不能继续向无权或已禁问场景呈现正文。
- Better future prompt: “普通事实修正后保留当前问题直到用户换题；若命中 restricted、do_not_ask、活动 deletion scope 或权限失效，则立即隐藏正文，只保留受限审计，不自动生成替代问题。”

### 2026-08-09 — 补转录后置与 DEV-006 讨论解锁

- User outcome: 停止让补转录占用当前迭代，尽快做出能验证记忆与追问价值的内部产品。
- Review mode: Correction mode；独立只读复核确认方向符合阶段优先级，但要求延期而非删除，并保留未来可靠性任务和现有数据安全硬门禁。
- Review finding: DEV-004 任务卡一处写“补转录另行拆分”，另一处又把“可补转录”作为父任务验收，造成错误进度信号；DEV-006 的真实前置本来就是产品讨论与 SPEC-DEV-006，而非补转录。
- Options considered: 继续 DEV-004 IN_PROGRESS；直接删除补转录义务；按内部 MVP/完整 MVP 分层关闭 DEV-004并建立后置可靠性任务。采用第三种。
- Adopted decision: DEV-004 按内部可用 MVP 收口；HARDEN-ASR-001 TODO；DISC-006 READY，SPEC-DEV-006/DEV-006 继续按讨论→契约→实现推进。
- Implementation evidence: 同步 `00/03/06/09/10`、任务板、追踪、REV-030、DEV-004/HARDEN-ASR-001/DISC-006 任务卡与 DISC-006 提示词；本轮仅治理与范围文档，不新增业务代码。
- Lesson: 可靠性需求不应被删除，但也不应因为最终产品需要它，就自动成为当前核心假设验证的前置条件。
- Better future prompt: “请把补转录保留为真实供应商/试点前的后置可靠性任务；当前只要求原始录音完整、安全结束和转录降级可见，并立即推进长期记忆产品讨论。”

### 2026-08-09 — DEV-004C1 实现任务下发审查

- User outcome: 在 SPEC-DEV-004C PASS 后启动独立 worktree 任务实现正式流说话人校准与可信角色核心，完成后交项目负责人 GitHub 手动审查。
- Review mode: Correction mode；独立只读复核确认当前阶段可开工，但要求提示词补强共享因果队列、provider namespace 生命周期、旧数据 migration 与 REVIEW 交付边界。
- Review finding: 主要风险不是页面缺少校准按钮，而是 begin/resolve 若未与 producer PCM、ASR final ingestion 和持久化共享有界串行顺序，仍会让 delayed final 污染普通内容；runtime 真重建若被误当 transport replay，同名短 label 会跨 namespace 继承。
- Options considered: 按后端/前端拆成并行实现；由一个独立 worktree 任务完成 migration、WS 1.1、服务端 marker、统一 snapshot 和最小前端纵向链路。采用后者，避免共享契约和 migration 漂移。
- Adopted decision: DEV-004C1 单任务纵向实现；提示词明确 marker 等待的是队列前方业务副作用提交，不得用 ACK/按钮时间近似；provider runtime 真重建必须新建 speaker stream，event replay 不得新建；实现只到 REVIEW，由项目负责人手动审查。
- Implementation evidence: 仅完成任务下发准备与 `DEV-004C1` READY 状态一致性修复；业务实现由新 worktree 任务执行，当前没有 C1 代码或 migration 证据。
- Lesson: 同步控制动作接入异步媒体链路时，关键是共享因果顺序，而不是共享一个状态字段或 mutex。
- Better future prompt: “begin/resolve 必须与 producer PCM、ASR final 持久化共享一个有界串行队列，队列前方业务副作用全部提交后才能冻结 marker；不得用请求时间或 ACK 高水位近似。”

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

### 2026-08-09 — DEV-005R3 项目负责人正式 PASS 与 R4 解锁

- User outcome: 由项目负责人手动复核最终 GitHub head，确认工作台与安全结束实现可以合并，同时不把页面 PASS 误写成 Android 整链路完成。
- Review mode: 项目负责人 GitHub 手动审查；总控只核对审查包身份并登记结论，不另行宣布独立审查结果。
- Adopted decision: REV-025 PASS 严格绑定 PR #15 head `481ee2593f27c62e3d137842edfd15fe11ad157c` 与 CI `31289795181`；合并 `8d5c4c5` 后 DEV-005R3 DONE、DEV-005R4 READY。
- Implementation evidence: 六项定向修复关闭，P0/P1=0；完整 verify、五视口七状态与对应 unit/Chromium 证据已由项目负责人复核。
- Verification boundary: CON-020/021/022 均保持 OPEN；R4 仍需目标 Android Chrome 的显式恢复、同一资源 identity、累计 archive、PCM offset、安全结束 manifest、真实终态与普通音量证据。
- Lesson: 子任务页面实现 PASS 只能解除其直接依赖，不能替代父纵向链路的设备与数据闭环门禁。

### 2026-08-09 — DEV-005R4 独立验收任务启动

- User outcome: 继续完成首次访谈最后一段真机纵向验收，在需要手机操作时由新任务逐步指导，并把最终 GitHub 审查留给项目负责人。
- Review mode: Learning mode；独立只读复核确认无前置阻塞，并指出 R4 应围绕资源 identity 不变量取证，而不是把页面截图当作链路完成。
- Review finding: R1/R2/R3 已 DONE，R4 READY；尚缺刷新后下一 generation 的同一 session/object/job、累计 archive、PCM offset、安全结束 manifest/终态及 Android 普通音量证据。单设备共享数据库和证据顺序不适合并行拆分。
- Options considered: 总控直接临时操作；并行拆成自动化与真机两个任务；建立一个独立 worktree 的 R4 任务统一组织证据。采用第三种。
- Adopted decision: 启动任务 `019fe468-6cb3-7cf0-b327-4a46e2d7aae9`；先桌面准备，再一次一个动作请求用户完成真机步骤；只允许任务内最小修复，公共契约不足时回报总控；候选只能到 REVIEW。
- Implementation evidence: 本轮仅完成任务派发和治理登记，尚无 R4 验收结果；CON-020/021/022 保持 OPEN。
- Lesson: 纵向验收要证明刷新前后属于同一业务对象，允许变化的 generation/stream 与必须不变的 session/object/job 要分别记录。
- Better future prompt: “请记录 Android 刷新恢复前后的 session、audio object、local job、generation、stream 和 archive 高水位，证明只有 generation/stream 合法变化；再以同一对象完成 stop、manifest 和终态。”

### 2026-08-09 — DEV-005R4 恢复代时间轴校正与正式纵向候选

- User outcome: 用桌面与目标 Android 的正式无 query 路由证明首次访谈从准备、单流采集、刷新显式恢复到安全结束，并把普通音量检测与服务端真实终态纳入同一审查包。
- Review mode: Correction mode；iteration-coach 的唯一独立只读复核发现 `timeline_offset_ms` 已持久化但未作用于恢复代实时转录事件、落库和 drain，若不修复会让 generation 1 转录从接近 0ms 重叠历史时间轴。
- Correction: 在服务端可信 ASR 边界统一映射 start/end；浏览器 wire PCM 继续保持 generation-relative，服务端持久化/广播/drain 使用 session timeline。未修改公共 API、数据库、枚举或 interruption reason。
- Evidence: integration 验证 generation 1 wire PCM `0..100ms` 而 interim/final/drain 从 offset 开始；桌面 5 分钟正式链路与 OnePlus/Android 约 8分21秒正式链路都保持唯一 object。Android 恢复 offset 与首个 generation 1 转录 start 同为 `436604ms`，最终 491/491 manifest、ASR drained、session completed。
- Boundary: 真实供应商、云存储、生产部署、跨设备恢复、iPhone Safari、完整回顾/导出/删除均未扩展；本地只使用虚构内容，不提交 audio Blob。候选只到 REVIEW，CON-020/021/022 仍 OPEN，最终 PASS 只由项目负责人在 GitHub 对 final head 手动给出。
- Lesson: capture generation 的 PCM 线时钟与 session 业务时间轴是两个边界；offset 必须由服务端在消费 ASR 结果时统一应用，不能要求浏览器伪造累计 PCM，也不能只把 offset 存进数据库而不消费。
- Better future prompt: “在恢复链路中同时断言 wire PCM 从 0 重置、服务端转录从 offset 延续，并分别记录原始 generation clock 与 session timeline，避免把持久化字段误当作已生效行为。”

### 2026-08-09 — DEV-005R4 与首次访谈页面闭环正式收口

- User outcome: 对 R4 final head 完成人工 GitHub 审查，在证据充分且无 P0/P1 后关闭首次访谈纵向父任务与三个剩余冲突。
- Review mode: 项目负责人手动 GitHub 复核；总控只登记结果和执行合并。
- Adopted decision: REV-026 PASS 严格绑定 PR #16 head `2fab0ead66e6b52d1b95dec0ef3708a78a5d5d26` 与 CI `31294084873`；merge `7477dca` 后 R4/DEV-005 DONE，CON-020/021/022 RESOLVED。
- Implementation evidence: 桌面 5 分钟、OnePlus Android 约 8分21秒，刷新恢复 identity、双时钟、491/491 manifest、ASR drained、completed 与普通音量/安静输入证据均经项目负责人复核；P0/P1=0。
- Verification boundary: 单台目标 Android、内部虚构内容、test ASR/no-cloud storage；不外推所有 Android，不包含 iPhone、真实供应商、云存储、跨设备恢复或生产部署。
- Lesson: 父纵向任务只有在业务对象不变量、原始证据、恢复代时间轴与服务端终态同时闭合时才能完成；页面成功或单个子任务 PASS 都不足以替代整链路证据。

### 2026-08-09 — DISC-004C 说话人校准讨论启动

- User outcome: 在 DEV-006 前先讨论并决定说话人校准、人工修正和角色不可信时的下游行为，再决定 DEV-004C 如何开发。
- Review mode: Correction mode；独立只读复核指出“校准是否为 start 硬门禁”的二选一过窄，真正目标是既不阻塞原始录音，又不让错误角色污染长期记忆。
- Review finding: 正式 provider speaker identity 只在 start 后的正式 ASR 流成立；准备页临时流不能可靠校准。刷新后新流也不能静默继承旧短 ID。现有原始角色、修正角色和映射历史边界可复用。
- Options considered: start 前临时流硬校准；校准作为录音硬门禁；start 后同一正式流确认，失败则 unknown 且限制下游消费。推荐第三种，最终决定等待用户讨论。
- Adopted decision: 此启动记录已被下方“DISC-004C 定稿与正式写回”取代；讨论阶段未启动实现。
- Implementation evidence: 已新增讨论任务卡、提示词和任务板入口，并启动独立讨论任务 `019fe4e1-8537-7a13-9831-8ef10df1e7df`；无业务实现。
- Lesson: 校准的核心不是让页面显示两个名字，而是定义角色可信度何时足以进入不可逆的派生数据；原始录音安全与角色语义门禁应分离。
- Better future prompt: “请先讨论正式流内的角色确认、失败时 unknown 回退、新流重新确认和 unknown 对长期记忆的消费限制；原始录音不得因校准失败停止。”

### 2026-08-09 — DISC-004C 定稿与正式写回

- User outcome: 把已逐项确认的说话人校准、人工修正和下游消费决定转成可审查、可实施且不污染长期记忆的正式契约。
- Review mode: Correction mode；独立只读复核重点检查标识符范围、角色可信度、控制内容权威来源、批量并发和 DEV-006/007 职责越界。
- Review finding: capture generation、`audio_stream_id`、WebSocket `event_stream_id` 都不能代表 provider speaker namespace；角色枚举值也不能代表用户确认。批量修正若只在执行时重新查范围会产生 TOCTOU，DEV-004C 若直接承诺 AI 重算则越过尚未实现的消费者。
- Options considered: 继续按 session 复用短 speaker label；按 generation 隔离；新增独立持久 `speaker_stream_id`。选择第三种，并将角色值与 authority 分离；修正拆为稳定 preview + 原子 execute；C 只产生 revision/membership seam。
- Adopted decision: 原子 start 后同正式流校准，用户确认才形成可信角色；失败/跳过录音继续且角色消费失败关闭；每个新 speaker stream 重确认；服务端权威标记控制句；任务拆为 SPEC、C1 校准/门禁、C2 修正/seam，复杂批量 UI 后置。
- Implementation evidence: 已写回 `01/03/04/05/06/07/08/09/10`、ADR-025、CON-014、任务板、追踪矩阵和 SPEC/C1/C2 任务卡；只修改文档，未执行 migration、代码或业务测试。
- Lesson: 下游能否相信一条角色信息，取决于“谁在什么生产者生命周期内以什么权限确认”，而不是字段看起来是否为 `elder`；标识符作用域和语义 authority 必须显式建模。
- Better future prompt: “请分别冻结 provider speaker namespace、角色值、确认 authority、控制内容来源和派生失效责任；不要用 generation 或事件流 ID 代替 speaker stream，也不要让上游任务代替下游消费者实现重算。”

### 2026-08-09 — SPEC-DEV-004C REV-027 三项接缝修订

- User outcome: 定向关闭 PR #17 中控制句 delayed final、下游 revision/stale 无载体和 WS 1.1 payload 未冻结三项 P1，不推翻已认可的流级 identity 与可信角色方向。
- Review mode: Correction mode；唯一独立只读复核确认三项 P1 均成立，并指出项目记忆可跨多个 session，给现有 `ai_job.session_id` 增加单值 revision 仍是错误模型。
- Review finding: final 到达时间不是音频归属边界；必须用服务端 PCM 有序控制点冻结生产时序。C 只知道 revision producer，不足以设计跨 session AI consumer。REST 与 WS 同名状态若没有 canonical snapshot，会在刷新/replay 后分叉。
- Options considered: 在本 PR 直接扩展全部 AI job/派生表；增加独立 SPEC-DEV-006 门禁。采用后者，避免把尚未讨论的跨 session 记忆与建议状态机塞进 C。
- Adopted decision: begin/resolve 作为 PCM 串行泵 marker，事务性冻结 sequence/session-timeline 半开区间；delayed/cross-boundary final 按重叠失败关闭。GET、begin、resolve、session.ready、WS updated 统一 snapshot。DEV-006 改为依赖 C1 PASS + SPEC-DEV-006 PASS；批量端点按 `(start_ms,id)` 闭区间。
- Implementation evidence: 定向修改 `04/05/06/07/09/10`、ADR-025、REV-027、任务板/追踪/交接及 SPEC/C1/C2 卡，并新增 `SPEC-DEV-006` 门禁卡；仍仅文档，没有业务代码或 migration。
- Lesson: 异步结果的分类必须绑定输入发生时的不可变边界，不能绑定结果到达时的状态；跨聚合域的版本水位必须逐来源表达，单一“当前版本”字段常会制造假安全。
- Better future prompt: “请分别冻结输入发生边界、结果到达语义和下游消费水位；若派生结果跨多个 session，先设计逐 session provenance/stale SPEC，不要给触发 session 加一个 revision 就宣称闭合。”

### 2026-08-09 — DEV-004C1 正式流说话人校准候选

- User outcome: 在唯一正式录音/PCM/ASR 链路内建立持久 speaker namespace、可追溯校准控制区间和仅由用户确认成立的 trusted role，同时让 fail/skip/retry 不损害原始录音。
- Review mode: Learning mode；iteration-coach 恰好一次独立只读复核确认可以实施，并要求复用 session runtime 的同一 causal executor，把 marker 前“完成”定义到 adapter 返回、final ingestion/membership 和必要事件事实提交，而不是另加 REST mutex 或用 ACK/到达时间近似边界。
- Review finding: 若 PCM 与 marker 由两套串行器保护，即使各自有锁也无法证明跨域先后；正确的不变量是同一 runtime queue 的 work completion 语义。UI 的低负担不能改变正式语义，只能减少操作与视觉噪音。
- Options considered: REST mutex；独立 calibration queue；复用现有 runtime causal queue。采用第三种，并以有界 deadline + interactive transaction timeout 保证零半终态。namespace 选择复用 generation/audio/event ID 或独立持久 ID，采用独立 `speaker_stream_id`。
- Adopted decision: provider/runtime 真重建关闭旧 speaker stream 并新建；begin/resolve 冻结 generation-derived 半开区间；final 按同 stream 时间区间归属；confirm 原子写两条 `user_confirmed` mapping 且 revision +1；fail/skip 保持 recording 并允许 retry；所有渠道共用唯一 snapshot mapper。
- Implementation evidence: PR #18、实现主体 `9ddf2c6`；unit 214、PostgreSQL integration 48、auth 13、普通 Chromium 8、auth Chromium 4、空库与旧 DEV-004A/B migration 均通过。`$impeccable` 仅影响克制层级、44px 触控、焦点/live region/reduced motion 和小屏布局，没有改变正式产品语义。
- Verification boundary: 本机无可用 ADB/Android CDP，本轮只有桌面 Chromium 小视口证据，不能冒充 Android 真机。真实 provider、C2 修正、DEV-006 memory/stale/recompute 均未实现；候选只到 REVIEW。
- Lesson: 跨异步边界的可信事实必须共享一个可证明的完成点；“收到/ACK/到达”都比业务提交更早，不能作为不可逆角色 authority 的边界。角色值、namespace 和确认 authority 必须分开建模。
- Better future prompt: “请先列出 producer work 何时才算完成，再让所有边界 marker 进入同一有界串行器；为 namespace、角色值和确认 authority 分配独立字段，并用 transaction/DB constraint 证明 timeout、重建与 replay 不产生半事实。”

### 2026-08-09 — DEV-004C1 PR #18 三项 P1 定向修复

- User outcome: 不重做主体架构，补齐 trusted role 的正式读模型、canonical snapshot 的队列/时间语义，以及真正渲染校准面板的小屏 Chromium 证据。
- Review mode: Correction mode；沿用本 material iteration 已执行的唯一独立只读复核，不重复启动第二次审查角色。项目负责人正式 `REQUEST_CHANGES` 绑定旧 head `4d18bcf5826aacad97494342d965b9a28d538497`，P0=0、P1=3。
- Review finding: 持久 evidence 已具备 original role/authority，但缺统一 trusted projection 和正式分页出口；marker transaction 虽在 causal queue 中，事件 append 却在 queue 外；snapshot 读取 membership label 却没有把 membership 持久时间计入 `updated_at`；旧 E2E 的 ready payload 没有 calibration，因此并未渲染新面板。
- Adopted decision: 新增唯一 `projectTrustedSpeakerRole` 供 transcript DTO 与 WS final 共用；GET 使用 opaque `(start_ms,id)` cursor。marker commit 后在同一 queue 同步 append canonical event，live socket write 失败只断开 subscriber，已存 replay event 和 DB 事实保留。snapshot `updated_at` 取 session/stream/attempt/membership 最新持久时间。
- Implementation evidence: targeted unit/contract 27、真实 PostgreSQL/API/WS 21、Chromium workbench 2 均通过。新增 snapshot-driven 390×844、320×568 用例发现 320px 下 calibration flex item 被压缩、内容溢出后由 transcript heading 拦截 retry；以 `flex: 0 0 auto` 修复并回归无溢出、44px、focus/live region、mic count 不增加。
- Verification boundary: 不补 Android 真机；不扩 C2、DEV-006、真实 provider。状态仍为 REVIEW，最终结论只由项目负责人对新 exact head 手动复审。
- Lesson: 组件“存在于 DOM”不等于交互证据成立；固定高度工作台里可压缩的状态面板可能视觉可见却被后续层覆盖。因果事件也同理：DB commit 后在 queue 外调用 publish 看似紧随其后，但不能证明后方 producer work 尚未越过。
- Better future prompt: “请同时证明持久事实、事件 append 与后方 producer work 的线性顺序，并让小屏 E2E 用真实状态 payload 点击每个关键动作；断言命中目标且无覆盖层拦截，而不只检查 DOM、截图或旧矩阵。”

### 2026-08-09 — DEV-004C1 REV-028 代行定向复审

- User outcome: 用户外出期间明确把 PR #18 手动审查临时委派给总控；不需要产品决定时持续推进，但不得越过仍需用户讨论的 DEV-006 门禁。
- Review mode: evidence-driven re-review + visual；只复核旧三项 P1 与相邻回归，不重新审完整 C1。
- Review finding: trusted role 已由一个服务端 helper 同时投影 REST/WS；marker commit、canonical event 和后方 PCM/final 共享 runtime causal queue；membership 时间进入 snapshot `updated_at`；实际小屏用例确实渲染 calibration snapshot，而非旧工作台空状态。
- Verification evidence: exact-head CI `31305357363` 全门禁 PASS；总控独立复跑 unit 27/27、Chromium calibration 1/1，并检查 4 张 320/390 宽实际渲染图。PostgreSQL 本机因未注入 `TEST_DATABASE_URL` 未复跑，不伪报本地通过。
- Adopted decision: REV-028 PASS，PR #18 merge `99b090d`，C1 DONE、C2 READY；SPEC-DEV-006/DEV-006 仍等待专项产品讨论，父 DEV-004 保持 IN_PROGRESS。
- Lesson: 审查授权可以临时转移，但产品决策权不会随之自动扩大；能够从已冻结契约机械推出的 C2 可以继续，尚需讨论的跨 session AI consumer 模型必须停在讨论门槛。

### 2026-08-09 — DEV-004C2 独立实现任务启动

- User outcome: 用户授权在无需新决策时持续推进；C1 收口后继续实现角色修正 producer seam，并把历史保存在独立项目任务/worktree。
- Review mode: Learning mode；iteration-coach 独立只读复核确认 `03/04/05/06/07/09`、ADR-025 与 C2 任务卡已足以实施，不需要追加产品决定。
- Review finding: C2 最容易混淆的是“产生失效证据”和“执行 AI 派生失效”。前者是 C2 的 revision/operation/membership，后者必须继续等待 SPEC-DEV-006。
- Adopted decision: 启动独立任务 `019fe614-9503-7891-a1d3-8708c60166e0`；单段 UI 低负担，批量只做正式 preview/execute 服务端契约，复杂批量 UI 后置，任何 AI stale/recompute consumer 禁止进入本任务。
- Implementation evidence: Codex 已建立独立 worktree `C:\Users\TR\.codex\worktrees\4034\elder_interview_ai` 并开始任务；此时尚无业务实现、提交或 PR，状态仅为 IN_PROGRESS。
- Lesson: 上游可以先稳定地产生“哪些证据在何版本被修正”，而不必猜每个下游消费者如何失效；把 producer seam 和 consumer policy 分开能维持可追溯性又避免错误模型先入为主。
- Better future prompt: “实现角色修正 producer seam：只产出 corrected role、operation、segment membership 和 session revision；批量全成全败；不要修改任何 AI 派生表或实现重算。”

### 2026-08-09 — DEV-004C2 与 deletion scope 的实现顺序纠正

- User outcome: 在不静默降低正式删除安全要求的前提下，避免 C2 为尚未启动的 DEV-008 先造半套删除系统。
- Review finding: `04/05/08` 已冻结未来 deletion request/scope 语义，但当前 Prisma/服务没有 producer、transition 或 read model；DEV-008 仍被 CON-006/007 阻塞。原 C2 提示词把未来能力误写成“现有基础设施”。
- Options considered: C2 新增最小 deletion 表/read seam；用 no-op guard 冒充覆盖；登记执行顺序缺口并保留正式要求。采用第三种。
- Adopted decision: CON-023 OPEN。C2 只验证现有 assignment、授权、project restricted/deleted；不新增 deletion 半模型。DEV-008 实现正式子系统时必须回接 C2 单段/preview/execute 的锁后 scope guard 和并发测试。
- Implementation evidence: 已更新任务板、C2 任务卡、冲突索引/日志与交接，并向独立实现任务发出边界纠正；尚未产生 deletion 业务代码。
- Lesson: “契约已设计”不等于“基础设施已存在”。消费者提前创建没有合法生产者的数据表，通常不是安全加固，而是难以验证的假能力；应保留最终不变量，同时明确实施依赖和回接门禁。
- Better future prompt: “若 deletion scope producer 已实现，则复用统一 guard；若尚未实现，登记延期集成并保持正式要求，不要为当前任务创建孤立删除模型。”

### 2026-08-09 — DEV-004C2 角色修正 producer REVIEW 候选

- User outcome: 在不覆盖原始转录证据、不抢跑 AI consumer 或删除子系统的前提下，交付可重放单段修正、持久稳定批量 preview/原子 execute，以及首次工作台低负担单段 UI。
- Review mode: Correction mode；iteration-coach 恰好一次独立只读复核指出正式 deletion scope 缺少运行时 producer/read model。总控以 CON-023 冻结“不造半模型、保留未来回接门禁”；`$impeccable` 仅约束行内层级、44px、焦点/live、reduced motion 和小屏遮挡。
- Review finding: 批量 stale 不能只比较 preview 中已有成员；迟到 final 是范围 phantom，必须让 final ingestion 与 execute 共享 session 锁，并在 execute 锁后重建完整闭区间。preview membership 必须包含被排除成员，否则无法区分“当时排除”与“后来消失”。
- Adopted decision: 所有 C2 写操作使用 `request_id -> session` 固定锁序；preview 保存完整候选、每段 revision 与排除 flag/hash/counts；execute 全量重读后全成全败。单段工作台原位展开，冲突只重读 canonical 服务端事实。删除 scope 留 CON-023，不创建 no-op/孤立表。
- Implementation evidence: unit 223、PostgreSQL integration 57（C2 8）、auth 13、Chromium 9、空库 deploy/status 与 C1 fixture 前向升级通过；390/320 视觉复核发现浮动“回到最新”覆盖行内取消操作，编辑期间隐藏该浮层后回归通过。
- Verification boundary: project restricted/deleted 已实现；session/segment deletion scope `NOT IMPLEMENTED / NOT VERIFIED`，相关 `09` 项不列 PASS。复杂批量 UI、AI stale/recompute、真实 provider 和完整删除链路未实现；状态仅 REVIEW。
- Lesson: “完整集合”是并发语义，不只是响应计数；若范围生产者不与执行共享锁，保存再多成员也无法证明没有 phantom。安全契约缺生产者时应明确延期集成，而不是用永远不命中的 guard 制造合规幻觉。
- Better future prompt: “请让范围内新增/删除与执行共享锁并在锁后重建完整集合；preview 持久全部候选、版本和排除结果。若安全 scope 尚无合法 producer，明确 NOT IMPLEMENTED/NOT VERIFIED 和回接任务，不要创建 no-op guard。”

### 2026-08-09 — SPEC-DEV-006 跨会话消费契约候选

- User outcome: 在不实现业务代码的前提下，给 DEV-006 一套可直接下发的后台 current memory、问题证据、跨会话消费、并发、删除与过程记录契约，并防止 DEV-006/007 各建 question history。
- Review mode: Learning mode；iteration-coach 恰好一次独立只读复核，重点挑战跨 session provenance、snapshot/eligibility、删除清理和模块所有权。
- Review finding: “实际输入 membership”不能证明哪些 session 已被评估，必须另存包含零 eligible 的 session scope；角色 revision 也不能证明正文没变，segment 还需 text revision/digest。外部调用不能跨事务持锁，必须 freeze 后释放、写回再锁并复核。物化 invalidation 可以滞后，普通查询不能滞后。
- Options considered: 单一 job session/revision；只保存实际 segment；scope + membership + 动态 eligibility。采用第三种。问题历史考虑 DEV-006/007 各自拥有、独立子任务、共享 QuestionEvidenceModule；采用共享模块，DEV-006 建基座/catalog，DEV-007 仅消费 seam。
- Adopted decision: claim/evidence 与 resolution/member 分离；display snapshot/future eligibility/visibility 三分；actual question 与 suggestion outcome 分离；AI job 使用 freeze-call-recheck；legacy 缺 provenance 数据失败安全；删除 provenance 不得以 FK RESTRICT 阻塞清理。
- Implementation evidence: 更新 `02/04/05/07/08/09/10`、ADR-027、CON-018/023、任务板/追踪/审查索引、SPEC-DEV-006/DEV-006/SPEC-AI 任务卡、handoff 和本 journal；没有修改业务代码、Prisma schema、migration 或运行时 contracts。
- Verification boundary: 契约仅到 REVIEW；CON-018 的 replace/undo/相似度和 CON-023 的 deletion runtime 仍 OPEN；真实模型、固定保留期限、质量百分比和生产部署未决定。项目负责人必须在非 Draft PR exact final head/CI 上给结论。
- Lesson: provenance 至少要回答“评估过什么范围”和“实际消费了什么”，并为正文与角色分别版本化；历史展示事实、未来消费资格和当前可见性也不能折叠成一个 status。
- Better future prompt: “为每个跨会话 job 同时冻结全 scope（包括零输入）和实际 membership；模型调用后按同一锁序复核所有版本与 policy。把 display、eligibility、visibility 以及 actual question/outcome 分开，并让一个模块拥有完整问题证据历史。”

### 2026-08-10 — SPEC-DEV-006 PR #20 三项 P1 定向修复

- User outcome: 保留 old head/CI/REQUEST_CHANGES 历史，只关闭 derived-output 业务关联、retention 物理根和 SPEC-AI 前置状态三项 P1；不扩实现、供应商或 deletion runtime。
- Review mode: Correction mode；本 material correction 恰好一次独立只读复核，重点挑战“一次 job 五条 claim”的基数、actual catalog 失效范围、依赖删除后的空集放行、retention owner 与治理状态。
- Review finding: 仅有 `ai_job_id/output_type` 无法证明 derived row 属于哪个业务输出；actual question 若逐条绑定会把一次 analysis 的可靠性错误拆散。让所有 child 自带 `expires_at` 会产生漂移，也无法解释展示快照为何可独立于 candidate 保留。任务板 READY 与任务卡等待 SPEC PASS 是直接状态冲突。
- Options considered: 一个 job/output-type output-set；每个业务输出逐项 derived；actual questions 逐条 derived。采用逐项模型，同时把 whole actual-question analysis 视为一个 catalog 业务输出。retention 考虑每条 child deadline、通用 root 表、三类显式 root；采用 `ai_job|question_display_snapshot|memory_retention_root`，降低 owner 歧义并保留展示事实独立生命周期。
- Adopted decision: automatic claim/resolution、question/boundary candidate、generated note、context snapshot 一对一 derived；5 claims=5 rows。actual analysis 整版一条 catalog row，任一 dependency 命中整版撤下。三类 dependency 保存 expected count/manifest，缺行/空 FK/剩余子集失败关闭。到期先 hidden/detach，再幂等 purge；失败保持隐藏。SPEC-AI 在 PR #20 项目负责人 PASS/merge 前保持 BLOCKED。
- Implementation evidence: 定向同步 `04/05/07/08/09/10`、ADR-027、任务板/追踪/REV-031、SPEC-DEV-006/DEV-006/SPEC-AI 任务卡、handoff 与本 journal；仍未修改业务代码、Prisma schema、migration 或运行时 contracts。
- Verification boundary: old head `2b6a5da1e67ef2b0e91457969a089ba79f09f465`、CI `31321844664` SUCCESS 与 REQUEST_CHANGES P0=0/P1=3 永久有效；项目负责人对 final head `4759633ed1e3d9031c8bbe32892d61293f9ec01c`、CI `31326717132` 定向复审 PASS，PR merge `6289c87`。CON-018/023 继续 OPEN。
- Lesson: 资格记录必须有明确业务聚合身份，否则“依赖失效”没有可执行范围；保留期也必须沿 owner 树传播，而不是在每张 child 表复制 deadline。动态状态源必须反映审查门禁，不能用未来预期替代当前事实。
- Better future prompt: “先列出每种受资格控制业务输出及其最小失效聚合，再冻结一对一 identity、expected dependency manifest 和 retention owner；对跨 root 清理明确先隐藏、detach、再 purge，并让任务板状态严格等待项目负责人 PASS/merge。”
### 2026-08-10 — DEV-006 后台 current memory 最小纵向链路

- User outcome: 用两次虚构访谈建立 trusted final → current memory/actual asked → 跨会话 context 的可追溯后台链路，同时给 DEV-007 唯一 QuestionEvidence seam，停在 GitHub 人工审查。
- Review mode: Learning mode；独立只读复核确认正式契约与用户目标一致，无需重开产品范围。最大风险是 deletion no-op、依赖删除后的 vacuous eligibility、human authority 被覆盖和 unjudged 空目录冒充可靠事实。
- Options considered: 拆成 memory 与 question 两套后续实现；先只建表；按已审查 scope+membership/逐输出 derived/三类 root 一次完成最小纵向链路。采用第三种，避免第二套 question history 和不完整 provenance。
- Adopted decision: production deletion port 未配置即 fail-closed；local/test fixture 明确不算 deletion coverage。provider call 永远在锁外；写回重检 live policy 与所有冻结 revision/digest。actual catalog 只整版可靠发布；context 只消费 current eligible facts。
- Implementation evidence: forward-only Prisma migration；`ai-runtime`、`memory`、`question-evidence` 模块；consent policy revision producer；unit/PostgreSQL/auth/empty+legacy migration tests；任务板、追踪和交接同步。
- Verification boundary: DEV-007 generation/display/UI 未实现；CON-023 deletion producer/read model 与传播验收仍 `NOT IMPLEMENTED / NOT VERIFIED`；真实 provider、队列、试点质量和生产部署后置。任务保持 REVIEW，等待项目负责人 GitHub exact-head 手动审查。

### 2026-08-10 — DEV-006 项目负责人八项 P1 定向修复

- User outcome: 保留 PR #22 old head `d5073501b170c7e11f2bc3e00395fb8fdf794480`、CI `31357613683` SUCCESS 与正式 REQUEST_CHANGES P0=0/P1=8，只闭合审查指出的 provenance、幂等、漂移、安全边界、相似度、冻结、模块 seam 与 retention 缺口。
- Review mode: Correction mode；遵守 iteration-coach 既有独立复核次数约束，复用本任务首次独立只读复核，不为修复再次触发额外复核。
- Adopted decision: session scope 同时保存 final watermark 与 eligible count；request/trigger/retry/input hash 成为可审计身份；provider 结果写回漂移先持久化 cancelled 再向调用者失败；actual-question 与 memory 在同一冻结事务形成 count/manifest。生产 boundary producer 缺失时与 deletion 一样稳定 fail-closed，test fixture 不计安全覆盖。
- Implementation evidence: 第 11 个 forward migration；coordinator/policy/eligibility/retention、memory/context、QuestionEvidence 与 deterministic question-sim fake 定向修改；真实 PostgreSQL 反例覆盖 deferred watermark、漂移取消、catalog supersede 和过期/失败 root；全量门禁结果记录在 DEV-006 handoff。
- Verification boundary: `QuestionEvidenceWriter` 只冻结唯一 owner 和正式方法名，DEV-007 编排到来前显式 unavailable，不用 no-op 伪造 publication；不新增 boundary/deletion 半模型。CON-023 保持 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`。修复候选仍为 REVIEW，只请求项目负责人在 GitHub 对新 exact head 手动定向复审。
- Lesson: “有最终证据但被资格过滤”与“从未有最终证据”必须是不同持久化事实；响应未知的幂等需要业务身份重放而非碰唯一键；依赖资格必须沿 root 的状态和期限验证，不能只看子记录仍存在。
### 2026-08-10 — DEV-006 最终收口后暂停 DEV-007

- Evidence: 项目负责人对 PR #22 exact head `07d5ce1c75ce31e2265e78559545373ce216edb1`、CI `31363920049` 定向复审 PASS，P0/P1=0；merge `28fb22dede07d5d64589a30b67128f16c311f360`。旧 head `d5073501` 的 REQUEST_CHANGES/P1=8 永久保留，CON-023 不变。
- Decision: DEV-006 可以 DONE，但项目负责人明确反馈当前项目与预期有若干差异并要求暂不启动 DEV-007。将该高影响不确定性登记为 CON-025；现有技术前置完成不自动等于下一任务可开工。
- Guardrail: 在项目负责人逐项说明差异、总控写回正式依据并明确解除暂停前，不创建 DEV-007 任务窗口、分支或 PR，不让实现 Agent自行解释产品偏差。

### 2026-08-10 — CON-025 第一项：先设计陌生关系下的访谈旅程与问题来源

- User outcome: 用户希望产品先解决陌生倾听员与长者之间的破冰和表达意愿，再从生平概貌逐步进入深层故事；基础题库与深入题库应成为 AI 正常选题/有据轻调的重要内容来源。用户同时要求后续产品讨论优先提出开放的大局问题，不要过早限制在实现选项中。
- Review mode: Correction mode；独立只读复核确认现有规范已详细冻结 publication/replace/history/safety，却没有冻结候选问题来源和由浅入深的访谈阶段；`07` §10 还把基础题库降为后续人工资源，与新方向冲突。
- Review finding: 真正问题是“陌生关系下如何建立信任、表达意愿和渐进深度”；双题库是有价值的内容供给解法，但不能被实现成僵硬的二元开关。阶段应根据表达意愿、回答具体度、人生轮廓和当前话题可进可退；题库分类不替代实时安全边界。
- Options considered: 访谈旅程优先 + 双题库 + AI 选择/有据轻调；固定题数后从基础切深入；继续模型自由生成。推荐第一种，固定切换过硬，自由生成难以控制破冰节奏和内容治理。
- Adopted decision: pending user choice；本轮先把该偏差和协作方式写入 CON-025，不修改 `01/03/07/09` 正式产品契约，不启动 DEV-007。
- Implementation evidence: 只更新 CON-025 与本 journal；无业务代码、数据库、API、页面或任务分支变更。
- Lesson: 问题引擎的首要设计对象不是“候选怎么排序”，而是“访谈关系如何发展”。只有先定义旅程和内容来源，排序、自动替换和记忆才知道自己在优化什么。
- Better future prompt: “先不考虑现有实现，请让我描述一次理想访谈从陌生、破冰、生平扫描到深入故事的完整过程；你先理解每阶段的用户感受和目的，再讨论题库与 AI，不要先问存储、接口或算法参数。”

### 2026-08-10 — SPEC-QUESTION-JOURNEY-001 双题库与访谈旅程候选

- User outcome: 不再要求负责人凭空设计完整理想流程，先交付可试用首版；用 basic/deep 题库和可进可退旅程支撑陌生倾听员破冰、生平轮廓与故事深入，AI 只选择或有依据轻调，并拆出可串行实现的 DEV-007A/B。
- Review mode: Correction mode；iteration-coach 恰好一次独立只读复核。复核确认方向可继续，并要求补齐三项高影响事实：完整 release 原子发布、可验收且不硬切的阶段判定、轻调对题库原题和实际 transcript/memory 的双重 provenance。
- Adopted decision: 一个 UTF-8 CSV 同时承载 basic/deep 并导入不可变 draft release，经过来源/许可全量校验后原子激活；阶段为 `rapport|life_outline|story_depth`，以表达意愿、回答具体度、上下文和安全事实可保持/前进/退回；AI 只允许 `verbatim|lightly_adapted`，题库是正常内容源而非 unavailable 兜底。
- Implementation evidence: docs-only 同步 `01/03/04/05/07/08/09/10`、ADR-030 候选、CON-025、task board、traceability、handoff、任务卡/提示词和题库模板；未修改 Prisma、业务代码、runtime contracts、页面或测试。13 字段模板与 3 条 synthetic fixture、115 个 Markdown 相对链接、Prettier、diff/scope/state 检查通过。
- Verification evidence: 在专用空 PostgreSQL 数据库从零应用 11 migrations；lint/typecheck/build/smoke 通过，unit 232、integration 65、auth 13、Chromium E2E 9、auth Chromium E2E 4 全部通过。共享默认测试库的既有 P3009 与默认 4173 端口占用仅作环境诊断，未修改共享库或终止既有进程。
- Verification boundary: 当前只是 SPEC REVIEW 候选；synthetic fixture 只证明 internal demo 技术 seam，正式内部试用前必须导入负责人题库。CON-025 仍 OPEN，ADR-030 仍 Proposed，DEV-007/007A/007B 仍 BLOCKED；只有项目负责人对非 Draft PR exact final head/CI GitHub 手动审查明确 PASS 后才能改变这些状态。
- Lesson: 易编辑的内容交换文件与运行时权威事实必须分层；题库出处只能证明“问题从哪里来”，不能证明“为什么能这样轻调”，后者必须由实际访谈证据单独回链。

### 2026-08-10 — SPEC-QUESTION-JOURNEY-001 三项 P1 定向修复

- User outcome: 永久保留 PR #23 old exact head `0f3034d27975cd0695e9963d5e29535d7d574dda`、CI `31371643597` SUCCESS 与正式 REQUEST_CHANGES（P0=0/P1=3），只在原分支冻结条件逻辑、journey 决策和 purpose/adaptation reason；不扩到业务代码、Prisma、runtime 或页面。
- Review mode: Learning mode；本次重大定向修复恰好一次独立只读复核。复核确认三项都能 docs-only 关闭，并建议把算法唯一事实集中在 `07`，以“规范化输入 → 固定优先级 → 单一决定分支 → 稳定输出”消除 DEV-007A/B 猜测。
- Review finding: 旧条件契约只列 token，未定义 AND/OR、排除优先和非法输入；阶段只有原则性信号，无法确定冲突时的唯一结果；CSV/item 缺 purpose，而 candidate 已有 purpose，adaptation reason 也无枚举，形成跨模块语义断点。
- Options considered: 容错去重与冲突排除、严格整批拒绝；输出所有命中信号、只输出最高决定分支；细分多种表层改写码、两值语义分类。采用严格拒绝、最高决定分支和 `surface_wording|grounded_slot_fill` 两值分类，降低内容错误隐藏与枚举组合爆炸。
- Adopted decision: `question_condition_v1` 采用 applicable all-of/AND、inapplicable any-of/OR、排除优先；整体空值允许，空 token/未知/重复/跨字段同码整批失败，fixture 使用同一 validator。`journey_policy_v1` 冻结完整 reason codes 与 hard safety → conservative → reluctant → retreat → continuous narration → deep → outline → hold 的顺序，保守信号压过正向信号，不消费题数/时间。CSV 升为 14 列必填既有 purpose，item/reader/candidate/snapshot 和轻调保持；adaptation reason 只允许两个受控值。
- Implementation evidence: 定向同步 `01/03/04/05/07/08/09/10`、ADR-030、CON-025、task board、traceability、REV-034、handoff、DEV-007/A/B 任务卡与提示词、14 列模板/3 条 synthetic fixture；未修改 Prisma、migration、业务代码、runtime contracts、测试或页面。
- Verification evidence: docs contract、scope/state、`git diff --check`、Prettier、115 个 Markdown 相对链接通过；format/lint/typecheck/build 通过；unit attempt 1 出现既有工作台 1 秒异步时序波动（231/232），未改测试，原样重跑 232/232；专用 PostgreSQL 库 11 migrations deploy/status、integration 65、auth 13、smoke、Chromium E2E 9 与 auth E2E 4 全部通过。
- Verification boundary: 三项仅为逐项响应候选，不代表项目负责人已关闭 P1。SPEC 保持 REVIEW、CON-025 OPEN、ADR-030 Proposed、DEV-007/007A/007B BLOCKED；新 exact head/CI 必须由项目负责人 GitHub 定向复审，本 Agent 不 PASS/DONE/合并。
- Lesson: 受控枚举只有与非法输入、冲突优先级和稳定输出顺序一起冻结，才能成为实现契约；“有 reason code”不等于“决策可重放”。内容 purpose 必须从原题贯穿运行时和展示事实，不能让模型按改写正文重新分类。
- Better future prompt: “请冻结 v1 输入事实、规范化/非法输入行为、固定优先级、单一转移表和稳定 reason-code 顺序；再逐字段证明内容源、runtime projection、candidate 与 snapshot 不漂移。”

### 2026-08-10 — SPEC-QUESTION-JOURNEY-001 最终接收与 DEV-007A 解锁

- Evidence: 项目负责人对 PR #23 final head `5963af98b4a807e5fa1d00ff33f8ef6b6a0e6323`、CI `31380903831` 定向复审 PASS，P0/P1=0；旧 head `0f3034d` 的 REQUEST_CHANGES/P1=3 永久保留；merge `f0bff3f029716804175000fab0d4441ec6585bf4`。
- Decision: SPEC-QUESTION-JOURNEY-001 DONE，ADR-030 Accepted，CON-025 RESOLVED，DEV-007A READY；DEV-007B 仍等待 A。项目负责人可并行准备 14 列题库，A 先用 synthetic fixture 建设导入/版本/阶段/确定性选择 seam。
- Guardrail: fixture 不得进入正式内部试用；A 不实现 LLM 轻调、QuestionEvidence 发布或页面，B 不得在 A PASS 前启动。公开题库必须先核验来源与许可。
- Lesson: 探索期可以让内容准备与基础设施并行，但必须先冻结交换格式、运行时事实、选择边界和验收等级，避免“先写几道题”偷偷变成不可追溯的产品内容。

### 2026-08-10 — DEV-007A 题库基础设施与确定性旅程实现

- User outcome: 从最新 `origin/main` 实现严格 14 列题库导入、不可变 release、原子 activate/retire、active reader、`question_condition_v1`、`journey_policy_v1` 与仅供 DEV-007B 消费的 deterministic seam；只用明确 synthetic fixture 做 internal demo，不提前实现 B。
- Review mode: Learning mode；iteration-coach 恰好一次独立只读复核，未发现需暂停的产品/契约偏差。
- Review finding: 最容易越界的部分不是 CSV parser，而是把 journey/source/purpose 提前写入 DEV-006 的 attempt/candidate/snapshot，或另建 history。复核确认 A 只新建 release/item 并返回确定性决策/eligible 投影；B 以后必须经既有 QuestionEvidence writer 持久化发布事实。复核同时要求 fatal UTF-8、正确 quoted CSV、raw/canonical digest 分离、许可矩阵、事务锁、数据库不可变与完整 basis hash。
- Options considered: 以 CSV/JSON 直接作为 runtime 权威、导入 PostgreSQL versioned release；在 A 修改 QuestionEvidence 表、只提供无持久化 seam；容错条件去重、严格拒绝非法集合。采用数据库权威 release、A/B 单一所有权 seam 和严格拒绝，避免内容漂移、双 history 与静默修正。
- Adopted decision: release/item 由本轮 migration 单一拥有，导入全量校验后只创建 draft；request/version/scope advisory lock 与数据库 trigger/index 共同保证精确幂等、不可变和原子激活。reader 只返回 active+enabled+licensed+condition-compatible item 和原 purpose；journey evaluator 规范化受控 signals/watermarks 后按冻结优先级输出 stage/reasons/basis hash；deterministic selector 明确只作基础设施测试 fake。
- Implementation evidence: `apps/api/prisma/migrations/20260810193000_dev007a_question_bank`、Prisma schema、`apps/api/src/question-bank`、受控 `question-bank-cli.ts`、AppModule 注册、CSV/journey unit、PostgreSQL/auth tests 与既有 `docs/question-bank/question-bank-internal-demo.fixture.csv`；未改 QuestionEvidence 表/Writer、REST/WS、页面或 DEV-007B 编排。
- Verification evidence: 专用空 PostgreSQL 库 12 migrations deploy/status；format/lint/typecheck/build/diff 通过；unit 37 files/261 tests、integration 12/71、auth 4/18、smoke、Chromium 9/9、real Web/API auth Chromium 4/4 通过。默认 `4173` 占用后使用隔离 Web 端口；auth proxy 保持既有 API `3101` 后通过，未修改测试目标。
- Verification boundary: 仅证明 internal demo 和 A 的工程 seam。正式题库内容尚未提供，产品内容质量/许可、正式内部试用、LLM/轻调/publication/current/history/manual-next/UI 均未实现或验收；任务保持 REVIEW，DEV-007B 保持 BLOCKED，等待非 Draft PR exact-head CI 与项目负责人手动审查。
- Lesson: 在共享事件表已由另一模块拥有时，正确的基础设施交付是“返回足以持久化的确定性事实”，而不是为便利提前复制发布状态。数据库不可变保护内容版本，basis hash 保护决策输入；两者分别回答“选自哪版内容”和“为什么得到这个阶段”，不能互相替代。
- Better future prompt: “请只在 A 中持久化它拥有的内容版本；对下游发布事实给出含版本、purpose、stage、reason 和完整 basis hash 的只读 seam，并列出明确禁止写入的既有 owner 表。”

### 2026-08-10 — DEV-007A membership seal 与可信环境两项 P1 定向修复

- User outcome: 永久保留 PR #24 old exact head `5cea9726994656c6a95babdcb6bc8f3f7ce4014e`、CI `31385629751` SUCCESS 与项目负责人正式 REQUEST_CHANGES（P0=0/P1=2），只闭合 release membership 可追加和 CLI 环境可伪装问题；DEV-007A 保持 REVIEW、DEV-007B 保持 BLOCKED，不合并、不自行 PASS/DONE。
- Review mode: Correction mode；本轮恰好一次独立只读复核。复核确认两项都是既有 `04/05/08/09` 数据完整性与 fixture 门禁的落实，不改变 ADR-030 冻结产品语义、QuestionEvidence 所有权、安全/许可边界或跨模块契约，无需暂停。
- Review finding: 只禁止 item UPDATE/DELETE 不等于不可变 release，draft 在 import 提交后仍能被追加；只由 service 记住“导入完成”也不能证明实际 count/digest。`--environment` 同样只是操作者声明，不能代表进程所在部署环境；仓库现有可信事实是经共享 schema 校验的 `APP_ENV=local|test|staging|production`，其中 staging 对应正式内部试用，internal_demo 是 release scope 而非部署身份。
- Options considered: 仅按 parent status 禁止 INSERT、transaction-local GUC、未提交构建窗口 + database seal/deferred invariant；继续保留 CLI environment 权威、参数与 APP_ENV 必须相等、删除覆盖参数并只信 APP_ENV。采用未提交窗口 + seal/deferred 和删除覆盖权；前两种 seal 方案分别不能封住 imported draft 或可被同数据库角色伪装，参数相等方案仍混淆 internal-demo scope 与部署身份。
- Adopted decision: release 保存 `item_count/membership_sealed_at`；同一导入事务按 create unsealed draft → createMany → PostgreSQL 重算 UTF-8 byte-length-framed canonical membership SHA-256 → seal → deferred commit check 执行。seal 后 draft/active/retired 的 item INSERT/UPDATE/DELETE 全部拒绝，scope/source/license 在 INSERT 窗口也由数据库重检。CLI 明确拒绝 `--environment`；service/reader 注入由 `APP_ENV` 映射的可信环境，request binding/audit 保存该环境，staging/production 对 fixture 写入和读取失败关闭。
- Implementation evidence: 最小同步 `02/04/05/08/09`；修订 PR 尚未合入 main 的 DEV-007A migration、Prisma release 字段、CSV canonical digest、question-bank module/service/reader/CLI 与 config APP_ENV loader；真实 PostgreSQL 反例覆盖正常 seal、actual count/digest、三状态 direct INSERT、mismatch/fixture bypass 全事务回滚；CLI/auth 覆盖可信 APP_ENV 与伪造参数。未修改 request replay 主体、activation transaction、condition/journey、QuestionEvidence、UI 或 DEV-007B。
- Verification evidence: 专用空 PostgreSQL 库从零应用 12 migrations 且 status up to date；format/lint/typecheck/build/diff、unit 38 files/265 tests、PostgreSQL integration 12/73、auth 4/23、smoke、Chromium 9/9 与 real Web/API auth Chromium 4/4 全部通过。已跑真实音频 E2E 的库因既有 auth 清理顺序被残留 capture 外键阻止，未修改测试目标，改用新空库完整复跑 auth 通过。
- Verification boundary: 新 exact head 与 GitHub CI 尚待生成；当前只是 REV-035 两项 P1 的修复候选，不代表项目负责人已关闭意见。正式题库仍缺失，fixture 只证明 `APP_ENV=local|test` 下 internal demo，产品内容/正式内部试用仍未验收。
- Lesson: 集合不可变必须建模为“提交前私有构建 + 提交前数据库证明 + 提交后封存”，而不是把 parent 状态或 service 调用顺序当作事实。内容声明只决定 release scope，部署配置才决定该进程是否有权操作或读取它。
- Better future prompt: “把 release 作为提交前不可见的集合聚合：数据库在 commit 前验证 sealed/count/canonical digest，seal 后拒绝 item INSERT/UPDATE/DELETE；所有 fixture 权限仅由 injected APP_ENV 决定，CLI 不接受环境覆盖。”

### 2026-08-10 — DEV-007A 最终接收与 DEV-007B 解锁

- Evidence: 项目负责人对 PR #24 final head `6b8e69e1b3170a86699338c7037374029a163978`、CI `31395799408` 定向复审 PASS，P0/P1=0；旧 head `5cea972` REQUEST_CHANGES/P1=2 永久保留；merge `7f9a17326f3d388333b63bd889ec09c5de5e5f91`。
- Decision: DEV-007A DONE，DEV-007B READY。B 可消费 A 的 active/eligible/journey seam 与 DEV-006 QuestionEvidence/current memory，但不得改写 A 的 release membership 或另建 history。
- Guardrail: 正式题库未提供不阻塞 B 的 internal demo 开发，但 fixture 不得成为正式内部试用内容；B 完成也不能替代正式题库来源/许可与内容质量验收。
- Lesson: 内容基础设施和 AI 编排可以分段验收；只要 A 的版本与环境边界真正封死，B 就能在不接触内容治理底层表的前提下安全迭代。
### 2026-08-11 — DEV-007 核心纠偏：题库参考、单次模型自由生成

- User outcome: 项目负责人明确下一问应由模型综合当前可信转录、DEV-006 current memory、实际已问、展示历史、阶段和题库参考自由决定；题库不是白名单，可以大幅改写或完全不用。问题生成不得修改源事实，但展示历史必须持久化。
- Review mode: Correction mode；唯一独立只读复核确认不能只把 source FK 改 nullable，必须同时纠正 Context、Output、Prompt、candidate provenance 和 DEV-007B 门禁，并保留 ADR-027-029 的 QuestionEvidence/current/history/幂等/安全基座。
- Options considered: 继续在 PR #25 上放宽轻调；增加第二个 planner agent；先做 docs-only 契约纠偏再新建 DEV-007B v2。采用第三种。数据库读取、上下文裁剪、权限、安全、事务和写回由确定性后端服务负责，不是第二个智能体；第一版只有一次实时结构化模型调用。
- Adopted decision: ADR-031 候选部分取代 ADR-030 的强制题库来源与轻调白名单；题库成为 0..N 可选参考。正式冻结 `InterviewDirectorContextV1`、`InterviewDirectorOutputV1` 与仓库内可编辑/不可变版本化 prompt bundle；reference attribution、事实 grounding 和发布资格分离。
- Implementation evidence: docs-only 更新 `01/03/04/05/07/08/09/10`、任务板/追踪/冲突/ADR、DEV-007/007B task+prompt，新增 Context/Output Schema、prompt v1、SPEC task/handoff；未修改 Prisma、migration、业务代码或页面。
- Review evidence: 用户临时委派总控对 PR #25 head `55bf9fba` 代审，REV-036 记录并发/幂等/late publish/阶段/历史恢复等缺口及 `REQUEST_CHANGES`；其旧轻调核心又被本轮产品决定 supersede。
- Verification boundary: SPEC-QUESTION-DIRECTOR-001 仅到 REVIEW；ADR-031 Proposed、CON-026 OPEN、DEV-007B BLOCKED。PR #25 old head 保留 REQUEST_CHANGES，不得合并；契约 PASS/merge 后以 v2 新分支/PR 选择性移植契约中立实现。

### 2026-08-11 — PR #26 Schema/Retry/题库归因定向一致性修订

- User outcome: 不再让 Markdown、Schema 和 Prompt 各自定义一套 Director 结构；第一版只做一个 Director、一次逻辑生成和基础硬校验，技术失败最多一次完全同输入 retry。题库可选，必须区分模型看过与模型声明使用。
- Review mode: Correction mode；恰好一次独立只读复核确认 old head `0a75b170` 的四项 P1 均成立，且可在 docs-only 边界关闭，无需新产品问题。
- Adopted decision: 两份 JSON Schema 分别成为 AI 实际 Context/Output 的唯一技术结构；Prompt 只定义任务和材料作用。job/attempt 另存版本/digest 与 input membership，不把过程元数据塞入模型 Context。seen bank membership、declared attribution、grounding 与 publication eligibility 四分。
- Retry boundary: `question_generation` primary 遇 transport/timeout 或返回未过基础硬校验后最多一次 `same_input_retry`；Prompt、Context、Output Schema、model config、版本/digest/input hash 完全相同，不回传前次输出或错误。权限、安全、deletion、重复或 writeback 漂移不 retry；第二次失败不创建 candidate、不改变 current/history。
- Validation boundary: 确定性后端只证明 Schema、ID/subset、权限、安全、版本、retention、重复、幂等与 CAS；自然语言是否真正单问、grounding/risk/purpose 是否贴切由 Prompt、固定评测和人工实践评价，不新增启发式 validator 或第二模型。
- Verification boundary: 本轮仍是 SPEC REVIEW；ADR-031 Proposed、CON-026 OPEN、DEV-007/007B BLOCKED、PR #25 REQUEST_CHANGES。新 exact head 和 CI 只作为项目负责人定向复审候选，不自行 PASS/DONE/merge。

### 2026-08-11 — SPEC-QUESTION-DIRECTOR-001 最终接收与 DEV-007B v2 解锁

- Evidence: 项目负责人对 PR #26 final head `8938d525d66f138e7c7b7e3049fe56cbea6bcbb1`、CI `31454260127` 定向复审 PASS，P0/P1=0、P2=1；merge `d320f642a30ee8cc71090ad0d1662b4fc2d08ad6`。old head `0a75b170` REQUEST_CHANGES/P1=4 永久保留。
- Decision: SPEC DONE、ADR-031 Accepted、CON-026 RESOLVED；两份 Director Schema 转正式，DEV-007B v2 仅解锁为 READY，父 DEV-007 继续等待 B。PR #25 旧白名单实现仍不得合并。
- P2 closeout: `09` 末尾旧的 Journey SPEC REVIEW / A/B BLOCKED 动态状态句已替换为任务板当前事实，避免规范正文冒充动态状态来源。
- Verification boundary: 本次治理不启动 DEV-007B，不实现模型/UI/数据库迁移，也不证明正式题库内容、真实 LLM、生产或真实试点可用。

### 2026-08-11 — DEV-007B v2 自由生成纵向链路候选

- User outcome: 在无需追加产品讨论的前提下，尽快交付“可信数据库 Context → 一个 Director → 基础硬校验 → QuestionEvidence 发布 → 当前问题/历史/UI”的 local/test internal-demo 链路。
- Review mode: Learning mode；唯一独立只读复核确认没有新的产品偏差，关键不是增加 planner，而是隔离只读来源事实、可失效候选与不可冒充 actual asked 的展示历史。
- Decision: 旧 PR #25 继续 REQUEST_CHANGES；从 main 新建 v2 分支，只移植契约中立骨架。后端确定性负责数据库范围、冻结、权限、安全、幂等、版本和写回，一个 Director 只生成结构化建议。
- Implementation evidence: 正式 Context/Output Schema validator、可编辑 prompt digest、同输入一次 retry、optional bank/seen-declared 分表、free-generation candidate、QuestionEvidence current/history/manual intent、REST canonical/bodyless WS、cursor/anchor 与跨刷新 UI。
- Verification boundary: deterministic fake、synthetic fixture、unit/PG/Chromium 只证明工程不变量；正式题库、真实模型、生产 boundary/deletion、问题质量和真实试点均未证明。DEV-007B 保持 REVIEW，等待 PR #27 exact-head CI 与项目负责人手动审查。

### 2026-08-11 — DEV-007B v2 REV-038 定向修复

- User outcome: 永久保留 PR #27 old head `542917229e1f68e60d434a74d6ef81b0cd7548f9`、CI `31458597516` 与正式 `REQUEST_CHANGES`（P0=0、P1=4、P2=1），只修 journey 最近回答/continue bypass、共享 8 秒 deadline、automatic provider 前 gate/同阶段 comparator、安全 current projection和 `09` 状态残留；不重开已通过的自由生成、seen/declared、QuestionEvidence owner、actual asked 与历史恢复主干。
- Review mode: Correction mode；本轮恰好一次独立只读 iteration-coach 复核。其指出旧文档中的模型 score 维度不能继续作为 publication 权威，必须改为服务端由 frozen evidence 可机械计算的 deterministic comparator，并要求 absolute deadline、每次供应商前安全重查和 trailing automatic 调度。
- Options considered: 沿用 stage+risk 固定分；增加第二个模型打分；用 grounding freshness、最近回答覆盖、stage-purpose fit、risk fit 的后端公式重评 current/candidate。采用第三种，既能区分同阶段候选，又不把模型自报 score 当事实或引入第二 AI。
- Adopted decision: response/engagement 只看最近 interviewer 后最多 3 条可信 elder 实质 final；continue listening 不调用 Director。attempt `created_at+8s` 是 primary/retry/publication 共同截止；automatic 20 秒门禁位于 provider 前并保留最新 trailing segment；current 只有 visible suggestion + active/unexpired snapshot 才进入 Context。
- Implementation evidence: `question-selection.ts` 及 unit、coordinator retry unit、orchestration/presentation service、PostgreSQL `question-presentation` 回归，并同步 `05/07/09`、REV-038、task/board/trace/handoff。
- Verification boundary: 当前仍是修复候选而非项目负责人复审结论；正式 LLM、正式题库、生产 boundary/deletion reader 与真实试点仍未覆盖，CON-023 继续 OPEN，DEV-007B 保持 REVIEW。

### 2026-08-11 — DEV-007B v2 最终接收与父任务聚合验收

- Evidence: 项目负责人在 PR #27 OPEN、非 Draft、未合并且 head 无漂移时，对 final exact head `0f03c270b7022ce8dbbce75028afe7e9f3e12cf3`、CI `31465809589` 手动定向复审 PASS，P0/P1/P2=0；四项 P1 与一项 P2 全部关闭。GitHub APPROVE 因 integration 403 未写入 UI，但项目负责人明确指定当前回复为正式 PASS。
- Decision: PR #27 以 merge commit `3bb80df36d484779761cf6bb6d45c302fa8d32d7` 合入 main，DEV-007B DONE；old head `5429172` 的 REQUEST_CHANGES/P1=4/P2=1 与旧 PR #25 的 REQUEST_CHANGES 永久保留。
- Parent gate: DEV-007A/B 与全部专项前置均已 PASS/merge，`main@3bb80df` 的 push CI `31468031796` 完整 verify PASS；但父 DEV-007 明确要求按 `09` 聚合验收，不能从子任务自动推导 DONE。因此父任务转 `VERIFY` 并整理聚合审查包，DEV-008 暂不解锁。
- Verification boundary: 当前只证明 local/test deterministic fake + synthetic fixture 的纵向工程不变量；正式题库、真实 LLM、生产 boundary/deletion reader、生产部署、问题质量和真实试点仍未证明，CON-023 继续 OPEN。
- Lesson: exact-head 手动结论可以在 GitHub Review API 受限时作为正式审查依据，但必须同时记录绑定 SHA、CI、PR 锁定状态、API 失败原因与明确的人类结论；父任务的跨模块聚合门禁仍需单独结论。

### 2026-08-11 — SPEC-ASR-PROVIDER-001 adapter v2 契约纠偏

- User outcome: 以腾讯实时 ASR V2 单一候选把授权后的标准普通话 PCM 接入真实转录，同时保持原始录音优先、unknown fail-closed、连接级 speaker namespace、明确 drain 与真实双人验收。
- Review mode: Correction mode；本轮恰好一次独立只读 iteration-coach 复核。它发现现有同步 `accept(frame)->result[]`/void drain、首帧 250ms 事务 deadline 和 runtime 复用无法表达腾讯独立握手、异步结果、新 voice namespace 与 `final=1` drain。按治理先暂停回传；总控随后明确授权“复用供应商中立边界但演进 v2 seam”。
- Options considered: 在 provider 内隐藏长连接/缓存（会污染事务、namespace 和 drain）；拆成两个 SPEC（增加审查往返）；本 SPEC 冻结一个供应商中立 v2 port、DEV 原子迁移。采用第三种，不新增产品状态或数据库事实。
- Adopted decision: connect/ready 与业务 session.ready 分离；PCM accepted 只表示 adapter 接管；结果异步绑定 attempt/voice/request/speaker stream；每个新 voice 新 stream 并重校准；当前 voice `final=1` + PCM 终态 + ingestion 才形成 drain receipt；timeout/error 后 fence。v1 不保留并行生产 truth source。
- Provider correction: 当前腾讯 V2 官方参数未证明 `speaker_diarization=1`，因此只冻结内部 `diarization_required=true` 与目标 `16k_zh_en_speaker_2.0`，wire 参数保持 unknown；营销能力不能替代同 PCM 三次真实双人 replay。
- Verification boundary: 本轮只形成 REVIEW docs/schema，不读取/测试密钥，不调用 provider，不实现代码/migration/deploy。CON-027 阻塞真实长者试点；DEV-ASR-PROVIDER-001 和真实 LLM 继续受正式 PASS 门禁约束。

### 2026-08-11 — SPEC-ASR-PROVIDER-001 sticky completeness P1 定向修复

- User outcome: 修复 PR #28 首轮唯一 P1，使重连后当前 voice 成功收束不能掩盖此前未回补的 ASR 缺口，同时不把所有多-attempt 会话错误地永久降级。
- Review mode: Learning mode；本轮恰好一次独立只读 iteration-coach 复核。复核确认可沿用既有 `session_finalization.transcript_status`，由 runtime 维护 session/capture 级单调 completeness 并在 stop 投影；无需新增持久字段、migration 或 backfill。若要求进程重启后精确恢复无 gap 或当前支持 clear，才需要扩大数据模型并暂停。
- Options considered: 为 attempt/gap 新增持久表（超出本 P1）；把所有 reconnect 一概 degraded（误伤无 gap lane）；runtime sticky 聚合 + evidence loss 失败关闭 + 既有终态投影。采用第三种。
- Adopted decision: attempt lifecycle/receipt 只证明一个 voice；session/capture completeness 仅允许 `no_known_gap -> known_unbackfilled_gap`。accepted PCM 无终态、capture coverage 中断或 evidence 丢失形成 sticky gap；后续 connect/ready/final/receipt/reconcile 均不能 clear。A 在首 PCM 前失败或 A/B 连续完整交接不形成 gap，最后 receipt 完整时仍可整体 `drained`。
- Review evidence: old exact head `8d9922bead9a7d70517bafe2245bc44a560b8dc5`、CI `31476068838` 的正式 REQUEST_CHANGES（P0=0/P1=1）永久保留为 REV-039；定向候选仍为 REVIEW，只请求项目负责人复审该 P1。

### 2026-08-11 — SPEC-ASR-PROVIDER-001 exact-head PASS 与治理收口

- User outcome: 先冻结真实腾讯 ASR 的生命周期、双人标签、安全和验收契约，再进入真实 provider 实现。
- Review mode: 项目负责人手动定向复审。
- Review finding: final head `84a2173c2b95111d7432b5c3a026494a3f666a3f`、CI `31484868105` PASS，旧 sticky completeness P1 关闭；old head REQUEST_CHANGES 历史保留。
- Adopted decision: PR #28 merge `d7b318f`，main CI `31494227785` SUCCESS；SPEC DONE、ADR-032 Accepted、DEV-ASR-PROVIDER-001 READY。CON-027 继续阻塞真实长者/PII，真实 LLM 继续依赖真实 ASR PASS。
- Implementation evidence: 本轮只有已审契约合并与治理收口；未实现 provider、未读取密钥、未运行真实腾讯或真实音频。
- Lesson: attempt 成功只证明局部连接收束，不能证明整场数据完整；聚合状态必须保留已知缺口，避免后续成功覆盖早期损失。
- Better future prompt: “请分别定义每个 ASR 连接的收束证据与整场访谈完整性；任一未回补缺口必须跨重连保持 degraded，直到权威 backfill 明确关闭。”
- Boundary and risk: 当前不持久化精确 gap interval、不实现 backfill/clear、业务代码或 provider；runtime/coverage evidence 丢失会保守 `degraded`，允许假阴性但禁止假完整。权威 gap ledger 与有证据重算仍归 HARDEN-ASR-001。

### 2026-08-12 — 腾讯 V2 话者分离 wire 事实修正候选

- User outcome: 修正腾讯实时 ASR V2 话者分离 wire 参数的过时正式事实，让 DEV-ASR-PROVIDER-001 在新契约 exact-head 获项目负责人 PASS 后，用同一虚构 TTS PCM、`reconnect=0` 做一次隔离诊断，而不把 close 1005 根因写成已证明。
- Review mode: Correction mode；按 iteration-coach 恰好一次独立只读复核。复核确认不能静默改写 ADR-032 或只改 Markdown；应新增 Proposed ADR-033 部分取代窄供应商事实，并同步 machine profile 的 required/omit/canonical 规则。
- New evidence: 腾讯官方会议话者分离指南明确 `speaker_diarization=1`；官方 Go SDK 固定 commit `257f9f56bcd592bff1faea9b4ce0f1ef90cea803` 中通用 recognizer 默认 0、专用 speaker recognizer 默认 1，且 query key 排序后签名；V2 文档确认目标 engine 支持/默认话者分离与实际 query 签名范围。
- Candidate decision: 实际 query 必发并签名 `speaker_diarization=1`、`enable_speaker_context=0`；`speaker_context_id` 必须省略而非传空值。目标 engine、新 voice→新 speaker stream→重新人工确认、unknown fail-closed、sticky completeness、安全/授权与原始录音优先全部不变。
- Adopted decision: pending project-owner review；任务 `SPEC-ASR-WIRE-PARAM-001`、ADR-033 与正式契约候选保持 REVIEW。ADR-032、SPEC-ASR-PROVIDER-001、REV-039 和既有 PASS/merge 历史永久保留，CON-027 继续 OPEN。
- Verification boundary: 本轮 docs-only，不改业务代码、Prisma、migration、provider、密钥或部署，不连接腾讯。单次诊断不证明 close 1005 因果，也不替代双人 label、三次 replay、Android、主动断线、账单或完整 provider PASS；仍失败时停止参数试错并走腾讯支持。
- Better future prompt: “请把供应商实际 query map、canonical query 和签名覆盖作为一个不可分割的契约，并为 required、omit 和 empty 分别提供机械可验证表示；后续一手证据推翻 Accepted ADR 的事实前提时，只新增 partial-supersede 决定，不改写历史正文。”

### 2026-08-12 — SPEC-ASR-WIRE-PARAM-001 exact-head PASS 与治理收口

- Review evidence: 项目负责人对 PR #29 final exact head `650f856c918639a7b992294b805873d7052ab44e` 手动 PASS，P0/P1/P2=0；exact-head CI `31556525476` SUCCESS。执行 Agent 先前保持 REVIEW 的候选历史永久保留。
- Adopted decision: ADR-033 Accepted，正式腾讯 profile 固定 `speaker_diarization=1`、`enable_speaker_context=0` 必发并签名，`speaker_context_id` 严格省略。总控按 exact head 合并，merge/main 集成点 `1e18ea83cd5a1d4953bb92fd251637ed6107c322`，main CI `31560488220` SUCCESS；SPEC-ASR-WIRE-PARAM-001 DONE。
- Historical boundary: ADR-032、SPEC-ASR-PROVIDER-001、REV-039 与当时 wire-unknown/PASS 历史不改写；REV-040 只记录后续官方一手证据促成的 partial supersede。CON-027 继续 OPEN。
- DEV handoff: DEV-ASR-PROVIDER-001 现可用同一虚构 TTS PCM、同一其余变量、单连接、`reconnect=0` 做恰好一次诊断；尚未执行。失败即保留最小安全证据并转腾讯支持，不做无界参数试错。
- Verification boundary: 本次 PASS/merge 只接受 docs-only 契约，不证明 close 1005 因果，也不替代双人 label、三次 replay、桌面/Android、主动断线、账单、数据治理或完整 provider PASS；未修改业务代码、Prisma、migration、provider、密钥或部署，未连接腾讯。

### 2026-08-12 — SPEC-DEV-008A 统一倾听员工作区与本机副本契约候选

- User outcome: 当前只交付响应式网页，让倾听员登录后能从同一工作区新建、继续和回顾访谈；最小回顾管理当前 origin 的录音副本，但绝不冒充服务器隐私删除。
- Review mode: Learning mode；恰好一次独立只读 iteration-coach 复核，结论 `NO-PAUSE`。
- Review finding: 现有 project/service-term/consent/session/start 语义足够冻结 A2；home 缺 project-session read model。IndexedDB v4 迁移后 legacy `chunks` 仍可能留 Blob，upload-jobs 还混存多个 generation interruption report；删除若只清 archive/formal job 会留下副本或恢复事实。storage estimate 只能说明 origin-wide 近似容量。
- Options considered: 继续依赖深链并让 A2/A3 各建 UI；把回顾、导出和 server deletion 保持一个 DEV-008；先建共享 A1，再并行 A2/A3，008D 独立。采用第三种。
- Adopted candidate: 唯一 authenticated home shell；A2 完整 project→service term→正式口头 consent→session/device-check/start；A3 播放本机完整 archive，并以 capture 共锁、fresh server preflight、单个 IndexedDB transaction 清 current/legacy/all reports、原子最小回执实现本机删除。倾听员不导出，不做 PWA/App/封装。
- Implementation evidence: 同步 `00/01/03/04/05/06/08/09/10`、ADR-034、任务板/追踪/冲突/任务卡/交接与正式 `local-audio-archive-v1` Schema；没有修改业务代码、Prisma、migration、测试、部署、密钥或真实数据。
- Verification boundary: SPEC 只到 REVIEW；A1/A2/A3/008D 全部 BLOCKED。没有实现 session list、UI、IndexedDB upgrade、播放、local delete 或 server delete；CON-023 继续 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`。
- Lesson: “设备上没有 Blob”与“隐私资料已删除”是不同事实。若既要删除恢复数据又要跨刷新诚实区分用户成功操作，就需要在同一原子事务保留无正文最小回执；浏览器清站连回执也消失时，原因必须回到 unknown，而不是通过猜测补齐审计。
- Better future prompt: “先用唯一 home shell 建立列表与路由，再让新建和回顾复用它；本机副本删除与 capture 竞争同一锁，单事务覆盖 current/legacy 全部 session 记录并写最小回执，明确服务器资料仍保留。”

### 2026-08-12 — SPEC-DEV-008A REV-041 定向契约修复

- old exact head `19604291e751f1403272183d314d367c0de593b0` / CI `31571463898` 的绿色门禁未覆盖三类契约可执行性：响应未知的 create identity、session lifecycle 到首页动作，以及机器 Schema 的跨字段一致性；项目负责人结论为 REQUEST_CHANGES/P1=3，历史永久保留。
- 修正：A2 四个 create 统一为“首次请求前持久 request ID + actor/action/target-or-create-identity/payload hash + authoritative replay”；project create 的无 target 身份固定为 `project:create:{actor_id}:{request_id}`。
- 修正：首页不再用“未完成/已完成”二分，而以服务端 session/finalization 事实输出唯一 action；processing、failed complete manifest、NO_AUDIO_CAPTURED 分别有明确只读回顾/播放/删除边界。
- 修正：本机 projection 先冻结唯一优先级，再由 Schema 条件约束 state/count/pending/playback/deleted_at，并以正反 fixture 防止语义回退。
- 教训：文档验收中的“响应丢失可恢复”“状态一致”“formal Schema”必须同时给出权威 identity、完整状态矩阵和机械不可表达矛盾的约束，不能只靠叙述性目标或 GET 重读。

### 2026-08-12 — SPEC-DEV-008A exact-head PASS 与治理收口

- Review evidence: 项目负责人明确授权总控手动定向复审 PR #31 final exact head `0308aa9ef37be457aa41f23ea6113666ff2c1f97` / CI `31573583324`，正式结论 PASS，P0/P1=0；GitHub 记录为 issuecomment `5263644971`。
- Adopted decision: A2 四 create authoritative replay、session 首页动作矩阵、local archive projection/Schema 正反例正式接收，ADR-034 Accepted。PR #31 merge `91e5e7ed042f598359827ae63daf464e12e2ef76`，main CI `31573985661` SUCCESS，SPEC-DEV-008A DONE。
- Historical boundary: old head `19604291e751f1403272183d314d367c0de593b0` / CI `31571463898` 的 REQUEST_CHANGES/P1=3 永久保留；后续 PASS 关闭问题但不改写首轮事实。
- DEV handoff: 只解锁 DEV-008A1 为 READY；父 DEV-008A、A2、A3、008D 继续 BLOCKED，A2/A3 等 A1 PASS/merge，CON-023 继续 OPEN。未实现 A1、业务代码、Prisma、migration、session list、UI、IndexedDB upgrade、播放或任何删除 runtime。
- Lesson: 契约 SPEC 的接收只解除被它直接阻塞的第一段实现，不应把父任务或可并行后续切片一并提升；把 exact-head PASS、merge commit 和 main CI 串成不可分割证据链，才能安全做治理状态迁移。

### 2026-08-12 — DEV-008A1 restricted 读取契约开工前修正

- User outcome: 在不泄露 restricted 项目正文的前提下保留一个可理解的首页中性占位，并让 DEV-008A1 获得可机械实现、可安全测试的项目列表/分页/详情读取边界。
- Review mode: Correction mode；沿用 DEV-008A1 实现窗口已完成的唯一独立只读复核，不启动第二次 iteration-coach。复核窗口 `019ff4ed-ed98-7e00-a592-6c6036a53a62`、子 Agent `019ff55e-3879-77e3-b539-b924d3fc330d` 在零改动阶段发现 shared `ProjectResponse` 与中性 restricted 投影冲突，并确认 session `created_by` 与 restricted prepare 深链旁路。
- Review finding: 复用 `ProjectResponse` 会泄露长者称呼、出生年龄、地域与创建来源；置空违反非空 DTO；直接排除又改变已冻结首页语义。普通 finalization 证据收束例外若继续复用公共 `InterviewSessionResponse`，还会把最小证据保存权限扩大成普通页面读取权。
- Options considered: 复用并清空 ProjectResponse；完全隐藏 restricted；独立最小 restricted 分支并保持 deleted/软删除/assignment 失效不可见。总控正式采用第三种。
- Adopted decision: 新增判别联合 `ProjectListProjection`、正式 session page DTO 与 `EvidenceFinalizationResponse`；restricted 分支只含 opaque project ID、固定 discriminator/status 和中性标签，无会话/统计/主动作。session cursor 签名绑定 project+created_at+id；普通 readers 要求 assignment+ordinary visibility；限制前冻结 stop 的原 actor 只走专属最小 seam。
- Implementation evidence: 同步 `03/04/05/08/09/10`、shared contracts、任务板/任务卡/追踪、CON-028、ADR-035、REV-042 与交接；无业务代码、Prisma、migration、页面或测试实现。
- Verification boundary: 候选保持 REVIEW；exact-head CI 与总控手动审查前不转 Accepted/Resolved/DONE，不恢复 A1。A1 恢复后仍须实现并测试 handler/repository/cursor/UI 与深链反例。
- Lesson: “允许把冻结证据保存完整”不是“允许继续浏览项目”。减权后的例外必须使用字段闭合的专属 DTO；否则审计字段或恢复接口很容易演变成横向权限旁路。
- Better future prompt: “为 restricted 首页定义独立判别 DTO，仅保留 opaque ID 和固定中性标签；ordinary detail 继续要求当前 assignment。若要保全撤权前已冻结证据，另设不含项目/正文/页面动作的最小 finalization seam，并以 cursor 篡改和 created_by 绕权反例验收。”

### 2026-08-12 — SPEC-DEV-008A1-ACCESS exact-head PASS 与治理收口

- Review evidence: 项目负责人正式审查 PR #33 exact head `81f0bba3d30139e458e919da969d40386231cc62` / CI `31586889712`，结论 PASS，P0/P1/P2=0；GitHub 记录为 issuecomment `5265462316`。
- Merge evidence: PR #33 merge commit `18ba7381f7ba747c2fb3beefe28297c6d063a174`；对应 main CI `31587442461` completed / success。
- Governance transition: SPEC-DEV-008A1-ACCESS REVIEW→DONE，ADR-035 Proposed→Accepted，CON-028 DECIDED→RESOLVED，DEV-008A1 BLOCKED→READY。父 DEV-008A、A2、A3、008D 保持 BLOCKED，CON-023 继续 OPEN。
- Historical boundary: DEV-008A1 唯一 Correction 与 REV-042 `PENDING` 候选历史永久保留；本次只接收 docs/shared-contract 安全接缝，不代表 A1 业务实现、Prisma/migration、页面或运行时安全回归已完成。
- Lesson: 权限收口应把“普通读取权”和“撤权前冻结证据的最小收束权”建模为字段闭合的不同 DTO；治理解锁也只能恢复直接受阻的实现切片，不能连带提升父任务或下游。

### 2026-08-12 — DEV-008A1 Home 与降权读取实现候选

- User outcome: 让倾听员登录后从唯一工作区看见当前有效 assignment 的项目和访谈，并由服务端唯一动作恢复 prepare/workbench/只读回顾壳；restricted 可理解但不泄漏，撤权前冻结证据只能在专属最小 seam 收束。
- Review mode: 复用开工前唯一 Correction，不重复启动 iteration-coach。Correction 对实现的实质影响是拒绝复用 `ProjectResponse/InterviewSessionResponse` 承载降权读：restricted 使用闭合最小投影，ordinary reader 与 `EvidenceFinalizationResponse` 分离，created_by 不成为普通授权。
- Options considered: 前端基于 completed 猜动作；普通详情接口返回后再裁字段；服务端在 formal session page 生成唯一矩阵并让 typed deep link 重新验证同一投影。采用第三种，因为授权和状态组合只能由拥有完整事实的服务端稳定解释。
- Adopted decision: project list 对 restricted 只返回固定中性标签；session page 使用 project-bound 签名 keyset cursor；Home 只消费 `home_state/primary_action/review_access`；prepare/workbench/review/save-facts 所有深链继续要求当前 ordinary access，只有原 finalization actor 可消费无项目正文/无页面动作的 evidence seam。
- Implementation evidence: A1 API、共享 Home/route shells、权限和幂等回放裁剪反例、三视口 Chromium 已形成候选；fresh PostgreSQL integration 79/79、auth 23/23，unit 309/309，普通 Chromium 13/13、auth Chromium 4/4，静态/build/smoke 全绿。
- Verification boundary: 候选保持 REVIEW，等待非 Draft PR exact-head CI 与项目负责人手动审查；不自宣 PASS/DONE/merge。A2/A3/008D、服务器删除、导出、ASR/LLM/PWA/App、QuestionEvidence/题库/AI history 未实现，CON-023 不变。
- Lesson: 幂等响应也是权限投影的一部分。即使 request identity 正确，权限在首次响应后下降时也不能原样回放更宽 DTO；必须先重新评估当前 ordinary access，再把回放裁到专属最小证据，且异步收束之后还要再次检查权限与 replay binding。
- Better future prompt: “把当前 assignment/ordinary visibility、稳定 cursor 和服务端动作矩阵作为同一 read model；所有 typed deep link 重用该投影，降权幂等回放只能缩窄不能恢复正文，并用跨项目 cursor、created_by、permission drift、restricted/deleted 和 DTO 白名单反例验收。”

### 2026-08-12 — DEV-008A1 exact-head PASS 与治理收口

- Review evidence: 项目负责人手动独立审查 PR #35 exact head `4bc1c00598801cb0d83f5da466b0c1d6514f3c74` / CI `31592543835`，正式结论 PASS，P0/P1/P2=0；GitHub 记录为 issuecomment `5266360647`。额外复核含定向 unit/component 24/24、全新 PostgreSQL 13 migrations 后 A1 集成反例 3/3 和三张 exact-candidate Chromium 截图目视检查。
- Merge evidence: PR #35 merge commit `29e3f993a65afd08cd301563d94e40cfc66076a8`；对应 main CI `31593387265` completed / success。
- Governance transition: DEV-008A1 REVIEW→DONE，DEV-008A2/A3 BLOCKED→READY，父 DEV-008A BLOCKED→IN_PROGRESS。A2/A3 已补齐 `10` §3 要求的正式任务字段，可在复用 A1 唯一 shell/routes/read model 的前提下独立并行；其 runtime 仍未实现。
- Historical boundary: REV-043 `PENDING` 候选永久保留；本 PASS 只接收 A1 runtime/UI/security seam，不代表 A2 新建入口、A3 回顾/本机副本、服务器删除、ASR、LLM、DEV-007 或产品整体完成。DEV-008D 保持 BLOCKED，CON-023 继续 OPEN / NOT IMPLEMENTED / NOT VERIFIED。
- Lesson: 下游解锁必须同时满足技术前置和治理可执行性。A1 PASS/merge 解除 A2/A3 的技术阻塞后，仍应在转 READY 前补齐正式任务字段和所有权边界；父任务进入进行中不等于任一未实现子任务已完成。
### 2026-08-12 — SPEC-DEV-008A3-PREFLIGHT finalization total bytes 接缝

- User outcome: 在不扩大 A3 产品范围的前提下，让本机副本 fresh delete preflight 能把本地 archive 与服务器权威完整性事实做机械比对，同时保持本机删除不等于服务器删除。
- Review mode: Learning mode；本契约窗口完成恰好一次独立只读 iteration-coach 复核，结论 `NO-PAUSE`。A3 原实现窗口的唯一 Correction 与零改动暂停事实保留，不重复启动实现复核。
- Review finding: `AudioObject.totalSizeBytes` 已是完整上传对象的权威 bytes 事实，但公共 `SessionFinalizationSnapshot` 缺少接缝。因本轮明确禁止修改 runtime mapper，shared TypeScript 字段须先采用 optional+nullable 兼容形态；A3 mapper 落地后 ordinary canonical GET 必须始终显式返回 key。
- Options considered: 新增 SessionFinalization Prisma 字段；让 A3 额外调用 audio manifest 接口；把现有 AudioObject bytes 窄投影到 ordinary finalization snapshot。采用第三种，避免重复存储、迁移与额外权限面。
- Adopted candidate: `total_size_bytes` 只来自同一关联 `AudioObject.totalSizeBytes`；未证明完成为 null，complete lane 为精确非负 safe integer。complete+missing/null/unsafe/不一致按 legacy/corrupt 失败关闭且不得当 0；ProjectSessionListItem 与 EvidenceFinalizationResponse 不扩字段。
- Implementation evidence: 已同步 `04/05/08/09/10`、packages/contracts、任务板/追踪/冲突、ADR-036、REV-044、任务卡与交接；未修改 service/controller/mapper、Prisma/migration、IndexedDB、页面或 A3 runtime。
- Verification boundary: 本轮仅冻结契约与测试矩阵，保持 REVIEW；A3 在 exact-head PASS/merge 前 BLOCKED。后续实现必须验证 mapper/API lifecycle 与 safe integer、ordinary auth/assignment/restricted/deleted/created_by，以及 fresh identity/count/bytes/chunk sum/checksum/local metadata 与 legacy/null 失败关闭；CON-023 不变。
- Lesson: contract-first 兼容性和最终 wire 义务可以分层表达：候选类型允许旧 mapper 暂时缺省，不代表新消费者可以把缺省视为成功。真正安全的删除前置必须把“字段存在”“来源可信”“数值可精确表达”和“本地/服务端一致”同时成立作为一个闭合谓词。
- Better future prompt: “先确认可复用的权威持久事实，再冻结 nullable lifecycle、响应白名单与 safe-integer 边界；若契约阶段不能改 mapper，明确区分 additive optional 兼容期和 runtime 必须显式发 key 的最终义务，并把 missing/null/mismatch 都写成失败关闭反例。”

### 2026-08-12 — SPEC-DEV-008A3-PREFLIGHT 最终接收与 A3 恢复 READY

- Evidence: 项目负责人对 PR #37 exact head `70167688202117364e5cab74c9a320e0a7d76742`、CI `31597563095` 手动独立审查 PASS，P0/P1/P2=0；正式评论 `issuecomment-5266978939`。PR merge `60f60cb6b5c8f70c9fca9840aa6c495f6e2318d8`，对应 main CI `31598183784` SUCCESS。
- Decision: SPEC-DEV-008A3-PREFLIGHT `DONE`、ADR-036 `Accepted`、CON-029 `RESOLVED`，DEV-008A3 `BLOCKED→READY`。父 DEV-008A 保持 `IN_PROGRESS`，DEV-008A2 保持 `READY`；DEV-008D 与 CON-023 不变。
- Verification boundary: 本次只登记已经完成的 docs/shared-contract 审查、合并与 main 集成门禁；没有修改业务 mapper/controller、Prisma/migration、IndexedDB、UI 或测试，也没有实现 A3。A3 仍须以 runtime exact-key、safe integer、ordinary 权限、fresh/legacy/null/mismatch 测试证明接缝实际输出和失败关闭。
- Lesson: 契约收口的 DONE 只解除实现前置，不可被写成下游 runtime 已完成；治理 closeout 必须同时保留候选历史、绑定 exact head/CI/merge/main CI，并明确未改变的父任务、并行任务和安全冲突。

### 2026-08-12 — DEV-008A3 回顾与本机副本实现候选

- User outcome: 倾听员在唯一工作区只读回顾已结束访谈的原始/修订转录，且仅在本机完整 archive 与最新服务器权威事实全部一致时播放或删除本机副本；任何页面文案都不能把本机清理冒充服务器隐私删除。
- Review mode: 复用本实现窗口开工前恰好一次 Correction，不重复启动 iteration-coach。该 Correction 让实现零改动暂停，直到 SPEC-DEV-008A3-PREFLIGHT/ADR-036/REV-044 正式补齐并接收 `total_size_bytes` 接缝后才从新 main 恢复。
- Options considered: 只对 manifest 与本机做比对；从服务器下载录音替代本机缺片；把 canonical session、manifest 与本机逐片事实收束为闭合 preflight。采用第三种，既不新增 API，也避免在缺片/陈旧事实下播放或删除。
- Adopted candidate: ordinary mapper 显式 exact/null key；fresh session+manifest 逐项验证 identity/count/bytes/chunk sum/checksum/metadata/Blob SHA-256；完整 archive 才创建 Object URL。IDB v5 复用 capture 共锁，并在一个事务内重检、清 current/legacy/delivery/state/jobs/reports/checkpoint、写最小回执；失败显式 abort。
- Implementation evidence: A1 唯一 shell 中完成只读回顾、容量近似、完整播放与本机删除；unit 329/329，fresh PostgreSQL integration 79/79、auth 23/23，真实 Chromium 5/5，lint/typecheck/format/build 全绿。三视口截图已目视检查。
- Verification boundary: 当前只到 REVIEW/REV-045 PENDING；非 Draft PR exact-head CI 与项目负责人手动审查尚待形成。无 server delete/deletion_request、导出、编辑、题库/AI history、ASR/LLM、A2/008D/PWA/App；CON-023 不变。
- Lesson: 原子事务的 catch 不能只等待 completion；某些同步请求异常发生在 transaction 自动 abort 之前，若不显式 `abort()`，更早的 delete 可能提交。删除安全必须用故意破坏最后写入的测试证明“前面全部恢复”，而不只是检查最终抛错。
- Better future prompt: “先以 fresh canonical session 和 manifest 闭合验证完整 archive，再持有 capture 同名 Web Lock 进入一个 readwrite transaction；事务内重检 identity/active/pending，任何同步或异步错误显式 abort，并用最后一步回执写失败证明此前所有删除回滚。”

### 2026-08-12 — DEV-008A3 删除确认文案与焦点定向修复

- Review evidence: PR #40 reviewed head `70b8fe89be9830cae5c3b493a88900eef881456e` 收到 P1=1、阻塞接收 P2=1：删除确认未完整说明审计保留/独立申请方向，alertdialog 未管理进入与关闭焦点。其余 archive/preflight/transaction 主干未发现新 P0/P1。
- Adopted fix: 常驻、确认、成功/已删除提示补齐服务器录音、转录、记忆和审计仍保留；确认层仅说明正式隐私删除需走独立申请且本页不提供，不添加链接或 deletion runtime。默认聚焦取消，Tab/Shift+Tab 留在两动作内，Escape/取消回触发按钮，成功聚焦 live 结果。
- Evidence: component 5/5、unit 330/330、真实 Chromium 6/6、lint/typecheck/format/build 通过。首次浏览器回归仅旧文案断言未同步而失败，更新期望后全部通过；受限运行环境曾让 Chromium 在启动阶段失败，权限恢复后隔离端口真实重跑通过。
- Integration boundary: 此为 A2 合入前的中间修复，不形成最终 exact-head 包。A2 closeout 后必须对齐最新 main、合并双方 route/API/styles，解决治理冲突并给 A3 重新分配唯一 review ID，再重跑完整门禁；任务继续 REVIEW、不合并。
- Lesson: 对危险确认而言，完整边界文案和焦点生命周期是同一个安全交互：默认安全动作、键盘不逃逸、取消回原触发点、成功落到结果状态，必须用真实键盘序列验证，不能只断言 dialog 存在。
### 2026-08-12 — DEV-008A2 新建访谈完整纵向入口候选

- User outcome: 倾听员从 A1 唯一工作区真正完成 project→service term→正式口头授权→session→prepare/device-check→start，而不是创建 draft 后冒充成功。
- Review mode: Learning mode；开工前恰好一次独立只读 iteration-coach 复核，结论 `NO-PAUSE`。
- Review finding: 四 create 缺 request ID 接线、服务端 authoritative replay、Prisma create identity/hash 和浏览器持久 workflow；start 缺 `mvp-v1` version gate。这些均是 REV-041/ADR-034 已接收契约的实现缺口，不需要新公共设计。CON-012 通过一次授权一个新音频对象规避，不裁决跨版本复用。
- Adopted decision: request ID/payload/step 在首次 fetch 前写入 actor-bound IndexedDB；服务端 request lock 后校验 actor/action/target-or-create-identity/hash，再做 project/session resource lock并同事务提交业务、历史/assignment、audit、response snapshot。普通 UI 只走 fresh complete `recorded_verbal/mvp-v1`，start 对版本/撤权/assignment drift 失败关闭。
- Implementation evidence: fresh PostgreSQL 14 migrations、integration 80/80、unit 316/316、真实 auth Chromium 5/5、新入口 Chromium 4/4，三视口与 accessibility/overflow 证据全绿；REV-045 候选保持 REVIEW。实现期间 main 的 A3 前置契约占用 REV-044，本候选按全局序号顺延，不改变产品实现。
- Lesson: “先持久化再联网”不仅是生成 UUID 的顺序，还要求动作锁在持久化之前接管，否则极窄双击窗口仍可能让本地权威记录与实际首个 POST 分叉。授权音频恢复同理：未冻结 job 可续录，已冻结 job 只能重放保存，不得追加新内容。
- Better future prompt: “为每个 create 把 pre-network durable identity、payload freeze、unknown-only replay、server binding 和 response ACK 写成同一个状态机；把 UI 双击锁放在持久化之前，并明确 frozen audio job 只能继续保存，不能重新录制。”
- Verification boundary: 当前只请求 exact-head 手动审查，不自宣 PASS/DONE/merge；不关闭真实授权文本、真实 PII/试点、服务器删除、A3、ASR/LLM/PWA 等后续门禁。

### 2026-08-12 — DEV-008A2 授权录音离页释放 P1 定向修复

- Review evidence: PR #39 old exact head `d240afd31bc94015e10b01b179550088ed85083d` / CI `31600521245` 自动门禁全绿，但独立审查仍发现 P1：SPA 离开 consent_audio 页面不会自动触发整页卸载，旧 cleanup 只清引用，MediaRecorder/MediaStream 可能继续占用麦克风。
- Correction: 沿用本物质迭代已执行的唯一只读复核，不重复 iteration-coach。为 capture 增加可等待、幂等 dispose；显式返回先释放再导航，unmount 是第二防线，listener 与所有异步消息均受 mounted guard；dispose 后实例不可复用。
- Data boundary: 离页停止只把 MediaRecorder 的最终 dataavailable 写入既有可靠暂存；不 freeze/upload/complete、不删除分片、不更换 job/request identity。重进继续同一 `expectedChunkCount=null` job。
- Verification evidence: 定向 unit/component 5/5、全量 unit 319/319、新入口 Chromium 5/5、普通 Chromium 全套 18/18、smoke 通过；真实浏览器直接验证 recorder inactive、所有 track ended、单一 job 与已有 archive 分片保持。静态、lint、typecheck、build、diff 全绿。
- Lesson: SPA 页面所有权结束不是浏览器采集生命周期结束；涉及麦克风的 controller 必须显式拥有“可等待释放”契约，用户导航与组件卸载都调用同一路径，同时把采集停止与业务 complete 严格分开。
- Verification boundary: old head 的 REQUEST_CHANGES/P1=1 永久保留；当前仍是定向修复候选，保持 REVIEW，等待新 exact-head CI 与外部复审，不扩 A3/008D/导出/ASR/LLM/PWA。

### 2026-08-12 — DEV-008A2 StrictMode adjacent P1 再修复

- Review evidence: 中间 head `cce98c8f1be3e92cd6c776d49c5cc747252b7579` / CI `31606714871` SUCCESS 已释放离页麦克风，但定向复审指出 React `<StrictMode>` 会 setup→cleanup→setup；`mounted` 仅初始化为 true 且 cleanup 置 false，第二次 setup 后所有 guarded state update 会被永久抑制。
- Correction: lifecycle effect 每次 setup 显式恢复 `mounted.current=true`；cleanup 仍负责 false、dispose 与 unsubscribe。没有改变录音 job、业务 complete、API/DTO/Prisma 或导航语义。
- Verification evidence: StrictMode 包裹的 component 回归实际推进 project→service term→consent audio，并验证 busy 复位、录音 snapshot 与说明消息继续更新；定向 suite 6/6，原麦克风释放与同一 job 恢复证据保留。
- Lesson: `isMounted` ref 不是一次性构造状态，而是 effect lifecycle 状态；在 StrictMode 下 setup 与 cleanup 必须对称写入，测试也必须让组件经过开发模式的双调用路径。
- Verification boundary: `d240afd3` 原 P1 与 `cce98c8f` adjacent P1 均永久保留；当前仍 REVIEW，等待再修复 exact-head CI/复审，不自宣关闭或合并。
- CI failure history: StrictMode 修复 head `ef85c3b` 的 CI `31607585915` 在既有 native MediaRecorder audio-buffer 用例首次分片读取为 0，普通 E2E 17/18；其余到 smoke 的全部门禁成功。本地该文件双 worker repeat 9/9，新增 P1 用例未失败；不为清绿修改产品或测试目标，以新 exact head 重跑完整门禁。

### 2026-08-12 — DEV-008A2 exact-head 接收与治理收口

- Evidence: PR #39 accepted exact head `1ad334de678b242fa0eb3e399af9138053ac251f`、CI `31608031668` SUCCESS；获授权总控手动审查 PASS，P0/P1/P2=0，正式评论 `issuecomment-5268364704`。PR 以 merge commit `7c32760fd9a128ece2e7ecffd35d2941a6ccfece` 合入 main，main CI `31609156286` SUCCESS。
- Decision: DEV-008A2 `REVIEW→DONE`；父 DEV-008A 保持 `IN_PROGRESS`。REV-045 唯一归属 A2；A3 分支临时同号修正为主线 REV-046，A3 保持 `REVIEW` 并等待基于新 main 整合。DEV-008D 与 CON-023 不变。
- Verification boundary: `d240afd3` REQUEST_CHANGES/麦克风释放 P1、`cce98c8f` StrictMode adjacent P1、`ef85c3b` / CI `31607585915` audio-buffer flake 永久保留；最终 PASS 不覆盖失败历史。本 closeout 不改业务代码、Prisma/migration、A3 实现、ASR、DEV-007 或 DEV-008D，也不替 A3 或父任务给出 PASS/DONE。
- Lesson: 并行分支的临时审查编号必须按实际先合入顺序在主线唯一化；修正编号只改变治理引用，不得改写另一路分支的审查意见或实现事实。

### 2026-08-12 — DEV-008A3 final main 整合候选

- Integration: 以 `origin/main@5035c119fa5a3eeb7999d305f5c052672dc50d25` 为最终 base，逐块合并并同时保留 A2 NewInterviewApi/new route/consent lifecycle 与 A3 ReviewApi/review route/local archive/styles；A2 继续 REV-045 DONE，A3 唯一 REV-046 REVIEW。
- Accessibility/privacy: 非 inert 背景不宣称 modal，因此删除 `aria-modal=true`；保留 alertdialog、安全默认焦点、键盘循环、关闭/成功焦点生命周期。确认文案完整列出服务器录音、转录、记忆与审计保留，并只指向本页未实现的独立隐私删除申请流程边界。
- Evidence: fresh 14 migrations/status、integration 80/80、auth 23/23；unit 341/341、Schema 1/1；普通 Chromium 24/24（A2 新入口 5/5、A3 回顾 6/6）与 fresh auth Chromium 5/5；format/lint/typecheck/build 全绿。
- Failure history: client generate、失效 import、三次 DB 编排参数错误与一次 auth 固定代理端口错误均先失败后按正式配置重跑；所有临时库均删除，没有放宽测试或产品边界。
- Boundary: `70b8fe8` REQUEST_CHANGES P1=1/P2=1 与 `f491d99` 中间修复/CI 历史永久保留。本候选仍是 REVIEW，不自行 PASS/DONE/merge；server deletion/008D/deletion_request、CON-023、导出、编辑、ASR/LLM、题库/AI history 与 PWA/App 均不变。

### 2026-08-12 — DEV-008A3 exact-head 接收与网页 A 范围收口

- Evidence: PR #40 accepted exact head `93be9a27b93e763e56457668c78b5ac2a332bab4`、CI `31612276827` SUCCESS；项目负责人授权总控 exact-head 审查 PASS，P0/P1/P2=0，正式评论 `issuecomment-5268932084`。PR 以非 squash merge commit `d2a911d3fd4362a84653c1401c4c23b8c5b4aafe` 合入 main，main CI `31613083916` SUCCESS。
- Decision: DEV-008A3 `REVIEW→DONE`；A1/A2/A3 均 DONE 后，父 DEV-008A 仅在统一倾听员响应式网页 A 范围 `IN_PROGRESS→DONE`。DEV-008D 保持 `BLOCKED`，CON-023 继续 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`。
- Historical integrity: reviewed head `70b8fe89be9830cae5c3b493a88900eef881456e` 的 REQUEST_CHANGES/P1=1/P2=1 与 `f491d99` 中间修复 / CI `31606148505` 永久保留，不被最终 PASS 覆盖。
- Verification boundary: 本 closeout 只修改治理文档，不改业务代码、Prisma/migration、ASR、DEV-007 或 DEV-008D；不宣称 server deletion/deletion_request、导出、PWA/App、真实 ASR/LLM、正式题库、真实试点或 MVP 发布完成。
- Lesson: 父任务聚合 DONE 必须显式限定到已经逐子任务 exact-head 接收的产品范围；相邻真实试点门禁即使在同一 Epic，也不能因网页切片完成而被隐式关闭。

### 2026-08-13 — DEV-008A4 首次访谈主链路整合启动

- User outcome: 普通倾听员不再填写固定服务价格；先在当前页面确认麦克风再录口头授权；授权后建立正式录音/ASR并完成独立校准；结束后自动收尾，raw archive 完整即使 ASR 降级也可回顾播放或只删本机副本。
- Review mode: 本轮按 iteration-coach 执行恰好一次独立只读复核，结果 `Correction / NO-PAUSE`。复核确认这是 contract-first 跨层重构，不是文案补丁；工作树在复核结束时仍无改动。
- Facts: ServiceTerm 同时阻塞 refreshReady/start/capture current gate；旧 device_check 会被页面 load 直接投影为 passed；普通 transcript query 未过滤 calibration；stop 后 formal job 为 uploading 且 complete ACK 未写回 complete；A3 因此判 activeOrDirty。
- Adopted decision: ADR-037 / DEV-008A4 / REV-047 冻结 `project→early session→current-page mic→consent→formal start/stream→dedicated calibration→workbench→automatic closeout→completed/review`。保留 ServiceTerm API/表/历史 dormant，不做 migration；普通正文双层过滤 calibration；controller 负责 exact ACK 后 local complete；回顾只做不放宽门禁的有界重投影。
- Risk controls: 当前页 mic passed 不持久化；校准失败/不可用不伪成功且不阻塞 raw recording；automatic closeout 使用稳定 ID、单 in-flight 和状态水位；mismatch/unknown/本机写失败绝不标 complete；CON-023/DEV-008D/local-delete≠server-delete 不变。
- Verification boundary: 当前仅完成正式契约与治理候选，任务保持 REVIEW。实现、全量门禁、真实 Chromium、non-Draft PR 与 exact-head CI 尚待完成；执行 Agent 不得自行 PASS/DONE/merge。
- Lesson: 跨页面“已检查”状态与服务端业务状态不是同一事实；当安全要求依赖当前设备与当前页面时，持久状态只能证明历史动作，不能替代本次本地重新取证。

### 2026-08-13 — DEV-008A4 校准边界与完成投影定向修正

- Review correction: degraded 按钮不能只做 local dismiss；已有 collecting attempt 必须经 server skip marker 收束。revision 相等过滤无法阻止更高 revision 的迟到校准 interim。completed 不能只是工作台内可收起 panel。
- Adopted boundary: 已有 attempt 以 payload-stable request ID 调用 `resolveSpeakerCalibration(action=skip)`；无 attempt + provider unavailable 才本地 bypass，auth/permission 错误不提供越过。WS interim 增加服务端按持久 attempt 时间区间分类的 `content_kind`，UI 只显示 conversation。completed 切换为无 workbench/transcript/suggestion DOM 的独立页并聚焦标题。
- Verification evidence: format/lint/typecheck/build/diff 通过，full unit `56 files / 339 tests` 通过。本地 Chromium 在 launch 阶段 `spawn EPERM`，Docker API/DB URL 不可用；这些门禁保留给 exact-head CI，未改测试目标。
- Lesson: 校准边界必须由 provider stream 与服务端时间证据表达，不能由 UI 的“刚点了跳过”或当前 revision 猜测；临时事件不落库也仍需要权威内容类型。完成态的独立性要用 DOM 排除而不是视觉遮盖来证明。

### 2026-08-13 — DEV-008A4 initial exact-head CI 夹具修正

- Failure evidence: PR #44 initial head `a26a5230f9d50d28633aee528fb7eeb79e842528` / CI `31665010283` 在 static、unit、fresh migration deploy/status 成功后，于 integration 80/82 失败；后续 auth/build/smoke/Chromium 按工作流跳过。迟到 interim 测试用随机 generation/audio ID 违反真实外键；旧 calibration API 测试仍期望 ordinary transcript 返回校准证据。
- Correction: 测试夹具构造真实 AudioObject/SessionCaptureGeneration/SpeakerStream 复合身份；API 用例同时断言数据库仍保留 4 条原始 final（含 2 条 `speaker_calibration`），而普通 transcript 只投影 2 条 `conversation`。产品代码、过滤规则和测试目标均未放宽。
- Verification boundary: 修复后本地 format/lint/typecheck/diff 与 full unit `56 files / 339 tests` 通过；fresh PostgreSQL integration 及后续完整门禁必须由新 exact-head CI 重跑。任务继续 REVIEW，失败 head/CI 永久保留，不自宣 PASS/DONE/merge。
- Second failure evidence: head `13079c6d9b1d700425105ac5188d1350a2478ea7` / CI `31665356601` 的 integration 仍为 80/82；全局 generation 夹具占用 session 唯一 interview audio object，相同 `start_ms` 的正文则不保证写入顺序。generation 改为用例内局部创建；正文同时验证集合完整和正式 `start_ms,id` 排序。测试 fixture 应满足整套 schema 不变量，等时间戳数据必须按公开排序键而非插入偶然性断言。
- Local retry evidence: 二次修复后首次 full unit 的既有工作台 401 异步用例等待超时（338/339），未修改该测试或产品；定向立即复跑 1/1、随后 full unit 339/339 与 build 均通过。exact-head CI 仍是最终门禁，局部时序波动必须保留事实而不能用放宽断言消失。
- Browser CI evidence: head `cfffa8b5e5b1e1d15609ccc54438b1652bd7f88d` / CI `31665661744` 首次让 fresh integration 82/82、auth、build、smoke 全绿，普通 Chromium 19/24；失败的 3 个 Home 视口仍找旧提示，2 个 workbench 测试仍走无 session 旧准备页/后置 mic，并把独立校准与普通工作台并存。E2E 改为 current copy/no-price、session-specific recovery start、校准态排除普通 transcript/workbench、确认后进入正文；测试必须描述正式路径，不能让旧入口偶然继续存在来维持绿色。
- Auth Chromium evidence: head `676a21d993676b9d97287b48aed1938d92b0ce3f` / CI `31666253024` 的 ordinary Chromium 24/24、auth Chromium 4/5。版本用例把无效 `mvp-v2` 当首份授权，实际测试的是 draft project，不是 consent drift；且仍造 0 超时价 ServiceTerm。夹具改为无 ServiceTerm、先有效 `mvp-v1` ready 后追加 `mvp-v2`，才准确验证 start 重验授权版本并返回 `CONSENT_REQUIRED`。

### 2026-08-14 — SPEC-CONTINUING-CONSENT-001 exact-head 接收与治理收口

- Evidence: PR #49 old exact head `4095e570d17d8ecae94d630d62bca9ab0205917d` / CI `31762375878` 获项目负责人 REQUEST_CHANGES（P0=0/P1=3/P2=0）；accepted exact head `1d241a4b8c40827a93eefe1c9825021b6859df74` / CI `31764584701` 关闭三项 P1并获正式 PASS（P0/P1/P2=0），评论 `issuecomment-5288833214`。PR merge `712b4ff46acbff5168453c79b2d02375a84fa017`，main CI `31764903272` SUCCESS。
- Decision: SPEC-CONTINUING-CONSENT-001 `REVIEW→DONE`、ADR-039 `Proposed→Accepted`、CON-012 `DECIDED→RESOLVED`。DEV-008B1 `BLOCKED→READY` 仅表示 fail-closed runtime implementation-ready；DEV-008B2 不再等待本 SPEC，但因 B1 runtime 未实现继续 `BLOCKED`。
- Historical integrity: old head 的 REQUEST_CHANGES/P1=3 与修复内容永久保留。契约接收不使真实 `covered` 自动可达；BLOCKED 的 SPEC-CONSENT-TEXT-POLICY-001 仍要求有权主体提供并正式接收正文、版本/digest 与 machine policy。
- Verification boundary: 本 closeout 只修改治理文档和 journal，不改业务代码、shared contract、Prisma/migration、页面、ASR/LLM、删除或部署；不启动 B1/B2，不撰写或批准正式授权正文，也不宣称真实持续授权、真实 provider 或真实试点可用。

### 2026-08-15 — PR #54/#55 联合治理收口

- Evidence: PR #54 old `195c4be2c4cd9277036e6a8759ab15e00e984a61` / CI `31798730203` 的 REQUEST_CHANGES（P0=0/P1=1/P2=0）永久保留；accepted `64cf94f33c957dc1a1ff74cbf49e35bd1c44698b` / CI `31808762082` 获项目负责人 PASS（P0/P1/P2=0），merge `751a32e1ffbae12ec639230cd3bf8482d1ff2820` / main CI `31815415871` SUCCESS。PR #55 content `01018376002b475fd7715ca9b3cb8ee6333a3a72` / CI `31798421917` 与 integration `d67dd12de5010f49e5ad97733a9c33aecea0c5c5` / CI `31816652463` 均获 PASS（P0/P1/P2=0），merge/main `8bcf65b2575841277ca7f885cdb783d57494b01e` / main CI `31817732960` SUCCESS。
- Decision: SPEC-STAGING-DEPLOY-001 `REVIEW→DONE`、ADR-041 `Proposed→Accepted`、REQ-020 契约完成；SEC-AUTH-PUBLIC-001 `REVIEW→DONE`、canonical ADR-042 `Proposed→Accepted`、CON-008 `REOPENED→RESOLVED`、DEV-001B 在应用身份/会话基础范围 `REVIEW→DONE`。REV-052/053 与 branch-local ADR-041 alias 只唯一化治理引用，不改写旧提交或审查事实。
- Remaining boundary: DEV-STAGING-DEPLOY-001 继续 `BLOCKED`。当前没有 Cloudflare/Windows 公网部署，trusted ingress/proxy/header/hop/origin 防直连、Tunnel/Access、进程守护、备份恢复与监控仍未实现；SEC runtime 继续 direct peer 并忽略转发 header。
- Data boundary: `data_mode=synthetic_only` 继续是唯一 machine authority；真实长者/访谈/PII/录音/转录/业务数据库/备份即使去标识或脱敏仍禁止，provenance 不明同样在 connect/upload/persist 前零业务副作用拒绝。开启真实数据必须新任务、数据治理决定、新版 machine contract 与项目负责人正式接收。
- Verification boundary: 本 closeout 只修改治理文档和 journal，不改 apps/packages/contracts/migrations/dependencies，不部署、不请求 token/secret、不清除任何失败或审查历史。
- Local validation history: 切换到 #55 合入后的 main 后，首次 `pnpm typecheck` 因工作区 Prisma generated client 仍是旧枚举而拒绝 schema 已有的 `anonymous` actor；未改代码、schema、migration、依赖或测试，执行仓库既有 `pnpm db:generate` 刷新未跟踪生成物后，原样重跑 lint/typecheck/unit 382/382/build/audit 全部 PASS。首次失败永久保留。

### 2026-08-15 — DEV-008B2 exact-head 接收与治理收口

- Evidence: PR #56 accepted exact head `90ce5b35ebe032931860045da5b63e97b2df3674` / CI `31820768146` SUCCESS；项目负责人临时授权总控独立定向复审正式 PASS（P0/P1/P2=0），评论 `issuecomment-5295947362`。PR merge `4b59c4d351d82e84ed88610cd0678b4882d84dab`，main CI `31821662034` SUCCESS。
- Decision: DEV-008B2 `REVIEW→DONE`，仅接收 REV-054（branch-local REV-052）内 completed 后双 lane、current-stream gate、权威 Context、restart orphan terminalization、late writeback 失效与 opening exact-once 的 fail-closed/provider-neutral/local-test seam 范围。
- Historical integrity: old `0e703af` / CI `31800324817` / REQUEST_CHANGES P1=3、`996994f` / CI `31812498482` / REQUEST_CHANGES P1=1，以及交接中的共享库污染、fixture residue、Prisma generate、时序 warning 等失败历史永久保留。
- Parent/dependency audit: 仓库没有 canonical DEV-008B 父任务，不新增治理实体；历史 DEV-008 继续 `CANCELLED`，DEV-008A 继续网页 A 范围 `DONE`，DEV-008D 与 SPEC-CONSENT-TEXT-POLICY-001 继续 `BLOCKED`。真实 continuing-consent `covered` 仍不可达。
- Verification boundary: 本 closeout 只修改 board/trace/review/task/handoff/index/journal，不改 apps/packages/contracts/schema/migrations/dependencies，不宣称真实 LLM/provider、正式授权正文、真实数据、公网部署或真实试点完成，也不启动 #57。
- Command history: 一次只读 parent/status/handoff 机械核对组合命令已输出所需证据但进程返回 exit 1；该命令未修改文件。随后用更窄的只读命令复核出同一结论，未因此暂停、放宽或扩大任何任务状态。

### 2026-08-15 — DEV-ASR-PROVIDER-001 exact-head 接收与治理收口

- Evidence: accepted content `5271b52bc7149a5b716d97df0dc6a5204aae397c` / CI `31800257197` 的项目负责人 PASS 永久保留；latest-main integration `27f1c84968fc3fb3482f830b0b07abd371959b57` / CI `31824839261` 获正式窄复审 PASS（P0/P1/P2=0），评论 `issuecomment-5296422732`；implementation merge/main `dd45f5e0f8cc24b764830b596f9a7c59fcc62e75` / CI `31825548551` SUCCESS。
- Decision: DEV-ASR-PROVIDER-001 `REVIEW→DONE`，仅接收 REV-055 记录的工程实现与既有虚构证据。该结论只解除 DEV-LLM-PROVIDER-001 的 ASR 工程依赖；真实 LLM 仍受 provider/model/region/data-policy、DPA/retention/training/跨境与重授权、secret、exact pins/migration/provenance、完整验证和独立审查门禁。
- Historical integrity: old accepted content、latest-main integration 与 merge/main 三层事实独立保留；更旧 `af99d9129c74e7db5b877aeef43f6d99f248b50c` 继续独占 provider/replay/desktop/Android 虚构实证，不冒充当前 fresh evidence。全部旧失败与审查历史不改写。
- Remaining boundary: actual billing/SKU unknown，历史约 2403 秒/CNY 0.668 只是估算；CON-027 继续 OPEN。真实长者、PII、真实数据、公网、生产部署与生产试点继续禁止。
- Verification boundary: 本 closeout 只修改 board/trace/task/handoff/review/index/journal，不改 apps/packages/contracts/schema/migrations/dependencies，不连接腾讯、不上传 PCM、不产生新 provider 费用。沿用本任务开工前已完成的唯一 iteration-coach 只读复核，不启动第二次。
- Local validation history: 首轮 full unit 为 407/408，既有 `workbench-shell` completed 标题焦点断言读取时 activeElement 仍为 body；未改产品或测试。原样定向复跑 39/39、随后 full unit 408/408 PASS；format、lint、typecheck、build、diff-check 均 PASS。首轮失败永久保留，exact-head CI 仍为最终门禁。
