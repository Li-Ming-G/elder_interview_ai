# P5 Evidence Drill-down V1

Status: `FORMAL CONTRACT / REVIEW CANDIDATE`.

This document and [`evidence-drilldown-v1.schema.json`](evidence-drilldown-v1.schema.json) define the provider-neutral, read-only machine surface for one bounded evidence round. They do not implement a tool runtime, Director wiring, prompt behavior, or a provider/model binding.

Correction authorized by the Product Owner and Architect in the P5E-02 review of PR #94: the P5E-01 contract is corrected to remove `transcript_revision`. Transcript source drift is proved by `text_revision + speaker_role_revision + effective_text_digest`; this correction adds no revision axis, database column, or migration.

## 1. Authority and scope

`MemoryClaim` / `MemoryResolution` remain the only semantic value authority. P3 candidates and P4 membership are references and authorization inputs; this contract does not create a second memory authority and does not return a new memory value.

Every request carries the current generation's `project_id`, `current_session_id`, P4 `context_digest`, P4 `membership_digest`, and frozen scope. A reader must validate those fences before executing either operation:

- `get_memory_evidence(memory_id)` accepts only a memory identity that is present and readable in the current generation's frozen P4 membership. It is not a project-wide memory lookup.
- `search_transcript(query)` searches only the explicitly frozen, authorized project/session scope. It may read finalized conversation transcript segments only; it cannot cross project scope or bypass authorization, retention, deletion, or content-eligibility gates.
- The transcript is source truth. Returned memory evidence is a reference to finalized transcript evidence, never an inferred fact. An implication, interviewer suggestion, or model interpretation is not promoted to `Fact` by this surface.

The response repeats the generation and membership fences. A later consumer must reject a response whose fences do not match the generation that requested it.

## 2. Closed machine surface

The JSON Schema has exactly three envelope variants:

| Message | Operation | Payload |
| --- | --- | --- |
| `request` | `get_memory_evidence` | one `memory_id` |
| `request` | `search_transcript` | one bounded `query` |
| `result` | `get_memory_evidence` | memory reference plus transcript evidence |
| `result` | `search_transcript` | deterministic matches or explicit `no_match` |
| `error` | either operation | safe error code and diagnostics only |

All envelopes are closed (`additionalProperties: false`). Bodies are limited to the declared request/result fields. Memory evidence includes the stable memory/reference identifiers, source level and semantic status, but not an alternate semantic value. Transcript evidence includes the segment text required for the listener to inspect the source, plus its segment/session identity, text/speaker revisions, effective text digest, and source fences.

Neighboring context is finalized conversation text only and is bounded to at most two preceding and two following segments per returned hit. Each neighboring segment carries the same source identity, revision, digest, and authorization/retention/deletion fences as the matched segment.

## 3. One-round invariant

Every envelope has `evidence_round: 1` and `max_evidence_rounds: 1`. For one Director generation:

- zero requests is valid;
- one request is valid;
- a second request, recursive call, parallel fan-out, or tool call started from a tool result is forbidden and must fail closed with `ROUND_ALREADY_USED` or `ROUND_RECURSION_FORBIDDEN`;
- a tool failure is not a fallback question and cannot become `CONTINUE_LISTENING`; the generation outcome is `SYSTEM_ERROR`.

The schema fixes the round numbers. The Director/tool owner must enforce the per-generation single-use and no-loop state across messages.

## 4. Fences and diagnostics

The `source_fence` on every returned segment makes the source eligibility decision explicit:

- `authorization.status=authorized` and the frozen project/session scope identify the permitted read;
- `retention.status=eligible` identifies the policy revision used for the decision;
- `deletion.status=not-deleted` identifies the deletion fence revision.

Missing or mismatched P4 membership, project/session scope, source revision/digest, authorization, retention, deletion, or content eligibility is a fail-closed error. Safe diagnostics contain only `stage`, `error_code`, `duration_ms`, `result_count`, and `reference_count`. They must not contain transcript/evidence bodies, raw queries, prompts, provider payloads, SQL, secrets, or personal data beyond the declared synthetic result fields.

`search_transcript` uses `match_state=no_match` with an empty `matches` array for a valid zero-result search. It is not a transport failure.

The following rejection codes are closed in the schema: `OUT_OF_SCOPE`, `MEMORY_NOT_MEMBER`, `STALE_SOURCE`, `DELETED_SOURCE`, `RETENTION_INELIGIBLE`, `AUTHORIZATION_DENIED`, `MALFORMED_REQUEST`, `MALFORMED_RESULT`, `TOOL_EXECUTION_FAILED`, `ROUND_ALREADY_USED`, and `ROUND_RECURSION_FORBIDDEN`. Every error has `generation_outcome=SYSTEM_ERROR`.

## 5. Read-only and non-goals

Neither operation mutates `MemoryClaim`, `MemoryResolution`, transcript, `QuestionEvidence`, asked/displayed history, P4 membership, retention state, deletion state, or any durable record. P5E-02 may implement the bounded readers mechanically from this surface; P5E-03 may add one-round Director integration only after its own task is unlocked.

This contract does not define T16–T17 Gate/Correction, P6 orchestration, recursive tool loops, provider/model/function-calling SDKs, tokenizers, production numeric budgets, migrations, or real-data fixtures.

Machine artifact: [`evidence-drilldown-v1.schema.json`](evidence-drilldown-v1.schema.json).

Fixtures: [`fixtures/evidence-drilldown-v1/`](fixtures/evidence-drilldown-v1/).
