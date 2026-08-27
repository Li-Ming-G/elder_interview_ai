# AI Development Current

## Product goal

Deliver a responsive web MVP where a listener can conduct a consented elder interview, preserve original audio/transcript evidence, receive evidence-linked AI assistance, continue the same project across sessions, and review saved records. AI assists the listener; it does not autonomously interview or write the final biography.

## P1–P6 architecture

| Layer | Frozen responsibility | Current truth |
| --- | --- | --- |
| P1 | Current-session Working Memory only; no Long retrieval | v1.2 runtime accepted at `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66` |
| P2 | LLM semantic consolidation Working→Mid and session-end Mid/current→Long; program owns persistence/CAS/revision/evidence/transaction | P2-C complete through PR #80; P2-D remains deferred |
| P3 | PostgreSQL + pgvector retrieval, provider-neutral embeddings, minimal continuation/branch/related graph | Complete through PR #86; real embedding model deferred |
| P4 | Programmatic Context V2, priority, configurable budget and frozen membership/digest | Complete through PR #88–#92; production numeric budget deferred |
| P5 | Evidence drill-down, Evidence Gate and non-destructive Correction | Complete through PR #93–#97 |
| P6 | Director/runtime orchestration, generation fences, deadlines and evaluation feedback | T18–T24 complete through PR #103; Owner Checkpoint A complete through CPA-05 / PR #111; T26–T27 deferred |

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current bugfix.

## Current phase and real progress

Current phase: `POST-CHECKPOINT A / FIRST INTERVIEW START BUGFIX ACTIVE`.

Completed baseline:

- P5 closed through PR #97;
- P6 Runtime T18–T24 closed through PR #103;
- Owner Checkpoint A completed through PR #111;
- Real-Flow Cleanup completed through PR #113;
- Dispatcher main-verification recovery hardening merged through PR #114;
- Local DB Port Maintenance completed through PR #115 and successful refreshed-main verification.

The Product Owner has now authorized one bounded product bugfix task after a real Checkpoint A hands-on attempt exposed a first-interview start failure.

Planning source:

`docs/agent/tasks/FIRST-INTERVIEW-START-01.md`

Canonical queue:

```text
FIRST-INTERVIEW-START-01  repair first-session current-consent readiness/start authority
  → null
```

## FIRST-INTERVIEW-START-01 frozen facts

- Task status is `READY`.
- Planning baseline is `main@7475b5144c816f9e383551bb5948c7a7f71d79cd`.
- The first session is identified by existing `sequence_no === 1`; no schema flag is added.
- A current valid, non-revoked formal `recording_transcription_ai` consent may authorize the current first interview.
- First-session readiness/start must not require future-session `ConsentContinuationPolicyReader` coverage.
- Later sessions (`sequence_no > 1`) remain governed by the existing repeat-interview/continuation policy; production `unavailable` remains blocking.
- `mvp-v1` is not declared cross-session continuing consent.
- The separate half-created interview abandon/delete UX and the browser workflow snapshot issue are explicitly out of scope for this task.
- No Prisma schema/migration, P1-P6/T0-T27, ASR, Director/OpenRouter/Ox, memory/evidence, audio-finalization, evaluation/scoring, provider/model/data/deployment semantics may change.
- `next_task` is `null`.

## Preserved Checkpoint A and P6 decisions

- OpenRouter/Ox and Owner Prompt meaning remain unchanged.
- Tencent real-ASR behavior remains unchanged.
- Automatic/manual Director orchestration, generation fences, deadlines, publication authority and background isolation remain unchanged.
- P1–P5 semantic/data ownership remains unchanged.
- AI failure must not stop recording; ASR failure must not damage original audio.
- P2-D, T26–T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region, ordinary real interview data and deployment decisions remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are durable runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable GitHub facts.

Accepted lifecycle:

`READY → Worker → PR REVIEW → external Architect verdict → merge → main CI → DONE → null`.

Architect plans/reviews only. Dispatcher launches Workers, consumes external verdicts, merges after PASS, verifies main, synchronizes state and unlocks only predefined successors. Implementation Workers implement only their current Task Card.

## Current states

- `READY`: `FIRST-INTERVIEW-START-01`.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `BLOCKED`: none.
- `DONE`: Local DB Port Maintenance through PR #115; Real-Flow Cleanup through PR #113; Owner Checkpoint A through PR #111; prior P1–P6 completed stages remain closed as recorded in repository history.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Dispatcher must fresh-read `origin/main`, identify the unique eligible `FIRST-INTERVIEW-START-01` READY task, persist `READY -> IN_PROGRESS`, and launch exactly one `luna-high` IMPLEMENTATION_WORKER. The Worker must stop at `REVIEW` after creating its PR. No successor may be invented because `next_task` is `null`.
