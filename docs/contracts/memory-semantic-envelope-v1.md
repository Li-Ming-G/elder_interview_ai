# Memory Semantic Envelope V1 正式候选契约

状态：`FORMAL CONTRACT / ACCEPTED CONTRACT ONLY`。任务：`MEMORY-T5-T8-P2-A1-SEMANTIC-ENVELOPE-001`。PR #71 exact head `dbb0cc76` / CI `32210618025` 获 owner `PASS / P0=0/P1=0/P2=0`，merge/main `7d02fa65` / main CI `32211560361`。本契约只补 P2-A1 machine envelope，不实现 Prisma、migration、repository、runtime writer、provider activation、P2-B/C/D、P3/P4 或 UI。

## 1. 为什么需要前向 A1

已接收的 `memory-evolution-v1` 只能把 checkpoint 中既有 Resolution 引用组织为 Mid/Long layer。P2 产品职责还要求 LLM 对 Working→Mid、session-end Mid/current→Long 做归纳、合并、重组、压缩和不确定表达。新语义结果必须先由唯一 `MemoryModule` 写成正式 `MemoryClaim/MemoryResolution/MemoryEvidence`，再进入 reference-only layer；旧 `source_resolution_id` 不能同时表示输入来源和新结果。

正式流程固定为：

```text
frozen checkpoint / final Mid manifest
  -> TransientSemanticContext（临时解引用有界 value + typed evidence refs）
  -> SemanticProposal（模型提议，不含 DB/CAS/lifecycle）
  -> ValidatedMemoryMutationPlan（进程内、一次性、非持久）
  -> MemoryModule 重新读取 authority + CAS + transaction
  -> CommittedSemanticProjection（source refs 与 committed authority 分离）
  -> reference-only Mid/Long layer + semantic Trace child
```

## 2. 所有权与内容边界

- `MemoryClaim/MemoryResolution/MemoryEvidence` 是唯一允许持久化 semantic value、claim 和 evidence 的业务 authority。
- `TransientSemanticContext` 可在 provider 调用期间临时包含已冻结 Resolution/Claim 的有界 semantic value；它不落 Context 表，不进入 Trace、技术日志或 provider receipt。
- `SemanticProposal` 只表达 source refs、`new_slot|existing_slot`、`derive|merge|reorganize|compress|mark_uncertain` intent、P1 v1.2 Episode/Fact proposed-state 方言和 claim-level evidence refs。intent 只用于语义解释/诊断，不决定数据库 lifecycle。
- 模型不得返回或控制 DB ID、最终 revision、layer identity/revision、lifecycle、Boundary mutation、source disposition、SQL、CAS、transaction、deletion 或 retention mutation。
- `ValidatedMemoryMutationPlan` 只存在进程内；不拥有 authority/lifecycle，不预留新 slot 的最终 ID，不宣称写入成功。existing slot 只携带当前 authority ID 与 expected revision供 MemoryModule 重读/CAS。
- `CommittedSemanticProjection` 只在 MemoryModule 事务成功后形成；它分开保存 `source_checkpoint_member_refs`、`committed_authority_ref`、`committed_evidence_manifest` 和 `target_layer` identity/revision。
- Long、layer、semantic Trace child、provider receipt 与技术日志始终 reference-only。禁止 semantic value、正文、转录、Prompt、Context、summary/narrative 或 provider payload。

## 3. Evidence 与 checkpoint parity

Context 的 claim 只引用 `evidence_ref_ids`。独立 `evidence_membership` 冻结 segment/session、text revision、speaker-role revision、effective-text digest、trusted elder conversation 与 input order，并形成 `memory-semantic-evidence-manifest-v1`。同一 `(session_id, segment_id)` 只能出现一次。`source_checkpoint` 必须与 Context 的 project、source-session set、member count、source manifest 和 evidence manifest 完全相等。

