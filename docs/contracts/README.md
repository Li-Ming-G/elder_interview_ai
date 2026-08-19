# 机器可读契约目录

本目录用于保存可被代码生成器、契约测试和 Agent 直接读取的正式契约。

文件状态逐项声明，不能再把整个目录一概视为占位。标记为正式的文件可作为机器契约；其余候选/占位文件仍不得用于生产代码生成或运行时校验。

REST 的正式 TypeScript shared DTO 位于 `packages/contracts/src/index.ts`，与本目录的 JSON Schema/OpenAPI 资产共同受 `05` 的契约变更规则约束。`ProjectListProjection`、`ProjectSessionListResponse` 与 `EvidenceFinalizationResponse` 已由 SPEC-DEV-008A1-ACCESS / REV-042 exact-head PASS 并合并，现为 DEV-008A1 的正式实现依据；接收 shared DTO 不代表对应运行时已实现。

DEV-008A4 / ADR-037 / REV-047 的普通首次访谈行为修订不新增 REST DTO、数据库字段或公共状态枚举；可执行 start gate 由 `apps/api/src/project-foundation/interview-start-policy.ts` 表达。ServiceTerm DTO/API 保留 dormant，普通 transcript list 的 `conversation` 过滤与 exact complete ACK 本机状态转换属于既有 DTO/状态上的收紧行为。WS 1.1 `asr.interim` 则以向后兼容新增必填 `content_kind` 明确迟到校准临时文本边界，正式 machine DTO 为 `packages/contracts/src/index.ts` 的 `InterviewWsAsrInterimPayload`；生产者权威分类和 consumer 失败关闭规则以 `05` §5.7/§10.2 为准。

