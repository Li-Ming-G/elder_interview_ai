# 冲突与待确认问题日志

## 文件用途

本文件记录正式文档之间的矛盾、无法由执行 Agent 自行决定的问题，以及最终决策和需要同步修改的文件。

## 已登记事项

### CON-001｜文档基线状态缺少验收证据

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：总控 Agent
- 涉及文件与章节：`docs/agent/00-task-board.md`、`docs/agent/04-review-report.md`、`10-研发协作与交接规范.md`
- 冲突内容：`DOC-001` 被标为 `DONE`，但审查报告明确没有独立审查或其他验收结论。
- 受影响任务：`DOC-001`、`DEV-001` 及全部下游任务。
- 处理：将 `DOC-001` 回退为 `BLOCKED`，在文档一致性问题闭合前不再以其解锁开发。
- 完成确认：任务看板已同步。

### CON-002｜审查责任规则不一致

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：总控 Agent
- 涉及文件与章节：用户本轮总控授权、`AGENTS.md`、`09-测试与验收规范.md`、`10-研发协作与交接规范.md`
- 冲突内容：原规范要求所有任务一律独立验收；项目负责人本轮明确要求按风险决定，低风险文档、格式、简单配置和局部修改通常由总控自检。
- 最终决定：采用风险分级；高风险任务和 MVP 发布仍必须独立审查或验收。
- 完成确认：三份治理文档已同步。

### CON-003｜推荐技术栈不足以支撑 DEV-001 开工

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：总控 Agent
- 涉及文件与章节：`02-项目开发规范.md` 第 3、4 节，`docs/agent/tasks/DEV-001.md`
- 冲突内容：`02` 将技术栈和 pnpm workspace 表述为“推荐”，但原任务板把 `DEV-001` 标为可执行；Node/pnpm 版本、ORM、测试工具、CI 和认证方式没有正式决定。
- 受影响任务：`DEV-001` 及所有开发任务。
- 最终决定：采用 Node 24.18、pnpm 11.15 workspace、Prisma 7/PostgreSQL、Vitest/Supertest/React Testing Library/Playwright、服务端不透明会话；production 本地身份由受控交互式运维 CLI 提供创建、重置、停用和启用，登录使用会话绑定 CSRF、Origin 校验和数据库限流；Redis/BullMQ/Nginx 延后。DEV-001 拆为 `DEV-001A` 工具链和 `DEV-001B` 身份权限两个串行任务。
- 需要同步修改的文件：`02`、`04`、`05`、`08`、`09`、ADR、任务板、任务卡、追踪和交接。
- 完成确认：正式文件已写回，REV-003 独立审查 PASS。

### CON-004｜敏感/禁止追问内容的 AI 上下文语义冲突

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：总控 Agent
- 涉及文件与章节：`03-业务流程与交互规范.md` 第 10 节、`07-AI访谈引擎规范.md` 第 3、5 节、`08-安全隐私与数据治理.md` 第 11 节
- 冲突内容：`08` 将 `sensitive`、`restricted`、`do_not_ask` 一并规定为“不进入普通 AI 上下文”；`07` 又要求把“不再追问边界”作为 AI 上下文最高优先级。若完全排除 `do_not_ask`，AI 无法可靠避免再次推荐；`03` 对 `sensitive` 仅要求谨慎处理，也未明确等同 `restricted`。
- 受影响任务：`DEV-005` 至 `DEV-008`，尤其上下文构建、标记和导出过滤。
- 最终决定：`sensitive` 是谨慎处理，`restricted` 是内容使用限制，`do_not_ask` 是追问行为边界，`deletion_request` 是删除工作流信号。AI 使用“本地策略状态—最小控制信封—许可内容上下文”三层边界，输入和输出均由服务端过滤；失败时返回“继续倾听”。
- 兼容性影响：不新增 marker 枚举；正式定义 `do_not_ask.note` 为人工确认的最小禁区描述；AI 候选使用独立 `boundary_candidate`，不等于正式 marker；补齐 `deletion_request`、幂等 transition、scope 限制及 ordinary/restricted 导出模式。
- 需要同步修改的文件：`03`、`04`、`05`、`07`、`08`、`09`、ADR、追踪和交接。
- 完成确认：正式文件已写回，REV-003 独立审查 PASS。

### CON-005｜路线依赖与任务板依赖不一致

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：总控 Agent
- 涉及文件与章节：`10-研发协作与交接规范.md` 第 5 节、`docs/agent/00-task-board.md`
- 冲突内容：`10` 规定 E 依赖 C、D，G 依赖 B、C、E；任务板中 `DEV-006` 只依赖 `DEV-004`，`DEV-008` 只依赖 `DEV-002`、`DEV-006`。两者会给出不同的并行和解锁结论。
- 受影响任务：`DEV-006`、`DEV-008` 及并行开发安排。
- 最终决定：`DEV-006` 后端依赖 `DEV-004` 的确定态转录和已批准边界契约，不硬依赖 `DEV-005` 完整 UI；未拆分的 `DEV-008` 包含回顾 UI，因此依赖 `DEV-002`、`DEV-003`、`DEV-004`、`DEV-005`、`DEV-006`、`DEV-007`，开工前优先拆为回顾/导出/删除子任务。
- 需要同步修改的文件：`10`、任务板、后续任务卡和追踪。
- 完成确认：正式文件已写回，REV-003 独立审查 PASS。

### CON-006｜备份延迟清理缺少后续状态与重试契约

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：独立审查 Agent（REV-003）
- 涉及文件与章节：`04` §4.18、`08` §14、`09` §8.2
- 冲突内容：当前只定义 `scheduled`/`not_applicable` 的完成前登记，没有备份清理后续完成、失败、重试和审计状态。
- 受影响任务：`DEV-008`；不阻塞 `DEV-001A/B`。
- 临时处理：`DEV-008` 保持 BLOCKED，开工前补正式状态机和测试。
- 需要谁决策：总控 Agent + DEV-008 数据治理实现/审查角色。
- 索引纠偏（2026-08-12）：本记录早已标记 `RESOLVED`，但 `02-open-conflicts.md` 仍误列为 OPEN；本轮只修正动态索引，不改写旧发现和临时处理历史。正式服务器备份清理义务转由 DEV-008D 承接；本机浏览器副本删除没有备份状态，也不重新打开或替代本冲突。

### CON-007｜删除范围摘要密钥缺少版本与轮换策略

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：独立审查 Agent（REV-003）
- 涉及文件与章节：`02` §3.5、`04` §4.18、`08` §14
- 冲突内容：已定义独立 `DELETION_AUDIT_PEPPER`，但尚未定义密钥版本、轮换和历史摘要验证策略。
- 受影响任务：`DEV-008`；不阻塞 `DEV-001A/B`。
- 临时处理：不得在 DEV-008 实现中自行猜测；开工前形成 ADR、配置和迁移/验证规则。
- 需要谁决策：总控 Agent + 安全/数据治理审查角色。
- 索引纠偏（2026-08-12）：本记录早已标记 `RESOLVED`，但 `02-open-conflicts.md` 仍误列为 OPEN；本轮只修正动态索引，不改写旧历史。正式服务器删除摘要/轮换义务转由 DEV-008D 承接；本机最小删除回执不是 deletion audit、不使用服务端 pepper，也不重新打开或替代本冲突。

### CON-008｜未知账号登录失败缺少合法审计 actor 表达

- 状态：`RESOLVED`
- 发现时间：2026-08-02
- 发现者：DEV-001B 身份安全实现 Agent
- 涉及文件与章节：`04` §4.17、`08` §15、`DEV-001B`
- 冲突内容：`08` 要求至少记录登录失败，但 `04.audit_log.actor_type` 仅允许 `user` 或 `system_operator`；普通应用操作要求 `user` 必须关联正式 `actor_id`，`system_operator` 又明确限定为 production 运维 CLI。账号不存在的登录失败没有合法 actor 可写入正式审计表。
- 受影响任务：`DEV-001B` 最终 `DONE`、真实身份部署和真实试点安全验收；不阻塞密码、会话、限流、Origin/CSRF、CLI、已知用户路径，亦不阻塞使用显式虚构身份的本地内部原型。
- 临时处理：未知账号与错误密码继续统一返回 `INVALID_CREDENTIALS`，使用不含邮箱/IP 原文的持久化限流摘要保护；不得把限流记录或普通技术日志冒充正式审计完成。DEV-001B 保持 `REVIEW`。探索期只使用显式虚构身份且不对公网开放；进入真实身份或真实试点前必须解决本冲突并通过独立复审。
- 候选方案：A）为应用匿名安全事件增加正式 actor 类型；B）允许 `user` actor 在特定认证失败事件中 `actor_id=null` 并用不可逆主体摘要；C）建立独立 security_event 载体。三者均涉及正式数据模型与安全契约，未经批准不得实施。
- 需要谁决策：总控 Agent + 项目负责人/独立安全审查角色。

