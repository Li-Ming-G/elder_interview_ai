# InterviewDirectorContextV2 / P4C-01-CONTRACT

状态：`FORMAL CONTRACT / REVIEW CANDIDATE`。本文与 [`interview-director-context-v2.schema.json`](interview-director-context-v2.schema.json) 共同定义 P4 Context V2 的正式 membership/freeze surface。它冻结可复现的输入形状和来源边界，不实现 assembly runtime、Director wiring、provider/model/tokenizer、embedding 或数值预算。

## 1. Authority and compatibility

`InterviewDirectorContextV2` 是 P4 的 formal context shape。`MemoryClaim` / `MemoryResolution` 仍是语义值 authority；P4 只编排已通过 P1/P2/P3 authority/readability gates 的 references 和安全内容。

`memory_candidates` 必须逐字段复用 accepted `memory-p3-retrieval-v1` candidate closed shape：P4 不添加 raw transcript、evidence body、prompt、provider payload、SQL/CAS 字段或新的 candidate truth。P3 candidate 的 `source_level`、`semantic_kind`、`semantic_status`、safe content、retrieval sources、scores 和 rank 保持原语义。

V1 不被改写或切换。`v1_compatibility.mode=projection-only` 明确允许未来 adapter 从 V2 投影 V1 的七个 legacy fields；它不允许 V1 consumer 读取 V2 未冻结的字段，也不允许 V2 反向改变 V1 runtime。V1 projection 中的 `actual_asked` 与 `recently_displayed` 仍是两个不同集合。

现存 `MemoryContextAssemblyService` / `MemoryRetrievalService` 是 legacy compatibility seam，**非本契约 authority**，不证明 P4 V2 行为，也不被本卡修改。后续 runtime 只能以本 formal contract 和后续已接收的 P4 assembly contract 为准。

## 2. Formal section shapes

每个 required section 必须存在；允许没有成员时使用空 array 或显式 `state=empty`，不允许省略、用 `null` 代替 section、或用另一个 section 的内容补位。

| Section | Formal shape and source boundary | Priority/protection |
| --- | --- | --- |
| `interview_state` | V1-compatible journey stage, reason codes and goal. | State is metadata, not transcript/evidence. |
| `working_memory` | `source=p1-working-direct`; P1 Working item 的 direct semantic shape，包含 revision、status、thread 和 evidence references。 | Direct section; never coerced into P3 candidate. |
| `active_memory` | Current active thread domain: `state`, thread identity/revision/source session and safe memory members. | Separate domain; current thread identity is retained. |
| `resumed_memory` | Resumed/continuation thread domain with the same closed reference shape, independent from active. | Separate domain; never silently merged with active. |
| `recent_transcript` | Final conversation segments only, with trusted role, content kind, text/revision and effective text digest. | Trusted role and eligibility are part of membership. |
| `memory_candidates` | Exact accepted P3 candidate shape. | Retrieval references only; no second memory authority. |
| `boundaries` | Active control-only envelope: id, code, abstract scope, status, revision and `content_policy`. | Highest protection. No evidence, source text, raw marker, or access detail. |
| `actual_asked` | Evidence-derived questions found in trusted interviewer final transcript, with source and segment IDs. | Actual fact; never inferred from display. |
| `displayed` | Immutable publication snapshots with sequence, displayed text, outcome and optional actual-question link. | Display fact; never treated as actual asked. |
| `question_bank` | Versioned, filtered reference entries; optional inspiration only. | No static fallback or question whitelist. |
| `current_presentation` | Current displayed snapshot or `null`; it is not a new question history. | Must remain consistent with `displayed` when present. |

`actual_asked` answers “what the trusted interviewer actually asked”; `displayed` answers “what the system published”. A displayed snapshot is not `actual_asked` merely because it was published, and an interviewer-spontaneous question may be `actual_asked` without a matching display snapshot. `outcome=unjudged` never becomes proof of either fact.

## 3. Frozen priority and configurable budget seam

P4C-01 freezes only the section protection/precedence order, matching the stale 07 wording while making the boundary explicit:

1. `boundaries`;
2. `recent_transcript`;
3. `working_memory`;
4. `active_memory`;
5. `resumed_memory`;
6. `memory_candidates`;
7. `actual_asked`;
8. `displayed`;
9. `question_bank`;
10. `interview_state`;
11. `current_presentation`.

The same order is machine-locked in `priority_order`. It is a protection order, not a provider or tokenization decision. If a later budget clips content, it must clip lower-priority members first and retain boundary controls and required membership metadata. P4C-02 may define more detailed policy behavior but cannot turn an absent required section into a successful partial context.

`budget` is a seam only: `config_ref` and `policy_version` identify externally supplied configuration, and optional `applied_limits` records what was supplied for this frozen context. No production numeric default is selected here. Overflow behavior is fixed as `clip-by-frozen-priority-and-order`; missing or invalid budget configuration fails closed rather than inventing a limit.

## 4. Freeze, ordering and digests

The freeze metadata must capture:

- project/current-session scope and active/resumed thread identities;
- source contract identities (`memory-p3-retrieval-v1`, V1 context, and this P4 contract);
- the complete required-section list;
- `p4-canonical-order-v1` and tie-breakers `input_order`, `source_id_lexicographic`, then `revision_ascending`;
- budget config reference and policy revision.

`membership.entries` is the immutable ordered manifest. Each entry records section, source type, source ID, source revision where applicable, per-member `membership_digest`, and canonical `input_order`. The top-level `membership_digest` is SHA-256 over canonical UTF-8 JSON of the ordered manifest plus its frozen scope; it excludes wall-clock time and object key insertion order.

The top-level `context_digest` is SHA-256 over canonical UTF-8 JSON of the complete frozen V2 context with `context_digest` removed and with `membership_digest` included. Canonical JSON uses UTF-8, recursively lexicographic object keys, the declared array order, no insignificant whitespace, and no floating-point normalization beyond JSON serialization. Reordering equal source inputs, changing any source revision/digest, changing policy/config identity, or changing required-section presence therefore changes the digest or fails validation.

Digests are references to the frozen input and are not a substitute for source authorization, retention, deletion, or eligibility checks. A digest mismatch at a later write/read fence cancels the dependent AI work and does not fall back to a newly assembled context.

## 5. Fail-closed and 07 alignment

The V2 shape narrows the old 07 list rather than expanding it: it retains fixed rules/state, Working, eligible active/resumed memory, recent trusted final transcript, actual/display history, filtered bank references and minimal boundaries. It excludes restricted/do-not-ask source text, untrusted roles, interim text, deletion-hit content, provider payloads and unbounded database rows.

The following are mandatory fail-closed conditions for a future assembly implementation, but are not implemented by this card:

- any required section, scope, revision, eligibility, policy, retention or deletion proof is missing;
- active/resumed identities cannot be tied to their source revision;
- an active boundary cannot be represented by the minimal control-only envelope;
- P3 candidate closed-shape or project/session readability validation fails;
- actual/display membership is mixed or inferred from the wrong source;
- budget config is absent/invalid or a deterministic order cannot be produced;
- either digest cannot be computed from the complete ordered membership.

The fail-closed result is no V2 context for Director consumption; it is not a partial V1 fallback, a guessed budget, or a reason to expose boundary/source text. Recording must remain independent of this contract.

## 6. Explicit non-goals

This artifact does not add runtime assembly, Director integration, provider/model/tokenizer/embedding selection, numeric budget selection, P2-D, P5 evidence drill-down, P6 orchestration, migrations, or real-data fixtures. Synthetic fixtures only demonstrate contract shape and negative required-section/boundary/distinction cases.
