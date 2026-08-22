# Memory P3 Retrieval V1

状态：`FORMAL CONTRACT / REVIEW CANDIDATE`。这是 `P3R-01-CONTRACT` 的内部检索契约；只冻结 P3 的可读范围、候选边界、图关系、embedding/storage seam 与配置面，不实现 migration、索引、retrieval runtime、P4 或真实 provider。

## 1. Responsibility and boundary

P3 是纯程序检索。它可以把当前会话的 Working 记忆作为 query signal，但 Working 永远不是 P3 candidate，也不会因为参与检索而变成 Mid/Long。P3 不写入 MemoryClaim、MemoryResolution、MemoryEvidence、layer identity 或 layer revision。

`MemoryClaim` 与 `MemoryResolution` 仍是 semantic value、status、correction、supersede 与 dispute 的唯一 authority。P3 candidate 只暴露经过 authority/readability gate 的安全语义内容和 reference metadata；它不是第二份 memory truth。

现有 `MemoryRetrievalService` 是 legacy seam，仅供既有薄 P3/P4 consumer 保持兼容；它不是本契约的 P3 authority，不能作为 P3 V1 的实现或行为证明。正式 P3 runtime、reader 和 integration 必须以本契约为准。

## 2. Readable search set

一次 retrieval request 的 scope 是一个 `project_id` 与一个当前 `session_id`。可检索集合严格限定为：

| Source level | Readable scope | Required gate |
| --- | --- | --- |
| `mid` | 当前 session 的 Mid revisions | project/session 相同；revision、authority、retention 与 deletion policy 均 readable |
| `long` | 当前 project 的跨 session Long revisions | project 相同；Long source session set 可跨 session，但不得跨 project；同样通过完整 readability gate |

Working、raw transcript、transcript segment、evidence row、interim/未 finalized 输入、candidate cache、P1/P2 transient object、superseded/hidden/expired/unavailable row 均不属于 P3 candidate set。当前 session 的 Long 仍按 project Long 读取；Mid 不得跨 session。

检索前必须从 P2 reader 获得完整、当前、可读的 layer revision/reference projection。缺 authority、revision/member parity、evidence/readability、retention 或 deletion-policy gate 时 fail closed，该 row 不得返回。

## 3. Query signal and candidate shape

Working 只以 `MemoryP3WorkingQuerySignal` 进入 query side。它可以携带当前 Working 的稳定引用和有限 semantic query signal，但不得携带 raw transcript/evidence 作为 candidate 输出；P3 也不得把 Working signal 映射成 `MemoryP3Candidate`。

每个 candidate 必须同时暴露以下信息：

- `memory_id`：语义 memory reference；
- `authority_id`：对应 `MemoryResolution` authority；
- `revision`：authority revision observed at read time；
- `source_level`：`mid` 或 `long`；
- `source_session_ids`：Mid 必须只含当前 session；Long 是同 project 内该 readable Long revision 的完整 source session set；
- `kind`：`episode` 或 `fact`；
- `status`：仅 readable 的 `current`、`uncertain` 或 `disputed`；
- `safe_content`：来自 semantic authority 的有界安全内容，不是 transcript/evidence/raw provider payload；
- `retrieval_sources`、分项 scores、综合 `score` 与最终 `rank`；
- stable `MemoryLayerIdentity` reference，用于 revision/graph provenance。

Candidate closed shape 不允许 raw transcript、evidence body、prompt、context、provider payload、SQL/CAS/transaction control fields 或未声明的扩展字段。evidence 只可通过已有 authority/reference provenance 在其他受控流程中 drill down，不能嵌入 P3 candidate。

P3 V1 的 retrieval sources 是 `embedding` 与 `graph_neighbor`。没有 embedding provider/model 时不得伪造真实 embedding 成功；实现可在配置允许时只使用已存在的合法 source，但不得改变 candidate scope 或安全边界。

## 4. Deterministic ranking and configuration

P3 的输入、readable snapshot、query signal、configured threshold/limit 与 graph neighborhood 相同，输出 candidate identity、scores、source set、排序和 rank 必须相同。实现不得依赖 wall clock、随机数、provider response ordering 或未声明的数据库顺序。

`embedding_threshold`、`candidate_limit`、`graph_neighbor_depth` 与 `graph_neighbor_limit` 是配置项；P3 不冻结具体生产数值，也不引入 P4 numeric budget。threshold/limit 必须在 request/config 中显式可追踪，超出 limit 的 row 不得作为 candidate 返回。tie-break 必须使用稳定 key（最终至少按 score descending、source priority、stable memory/layer identity ascending）。

## 5. Graph contract

V1 只允许四种 graph relation：`CONTINUATION`、`RESUME`、`BRANCH`、`RELATED`。任何其他关系名、隐式 hierarchy、session-only edge 或未经 identity 绑定的 edge 都 invalid。

每条 edge 必须绑定同一 project scope 内两个 stable `MemoryLayerIdentity` references。edge 连接 identity，不连接某个临时 candidate、raw transcript/evidence、Working item 或只存在于某一 revision 的 node；revision 只能作为 provenance/readability metadata。identity tuple 沿用 P2 persistence contract：`project_id + origin_session_id + origin_thread_id + origin_resolution_id`。A → B → A 必须复用 A 的 stable identity。

Graph traversal 只能产生 `graph_neighbor` source，并遵守 configured depth/limit 与同一 readable Mid/Long scope。它不得扩大 project/session scope，也不得绕过 authority、retention、deletion 或 status gate。

## 6. Embedding and storage seam

P3 定义 provider-neutral `EmbeddingProvider` port：调用方只依赖稳定的 provider-neutral request/result shape（文本输入、维度、向量与 provider/model metadata），不把具体厂商、模型、区域、secret 或 SDK 类型写入 P3 contract。real embedding provider/model/dimension、activation、cost and budget remain `DEFERRED`。

P3 V1 storage is PostgreSQL with the `pgvector` extension. Vector column/index/operator choice、migration、backfill、query plan、connection/runtime wiring 与 production dimension 仍属于后续 P3 tasks；本契约不授权提前实现它们。P3 不引入独立 vector database。

## 7. Non-goals and acceptance boundary

本契约不实现：P2 semantic consolidation、P2 persistence migration、retrieval service/reader、embedding model selection or activation、real data/consent/deployment、P4 Context V2/priority/budget、P5 evidence drill-down 或 P6 orchestration。

通过本契约测试只证明 closed shape、enum/scope/identity rules 与 configuration seam 自洽；不表示 PostgreSQL migration、pgvector index、real embedding、retrieval runtime 或 product flow 已完成或被 Architect 接受。

Machine artifact: [`memory-p3-retrieval-v1.schema.json`](memory-p3-retrieval-v1.schema.json)。TypeScript surface: `apps/api/src/memory/memory-p3-retrieval.types.ts` 与对应 contract specs。