### CON-009｜最小项目、授权与会话 API 缺少关键业务契约

- 状态：`RESOLVED`
- 发现时间：2026-08-03
- 发现者：DEV-002 后端业务 Agent
- 涉及文件与章节：`01` §5/§7/§9、`03` §4-6、`04` §4.2-4.6、`05` §3.1-3.5、`DEV-002`
- 冲突内容：`04.consent_record` 定义了 `consent_type` 但没有合法值；`05` 只列项目、assignment、服务、授权、会话路径，未定义创建/响应 DTO；正式文档也未明确项目创建者是否自动获得 interviewer assignment。若直接实现，会静默决定核心授权模型、资源归属和跨模块 API。
- 已澄清部分：`05` 把创建会话与 `/start` 分为两个接口，且 `01`/`03` 只禁止未确认服务与授权时“开始正式访谈”，因此 draft session 可创建，启动必须拒绝；已据此纠正任务卡，不构成新增产品决定。
- 受影响任务：阻塞 DEV-002 的正式迁移、授权/assignment 行为和公开 REST DTO；不阻塞纯领域/仓储端口、访问拒绝策略和不固化未决枚举/接口的测试骨架；不影响 DEV-003A。
- 临时处理：在项目负责人决定前，DEV-002 只提交合同中立策略 `1085ae6`，未形成迁移/API 既成事实。
- 候选方案：A）一次口头授权作为 `recording_transcription_ai` 捆绑记录，项目创建者自动获得 interviewer assignment；B）录音、转录、AI 分析三类独立授权，start 要求三者均 valid，项目创建者自动 assignment；C）项目创建与 assignment 完全分离，仅管理员先分配后倾听员可访问。DTO 无论选择哪项，都应按现有 snake_case 约定明确最小必填字段和响应。
- 推荐：探索期优先 A，最符合 `03` 单次固定文本口头授权流程且最小；若产品确实需要分别同意/撤回三种处理，则选择 B。C 会破坏倾听员新建项目的当前主流程，不推荐。
- 最终决定：项目负责人于 2026-08-03 选择方案 A。`consent_type=recording_transcription_ai` 作为一次捆绑授权；倾听员创建项目时在同一事务自动获得 `interviewer` assignment，但 `created_by` 本身不产生访问权；draft session 可先创建，`/start` 必须重新验证 assignment、服务说明、有效捆绑授权和设备检查。最小 snake_case DTO 已写入 `05`。
- 需要同步修改的文件：`04`、`05`、ADR-014、任务板、DEV-002 任务卡、追溯和交接。
- 完成确认：正式契约已写回；DEV-002 可恢复实现。真实口头授权音频仍由后续音频集成和真实试点门禁验证。

### CON-010｜口头授权音频缺少可验证的项目对象关系

- 状态：`RESOLVED`
- 发现时间：2026-08-03
- 发现者：DEV-002 后端业务 Agent
- 涉及文件与章节：`03` §6.2、`04` §4.5、`05` §3.4、`06`、DEV-002/DEV-003B
- 冲突内容：正式契约要求 `recorded_verbal` 的 `consent_audio_object_id` 已属于当前项目且可靠保存，但 `04` 尚无授权音频对象实体/关系，DEV-003B 也尚未提供可查询对象 seam。只校验 UUID 格式会把未保存或跨项目对象伪装成合规授权。
- 受影响任务：阻塞 recorded_verbal 正式实现、DEV-003B 授权音频集成和真实试点；不阻塞只使用虚构数据及 `electronic|written` 的内部纵向原型。
- 临时处理：DEV-002 对 `recorded_verbal` 失败关闭并返回稳定 `CONSENT_AUDIO_NOT_VERIFIED`；不得创建 `valid` 授权。`electronic|written` 仅限内部虚构数据，不能作为真实试点证据。
- 候选方案：DEV-003B 开工时明确授权音频与普通 session audio 的对象模型、project 归属、checksum/manifest 和可靠保存查询 seam，再由 DEV-002 接入同事务授权校验。
- 需要谁决策：总控 Agent + DEV-003B 后端音频实现/审查角色；真实试点前必须解决。
- 最终决定：新增项目级 `audio_object` 聚合，以 `purpose=consent|interview` 区分用途；`audio_chunk` 改为归属 audio object。consent 对象不绑定 session，可在正式访谈 start 前保存；interview 对象必须绑定同项目且处于允许录音状态的 session。两者共享不可变分片、checksum、幂等、私有保存和 manifest，但不能互相冒充。
- 需要同步修改的文件：`04`、`05`、`06`、ADR-016、DEV-003B、任务板、追溯和交接。
- 完成确认：正式契约已写回，DEV-003B 可进入实现；`recorded_verbal` 仍必须等对象 complete 且存储复核通过才可创建 valid 授权。

### CON-011｜高风险任务审查角色与 GitHub 人工审查流程不一致

- 状态：`RESOLVED`
- 发现时间：2026-08-04
- 发现者：总控 Agent / iteration-coach 只读复核
- 涉及文件与章节：用户指令、`AGENTS.md`、`00` §11、`09` §1/§13、`10` §1/§2/§6/§9/§10
- 冲突内容：既有规范把高风险任务最终审查限定为独立审查/验收 Agent；项目负责人明确要求后续开发先提交 GitHub，并由本人审查后返回意见。
- 最终决定：项目负责人可以作为与实现者分离的独立审查角色。流程固定为本地验证 → commit/push → GitHub `REVIEW` → 项目负责人返回意见 → 修复并再 push → 明确通过后才可 `DONE`。push、PR 和 CI 均不等于审查通过。
- 需要同步修改的文件：`AGENTS.md`、`00`、`09`、`10`、任务板/任务卡/交接及迭代日志中的后续审查口径。
- 完成确认：正式治理文件已写回；GitHub 私有仓库和 Draft PR 建立后，后续高风险开发不再由实现 Agent 或内部审查 Agent 宣布最终通过。

### CON-012｜授权音频对象跨授权文本版本复用规则未定义

- 状态：`RESOLVED`；SPEC-CONTINUING-CONSENT-001 exact-head PASS/merge/main CI 与治理收口已完成
- 发现时间：2026-08-04
- 发现者：项目负责人（REV-010 非阻塞意见）
- 涉及文件与章节：`04` §4.5/§4.24、`05` §3.4/§3.6、`08` 授权治理、DEV-003B
- 冲突内容：正式契约允许授权记录追加并关联 consent audio object，但尚未明确同一个 complete consent audio object 能否关联不同 `consent_text_version` 的多条授权记录。若允许，音频中的口头文本可能与新版本不一致；若禁止，需要数据库或事务约束及测试。
- 受影响任务：真实试点授权验收；不阻塞 DEV-003A/B 内部虚构数据原型，也不阻塞父 DEV-003 的自动上传编排。
- 正式决定：禁止同一授权音频对象跨 `consent_text_version` 复用。任何需要新文本版本的正式重授权都必须重新录制与该版本逐字一致的完整授权音频并追加新 consent record；普通同 project 后续访谈在原文本明确覆盖未来计划内访谈且兼容性门禁通过时复用原 consent record，不新增记录或音频。
- 正式写回：SPEC-CONTINUING-CONSENT-001 已将决定同步到 `01/03/04/05/08/09/10`、shared contract、ADR-039 与 B1/B2 门禁；不新增 Prisma/migration/runtime。缺少显式版本兼容政策、未来访谈 scope metadata 或无法证明音频/文本匹配时失败关闭并要求重新正式授权；示例 `mvp-v1` 不被猜成已覆盖未来访谈。
- 关闭证据：PR #49 accepted exact head `1d241a4b8c40827a93eefe1c9825021b6859df74` / CI `31764584701` 获项目负责人 PASS（P0/P1/P2=0）；merge `712b4ff46acbff5168453c79b2d02375a84fa017` / main CI `31764903272` SUCCESS。关闭只表示跨版本音频规则已确定并接收；真实正文/policy 仍由 SPEC-CONSENT-TEXT-POLICY-001 阻塞。

