# InterviewDirectorContextV2 / P4C-01-CONTRACT

状态：`FORMAL CONTRACT / REVIEW CANDIDATE`。本文与 [`interview-director-context-v2.schema.json`](interview-director-context-v2.schema.json) 共同定义 P4 Context V2 的正式 membership/freeze surface。它冻结可复现的输入形状和来源边界，不实现 assembly runtime、Director wiring、provider/model/tokenizer、embedding 或数值预算。

## 1. Authority and compatibility

`InterviewDirectorContextV2` 是 P4 的 formal context shape。`MemoryClaim` / `MemoryResolution` 仍是语义值 authority；P4 只编排已通过 P1/P2/P3 authority/readability gates 的 references 和安全内容。

`memory_candidates` 必须逐字段复用 accepted `memory-p3-retrieval-v1` candidate closed shape：P4 不添加 raw transcript、evidence body、prompt、provider payload、SQL/CAS 字段或新的 candidate truth。P3 candidate 的 `source_level`、`semantic_kind`、`semantic_status`、safe content、retrieval sources、scores 和 rank 保持原语义。

V1 不被改写或切换。`v1_compatibility.mode=projection-only` 明确允许未来 adapter 从 V2 投影 V1 的七个 legacy fields；它不允许 V1 consumer 读取 V2 未冻结的字段，也不允许 V2 反向改变 V1 runtime。V1 projection 中的 `actual_asked` 与 `recently_displayed` 仍是两个不同集合。

现存 `MemoryContextAssemblyService` / `MemoryRetrievalService` 是 legacy compatibility seam，**非本契约 authority**，不证明 P4 V2 行为，也不被本卡修改。后续 runtime 只能以本 formal contract 和后续已接收的 P4 assembly contract 为准。

## 2. Formal section shapes

每个 required section 必须存在；允许没有成员时使用空 array 或显式 `state=empty`，不允许省略、用 `null` 代替 section、或用另一个 section 的内容补位。

| Section | Formal shape and source boundary |
| --- | --- |
| `interview_state` | V1-compatible journey stage, reason codes and goal. State is metadata, not transcript/evidence. |
| `working_memory` | `source=p1-working-direct`; P1 Working item 的 direct semantic shape，包含 revision、status、thread 和 evidence references。它 never coerces into P3 candidate. |
| `active_memory` | Current active thread domain: `state` is only `active|empty`, with thread identity/revision/source session and safe memory members. |
| `resumed_memory` | Resumed/continuation thread domain: `state` is only `resumed|empty`, independent from active. |
| `recent_transcript` | Final conversation segments only, with trusted role, content kind, text/revision and effective text digest. |
| `memory_candidates` | Exact accepted P3 candidate shape; retrieval references only, not a second memory authority. |
| `boundaries` | Active control-only envelope: id, code, abstract scope, status, revision and `content_policy`; no evidence, source text, raw marker, or access detail. |
| `actual_asked` | Evidence-derived questions found in trusted interviewer final transcript, with source and segment IDs. |
| `displayed` | Immutable publication snapshots with sequence, displayed text, outcome and optional actual-question link. |
| `question_bank` | Versioned, filtered reference entries; optional inspiration only. |
| `current_presentation` | Current displayed snapshot or `null`; it is not a new question history. |

`actual_asked` answers “what the trusted interviewer actually asked”; `displayed` answers “what the system published”. A displayed snapshot is not `actual_asked` merely because it was published, and an interviewer-spontaneous question may be `actual_asked` without a matching display snapshot. `outcome=unjudged` never becomes proof of either fact.

## 3. Reproducible ordering and opaque policy/config seams

P4C-01 freezes only the inputs needed to reproduce membership ordering. The required sections are serialized in the order declared by `freeze.required_sections`; entries within each section use the declared `input_order`, then `source_id_lexicographic`, then `revision_ascending` as deterministic tie-breakers. This is canonicalization metadata, not a priority or clipping policy.

`budget.config_ref` and `budget.policy_version` are opaque references only. P4C-01 does not define numeric limits, priority classes, overflow behavior, clipping order, or a fallback policy. Those decisions remain outside this contract and may be defined by the successor policy task without changing the source-complete membership rules here.

V2 adds no cardinality or content-length capacity cap. The remaining numeric bounds in the schema are copied only from an upstream source contract: the accepted V1 context shape for journey/text/boundary/question-bank fields, and the accepted P2 semantic canonical-key bound. The source-owned evidence/retrieval minimums and exact 11-section manifest cardinality are structural invariants, not P4 capacity policy. In particular, P4 does not cap recent transcript, memory candidates, Working/thread-memory members, actual asked, displayed questions, or question-bank members, and it does not cap P3 `safe_content`.

## 4. Freeze, ordering and digests

The freeze metadata must capture:

- project/current-session scope and active/resumed thread identities;
- source contract identities (`memory-p3-retrieval-v1`, V1 context, and this P4 contract);
- the complete required-section list;
- `p4-canonical-order-v1` and tie-breakers `input_order`, `source_id_lexicographic`, then `revision_ascending`;
- opaque budget config reference and policy revision.

`membership.sections` is the immutable, source-complete ordered manifest. It contains exactly one section manifest for every required section, including empty sections. Each manifest records `expected_member_count`; every included content member must occur exactly once in its section's `entries`. Each entry records section, source type, source ID, source revision where applicable, the member `content_digest`, the source `membership_digest`, and canonical `input_order`. The top-level `membership_digest` is SHA-256 over canonical UTF-8 JSON of the complete ordered section manifest plus its frozen scope; it excludes wall-clock time and object key insertion order.

The future assembly validator must fail closed when a section is omitted, duplicated, has an unexpected source type, has an extra or missing source ID, has a source revision mismatch, has a content or membership digest mismatch, or has an `expected_member_count` mismatch. A valid empty section has an explicit section manifest with zero entries; it is not omitted.

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
- membership content, source, revision, or digest does not match the frozen section manifest;
- an opaque budget/config reference is absent when required or a deterministic order cannot be produced;
- either digest cannot be computed from the complete ordered membership.

The fail-closed result is no V2 context for Director consumption; it is not a partial V1 fallback, a guessed budget, or a reason to expose boundary/source text. Recording must remain independent of this contract.

## 6. Explicit non-goals

This artifact does not add runtime assembly, Director integration, provider/model/tokenizer/embedding selection, numeric budget selection, P2-D, P5 evidence drill-down, P6 orchestration, migrations, or real-data fixtures. Synthetic fixtures demonstrate contract shape, complete source membership, manifest mismatch rejection, and active/resumed state separation.