修改 evidence revision/digest 即使同时重算 semantic content，也会与冻结 checkpoint evidence manifest 失配。Context evidence membership 内任何 duplicate evidence ref、segment identity、order gap、scope/trusted-role/content-kind 漂移均失败关闭。validator 按 source member 建立 claim owner 索引；每个 proposal claim 的 source claim 必须归属于该 proposal 声明的 source member，evidence 必须属于这些 source claims。proposal 与 commit 的唯一键都是 `(proposal_claim_ref_id, evidence_ref_id)`；同一个 evidence ref 可以支持多个不同 proposal claims，但同一 pair 不得重复。proposal pair 集合与 committed pair 集合必须完全相等，不能遗漏、增加或用另一 claim 冒领。MemoryModule 成功后生成正式 `MemoryEvidence` ID 与 committed evidence manifest。

同一个 Context 内，每个 durable source `resolution_id` 必须全局唯一；不同 `source_ref_id` 不得包装同一 Resolution 形成重复 source member。该约束由 pure validator 机械执行，并受 source manifest/digest tamper 测试保护。

`session_end_to_long` 的 checkpoint 另含 `source_set.kind=final_mid_and_current`、Mid/current 各自 expected count 与独立 manifest hash。trigger `source_session_id` 必须属于 `source_session_ids`；final Mid 至少一项，Mid/current 的 identity、revision、digest、order 与完整数量必须分别匹配。`working_to_mid` 只能使用 `source_set.kind=working_checkpoint`，其 Mid/current count 为 0、manifest 为 null。

## 4. Canonicalization

算法版本：`memory-semantic-envelope-canonical-v1`。

- UTF-8；canonical JSON 递归按 object key 升序，array 顺序保持；不 trim、不做隐式 Unicode normalization。
- digest 输入为 `domain-prefix + NUL + canonical-json`。
- domain 分离：semantic content、evidence manifest、source manifest、Mid manifest、current manifest、proposal、claim-evidence manifest、mutation plan、committed evidence、whole committed projection 各自独立。
- source/evidence membership 必须从 0 连续排序，不能由 validator 自动重排。
- `plan_digest` 计算时排除自身字段，并覆盖 plan schema version、全部 link digest 与 entry 的 proposal/target/authority/state/evidence 字段；`commit_digest` 覆盖 committed projection schema version、全部 link digest、entry proposal/source/authority/evidence/layer 字段但排除自身。Trace 只引用 proposal/plan/commit digest，不保存 payload。

## 5. Pure semantic gates

1. `working_to_mid` 只接受同 project、同 source session 的 `working_resolution`；P1 Context 对任何 Long、`layer=long` 或 `long_resolution` 失败为 `P1_LONG_INPUT_FORBIDDEN`。
2. `session_end_to_long` 只接受完整 final Mid manifest 与显式冻结的 current Resolution；允许多 session，但禁止跨 project。
3. safety policy 对 source member、claim、evidence、semantic characters 与 JSON depth 提供版本化硬上限；具体 production budget 不由 A1 选择。
4. semantic value 只允许有界 JSON value，Schema 与 pure validator 双层递归拒绝 raw transcript/transcript、Prompt、provider payload/request/response、SQL、CAS 与其他控制字段。
5. proposal 的全部 source/claim/evidence refs 必须构成 Context 内闭合子图；merge/compress 至少两个 source；`mark_uncertain` 必须产生 `uncertain`。P1 v1.2 方言固定为 `exact -> single`、`range -> range`、`unknown -> unknown`；只有 `disputed` 可使用 `value_kind/value=null + conflict_set` 且至少两个 proposed claims。`canonical_key` 在 Context、Proposal 与 committed authority 三处统一为 1-240 个 Unicode code points。
6. automatic proposal 不得覆盖/降级 `human_confirmed` existing slot；Boundary、deletion 或 retention 非 active 时零合法 plan。
7. `new_slot` committed authority ID 必须与全部 source Resolution ID 分离且 revision 固定为 1；`existing_slot` target 必须属于 proposal source set，其 semantic kind/canonical key 必须与目标 source slot 相等，plan 携带 source current revision 作为 expected revision，commit 必须是同 ID 的 `expected+1`。自动 merge 不 supersede source Resolution。
8. committed authority 的 semantic kind、canonical key、value kind、resolution kind、status 必须与 proposal 逐字段相等；它们只是 reference metadata，不复制 semantic value。committed bridge 与 Trace 必须对 proposal/plan/commit/source manifests、source membership、authority/evidence/layer refs逐项相等；任一重复、遗漏、额外、顺序或 digest 漂移失败关闭。