### CON-013｜内部 audio harness 的生产与真实试点暴露策略未定

- 状态：`OPEN`
- 发现时间：2026-08-04
- 发现者：项目负责人（REV-011 非阻塞意见）
- 涉及文件与章节：`apps/web/src/main.tsx`、`apps/web/src/audio/audio-browser-harness.tsx`、`02` 部署与配置边界、`08` 安全治理、QA-001
- 冲突内容：当前内部 audio harness 可通过查询参数启用，适合虚构/合成数据纵向验证，但不应未经限制进入真实试点或生产。尚未决定在生产构建中完全移除，还是通过编译期开关、环境门禁与授权限制保留诊断能力。
- 受影响任务：生产部署与真实试点验收；不阻塞 DEV-003 内部原型完成，也不阻塞 DEV-004 的虚构数据 ASR 开发。
- 临时处理：继续仅用于本地和 CI 的虚构/合成数据；生产或真实试点前不得按现状开放查询参数入口。
- 需要谁决策：项目负责人 + 前端/安全角色；决定后同步构建配置、入口门禁、测试与发布检查。

### CON-014｜说话人校准是否为 session start 硬门禁未定义

- 状态：`OPEN`
- 发现时间：2026-08-04
- 发现者：iteration-coach 独立预审 / 总控 Agent
- 涉及文件与章节：`03` §7-8、`04` interview_session 状态、`05` §3.5/§5、`06` §7、DEV-004C
- 冲突内容：业务流程把说话人校准放在正式访谈前，但现有 session 状态和 start 门禁只要求 device check，没有 calibration 状态、完成凭据或重校准规则。直接实现会导致前后端各自解释是否可开始录音。
- 受影响任务：DEV-004C 的校准 UI、映射写入和正式 start 门禁；不阻塞 DEV-004A final-only 存储核心，也不阻塞以 `unknown` 回退的内部虚构数据验证。
- 已批准决定：校准不是 session start 或原始录音硬门禁；原子 start 后在同一正式 `speaker_stream_id` 内校准，只有倾听员确认才形成可信角色。失败或跳过时录音继续，片段保持 `unknown`，角色相关记忆、已问问题和建议上下文失败关闭；每个新 speaker stream 必须重新确认。
- 正式写回边界：`speaker_stream_id` 独立于 capture generation、`audio_stream_id` 和 `event_stream_id`；角色值与用户确认 authority 分离；校准控制内容由服务端 attempt 权威标记；修正采用单段默认、稳定预览批量原子执行，并只产生 revision/membership 失效 seam，AI 重算由 DEV-006/007 实现。
- 当前处理：`RESOLVED`。DISC-004C 与 SPEC-DEV-004C 均已完成；DEV-004C1 解锁为 `READY`，DEV-004C2 继续等待 C1 PASS。
- REV-027 补充：PR #17 首轮 head `6983ee0` 被项目负责人判定 `REQUEST_CHANGES`（P1=3）。定向修订采用 PCM 串行 marker 的不可变半开区间、统一 `SpeakerCalibrationSnapshot`，并以独立 `SPEC-DEV-006` 阻止下游自行发明单 session revision/stale 模型；项目负责人随后对 final head `2a65b1f` 判定 `PASS`，CI `31298277051` SUCCESS，PR 以 merge commit `0b6c357` 合入 main。
- 关闭条件：SPEC-DEV-004C 项目负责人审查 PASS，正式规范、ADR、任务卡和测试责任无冲突；关闭 CON-014 只表示契约可执行，不代表 C1/C2 已实现或父 DEV-004 完成。

### CON-015｜原始与修正说话人角色缺少分离表达

- 状态：`RESOLVED`
- 发现时间：2026-08-04
- 发现者：iteration-coach 独立预审 / 总控 Agent
- 涉及文件与章节：`01` 原始资料原则、`04` §4.7/4.9、`06` §6-7、ADR-018
- 冲突内容：正式要求说话人可修正且保留原角色，但原模型只有单一 `speaker_role`，实现 remap 会覆盖原始证据。
- 最终决定：segment 分列保存不可变 `original_speaker_role` 与可选 `corrected_speaker_role`；展示使用修正值优先。speaker mapping 采用追加历史，变化不回写既有 segment 的原始角色。
- 完成确认：`04`、`06`、ADR-018 与 DEV-004A 任务卡已同步；实现和迁移必须据此验收。

### CON-016｜interim 枚举与“中间态不落正式库”边界含混

- 状态：`RESOLVED`
- 发现时间：2026-08-04
- 发现者：iteration-coach 独立预审 / 总控 Agent
- 涉及文件与章节：`04` §4.9、`05` §5、`06` §5、ADR-006/018
- 冲突内容：原数据模型在 transcript finality 中列出 interim/final，容易被解释为 interim 可写 transcript 表；音频规范和测试又明确 interim 只展示、不得进入正式 AI 链路。
- 最终决定：`transcript_segment` 只保存 final，数据库不保存 interim row；interim 仅能作为短暂实时事件存在。finality 在事件响应中保留，持久表无需用可变 finality 表达。
- 完成确认：`04`、`05`、`06`、ADR-018 与 DEV-004A 验收已同步。

### CON-017｜首轮工作台与问题建议流程存在两套产品定义

- 状态：`RESOLVED`
- 发现时间：2026-08-07
- 发现者：总控 Agent / 前端页面规划对话
- 涉及文件与章节：`01` §6/§8/§10、`03` §3/§9/§17.3、`04` §4.11-4.12、`05` §3.9、`07` §6/§9、`09` §11-12、`10` Epic D/F、MVP-V01
- 冲突内容：原正式规划要求项目列表前置、三栏工作台、多候选问题和采用/已问/忽略/稍后/改写生命周期；已获项目负责人批准的前端规划要求优先验证准备页、转录优先工作台、安全结束页，并且同时只展示一个当前最佳问题，仅提供“没用，换一个”。
- 最终决定：当前优先切片命名为“首次访谈最小纵向闭环”；使用已分配、已预创建的单个虚构项目深链进入；工作台采用顶部状态、转录主体、底部单建议卡；不要求操作或记录采用、已问、忽略、稍后和改写。项目管理、完整回顾、复杂标记、导出/删除 UI 和多次访谈后置，但不从完整 MVP 删除。
- 安全边界：页面确认不能替代正式授权记录、授权音频或服务端 start 门禁；原始数据可靠保存、权限和删除治理不因 UI 后置而取消。
- 完成确认：SPEC-FE-001 已同步正式产品/交互/验收/路线，等待 GitHub 最终 head 审查。

### CON-018｜自动替换、手动下一问与展示历史的最小数据/API 契约未冻结

