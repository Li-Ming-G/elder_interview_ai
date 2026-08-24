# Question Runtime Orchestration V1 / P6R-01

Status: `FORMAL CONTRACT / REVIEW CANDIDATE`.

This document and [`question-runtime-orchestration-v1.schema.json`](question-runtime-orchestration-v1.schema.json) freeze the provider-neutral T18–T24 orchestration seam. They define ownership and references for the existing Director lane; they do not implement a runtime, select a provider/model/tokenizer, or add a second state authority.

## 1. Authority and boundary

The existing `AiJob`, `QuestionGenerationAttempt`, `QuestionPresentation`/presentation revision and snapshot, and append-only `DecisionTrace` authorities remain the only durable authorities. A runtime implementation may add no orchestration truth store, second Director, second presentation authority, semantic memory authority, or agent/tool framework.

The record is reference-oriented. It may contain IDs, revisions, hashes, safe status/error codes, timing/deadline facts and publication outcomes. It must not contain interim/final transcript text, prompt/context bodies, evidence bodies, provider payloads, secrets, model selection, or raw personal data.

`trace.generation_id` is the stable orchestration correlation ID required by the accepted Decision Trace surface. When the automatic gate does not start a Director generation, `generation` is `null` and the trace may still record the bounded gate decision; no `AiJob`/attempt is implied by that trace reference.

## 2. Trigger, buffering and automatic gate

Interim ASR is observational only: it cannot start Director generation or change presentation. A finalized transcript event may append to a bounded buffer and schedule one automatic eligibility check. Multiple rapid finals are coalesced; they do not imply one Director call per segment.

Automatic eligibility is controlled by the existing debounce/minimum-interval compatibility gates. The schema carries baseline values as compatibility facts, not new product tuning. A non-eligible automatic event records its reason and remains `NOT_STARTED` with no generation identity.

The automatic gate is a bounded eligibility decision, not a provider call. If it is eligible, the successor runtime creates one durable `AiJob`/attempt/generation identity before invoking Director. The finalized source is represented by segment IDs, revisions and digests only.

## 3. Manual-next priority

Manual-next can bypass automatic debounce/minimum-interval waiting. It must still pass authorization, idempotency, current presentation/snapshot basis, retention/deletion, and publication fences. Its `manual_intent_sequence` is durable on the existing presentation/attempt authority.

When manual-next starts from a newer accepted presentation basis, older automatic work remains auditable but loses publication authority. The older result is terminally `stale_basis` or `superseded_by_manual`; it cannot replace the newer presentation.

## 4. Generation identity, replay and restart

Every actual generation carries one stable `generation_id`, `request_id`, `attempt_id`, `ai_job_id`, and `trace_id`. Retries/restarts must reuse the existing durable identity when replaying an existing attempt; they must not create a parallel orchestration truth. A replay record sets `replayed=true`, identifies the prior durable IDs, and uses the same identity values in the trace references.

Idempotency is checked against the existing `AiJob`/attempt/trace authority. A duplicate request returns or reconciles the existing winner. Original audio, transcript, evidence and trace records are never overwritten.

## 5. Deadline, failure and semantic outcome

The generation deadline is absolute for the Director lane and is represented by `deadline.started_at`, `deadline.deadline_at`, and `deadline.state`. Existing deadline constants remain compatibility baselines; this contract does not introduce new numeric values.

Timeout, provider/tool, context, P3, P4, evidence, runtime, retention or deletion failures are fail-closed. They map to `generation_outcome=SYSTEM_ERROR` or `UNAVAILABLE` and a safe closed `error_code`; they must never be relabeled `CONTINUE_LISTENING`.

Genuine Director `continue_listening` is a successful semantic result: `decision_outcome=continue_listening`, `generation_outcome=CONTINUE_LISTENING`, `semantic_success=true`, `lifecycle_status=succeeded`, and no failure code. The lowercase trace/attempt vocabulary is the existing internal compatibility vocabulary; the uppercase `generation_outcome` is the explicit public compatibility mapping for this contract.

## 6. Publication and generation fencing

Publication is authorized only when the result still matches the current presentation basis. The fence compares the generation's basis presentation revision/snapshot with the current revision/snapshot and records whether publication remains possible. A newer accepted basis, manual-next supersession, retention/deletion block or unknown basis makes `can_publish=false`; a late result cannot publish over a newer accepted presentation.

Only the existing presentation revision/snapshot authority can accept a publication. `published` is the only outcome that advances presentation; `stale_basis`, `superseded_by_manual`, `not_better`, `duplicate_filtered`, `policy_blocked`, and `not_applicable` do not create a parallel presentation.

## 7. Background isolation and Decision Trace

P1 and P2 are background lanes. `recording_blocked`, `finalized_asr_blocked`, `background_blocks_director`, and `background_blocks_recording` are fixed false in this contract. P1/P2 pending, failed or unavailable states are observable and may affect memory availability, but do not block recording, finalized ASR, manual-next, or the Director live lane. Memory failure cannot change question publication authority.

Decision Trace remains append-only/reference-oriented. Each record references the trigger, generation/request/attempt/job identity when present, basis/fence revisions, deadline, stage, safe error and publication outcome. It does not copy transcript, prompt, context, evidence or provider payloads.

## 8. Explicit non-goals

- No production runtime implementation or numeric debounce/deadline tuning.
- No prompt v2 activation, provider/model/region/secret selection, tokenizer, embedding or budget decision.
- No P1/P2 semantic redesign, P4 budget change, or P5 contract rewrite.
- No real data, audio, transcript, provider payload, deployment, or agent framework.

Machine artifact: [`question-runtime-orchestration-v1.schema.json`](question-runtime-orchestration-v1.schema.json).

Fixtures: [`fixtures/question-runtime-orchestration-v1/fixtures.json`](fixtures/question-runtime-orchestration-v1/fixtures.json).
