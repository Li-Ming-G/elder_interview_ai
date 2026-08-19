# SPEC-MEMORY-SYSTEM-V1｜Memory System V1 路线与实施边界

## 1. 状态与依据

- 状态：REVIEW（T0 / Foundation-Observability、PR #65 candidate/local Memory Core、PR #68 T2-T4/P1 v1.1 runtime、PR #69 P2-A contract、PR #70 P1 v1.2、PR #71 A1 semantic envelope 与 PR #72 P2-B database-agnostic persistence contract 已分别按各自范围接收；PR #73治理closeout完成；P2-C contract-first且implementation未开始；P2-D、P3/P4 runtime尚未开始）。
- 依据：`C:\Users\TR\Downloads\LLM记忆改造.md` 最底部 T0–T27 安排，以及项目正式 `00`–`10` 规范、现有 AI/Memory/QuestionEvidence 契约和最新 handoff。
- 当前 Memory 基线分层记录：PR #65 accepted `7d0a0460beccfdb4b502acb8d9a69f98de8c5730` / CI `31941029795`、merge/main `081b404e613d373ab97365e691f8845e853d304f` / CI `31989367027` SUCCESS（candidate/local seam）；PR #68 T2-T4/P1 runtime、PR #69 P2-A contract 与 PR #70 P1 v1.2 的 accepted/merge/main 事实分别见 REV-060/061/062、ADR-048/049/050。PR #70 merge/main `00953ac` tree 与 accepted head tree `033d3a9b` 一致；main CI `32165583907` cancelled，不得写 SUCCESS。上述均不代表 P2 runtime、正式 P3/P4、真实 provider/model 或真实数据已接入。

当前顺序门禁由 ADR-052/053 冻结为 `A1 semantic envelope accepted -> P2-B persistence contract accepted -> P2-C runtime -> P2-D`。A1/P2-B均已contract-only接收，P2-C当前仅contract-first；MemoryClaim/Resolution是唯一semantic authority，Long/layer/Trace/log reference-only。

本文件是实施路线，不把规划内容伪装成正式机器契约。凡涉及表结构、状态枚举、REST/WebSocket、AI Schema 或数据所有权的改动，必须先建立对应正式契约并由项目负责人审查。

## 2. 目标架构

```text
Transcript
  -> P1 Working Memory
  -> P2 Mid / Long Memory
  -> P3 Retrieval
  -> P4 Context Assembly
  -> Interview Director
  -> Evidence Drill-down
  -> Question / Continue Listening / System Error
```

不新增第二个 Director、planner/critic 或多 Agent 调度层。P1 只理解当前 session；P2 LLM 负责 Working→Mid 与 session-end Mid/current→Long 的 semantic consolidation；P3/P4 程序化检索与 Context assembly；Director LLM 负责 QUESTION/CONTINUE_LISTENING。程序负责确定性触发、权限、事务、预算、状态机和写回；LLM 只提出被正式 Schema 约束的语义结果，不能直接访问或修改数据库。

### P1–P6 映射（所有任务/PR 必须标注）

| 层 | 架构职责 | 对应任务 |
|---|---|---|
| Foundation / Observability | 跨层诊断、错误可见性、Trace、评价基座 | T0–T1、T26–T27 的观测部分 |
| P1 | 当前 session 的 Working Memory Maintainer 与 active thread；不检索 Long | T4、T18–T20 的 P1 trigger |
| P2 | LLM semantic consolidation：Working→Mid、Park/Resume、Checkpoint、session-end Mid/current→Long | T5–T8、T22 的 P2 后台 |
| P3 | PostgreSQL + pgvector + provider-neutral embedding adapter；最小 Graph Neighbor candidate retrieval | T9–T10 |
| P4 | 程序化 Context V2、优先级、可配置 budget、membership freeze | T11–T12 |
| P5 | Evidence Drill-down、Evidence Gate、Correction | T13–T17、T25 的 evidence/boundary 规则 |
| P6 | Director/runtime orchestration、generation fence、deadline、evaluation feedback loop | T3、T15、T18–T25、T26–T27 的运行时部分 |