- 状态：`OPEN`
- 发现时间：2026-08-07
- 发现者：iteration-coach 独立只读审阅 / 总控 Agent
- 涉及文件与章节：`04` §4.11-4.12、`05` §3.9/§5.10、`07` §6-9、`09` 场景 A、SPEC-AI-QUESTION-001
- 冲突内容：产品行为已经批准，但稳定 request ID、并发替换、过期建议、相似问题判定、节流、持久化状态及旧 `suggestion_action` 的去留尚未定义。直接编码会让前后端各自猜测。
- 受影响任务：硬阻塞 DEV-007A；不阻塞 DEV-005A 页面外壳，DEV-005B 只能预留展示 seam。
- 临时处理：冻结通用 suggestion action 入口和旧采用生命周期；只允许文档/UI 占位表达单问题和替换意图，不新增数据库或 API。
- 需要谁决策：AI/后端契约 Agent 提案，总控收敛，项目负责人或独立审查通过。
- 关闭条件：SPEC-AI-QUESTION-001 同步 `04/05/07/08/09` 并获得明确 PASS。
- SPEC-DEV-006 进展（2026-08-09）：已冻结 `QuestionEvidenceModule` 共享 generation/display/actual-question 基座、display snapshot/future eligibility/visibility 分离和 actual-question reader；CON-018 继续 OPEN，因为具体建议交互、节流、相似度和最终 REST/WS 仍必须由 SPEC-AI-QUESTION-001 冻结并获 PASS。
- 项目负责人产品修订（2026-08-10）：暂停原“一层撤销”讨论框架，明确只要系统判断有更合适且具资格的问题即可自动替换；所有真实展示快照进入可浏览历史；“上一个问题”只读回看并可“回到当前问题”；“换一个”改为“下一个问题”。旧一层撤销不再实现；历史浏览不触发 AI、不改变当前建议/排除，也不代表实际问过。SPEC-AI-QUESTION-001 已解锁为 READY，须冻结自动替换稳定规则、手动请求幂等、历史游标/安全投影和并发后才能关闭本冲突。
- SPEC-AI-QUESTION-001 REVIEW 候选（2026-08-10）：已在 `04/05/07/08/09/10` 冻结单调 `display_sequence`、`presentation_revision` CAS、manual intent fence、自动分差/15 秒 dwell/1500 ms debounce、`question-sim-v1`、手动单飞与 3 秒/60 秒 6 次节流、稳定 history cursor/anchor、REST canonical projection、无正文 WS 1.2 notification、hard withdrawal 与桌面/390×844/320×568 无障碍矩阵。历史导航已从幂等写操作清单移除；`manual_next_requested` 不再冒充 `explicitly_replaced`；旧 `attempt_kind=replace` 和 `suggestion_action` 明确废弃。当前仍为候选，CON-018 保持 `OPEN`，只在非 Draft PR exact final head/CI 获项目负责人 GitHub 手动审查 PASS 后关闭。
- 解决确认（2026-08-10）：项目负责人对 PR #21 final head `af088ed6165c979e8de2e469900ee6519fafe183`、CI `31352681061` attempt 2 手动审查 `PASS`，P0/P1=0；PR 以 merge commit `10fcc5c6580fa8285f54866f6252e5806b0f932a` 合入 main。ADR-029 Accepted，SPEC-AI-QUESTION-001 DONE，本冲突关闭。实现仍由 DEV-007 在 DEV-006 PASS 后交付，不因契约关闭而冒充功能完成。

### CON-019｜安全结束页缺少可执行的服务端 stop/completion 契约

- 状态：`RESOLVED`
- 发现时间：2026-08-07
- 发现者：项目负责人 PR #6 审查 / 总控 Agent / iteration-coach 独立只读预审
- 涉及文件与章节：`03` §12/§17.2、`04` §4.6、`05` §3.5/§4、`06` §9-10、`09` 场景 A/§12.1、DEV-005A、SPEC-FE-001
- 冲突内容：产品要求安全结束页依据 `stopping/processing/failed/completed` 服务端事实展示，但当前 controller/service 只有 create/get/device-check/start；`05` 仅列出 stop/recover 路径，没有请求响应、合法状态、幂等、跨链路收束、失败或完成条件，公共 session 响应也不包含结束时间与时长。原 DEV-005A 又只允许修改 `apps/web`，无法合法补齐能力。
- 受影响任务：阻塞原 DEV-005A 中的安全结束页和完整 DEV-005 闭环；不阻塞拆分后的 DEV-005A 准备页/路由外壳，也不阻塞 SPEC-SESSION-END-001。
- 临时处理：stop/recover 明确为路径占位；DEV-005A 缩为准备页与路由外壳，DEV-005B 只保留结束动作挂载位置；新建 SPEC-SESSION-END-001、DEV-005C 后端编排和 DEV-005D 结束页薄集成。
- 需要谁决策：会话编排契约任务提出正式状态机与完成事实，项目负责人或独立审查通过后由后端实现任务执行。
- 关闭条件：SPEC-SESSION-END-001 获得明确 PASS，并把 DEV-005C/005D 所需字段、错误、幂等、权限和验收矩阵写入正式契约；实现完成另按任务审查，不以关闭冲突代替代码验收。
- 处理进展（2026-08-07）：SPEC-SESSION-END-001 已形成正式审查候选：唯一 interview audio object、stop 后冻结逐片 commitment、持久 `session_finalization`、受限 evidence-finalization 补传、ASR `drained|degraded|not_started`、统一公共 snapshot、recover 重驱与验收矩阵已写入 `03` 至 `06`、`08`、`09` 和 ADR-022。当前仍为 `OPEN`；候选 push/CI/PR 不等于关闭，等待项目负责人绑定最终 GitHub head 明确审查。
- REV-017 首审进展：项目负责人锁定 PR #8 head `e8fa20f39903aaf9f84a4dc4672d10ff25058933`，CI `31162831225` PASS，但发现 P1：授权在首次 stop snapshot 前撤回且 assignment 仍有效时，`05` 没有明确禁止首次 stop/`finalize_interrupted` 新建 commitments，与 `08` 冲突。已按“撤权前已冻结才允许受限补传”定向修正；CON-019 继续 `OPEN`，等待修复后最终 head PASS。
- 最终决定：采用 ADR-022 的持久 `session_finalization` 与逐片 commitment；首次 stop/无 finalization 的 `finalize_interrupted` 必须在同一资源锁内重新验证有效 assignment、资源归属、最新授权仍有效且项目未受限。只有撤权前已冻结的 snapshot 才允许原 actor 重新认证后在 commitment 范围内补传。
- 完成确认（2026-08-07）：项目负责人对 PR #8 final head `9c471d81d783c902ae389c50500cafac0b187202` 给出 REV-017 定向复审 `PASS`，CI `31163777417` 全绿；PR 以 merge commit `9af96c1be61936e7eef7665d313e44a6f0c6c2bf` 合入 `main`。契约缺口已关闭并解锁 DEV-005C；stop/recover 代码实现及 DEV-005D 页面仍分别等待后续任务验收。

### CON-020｜正式工作台缺少访谈录音作业所有权与 stop 输入

- 状态：`RESOLVED`
- 发现时间：2026-08-07
- 发现者：DISC-005D 总控验收 / iteration-coach 独立只读复核
- 涉及文件与章节：`00` §4/§9、`01` §8/§11、`03` §9/§12、`05` §3.5.2/§3.6、`06` §2/§3.5/§10、`09` 场景 A、DEV-005A/B/C/D
- 冲突内容：DEV-005C stop 要求唯一 interview audio object、录制停止时冻结的 expected count 和逐片 commitments；现有正式准备页不创建录音作业，正式工作台只接合成 PCM 实时转录，可靠 MediaRecorder/IndexedDB 上传作业仍由内部 audio harness 组装。正式路由因此无法合法构造 stop payload，也不能按 session 恢复同一作业。
- 受影响任务：阻塞原 DEV-005D 薄集成和完整 DEV-005 纵向闭环；不撤销 DEV-005A/B/C 在各自已审查范围内的 DONE，也不阻塞其他边界清晰的后端原型。
- 临时处理：不修改旧 A/B/C 代码或任务历史，不依赖 query harness/E2E 预置伪造结束输入；先执行 DISC-005-R0，再由 B-R 重点冻结真实/合成音频等级、单一作业生命周期、刷新恢复和 stop handoff。
- 需要谁决策：项目负责人在 DISC-005-R0 与后续 B-R 中决定产品验证等级和用户可观察恢复行为；总控在全部阶段讨论后统一收敛正式产品与技术规范。
- 关闭条件：新的跨阶段方案明确正式工作台从 start 到 stop 如何持有/恢复唯一录音上传作业，能产出与 DEV-005C 匹配的不可变 stop 输入，并形成真实浏览器纵向验收；对应实现与项目负责人审查另行关闭，不以讨论通过冒充代码完成。
- 设计收口进展（2026-08-07）：项目负责人批准 R0 与 A-R/B-R/C-R/D-R；`SPEC-DEV-005R` 已把 session-scoped controller、atomic start、唯一 object、capture generation、archive/delivery 分离、显式恢复和同页结束体验写成正式候选。冲突继续 `OPEN`；只有 DEV-005R4 证明正式路由从 start 到同一对象 stop/manifest 且获得 GitHub PASS 后才关闭。
- REV-025 进展（2026-08-09）：正式工作台与安全结束页面已获项目负责人 PASS 并合入 `main`，R4 前置成立。CON-020 仍保持 `OPEN`；必须由 R4 在正式路由证明恢复后仍复用同一 session/audio object/local job，并完成冻结 commitments、上传、manifest 与终态后关闭。
- DEV-005R4 REVIEW 候选（2026-08-09）：桌面真实 Chromium 5 分钟与 Android 正式路由约 8分21秒均从准备页进入同一真实 MediaStream 的 archive/PCM；Android 刷新恢复前后复用同一 session/audio object/local job，唯一 audio object 最终形成 491/491 complete manifest、ASR drained 与 session completed。该证据已满足候选关闭条件，但冲突继续 `OPEN`，只由项目负责人绑定非 Draft PR final head PASS 后关闭。
- 最终解决（2026-08-09）：项目负责人对 PR #16 final head `2fab0ead66e6b52d1b95dec0ef3708a78a5d5d26` 给出 REV-026 `PASS`，确认同一正式 object 从 start、刷新恢复到 commitments、491/491 manifest 与 completed 的纵向证据成立；PR merge `7477dca` 后状态改为 `RESOLVED`。

