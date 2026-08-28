# AI Development Current

## Product goal

Deliver a responsive web MVP where a listener can conduct a consented elder interview, preserve original audio/transcript evidence, receive evidence-linked AI assistance, continue the same project across sessions, and review saved records. AI assists the listener; it does not autonomously interview or write the final biography.

## P1–P6 architecture

| Layer | Frozen responsibility | Current truth |
| --- | --- | --- |
| P1 | Current-session Working Memory only; no Long retrieval | v1.2 runtime accepted at `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66` |
| P2 | LLM semantic consolidation Working→Mid and session-end Mid/current→Long; program owns persistence/CAS/revision/evidence/transaction | P2-C complete through PR #80; P2-D deferred |
| P3 | PostgreSQL + pgvector retrieval, provider-neutral embeddings, minimal continuation/branch/related graph | Complete through PR #86; real embedding model deferred |
| P4 | Programmatic Context V2, priority, configurable budget and frozen membership/digest | Complete through PR #88–#92; production numeric budget deferred |
| P5 | Evidence drill-down, Evidence Gate and non-destructive Correction | Complete through PR #93–#97 |
| P6 | Director/runtime orchestration, generation fences, deadlines and evaluation feedback | T18–T24 complete through PR #103; Owner Checkpoint A complete through PR #111; T26–T27 deferred |

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current first-session compatibility repair.

## Current phase

Current phase: `CHECKPOINT A RETEST BLOCKER / LEGACY FIRST-INTERVIEW DRAFT RECOVERY`.

Completed baseline:

- P5 through PR #97;
- P6 Runtime T18–T24 through PR #103;
- Owner Checkpoint A through PR #111;
- Real-Flow Cleanup through PR #113;
- Dispatcher main-verification recovery hardening through PR #114;
- Local DB Port Maintenance through PR #115;
- fresh first-interview start repair through PR #116;
- same-task/same-PR repair-loop governance through PR #117;
- Checkpoint A local-start repair through PR #118.

PR #116 and PR #118 are merged. The current Owner blocker is therefore not a missing merge.

The retest restored a browser-side unfinished first-interview workflow at the Start step. The durable server record can predate PR #116 and remain stranded as `project=draft + sequence_no=1 session=device_check + current valid formal recording_transcription_ai consent`. The fresh path is fixed because a current consent append runs `refreshReady()` and promotes the project to `ready`; a legacy record with consent already stored does not necessarily execute that mutation again. Current start authority still requires project state `ready|active` before first-session consent can authorize start, so the legacy `draft` remains `PROJECT_NOT_STARTABLE`.

## Canonical current queue

```text
FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01  [READY]
  -> DISPATCHER-STALE-DONE-RECONCILIATION-01  [DEFERRED]
  -> null
```

Planning sources for the current product blocker:

- `docs/agent/tasks/FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-PACK.md`
- `docs/agent/tasks/FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01.md`

## Current task truth

`FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01` is `READY` and has priority because it blocks the Owner's Checkpoint A retest.

Frozen outcome:

- only `sequence_no === 1` legacy projects stranded in `draft` may self-heal at formal start;
- self-heal requires ordinary/visible project authority, active interviewer assignment, non-deleted/non-restricted project, current valid non-revoked formal `recording_transcription_ai` consent, and an otherwise valid start/session state;
- repair happens under the existing project/session transaction locks before the final start gate;
- normal fresh `ready` first interviews remain unchanged;
- missing/revoked/pending consent remains blocked;
- repeat interviews continue to use existing continuation policy unchanged;
- no duplicate project/session/consent, database wipe, browser IndexedDB clearing, schema migration or frontend redesign;
- real PostgreSQL regression must reproduce the pre-fix durable state and prove successful start plus negative cases.

After this task is Architect-PASSed, merged and exact-main CI verified, the predefined governance follow-up `DISPATCHER-STALE-DONE-RECONCILIATION-01` becomes READY.

## Preserved decisions

- OpenRouter/Ox and Owner Prompt meaning unchanged.
- Tencent real-ASR unchanged.
- Automatic/manual Director orchestration, generation fences, deadlines, publication authority and background isolation unchanged.
- P1–P5 semantic/data ownership unchanged.
- AI failure must not stop recording; ASR failure must not damage original audio.
- Repository-standard local PostgreSQL host ports remain `15432` / `15433`; container PostgreSQL remains `5432`.
- Unfinished/new-interview delete/abandon UX remains a separate later product task and is not mixed into the current recovery.
- P2-D, T26–T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region, ordinary real interview data and deployment decisions remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable facts.

Accepted lifecycle:

`READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> Architect PASS -> merge -> refreshed-main CI -> DONE -> only predefined/newly Owner-authorized next work`.

Architect plans/reviews only. Dispatcher launches Workers, consumes external verdicts, merges only after accepted gates, verifies main, synchronizes state and unlocks only authorized work. Implementation Workers implement/repair only their current Task Card and canonical PR.

## Current states

- `READY`: `FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01`.
- `IN_PROGRESS`: none at planning publication time.
- `REVIEW`: none at planning publication time.
- `BLOCKED`: Owner Checkpoint A retest is functionally blocked by the legacy first-session durable-state compatibility gap until the current task merges.
- `DEFERRED`: `DISPATCHER-STALE-DONE-RECONCILIATION-01`, P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.
- `DONE`: CKPT-A-LOCAL-START-01 through PR #118; DISPATCHER-SAME-TASK-REPAIR-01 through PR #117; FIRST-INTERVIEW-START-01 fresh-path repair through PR #116; Local DB Port Maintenance through PR #115; Real-Flow Cleanup through PR #113; Owner Checkpoint A through PR #111; prior P1–P6 stages as recorded in history.

## Authority order

Task Card for scope/entry -> exact Accepted Contract for behavior/invariants -> this file -> stable `00`–`10` specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Persistent Dispatcher fresh-reads `origin/main`, sees the unique READY task `FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01`, persists `READY -> IN_PROGRESS`, and launches the declared `luna-high` IMPLEMENTATION_WORKER. Worker creates/reuses exactly one PR, runs the required regression/static gates, publishes `ARCHITECT_REVIEW_CONTEXT_V1`, and stops at REVIEW for external Architect exact-head review.