- `openapi.yaml`：REST API 的机器可读定义；
- `websocket-events.md`：实时事件目录及其 Schema 文件索引；
- `interview-recorder-output.schema.json`：访谈记录员结构化输出；
- `interview-director-context.schema.json`：`InterviewDirectorContextV1`，正式；是 Director 实际输入字段、类型、必填性、枚举和边界的唯一技术结构；
- `interview-director-output.schema.json`：`InterviewDirectorOutputV1`，正式；是 Director 实际输出字段、类型、必填性、枚举和交叉约束的唯一技术结构；
- `decision-trace-v1.schema.json`：`QuestionOrchestrationDecisionTraceV1`，T0 已接收的正式字段/枚举约束；只允许保存 ID、revision、hash、版本、typed membership references、状态、分数/排序、result IDs 和耗时，不允许保存完整 prompt、context、transcript 或 provider payload。P1–P6 映射与 retention/authorization 边界见 `docs/agent/tasks/MEMORY-SYSTEM-V1-ARCHITECTURE-MAPPING.md`。
- `memory-maintainer-context-v1.schema.json`、`memory-maintainer-output-v1.schema.json` 与 `fixtures/memory-maintainer-v1.fixtures.json`：PR #66 已接收的 `MEMORY-T2-T4-CONTRACT-001` 历史 machine contract，状态 `ACCEPTED-HISTORY / PRE-RUNTIME-SUPERSEDED`。三文件字节由 v1.1 contract test 的 SHA-256 固定保护；runtime 不得加载 v1。
- `memory-maintainer-context-v1.1.schema.json` 与 `memory-maintainer-output-v1.1.schema.json`：`MEMORY-T2-T4-CONTRACT-002` 已接收并由 PR #68 runtime accepted/merged 的历史可读 runtime 前置。它修正 text revision 0、semantic/lifecycle 分离、disputed conflict set、failed retry/dedupe、transcript-owned consumption 和唯一 producer cutover；accepted runtime head `f55da95`、merge/main `58794c4` 的历史保持可追溯，不因 v1.2 候选被改写。
- `fixtures/memory-maintainer-v1.1.fixtures.json`：v1.1 Schema、跨文档 semantic、revision parity、job dedupe、consumption 与 producer cutover 正反例；由 `apps/api/src/memory/memory-maintainer-contract-v1-1.ts` 纯函数机械验证。
- `memory-maintainer-v1.2.md`、两份 `memory-maintainer-*-v1.2.schema.json` 与 fixtures：`MEMORY-T4-P1-SEMANTIC-TRIGGER-001` 的 forward candidate，当前 `REVIEW`。P0 核心只保留 Episode/Fact 与独立 Boundary；person/place/event 等仅为 optional nullable `memory_tag`，不参与 identity/CAS。trigger facts 必须从实际 selected-new trusted-elder conversation membership 按 NFKC、移除 Unicode 空白、Unicode code point 累计重算；普通低内容扫描零 job，final flush 低内容只允许 `MEMORY_UNJUDGED` 系统终态且零 provider/业务记忆写入。v1/v1.1 artifacts 保持不可变，runtime 只可在 v1.2 exact-head 独立 PASS/merge 后切换。
- `export-manifest.schema.json`：导出资料包清单。
- `streaming-asr-provider-v2.schema.json`：`StreamingAsrAdapter v2` 供应商中立 lifecycle/result/drain/error 正式 Schema；
- `tencent-realtime-asr-v2.profile.json`：腾讯实时 ASR V2 正式 profile，含 verified/inference/unknown 及实际 query、参数省略和 canonical signature 规则；
- `streaming-asr-provider-v2.md`：v1→v2 迁移、腾讯映射、安全、指标、成本与真实 provider 验收的唯一技术契约。
- `local-audio-archive-v1.schema.json`：`LocalAudioArchiveV1`，正式；定义当前 origin IndexedDB 访谈 archive 的本机投影、删除结果和最小回执。它不是服务端 deletion request、隐私删除审计或跨设备档案。
- `fixtures/local-audio-archive-v1.fixtures.json`：上述 Schema 的正反例集合；`expected_valid=false` 条目用于机械证明矛盾 state/count/playback/pending/deleted_at 组合会被拒绝。
- `llm-provider-registry-v1.schema.json` 与 `llm-provider-registry.default.json`：`SPEC-LLM-PROVIDER-001` 的 `CANDIDATE / REVIEW` registry/config；profile 必须列出 exact model/config ref、endpoint、region/jurisdiction、secret reference、environment/data class 和真实访谈审批证据。默认无 provider、无 active binding、真实内容 deny，不得在项目负责人 exact-head PASS 前作为 runtime authority。
- `llm-provider-registry-semantics-v1.md` 与 `fixtures/llm-provider-registry-semantics-v1.fixtures.json`：REV-050 定向修复的跨数组 exactly-one/membership/duplicate/digest deterministic contract；JSON Schema 通过不替代 semantic validator。
- `llm-model-config-v1.schema.json`、`llm-model-config-v1.md` 与 fixtures：完整 generation/provider-options manifest、canonical JSON v1、SHA-256 golden vector 和 equal-effective-config 边界。
- `llm-provider-call-receipt-v1.schema.json` 与 `fixtures/llm-provider-call-receipt-v1.fixtures.json`：`LlmProviderCallReceiptV1` 候选 provenance；拆分 requested/observed model、provider request ID、SDK response ID 与各自来源，并用正反例锁定 sanitized config warning/status。禁止用 `local-test` 补缺，不包含完整 Prompt/Context/output、warning 原文或 secret。
- `staging-deployment-manifest-v1.schema.json`：`DEV-STAGING-DEPLOY-001` 的正式服务端 deployment manifest Schema；唯一数据许可字段为 `data_mode=synthetic_only`，missing/unknown/其他值及旧 `real_data_allowed` 等平行字段全部失败关闭。
- `fixtures/staging-deployment-manifest-v1.fixtures.json`：manifest 正反例与入站 provenance 判定矩阵；真实来源即使去标识/脱敏、真实备份或来源不明，也必须在 connect/upload/persist 前以零业务副作用拒绝。
- `memory-evolution-v1.md`、`memory-evolution-context-v1.schema.json`、`memory-evolution-output-v1.schema.json` 与 fixtures：`MEMORY-T5-T8-P2-A-CONTRACT-001` 的 P2-A formal candidate；冻结 Working->Mid checkpoint/layer references、claim/boundary facts、Park/Resume hierarchical consequence 和 strict cross-document semantic validators，不接 Prisma/runtime。
- `long-memory-consolidation-context-v1.schema.json`、`long-memory-consolidation-output-v1.schema.json` 与 fixtures：T8 Long reference-only terminal contract；机械拒绝 value/text/transcript/prompt/context/summary/narrative/provider payload。
- `decision-trace-v1.1.schema.json` 与 fixtures：T0 forward trace contract，区分 `trace_kind` 与 `memory_outcome`；v1 schema/fixtures bytes 不变。`apps/api/src/memory/decision-trace-v1-1.contract.ts` 是 strict format/UTF-8 raw schema digest loader，不是 orchestration runtime。
- `memory-semantic-envelope-v1.md`、五份 `memory-semantic-*-v1`/plan/committed closed Schema 与 fixtures：`MEMORY-T5-T8-P2-A1-SEMANTIC-ENVELOPE-001` 的 contract-only candidate。它临时解引用 bounded Claim/Resolution value供 P2 语义整理，Context、Proposal 与 committed authority 的 `canonical_key` 统一为 1-240 字符，并有 240 成功/241 拒绝/201-240 完整 envelope 边界测试。Context 内 durable Resolution identity 与 evidence membership/segment identity 全局唯一；模型只输出闭合 source/claim/evidence 子图与 proposed state，同一 evidence 可支持不同 claims，唯一键为 claim/evidence pair。proposal/plan/commit 的 ID、target slot、CAS authority、committed authority/metadata 与 MemoryEvidence 集合均按整个 projection 校验，并有多 entry 正反 fixtures。进程内 plan不持久化、不拥有 authority；MemoryModule 成功后才形成带 authority dialect parity、完整 pair parity 和 whole-commit digest 的 P2-A forward bridge。Long 输入绑定 final Mid/current 分域 manifest；Long/layer/Trace/log仍 reference-only，P1 明确禁止 Long input，真实 provider/model仍 unavailable/deferred。