### CON-021｜Android Chrome 后台与设备生命周期的采集事实尚无真机证据

- 状态：`RESOLVED`
- 发现时间：2026-08-08
- 发现者：DISC-005R-UI 项目负责人讨论 / iteration-coach 独立只读复核 / 总控 Agent
- 涉及文件与章节：`01` §8、`03` §9/§12、`05` capture actions、`06` §9/§11、`09` §10.2/场景 A、DEV-005R2/R3/R4
- 冲突内容：产品已确认 Android Chrome 是完整访谈主设备，但尚无目标真机证据证明页面隐藏、切后台、锁屏、旋转和音频设备中断时 MediaStream/MediaRecorder/AudioWorklet/IndexedDB 的可靠行为。页面若自行假定“继续正常”会静默丢音频；一律中断又可能无必要破坏访谈。
- 受影响任务：DEV-005R2 必须冻结 controller 行为，DEV-005R4 必须提供真机证据；DEV-005R3 只能消费已冻结事实。iPhone Safari 明确延期。不阻塞 DEV-005R1 服务端或边界独立的 DEV-005R2C 继续开发。
- 临时处理：旋转只允许重排，禁止刷新、重新请求麦克风或创建新 capture。其他生命周期事件在 R2 真机验证后选择“可证明可靠则继续”或“不可证明则持久报告 interrupted”；不得私有发明状态或仅改文案。
- DEV-005R2 候选证据（2026-08-08）：执行环境未安装 `adb`，PnP 查询也未发现 Android 目标设备，因此设备型号、Android 版本与 Chrome 版本均不可取得；5–10 分钟录制、visibility/后台、锁屏、权限或音频设备中断均未验证。桌面真实 Chromium harness 已证明旋转不触发刷新、重新申请麦克风或新 capture，但这不能替代 Android 证据。controller 未监听 visibility 并猜测平台结果，现有 reason/snapshot 暂未因缺乏证据而改动。
- REV-024 真机证据（2026-08-08）：OnePlus GM1900、Android 12 / SDK 31、Chrome `150.0.7871.188` 在正式路由连续采集约 6 分 20 秒；archive `0..371` 共 372 片且无缺口。旋转、约 20 秒切后台和约 20 秒锁屏期间同一 session/object/stream/generation 持续采集。刷新后同一 job/archive/request ID 保留并以 `page_recovery_detected` 进入 `interrupted`；第二条正式会话撤销麦克风权限后保留 71 片 archive，并以 `microphone_ended` 进入 `interrupted`。现有 reason/snapshot 足以表达本次事实，无需扩枚举。
- 当前处理：R2 的平台事实门禁已满足并 `DONE`。该单机证据不外推为所有 Android 的无条件后台保证；controller 以 track、recorder、archive 与 identity 健康事实决定继续，不能只看 visibility。CON-021 保持 `OPEN`，R4 必须在 R3 页面上复验显式 resume 到下一 generation、同一 session/object/job、累计时间轴和安全结束 manifest 后关闭。
- REV-025 进展（2026-08-09）：R3 已正式 PASS，页面已具备显式恢复与安全结束入口；这只解除 R4 前置，不构成手机端恢复/结束证据。CON-021 继续 `OPEN`。
- DEV-005R4 REVIEW 候选（2026-08-09）：同一 OnePlus/Android 12/Chrome 150 在 R3 正式工作台额外复验旋转与约 10 秒后台返回不刷新、不重新取麦、不创建新 capture；刷新后真实进入 `page_recovery_detected`，稳定恢复页 gUM/MediaRecorder 为 0，用户显式恢复后 generation `0→1`、stream 更新，archive/timeline 累计延续并安全结束。R2 的锁屏/撤权证据继续复用。冲突保持 `OPEN` 等项目负责人 final head PASS。
- 最终解决（2026-08-09）：REV-026 确认 R2 生命周期证据与 R4 正式工作台恢复/结束证据共同满足当前单目标设备范围；PR merge `7477dca` 后状态改为 `RESOLVED`。结论不外推所有 Android，iPhone Safari 仍延期。
- 关闭条件：目标 Android Chrome 真机覆盖 5–10 分钟录制、旋转、后台/锁屏、权限/设备中断和刷新恢复；正式契约明确每类事件的继续/中断结果，必要的 reason/snapshot 变更先同步文档与共享契约，并获得项目负责人 PASS。

### CON-022｜准备页低音量输入检测在 Android Chrome 上容易误判无声

- 状态：`RESOLVED`
- 发现时间：2026-08-08
- 发现者：项目负责人 / DEV-005R2 真机验收
- 涉及文件与章节：`03` §7、`09` §10.2、`apps/web/src/interview/microphone-check.ts`、DEV-005R3/R4
- 问题：OnePlus GM1900 的准备页真机检测中，较小但可听见的说话音量被判定为“没有声音输入”，提高音量后才能通过。当前检测仅短时采样并使用固定振幅阈值，可能把真实可用麦克风误判为失败。
- 风险：P2 可用性问题；不会绕过授权或导致录音静默丢失，但可能阻止倾听员开始访谈，并诱导用户不必要地大声说话。
- 当前处理：不取消“检测到输入”门禁，也不把预计时长只读或本地 fixture 乱码混入本缺陷。DEV-005R3 应改善采样时长、实时反馈或重试说明，并用普通说话音量验证；如需改变判定算法，增加单元与 Android 真机证据。
- DEV-005R3 候选进展（2026-08-08）：检测窗口由 1.4 秒固定幅度阈值改为 3.6 秒，先采 600 ms 噪声基线，再要求连续三帧越过动态阈值；页面区分“完全无输入”与“声音太弱”，两者都不放宽真实输入门禁，并增加 retry/unit/Chromium 合成输入证据。当前仍为 `OPEN`：桌面/合成输入不能替代 OnePlus/Android Chrome 的普通说话音量复验，关闭权留给 R4/项目负责人。
- REV-025 进展（2026-08-09）：DEV-005R3 页面与算法实现已获项目负责人正式 PASS 并合入 `main`。本结论不替代 Android 普通说话音量证据；CON-022 保持 `OPEN`，由 R4 在目标设备复验后决定是否关闭或继续调整。
- DEV-005R4 REVIEW 候选（2026-08-09）：OnePlus GM1900 / Android 12 / Chrome 150 在室内约 30–50cm 由用户多次以普通说话音量确认可用；安静/无输入仍正式判定失败并禁用开始按钮，随后正常输入可恢复。未放宽输入门禁，未再修改检测算法。冲突继续 `OPEN` 等项目负责人 final head PASS。
- 最终解决（2026-08-09）：REV-026 确认普通近距离音量多次通过、安静输入失败且可重新检测，满足正式关闭条件；PR merge `7477dca` 后状态改为 `RESOLVED`。
- 关闭条件：目标 Android Chrome 上普通近距离说话可稳定通过，安静/无输入仍失败，失败说明和重新检测可操作；R4 记录设备、环境与结果。