### 5.1 Projection-wide invariant inventory

| Projection | 全局唯一/冲突集合 | 允许复用 |
| --- | --- | --- |
| Context | `source_ref_id`、durable `resolution_id`、source claim ref、evidence membership ref、`(session_id,segment_id)` | 一个 evidence membership 可被多个 source claims 引用 |
| Proposal | `proposal_id`、`proposal_claim_ref_id`、target `(semantic_kind,canonical_key)`、每 claim 内 claim/evidence pair | source member/source claim/evidence ref 可在不同合法 proposals/claims 复用 |
| Plan | entry `proposal_id`、target semantic slot、existing CAS target `resolution_id`；一个 authority 最多一个 write entry | source member refs 可跨 entries 复用 |
| Commit | entry `proposal_id`、committed `resolution_id`、target semantic slot、全 projection claim/evidence pair、`memory_evidence_id`；同 authority ID 的不同 revision/dialect/slot metadata 是冲突 | source checkpoint refs 与 evidence ref 可复用，但 evidence ref 跨 claim 时 pair 必须不同 |

这些集合必须在整个 projection 建立，禁止每个 entry 各自新建集合后遗漏跨 entry 冲突。多 entry 正例允许两个 proposal 共用合法 source/evidence；反例分别锁定 ID、slot、authority metadata、pair 与 durable MemoryEvidence 冲突。

## 6. Provider 与失败边界

deterministic fake 仅用于生成经过同一 Proposal Schema/validator 的固定 fixture；A1 不提供 fake runtime adapter。真实 `P2_MODEL` provider/model/region/secret 仍 `DEFERRED`，未配置时只能返回 `P2_PROVIDER_UNAVAILABLE`，禁止自动回落 fake 并冒充真实语义成功。provider late result、source/policy/revision drift 和 MemoryModule CAS failure 均不得产生 committed projection、layer 或 Trace committed refs。

## 7. Machine artifacts

- [`memory-semantic-context-v1.schema.json`](memory-semantic-context-v1.schema.json)
- [`memory-semantic-proposal-v1.schema.json`](memory-semantic-proposal-v1.schema.json)
- [`validated-memory-mutation-plan-v1.schema.json`](validated-memory-mutation-plan-v1.schema.json)
- [`committed-semantic-projection-v1.schema.json`](committed-semantic-projection-v1.schema.json)
- [`memory-semantic-trace-v1.schema.json`](memory-semantic-trace-v1.schema.json)
- [`fixtures/memory-semantic-envelope-v1.fixtures.json`](fixtures/memory-semantic-envelope-v1.fixtures.json)
- `apps/api/src/memory/memory-semantic-envelope-contract.ts` 与 contract/adversarial specs

P1 v1/v1.1/v1.2、P2-A v1、Decision Trace v1/v1.1 artifacts 与既有 migrations 字节不变。A1 contract 通过不表示 persistence、runtime、provider、真实数据或生产许可完成。

## 8. P2-C stable authority mapping

A1 `existing_slot`所称“同`resolution_id`到下一revision”在durable runtime中指同一stable `memory_resolution.authority_id`，不是复用现有row `id`。成功事务必须插入新的resolution row ID，复用authority ID，revision=`expected+1`，`supersedes_resolution_id`指向旧current row并原子supersede旧row。new slot同时分配不同的authority ID与首row ID。Proposal/Plan仍不持久化，也不预留任何最终row/layer revision ID。

A1 `memory_evidence_id`映射`MemoryClaimEvidence.id` evidence-link authority；它不持有semantic value。link authority revision固定为1，transcript text/speaker revision来自冻结`AiJobInputSegment`，两者不得混用。