任务卡、PR 标题/正文、handoff 和 review 必须同时写 `Tn` 与 `Foundation/Observability` 或 `P1`–`P6`；T0/T1 固定标记为 `Foundation/Observability`，不得只用 T 编号推进。

## 3. 分阶段路线

| 阶段 | 任务 | 输入 | 主要输出 | 最小验收 | 依赖/边界 |
|---|---|---|---|---|---|
| 0 | T0–T1 诊断与错误可见性 | 现有 generation attempt、QuestionEvidence、Director 输出 | Decision Trace；`QUESTION`/`CONTINUE_LISTENING`/`SYSTEM_ERROR` 投影与诊断字段 | 任一生成可回答“看到了什么、为何决策、各阶段耗时”；timeout/P3 错误前端不伪装成 continue | 先于 Memory schema 大改；不含完整输入/密钥/原文日志 |
| 1 | T2 数据合同 | 现有 MemoryClaim/Resolution/Evidence | Episode/Fact/Boundary、Working/Mid/Long、Thread Active/Parked、revision/status、evidence membership 契约 | synthetic fixture 可表达来源、状态、revision、关系并可回溯 transcript segment | 先契约后 migration；不引入 Neo4j |
| 2 | T3 Provider | provider-neutral coordinator、manifest/registry 基座 | 至少一个正式 provider adapter、统一 timeout/structured output/retry/error/provenance | 完全虚构数据完成一次 Director 调用；真实 provider 仅在厂商、model、region、data policy、secret 注入和人工接收齐备后 | 当前父任务仍 BLOCKED；中转站需单独登记 endpoint/region/retention/training/billing |
| 3 | T4 P1 Working Memory | finalized transcript batch、当前 Working、active thread、session Mid index | Maintainer 候选操作：Episode/Fact/Boundary 与 CONTINUE/BRANCH/RESUME/NEW/DUPLICATE/SUPPLEMENT/RELATED/UNCERTAIN | 阈值/时间触发；同一事件补充更新而非重复创建；只产候选，不直接写库/删记忆/决定问题 | 不逐 segment 调模型；由程序验证并执行操作 |
| 4 | T5–T8 P2 演化 | Working thread、Mid index、session end | P2 LLM semantic consolidation、Park/Resume、checkpoint、final flush、post-session Long | A→B→A 可恢复同一 thread；Working 有上限；会后 Long 保留 evidence、不静默覆盖 | LLM 只提案；persistence/CAS/revision/evidence/transaction 由程序控制；失败不影响 completed/录音 |
| 5 | T9–T10 P3 Retrieval | Working + recent transcript、active thread、Mid/Long | PostgreSQL+pgvector embedding 与最小 graph-neighbor candidate set（可为空） | 召回跨 session 相关记忆；不相关候选可全部丢弃；Graph V1 仅 CONTINUATION/RESUME、BRANCH、RELATED | provider-neutral adapter；真实 embedding model DEFERRED；不引入 Neo4j/BM25/Intent LLM/Reranker |
| 6 | T11–T12 P4 Context | state/goal、Working、active memory、recent transcript、candidates、boundaries、asked/displayed、bank | `InterviewDirectorContextV2`、优先级与可配置 budget、membership/digest | 高优先级边界/状态不被低优先级内容挤掉；同一冻结 context 可复现 | 具体 budget 数值 DEFERRED；`last-40` 不是核心架构；旧 V1 保持兼容 |
| 7 | T13–T15 Evidence | memory evidence membership、transcript | `get_memory_evidence`、受限 `search_transcript`、最多一次只读 drill-down | 返回原文片段及邻近上下文；最多一次 tool call；工具失败为 SYSTEM_ERROR，不伪装 continue_listening | 权限、删除、retention 复用既有契约；诊断保留 stage/error_code/duration/message |
| 8 | T16–T17 Gate/Correction | candidate operations、evidence | Episode/Fact/Boundary gate；SUPERSEDED/UNCERTAIN/DISPUTED/REVOKED 非破坏修订 | Fact 默认仅接受长者明确表达；更正保留旧版本和 evidence；Boundary 明确撤回才 REVOKED | 不自动推断 Fact；不覆盖原始录音/转录 |
| 9 | T18–T24 Runtime | ASR finalized、P1/P2 jobs、Director attempts | buffer→hybrid P1 trigger→automatic gate/manual next→generation fence→deadline/error | 不逐 segment 调 Director；manual next 可绕过自动 20s；旧 generation 不得写回；超时为 SYSTEM_ERROR | 不阻塞录音/ASR；P2 后台不阻塞 Director |
| 10 | T25 Prompt | V2 context/schema 已稳定 | v2-draft 更新；candidate/version/digest 记录 | 明确 candidates/boundary/evidence/uncertain/continue 语义；仍不可 runtime load，直到正式接收 | 不重命名 v2-draft；不覆盖 v1 |
| 11 | T26–T27 Evaluation | Decision Trace、固定 synthetic transcript cases | 人工反馈标签；固定 10-case 记忆测试集 | 覆盖补充、Park/Resume、Duplicate、Supersede、Uncertain、Boundary、跨 session retrieval、误召回、evidence、continue | 评价写隔离 artifact，不写 QuestionEvidence/current/history |
| 12 | 首次完整访谈 | 所有阶段 PASS、真实 provider/授权/数据/部署门禁 | 一次完整真实访谈验证与问题归因 | 先看 Trace 定位 P1/P2/P3/P4/Prompt/Trigger，再决定单层修复 | 当前明确禁止；不得由 synthetic 证据替代 |