### CON-023｜C2 删除 scope 门禁缺少可执行的 deletion_request producer/read model

- 状态：`OPEN`
- 发现时间：2026-08-09
- 发现者：DEV-004C2 实现任务 / 总控 Agent
- 涉及文件与章节：`04` §4.13/§4.18/§4.22、`05` §3.4/§3.7.4、`08` §14、`09` §8.2、DEV-004C2、DEV-008、CON-006/007
- 冲突内容：正式契约要求角色修正在命中非终态 project/session/segment_range 删除 scope 时失败关闭，但当前 Prisma 与服务层尚未实现 `content_marker`、`deletion_request`、transition 或统一 scope 查询；现有运行时只有项目 `restricted|deleted`、授权和 assignment 门禁。删除子系统归属仍为 BLOCKED 的 DEV-008，且 CON-006/007 要求其开工前先冻结备份清理状态和摘要密钥轮换。
- 风险：若 C2 自行新增没有合法创建/处理链路的 read-only 表或 no-op guard，会制造“已支持删除门禁”的假能力；若未来 DEV-008 上线后忘记回接，session/segment 删除申请期间仍可能发生角色修正。
- 当前处理：C2 不新增 deletion schema、marker、API 或占位 guard；完整实现并验证当前真实存在的 auth、assignment、最新授权、project `restricted|deleted` 门禁。由于当前不存在可创建 deletion request 的运行时入口，session/segment scope 命中测试明确记为未验证但不阻塞内部 MVP 的 C2 核心。
- DEV-004C2 定向审查补充（2026-08-09）：`speaker_remap_preview.segment_start_id/segment_end_id` 外键使用 `ON DELETE RESTRICT`。未来 DEV-008 实现 session/segment 删除时必须显式处理 correction preview/operation 引用及其并发顺序，不能把当前 project `restricted|deleted` 门禁冒充 deletion scope；C2 本轮不修改外键，也不新增删除模型或临时 guard。
- 正式要求：`05` 的 deletion scope 失败关闭语义保持不变，不因本次执行顺序调整而删除或降级。
- 关闭条件：DEV-008 实现正式 deletion request producer/read model 与统一 scope guard，并让 C2 单段修正、批量 preview、批量 execute 在锁后复核 project/session/冻结 segment_range scope；补 scope 命中、创建/修正并发、幂等和不泄密测试后关闭。
- 需要谁决策：DEV-008 开工前由总控与数据治理/安全角色先解决 CON-006/007；C2 无需等待该决定，可继续其余已冻结范围。
- SPEC-DEV-006 REVIEW 进展（2026-08-09）：consumer 目标已冻结统一 `DeletionScopeReader` port、project/session 固定锁序、输入冻结/调用前/写回/展示四次检查、动态撤下与派生关系清理；这不是 runtime 实现。当前 coverage 仍为 `NOT IMPLEMENTED / NOT VERIFIED`，不得增加 no-op guard。关闭条件仍是 DEV-008 producer/read model、C2 回接与真实并发/幂等/不泄密测试全部完成。
- PR #20 REQUEST_CHANGES 修复进展（2026-08-10）：契约新增 `ai_job|question_display_snapshot|memory_retention_root` 三类保留根、先隐藏后清理、跨 root detach、CASCADE/显式幂等顺序和失败续跑；这些仍是未来 DEV-006/008 的目标，不是现有 deletion producer/read model。CON-023 状态和 `NOT IMPLEMENTED / NOT VERIFIED` 覆盖结论不变。
- SPEC-DEV-008A 拆分（2026-08-12）：历史 DEV-008 已停止作为聚合实现任务。当前 origin IndexedDB 的“删除此设备上的录音副本”由 DEV-008A3 承接，明确不创建/推进 `deletion_request`，不改变服务端 audio/transcript/memory，也不关闭本冲突。正式 producer/read model、统一 `DeletionScopeReader`、C2/AI/回顾回接、在线/备份清理与最小审计全部转由独立 DEV-008D；关闭条件和 `NOT IMPLEMENTED / NOT VERIFIED` 结论不变。

### CON-024｜已展示问题快照与正式边界即时撤回规则冲突

- 状态：`RESOLVED`
- 发现时间：2026-08-09
- 发现者：DISC-006 写回 / iteration-coach 独立只读复核
- 涉及文件与章节：`01` §5/§9、`03` §9/§10、`04` §4.11/§4.18、`05` §3.9/§4、`07` §5.6/§9/§13、`08` §11/§14、`09` §6.1/§8.2、SPEC-DEV-006、SPEC-AI-QUESTION-001、DEV-006/007
- 冲突内容：DISC-006 已确认“说话人/文字修正、人工边界或 deletion 变化只影响后续生成，已经显示的当前问题不自动撤下”；现行正式规范要求角色修正命中的旧派生结果在重算前不可展示/消费，并要求 `restricted`、`do_not_ask`、活动 deletion scope、授权或访问失效在展示前失败关闭，不得继续展示命中内容。
- 风险：若把所有变化一概视为可保留屏幕快照，软件可能继续主动呈现长者已拒绝的话题、普通倾听员已无权消费的派生内容或待删除范围的正文；“倾听员拥有现场判断权”不能代替软件自身的权限和删除义务。若一概立即撤下，又会违反项目负责人对普通事实修正后保留当前问题、避免自动重算和界面跳动的明确体验决定。
- 独立复核推荐：拆成两类。说话人/文字/普通记忆修正、普通冲突和单独 `sensitive` 只使未来 eligibility 失效，不自动重算或撤下已展示快照；`restricted`、`do_not_ask`、活动 deletion scope、授权/访问失效属于硬边界，立即撤下问题正文，显示中性的“继续倾听”或“AI 暂不可用”，不自动生成替代问题，同时只在受限审计中保留曾展示的 ID、版本和时间。
- 临时处理：项目负责人裁决前 DISC-006 候选决定包保留但不正式写回冲突条款；`DISC-006`、`SPEC-DEV-006` 与 `DEV-006` 暂时 `BLOCKED`，避免正式规范出现半套新旧语义。
- 需要谁决策：项目负责人确认推荐拆分，或明确选择仅限纯虚构内部实验仍保留硬边界命中的问题；后一选择不能成为正式隐私/删除规则，也不能据此宣称删除和禁问门禁成立。
- 需要同步修改：`01/03/04/05/07/08/09/10`、SPEC-DEV-006、SPEC-AI-QUESTION-001、DEV-006/007 任务卡、追踪、ADR、测试矩阵与过程记录。
- 关闭条件：项目负责人明确选择；所有正式规范、任务卡和验收规则写回一致并通过适用 GitHub 审查。
- 最终决定（2026-08-09）：项目负责人批准独立复核推荐拆分。普通说话人/文字/记忆修正、普通冲突和单独 `sensitive` 允许保留已展示快照，但立即取消其未来生成/current memory/跨会话资格；`restricted`、`do_not_ask`、活动 deletion scope、授权或访问权限失效必须立即撤下正文，只显示中性状态且不自动生成替代问题。
- 完成确认：`01/03/04/05/07/08/09/10`、ADR-026、DISC/SPEC/DEV 任务卡与追踪同步后标记 `RESOLVED`。该解决只冻结产品和契约输入，不代表 SPEC-DEV-006 或 DEV-006 已实现/通过。

### CON-025｜当前实现路线与项目负责人预期存在尚未逐项说明的差异

