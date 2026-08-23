# Memory Gate/Correction V1

Status: `FORMAL CONTRACT / REVIEW CANDIDATE`.

This document and [`memory-gate-correction-v1.schema.json`](memory-gate-correction-v1.schema.json) freeze the provider-neutral T16-T17 gate and correction surface. They define candidate validation and an append-only, program-owned mutation plan; they do not implement a writer, migration, repository, new semantic store, provider, prompt, or runtime orchestration.

## 1. Authority and source truth

`MemoryClaim` and `MemoryResolution` remain the only semantic value, semantic-status, correction, supersession, and dispute authorities. Episode and Fact candidates can propose a state for that authority. Boundary is a separate explicit-control candidate/revision authority; it is not a third `MemoryResolution.semantic_kind`, `resolution_kind`, or ordinary memory value.

Transcript and original audio remain source truth. Every accepted candidate carries typed, finalized transcript evidence references and the source revisions/digest needed for the program gate to re-read the source. The contract never copies transcript text into a semantic record or correction plan. A proposal, plan, layer, trace, or log cannot become a second source of semantic truth.

The `authority_snapshot` binds project/session scope, evidence manifest, deletion scope, retention policy, and the accepted P1/P2 authority contract. The program must compare every candidate evidence reference and target against that snapshot before accepting a decision. Unknown authority, mismatched scope, missing evidence, stale source, deletion, retention ineligibility, or an ambiguous snapshot fails closed.

## 2. Candidate surface

The machine surface has two closed envelope variants:

| Message | Meaning |
| --- | --- |
| `gate_request` | A provider/producer proposal plus the frozen authority snapshot. It has no write permission. |
| `gate_decision` | The deterministic program decision and, only for an accepted or review-required transition, a typed append-only mutation plan. |

`candidate_kind=episode|fact` uses the existing P1/P2 semantic vocabulary. `candidate_kind=boundary` uses the independent Boundary vocabulary. The candidate declares `proposal_source=llm_proposal`; this identifies an input proposal, not an authority or writer.

The candidate operations are deliberately closed:

- `create` creates a new Episode or Fact authority;
- `correct` appends a new MemoryResolution revision for an existing authority;
- `mark_uncertain` and `mark_disputed` append a non-current semantic resolution that preserves conflicting or insufficient evidence;
- `activate` creates an explicit active Boundary;
- `revoke` appends a revoked Boundary successor and supersedes the prior active revision;
- `supersede` appends an explicit Boundary successor and supersedes its predecessor.

Creation/activation has no target. Correction and status changes require the target authority, target revision, expected revision, and observed lifecycle/status. A target that is already superseded, has an unknown authority, or does not match the expected revision is not silently repaired.

## 3. Evidence gate

Evidence references are typed `transcript_segment` authorities, not copied bodies. They must identify project/session, authority revision, transcript text and speaker-role revisions, effective text digest, finalized conversation content, and authorization/retention/deletion eligibility.

Fact acceptance has the strongest explicitness rule: at least one eligible `elder` reference with `evidence_role=explicit_fact_statement` is required. Interviewer suggestions, implication, model inference, unknown evidence, or an elder story context without an explicit fact statement cannot be promoted to a current Fact. An inferred-only Fact is rejected with `FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED`.

Episode may summarize an experienced elder story with eligible evidence and may remain `uncertain`; it must not manufacture explicit Fact fields or turn an interviewer suggestion into Fact evidence.

Boundary activation requires eligible elder evidence with `evidence_role=boundary_activation_intent`. Boundary revocation or supersession requires eligible elder evidence with `evidence_role=boundary_withdrawal_or_contradiction`. Silence, non-repetition, or absence of later evidence is never a withdrawal. A Boundary is never invented from model inference or interviewer suggestion.

## 4. Status and transition rules

The contract preserves the accepted P1/P2 split rather than introducing a second semantic enum:

| Consumer label | `resolution_status` (lifecycle) | `semantic_status` |
| --- | --- | --- |
| `CURRENT` | `current` | `current` |
| `SUPERSEDED` | `superseded` | predecessor’s prior semantic status |
| `UNCERTAIN` | `current` | `uncertain` |
| `DISPUTED` | `current` | `disputed` |

`disputed` uses the accepted P1/P2 `conflict_set` shape: null value, null value kind, at least two claims, and `review_required=true`. Conflicting eligible evidence is never silently collapsed into a current single value. The deterministic gate appends an uncertain/disputed resolution or returns `review_required` according to the candidate’s declared state; it never accepts a current Fact on unresolved conflict.

Boundary status remains the accepted independent surface: `active`, `revoked`, or `superseded`. A withdrawal creates a new `revoked` Boundary successor and marks the prior active revision `superseded`; the prior evidence and revision remain addressable. Explicit replacement follows the same append-only pattern with a successor and predecessor supersession.

## 5. Non-destructive correction

An accepted correction is an append-only plan against `MemoryClaim`/`MemoryResolution`:

1. the program re-reads the target authority and compares the expected revision, source scope, evidence manifest, deletion scope, policy, and retention state;
2. it creates a new revision number exactly `expected_revision + 1`;
3. it retains the predecessor revision and its evidence membership, and marks that predecessor `superseded` in the lifecycle projection;
4. it carries forward or adds typed evidence references without rewriting original audio, transcript, or prior evidence;
5. it writes only through the existing program-owned authority transaction/CAS boundary when a later runtime task is implemented.

The schema’s mutation plan is a description of this safe append-only operation, not a durable write. Rejected and ambiguous decisions have `mutation.action=none`. A stale/deleted/missing/retention-ineligible source, unknown target, illegal transition, revision mismatch, or ambiguous correction is `fail_closed=true` and cannot produce a mutation plan.

## 6. Error and review behavior

Gate errors are closed by `reason_code`: `EVIDENCE_MISSING`, `FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED`, `BOUNDARY_EXPLICIT_INTENT_REQUIRED`, `BOUNDARY_WITHDRAWAL_REQUIRED`, `EVIDENCE_NOT_ELIGIBLE`, `STALE_EVIDENCE`, `DELETED_EVIDENCE`, `RETENTION_INELIGIBLE`, `UNKNOWN_AUTHORITY`, `ILLEGAL_TRANSITION`, `REVISION_MISMATCH`, and `AMBIGUOUS_CORRECTION`, among others listed in the schema.

Every rejected or review-required decision is fail closed. `review_required` is not `CURRENT`, is not a fallback write, and does not authorize the provider to mutate state. Provider/model/prompt errors are not assigned semantic meaning by this contract.

## 7. Explicit non-goals

- No production mutation runtime, Prisma schema, migration, repository, or transaction implementation.
- No new semantic memory store or alternate Episode/Fact/Boundary authority.
- No automatic Boundary invention and no inferred Fact extraction policy expansion.
- No P6 Director/runtime orchestration, provider/model/prompt/tokenizer/embedding/budget decision.
- No real data, transcript body fixtures, audio, secrets, or deployment.

Machine artifact: [`memory-gate-correction-v1.schema.json`](memory-gate-correction-v1.schema.json).

Fixtures: [`fixtures/memory-gate-correction-v1/`](fixtures/memory-gate-correction-v1/).