## 4. Decision Trace 最小冻结方向（T0）

T0 记录的是每次 question-orchestration decision/generation attempt，而不只是“调用了 Director”。因此 `continue_listening`、无 provider、前置门禁拒绝、超时、重试失败和 stale/late fence 等不调用模型的路径，也必须产生一条完整 trace，并明确 `director_invoked=false` 与跳过原因。T0 先保存可审计的引用和结果，不保存完整 prompt/context/transcript/provider 原文。每条 trace 至少包括：

- `generation_id`、`trigger_type`、`created_at`、`session_id`、`project_id`；
- 输入引用：transcript range/revision、working revision、active thread、mid/long memory IDs、P3 candidates/source/score；
- P4：context version/digest、实际进入 Director 的字段 membership、budget drop/裁剪记录；每个 Working/Mid/Long memory、P3 candidate、P4 section membership 和 Evidence 调用都必须保存 ID、revision、membership/order、digest 或结果 ID 引用，足以重建当次输入集合，但绝不保存正文副本；
- Director/决策结果：question/continue_listening/system_error/unavailable、`director_invoked`、stage/gate、output schema/version、error code；
- Evidence：是否调用、tool 名、请求/返回摘要引用、调用次数；
- latency：P1/P2/P3/P4/Director/total；
- provenance：ai job/attempt/provider receipt/config digest；
- append-only 语义，late generation 不得覆盖新 trace 或 question state。

实现时优先复用 `AiJob`、generation attempt、QuestionEvidence event 和现有 provider receipt；只有缺失的跨阶段引用才新增一个受 retention 管理的窄 trace root/投影，不复制已有 segment/memory membership 或正文。Trace 必须与冻结 job/attempt 事务关联，终态后不可变，late result 不得改写。T0 的第一版允许未接入 P1–P4 时记录 `unavailable/not_started`，但不得虚构成功数据。

## 5. 文档未完全规定、需要本项目补出的细节

以下是原任务清单未冻结、实施前必须写入契约/ADR 的项目决定：