- 状态：`RESOLVED`
- 发现时间：2026-08-10
- 发现者：项目负责人
- 涉及文件与章节：当前产品流程与页面、DEV-006 已完成能力、DEV-007 及其后续路线；具体差异尚待项目负责人逐项说明后补充。
- 冲突内容：项目负责人明确反馈“目前项目和我想象的有几个地方不一样”，并要求先不要启动 DEV-007。现有正式契约虽然已足以实施问题引擎，但继续开发可能把尚未识别的产品偏差扩大到接口、数据和页面。
- 受影响任务：DEV-007 保持 `BLOCKED`；不得创建实现任务、分支或 PR。DEV-006 已通过范围不因本条自动撤销，但可在对齐后形成有依据的修订任务。
- 临时处理：完成 PR #22 合并与 DEV-006 治理收口后暂停开发；由总控与项目负责人先用通俗的现状说明逐项识别“预期是什么、当前是什么、是否需要修改、影响哪些已完成能力”。
- 第一项具体差异（2026-08-10）：现行路线详细冻结了问题发布、替换、历史、幂等和安全过滤，却没有先冻结“陌生倾听员如何帮助长者建立表达意愿”“问题内容从哪里来”“怎样从低压力破冰逐步进入深层故事”。`07` §10 当前把基础题库定位为后续人工资源，且 AI 不可用时不回退题库；项目负责人提出题库应成为正常问题供给的重要来源，并准备基础题库与深入题库，由 AI 结合访谈阶段、当前转录和记忆进行选择或有据轻调。这是候选产品方向，尚未完成整体验收与正式写回。
- 协作方式修正：后续产品讨论先使用开放式大问题，让项目负责人描述目标用户、整体旅程、内容来源、阶段体验和成功标准；在产品方向未清楚前，不再让负责人优先选择数据库、接口、阈值或组件等可回退实现细节。
- 复核建议：采用“访谈旅程优先、双题库供给、AI 负责选择与有据微调”的路线；基础题库服务破冰和生平地图，深入题库服务人物、选择、场景、转折、情绪与未讲完故事。阶段应可进可退，不按固定题数或时间硬切。公开题库仅可在来源与许可确认后参考，不得直接复制入仓库。
- 项目负责人确认（2026-08-10）：先尽快做可试用第一版，再从真实倾听实践迭代；正式采用 basic/deep 两类内容源，AI 结合确定态转录、可信角色、DEV-006 current memory、旅程阶段与安全边界选择原题或有依据轻调，禁止无依据自由编造。研发不等待完整真实题库，先冻结易填写、可版本化、可校验的 UTF-8 CSV，并只用明确标记的虚构 fixture 验证链路；正式内部试用前必须导入负责人题库。
- 候选解决方案：SPEC-QUESTION-JOURNEY-001 已把上述决定写入正式产品/流程/数据/API/AI/安全/测试/协作规范，提出 ADR-030，并将 DEV-007 拆为 A（题库基础设施、导入、阶段与确定性选择 seam）和 B（AI 选择/有据轻调、QuestionEvidence 与工作台集成）。该候选同时处理 `07` §10 的旧冲突：题库成为正常内容源，但不恢复 AI unavailable 时的静态兜底。
- 当前门禁：已解除。项目负责人对 PR #23 final head `5963af98b4a807e5fa1d00ff33f8ef6b6a0e6323`、CI `31380903831` 定向复审 PASS，P0/P1=0；PR 以 merge commit `f0bff3f029716804175000fab0d4441ec6585bf4` 合入 main。ADR-030 转 Accepted，SPEC DONE，DEV-007A 解锁为 READY；DEV-007B 继续等待 A。
- 首轮审查（REV-034）：项目负责人对 PR #23 old exact head `0f3034d27975cd0695e9963d5e29535d7d574dda` 正式 `REQUEST_CHANGES`，P0=0/P1=3，要求冻结条件 AND/OR/排除优先与非法输入、`journey_policy_v1` 完整 reason/冲突顺序，以及 14 列 purpose 和 `adaptation_reason_code_v1`。该 old-head 结论永久保留；当时仅为定向修复候选，CON-025 尚未转 RESOLVED，最终状态以后续 exact-head PASS 为准。
- 定向复审（REV-034）：项目负责人绑定 final head `5963af98b4a807e5fa1d00ff33f8ef6b6a0e6323` 与 CI `31380903831` 给出 `PASS`，确认三项 P1 3/3 CLOSED：条件 v1、deterministic journey policy、purpose/adaptation reason 均已冻结；P0/P1=0。
- 需要谁决策：项目负责人确认具体差异及优先级；总控负责把决定写回正式需求、契约、任务卡和追踪，必要时先创建修订 SPEC，不得让 DEV-007 实现 Agent自行解释。
- 关闭条件：项目负责人对 SPEC-QUESTION-JOURNEY-001 exact final head/CI 的 GitHub 手动审查明确 PASS，确认本轮问题旅程/内容来源偏差已被正式依据承接，并明确允许 DEV-007A 开工；后续若发现其他未对齐项，另行登记而不得静默并入本条。


### CON-026｜题库白名单与项目负责人确认的自由生成方向冲突

- 状态：`RESOLVED`
- 发现时间：2026-08-11
- 发现者：项目负责人、总控 Agent
- 涉及文件与章节：`01/03/04/05/07/08/09/10`、ADR-030、DEV-007/007B、PR #25
- 冲突内容：现行规则要求每个问题来自 eligible 题库并只做轻调；项目负责人明确题库只作参考，模型应综合可信对话/记忆/历史自由生成，且问题生成不得修改源数据库事实但必须保存展示历史。
- 发现时受影响任务：DEV-007B 与父 DEV-007 保持 BLOCKED；PR #25 old head 保留 REQUEST_CHANGES，不得合并。关闭后 DEV-007B 仅转 READY，父 DEV-007 仍等待 B 完成。
- 临时处理：以 SPEC-QUESTION-DIRECTOR-001 docs-only PR 冻结两份唯一 Context/Output Schema、Prompt、seen/declared/grounding/eligibility 四类事实和 source-read-only/suggestion-append-only；不在旧契约上继续实现。
- 需要谁决策：项目负责人对契约 PR exact head 手动 GitHub 审查。
- 最终决定：候选采用 ADR-031；题库 0..N 可选参考，一个实时 Director 完成一次逻辑生成，受控失败最多一次完全同输入 retry；后端确定性编排和硬安全不变。
- 需要同步修改的文件：`01/03/04/05/07/08/09/10`、ADR、任务板/追踪、DEV-007/007B task+prompt、handoff/journal。
- 关闭条件：契约 PR PASS/merge，ADR-031 Accepted，DEV-007B v2 任务门禁和正式实现依据一致。
- 关闭证据：项目负责人对 PR #26 final head `8938d525d66f138e7c7b7e3049fe56cbea6bcbb1`、CI `31454260127` 定向复审 `PASS`，P0/P1=0、P2=1；PR 以 merge commit `d320f642a30ee8cc71090ad0d1662b4fc2d08ad6` 合入 main。ADR-031 Accepted，SPEC DONE，DEV-007B v2 解锁为 READY；P2 旧动态状态句已清理。

### CON-027｜腾讯实时 ASR 真实试点数据治理证据不足

- 状态：OPEN
- 发现时间：2026-08-11
- 发现者：SPEC-ASR-PROVIDER-001 契约 Agent
- 涉及文件与章节：`01` §12、`06` §15、`08` §17、`09` §15、腾讯服务条款/优化授权/FAQ
- 冲突内容：项目已批准在有效授权后向腾讯中国大陆发送实时 PCM，并固定关闭可选训练/优化/测试授权；但当前腾讯公开资料不足以证明真实长者试点所需的诊断日志、音频/文本保留细则、处理地区边界和 DPA/处理者义务。FAQ 的概括不能替代合同、控制台或专项书面证据。
- 受影响任务：不阻塞使用完全虚构、合成或明确同意非长者数据的 DEV-ASR-PROVIDER-001；阻塞任何真实长者、PII 或生产试点。真实 LLM 仍另行依赖 DEV-ASR-PROVIDER-001 PASS。
- 临时处理：后端最小 payload；授权前不连接；撤权后停止新发送；secret redaction；可选优化授权 false；禁止真实长者/PII；日志不复制完整音频/转录。
- 需要谁决策：项目负责人 + 数据治理/法务角色。
- 最终决定：未定。
- 需要同步修改的文件：关闭时更新 `08`、`09`、腾讯 provider profile、任务板/追踪和本索引。
- 关闭条件：取得并审查适用于目标账号/产品/region 的 retention、diagnostic logging、处理地区与 DPA/处理者义务一手证据，形成可测试配置和删除/保留责任；项目负责人明确允许真实长者试点。

