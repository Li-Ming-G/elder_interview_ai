# Handoff｜Memory System V1 产品负责人决策补充

状态：`REVIEW / GOVERNANCE SYNC ONLY`

依据：项目负责人决策附件 `C:\Users\TR\.codex\attachments\0c191ede-f8c2-49db-8b53-ffbc8f8091f0\pasted-text.txt`，与 `SPEC-MEMORY-SYSTEM-V1`、ADR-043 至 ADR-050、REV-058 至 REV-062 对照。

## 已冻结的职责边界

- **P1** 只理解当前 session 的 Working Memory；不做 Long Memory write-side retrieval，也不新增 Long Retrieval Agent。历史 Long 由 P3 检索，供 P4 Context 与 Director 消费。
- **P2** 必须保留 LLM semantic consolidation：Working→Mid，以及 session end 的 Mid/current→Long，并可做必要的重新归纳、去重和跨 session 整合。LLM 只提出语义整理结果；persistence、CAS、revision、evidence、状态变更和 transaction 由程序控制，LLM 不直接访问或修改数据库。P2-A contract-only 接收不等于 P2 runtime 完成。
- **P3** 使用 PostgreSQL + pgvector + provider-neutral Embedding Adapter；deterministic/fake embedding 可用于开发和测试，真实 embedding model 未冻结。
- **Graph V1** 只冻结 `CONTINUATION/RESUME`、`BRANCH`、`RELATED`，底层保留 `source_memory_id`、`target_memory_id`、`relation_type` 的可扩展形状；不引入完整知识图谱、Neo4j 或复杂 ontology。
- **P4** 只实现可配置 Context Budget 机制；`working_memory_budget`、`recent_transcript_budget`、`active_memory_budget`、`memory_candidate_budget`、`asked_history_budget`、`displayed_history_budget`、`question_bank_budget` 等具体数值为 `DEFERRED`。`last-40 segments` 不是核心架构，可保留 max-segment safety guard。
- **Evidence Drill-down V1** 仅有 `get_memory_evidence(memory_id)` 与受限 `search_transcript(query)`；一次 Director generation 最多一次 tool call，工具失败必须为 `SYSTEM_ERROR`，不得伪装为 `continue_listening`，诊断至少保留 stage、error_code、duration、message。

## Provider、模型与最低安全底线

- LLM Provider/Model = `DEFERRED`；开发 Agent 不得自行选择厂商或具体模型。
- 保留 `P1_MODEL`、`P2_MODEL`、`DIRECTOR_MODEL` 三个独立配置槽；Provider Config 支持可选 Base URL、API key、Model ID。三个槽位可以暂时共用同一模型，但代码不得写死为只能共用。
- API key 只允许 server-side 使用，不得进入前端、GitHub 或日志；使用环境变量或既有 secret injection。高级 security hardening、DPA/跨境/企业级审计、正式 benchmark/A-B 横评均为后置或 `DEFERRED`，不等于真实数据或生产许可。

## 未来必须拉回负责人确认

1. 真实 LLM provider/model（P1、P2、Director，以及 API key/Base URL）。
2. 真实 embedding model（主 Provider 确定后）。
3. P4 Context Budget 的具体数值（Director 主模型确定后）。

到达对应开发节点必须主动提醒负责人；遇到新的产品含义歧义，暂停该具体决策并上报，不用工程实现默默定义产品行为。

## 当前工作边界

本交接只同步治理文档，不接收真实 provider、真实 embedding、真实数据、正式生产授权、公网部署或生产许可。父任务 `SPEC-MEMORY-SYSTEM-V1` 与当前 v1.2 P1 修正继续保持 `REVIEW`；既有 PR/REV/CI 历史不得改写。