1. Decision Trace 的持久化载体、retention root、脱敏字段和查询权限；
2. Trace 与 `AiJob`/generation attempt 的一对一或一对多关系，以及重试/late writeback 规则；
3. P1 操作候选的正式 JSON Schema、事务验证顺序和幂等键；
4. Episode/Fact/Boundary 的 authority、同义合并、冲突与撤回权限；
5. Working/Mid/Long 的容量、checkpoint、park/resume 和最终 flush 触发阈值；
6. 真实 embedding model、region/retention/training policy、成本上限；V1 向量存储冻结为 PostgreSQL+pgvector，接口保持 provider-neutral；
7. Context budget 的具体数值（计量单位、优先级、裁剪顺序和 digest 算法机制可先做可配置接口）；
8. `SYSTEM_ERROR` 的公开错误码、前端诊断字段和安全日志边界；
9. 人工评价与固定测试集的版本、隔离存储、审计和禁止写入业务事实的机械约束；
10. 真实 LLM provider/model 及 `P1_MODEL`、`P2_MODEL`、`DIRECTOR_MODEL` 的最终绑定。

这些条目在相应阶段前保持 `REVIEW/BLOCKED` 或 `DEFERRED`，不由实现 Agent 默默猜定；新的产品含义歧义必须上报。

## 5.1 T0 接收后的实现顺序

只有项目负责人接收 T0 提案后，按以下顺序开工：

1. 将 schema 从 `REVIEW` 提升为正式契约，并冻结错误码、结果枚举、retention/权限边界；
2. 选择与现有 `AiJob`/`QuestionGenerationAttempt`/`AiProviderCall` 兼容的窄 trace root，补 forward-only migration 和 retention cleanup 接口；
3. 实现 append-only repository：同一 request/generation 只能创建一个 trace，终态 CAS 后拒绝 late mutation；
4. 在 automatic、manual next、journey continue bypass、provider unavailable、timeout/retry、context/P3 failure、stale generation 和 publication failure 路径写入 trace；
5. 先补 persisted-state/unit/integration 覆盖四类结果与 provider-call=0 负例，再考虑 T1 前端投影；
6. exact-head CI、失败历史、任务板、需求追踪、ADR/handoff 同步后提交窄 PR，等待独立负责人审查。

该顺序明确禁止先写大规模 Memory migration、先切换 V2 Context、先安装真实 provider 或把 trace 做成完整上下文日志。

## 6. NOT V1（明确不做）

Neo4j/完整 Graph Database、除 `CONTINUATION/RESUME`、`BRANCH`、`RELATED` 外的 V1 relation ontology、Retrieval Reranker LLM、Search Intent LLM、Entity Agent、Temporal Reasoning Agent、无限 Evidence Tool Calling、自动推断 Fact、每个 Transcript Segment 调一次模型、实时语音情绪识别、多 Agent 调度框架、复杂消息队列基础设施。

## 7. 交付与门禁

- 每一阶段至少一个窄 PR；先契约/迁移，再实现和测试；exact-head CI、任务卡、需求追踪、ADR、handoff 同步。
- 核心架构、数据模型、权限、安全、状态机和跨模块契约必须由项目负责人或独立验收角色明确审查；执行 Agent 不得自行 PASS/DONE/merge。
- Provider/Model 当前为 `DEFERRED`，不得自行选厂商或模型；保留 `P1_MODEL`、`P2_MODEL`、`DIRECTOR_MODEL`、可选 Base URL/API key/Model ID 的 provider-neutral 配置槽。API key 只能 server-side，不能进前端或 GitHub。真实 LLM 只有在负责人确认 provider/model/region/endpoint、数据政策、DPA/retention/training、secret 注入和完整验证齐备后才可启用；真实长者、PII、生产公网、真实试点继续受现有 BLOCKED 门禁约束。高级 security hardening 与正式 benchmark 后置或 DEFERRED。
- 任一阶段失败时保留失败历史，不删除测试目标、不用 `continue_listening` 掩盖错误、不覆盖原始录音/转录/授权记录。

## T0 implementation closeout (REV-058)

The T0 / Foundation-Observability Decision Trace implementation received independent PASS at `40cc61e12ef63096474fe63b69463920f2d6a7c4` / CI `31936839303` and merged to main as `a9363dcd` with CI `31937348480` SUCCESS. This closes only the reviewed T0 reference-only implementation. The overall SPEC remains REVIEW for T1-T27; every future task/PR/handoff must retain explicit P1-P6 mapping, and real provider, real data, public deployment and formal v2 remain blocked.