### CON-028｜restricted 首页投影缺少最小机器 DTO，普通 finalization/prepare reader 存在权限旁路

- 状态：`RESOLVED`
- 发现时间：2026-08-12
- 发现者：DEV-008A1 唯一 iteration-coach 独立只读 Correction（实现窗口 `019ff4ed-ed98-7e00-a592-6c6036a53a62`）
- 涉及文件与章节：`03` §3.1/§17.2、`04` §4.2-4.6、`05` §3.1/§3.3-3.5.4、`08` §4.5/§5、`09` §10.3、`10` §5.1、ADR-034、shared contracts、DEV-008A1
- 冲突内容：正式文本要求 restricted+有效 assignment 在首页显示中性受限投影，但唯一 shared `ProjectResponse` 必含长者称呼、出生/年龄、籍贯、城市与 `created_by`。置空违反 DTO，复用会泄露正文，直接隐藏又改变首页语义。复核同时确认普通 `GET /sessions/:id` 可能以 session/finalization `created_by` 绕过当前 assignment，restricted prepare 深链也可能返回 project/service-term/consent 正文。
- 受影响任务：发现时 DEV-008A1 保持零改动 `BLOCKED`；A2/A3 和父 A 的既有阻塞不变。关闭后仅 DEV-008A1 恢复 `READY`。
- 总控正式决定：只有 restricted 且当前有效 assignment 仍存在时，首页返回独立最小中性投影；deleted、软删除、assignment 失效完全不可见。session cursor 绑定 `project_id + created_at + id` 并签名失败关闭。普通 Home/prepare/workbench/review readers 不得用 `created_by` 或 evidence-finalization 例外绕权；限制前已冻结 stop 的原 actor 只走专属最小 seam。
- 候选写回：SPEC-DEV-008A1-ACCESS 同步正式规范、`ProjectListProjection`/`ProjectSessionListResponse`/`EvidenceFinalizationResponse`、ADR-035、测试与协作门禁；不改业务代码、Prisma、migration、页面或测试实现。
- iteration-coach：原 DEV-008A1 已完成恰好一次 Correction；本 docs-only 修正和后续恢复不得启动第二次复核。
- 关闭证据：项目负责人对 PR #33 exact head `81f0bba3d30139e458e919da969d40386231cc62` / CI `31586889712` 正式 PASS（P0/P1/P2=0）；GitHub 记录 [issuecomment-5265462316](https://github.com/Li-Ming-G/elder_interview_ai/pull/33#issuecomment-5265462316)。PR merge `18ba7381f7ba747c2fb3beefe28297c6d063a174`，main CI `31587442461` SUCCESS；ADR-035 Accepted，SPEC-DEV-008A1-ACCESS DONE，DEV-008A1 恢复 READY。
- 历史边界：本次关闭只接收 docs/shared-contract 安全接缝；原 Correction、`DECIDED`/`PENDING` 候选历史永久保留，不代表 A1 handler/repository/cursor/UI 或安全回归已实现。

### CON-029｜A3 fresh delete preflight 缺少 finalization total bytes 公共字段

- 状态：`RESOLVED`
- 发现时间：2026-08-12
- 发现者：DEV-008A3 开工前唯一 iteration-coach Correction；实现窗口 `019ff5db-a0dd-7060-875f-8ee454a84469`，只读复核 `019ff5e0-47d2-7d92-8148-7eff63ec61a9`
- 涉及文件与章节：`04` §4.24-4.25/§4.44、`05` §3.1/§3.5.1/§3.5.3/§3.6.1、`08` §5/§14.1、`09` §10.4、`10` §4/§7、shared contracts、DEV-008A3、ADR-034/035
- 冲突内容：正式 `05` 要求 A3 将 manifest 的 chunk count/total bytes 与 session finalization 对照，但公共 `SessionFinalizationSnapshot` 只有 expected/uploaded count 与 manifest checksum，没有 `total_size_bytes`。静默跳过会削弱删除安全门；A3 自行补字段又会未经审查改变公共 API。
- 发现时处理：DEV-008A3 在零改动、未建分支/PR的阶段暂停并回传；没有修改业务 mapper、Prisma、IndexedDB、页面或删除语义。
- 总控正式决定：采用方案 A。公共 snapshot 增加 additive optional+nullable `total_size_bytes`，只从既有 `AudioObject.totalSizeBytes` 投影；不新增 Prisma 字段/migration。A3 runtime 后 ordinary canonical GET 必须显式带键；缺键/null/unsafe/mismatch 对播放和本机删除失败关闭。
- 白名单决定：A1 `ProjectSessionListItem` 不扩字段；restricted `EvidenceFinalizationResponse` 不扩字段。A3 只能使用当前 assignment + ordinary visibility 下的 canonical session GET，不能用列表、created_by、本机 archive 或 evidence seam 绕权。
- 需要同步修改：SPEC-DEV-008A3-PREFLIGHT、`04/05/08/09/10`、packages/contracts、ADR-036、任务板/追踪/审查/交接/journal。
- 受影响任务：本 SPEC 候选阶段保持 `REVIEW`；DEV-008A3 在本 SPEC exact-head PASS/merge 前保持 `BLOCKED`。A2、DEV-008D 与 CON-023 状态不变。
- 关闭条件：项目负责人授权总控对非 Draft PR final exact head/CI 手动审查 PASS，PR merge 且 main CI 成功；关闭只解锁 A3 runtime，不代表 A3 或服务器隐私删除完成。
- 关闭证据（2026-08-12）：项目负责人对 PR #37 exact head `70167688202117364e5cab74c9a320e0a7d76742` / CI `31597563095` 手动独立审查 PASS（P0/P1/P2=0）；正式记录为 [issuecomment-5266978939](https://github.com/Li-Ming-G/elder_interview_ai/pull/37#issuecomment-5266978939)。PR 以 merge commit `60f60cb6b5c8f70c9fca9840aa6c495f6e2318d8` 合入 main，main CI `31598183784` SUCCESS。关闭条件全部满足，DEV-008A3 恢复 `READY`。
- 历史与边界：原 Correction、方案 A、REV-044 `PENDING` 候选历史永久保留。本关闭只证明 contract-first 接缝已接收；A3 mapper/controller、IndexedDB、页面与 runtime 测试仍未实现。DEV-008A2 保持 `READY`，父 DEV-008A 保持 `IN_PROGRESS`，DEV-008D 保持 `BLOCKED`，CON-023 继续 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`。

### CON-030｜第二次访谈旧摘要/待确认页面与无记忆 UI 边界冲突

- 状态：`RESOLVED`
- 发现时间：2026-08-13
- 发现者：SPEC-REPEAT-INTERVIEW-001 docs-only 契约任务
- 涉及文件与章节：`01` §5.9/§13、`03` §9/§21、`09` 场景 B/§17、DEV-006、SPEC-REPEAT-INTERVIEW-001
- 冲突内容：`01/03` 已明确第一版不新增记忆列表、冲突列表、摘要待确认页或第二次访谈前回顾页，但 `09` 场景 B 仍要求“查看上次摘要和待确认”，会让实现 Agent 偷增页面并把未确认/不可见派生内容当用户工作流。
- 项目负责人本轮决定：用户所说“回顾上次对话”只指后台 AI/系统继承 current memory 与 reliable actual asked，以及已有 session 行的只读回顾；不新增摘要、待确认或记忆管理 UI。
- 写回：`09` 场景 B 已改为 project 卡 next-session、已有 session review、后台 membership 与 opening exact once；`01` §13、`03` §21、`07` §18 和任务边界同步。
- 关闭确认：本冲突由项目负责人当前明确指令直接裁决并完成正式文本一致化，标记 RESOLVED；这不代表 B1/B2 runtime 已实现或审查通过。

## 登记模板

```text
冲突编号：CON-XXX
状态：OPEN / DECIDED / RESOLVED
发现时间：
发现者：
涉及文件与章节：
冲突内容：
受影响任务：
临时处理：
需要谁决策：
最终决定：
需要同步修改的文件：
完成确认：
```
