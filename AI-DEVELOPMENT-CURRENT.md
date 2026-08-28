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

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current governance maintenance task.

## Current phase

Current phase: `POST-CHECKPOINT A / DISPATCHER STALE-DONE RECONCILIATION HARDENING`.

Completed baseline:

- P5 through PR #97;
- P6 Runtime T18–T24 through PR #103;
- Owner Checkpoint A through PR #111;
- Real-Flow Cleanup through PR #113;
- Dispatcher main-verification recovery hardening through PR #114;
- Local DB Port Maintenance through PR #115;
- first-interview start repair through PR #116;
- same-task/same-PR repair-loop governance through PR #117;
- Checkpoint A local-start repair through PR #118.

Checkpoint A local-start completion is durably supported by accepted PR #118 plus exact current-main-at-verification `9669e86cf4859d43272bb7fb419fc8b8b2dcc7b5`, CI run `33146225956` attempt 2 `SUCCESS`.

## Canonical current queue

```text
DISPATCHER-STALE-DONE-RECONCILIATION-01  [READY]
  -> null
```

This is a newly Product Owner-authorized governance task after the prior queue reached an Owner Checkpoint. It does not retroactively invent product scope or a product successor.

Planning sources:

- `docs/agent/tasks/DISPATCHER-STALE-DONE-RECONCILIATION-PACK.md`
- `docs/agent/tasks/DISPATCHER-STALE-DONE-RECONCILIATION-01.md`

## Current task truth

`DISPATCHER-STALE-DONE-RECONCILIATION-01` is `READY`.

Frozen outcome:

- `DONE` remains a reconstructable projection, not irreversible authority;
- every bounded pulse reconciles an apparently DONE current task against accepted merge ancestry and the latest applicable required CI for exact refreshed current main before allowing status-based no-op;
- exact-current-main CI pending/missing means DONE is unconfirmed and must use the pre-DONE verification wait path;
- exact-current-main CI terminal failure invalidates stale DONE and projects `BLOCKED / TASK_BLOCKED / MAIN_VERIFY_FAILED`;
- later exact-current-main CI SUCCESS confirms/restores DONE using existing recovery semantics;
- `next_task:null` never suppresses this reconciliation;
- deterministic dry-run fixtures K/L/M/N must make the rule executable rather than comment-only memory.

Allowed implementation area is Dispatcher governance only. No application source, Prisma/schema/migrations, CI workflow YAML, Checkpoint A runtime behavior, P1–P6/T0–T27 semantics, OpenRouter/Ox, Tencent ASR, memory/evidence, evaluation/scoring, privacy, provider/model/data or deployment semantics may change.

## Preserved decisions

- OpenRouter/Ox and Owner Prompt meaning unchanged.
- Tencent real-ASR unchanged.
- Automatic/manual Director orchestration, generation fences, deadlines, publication authority and background isolation unchanged.
- P1–P5 semantic/data ownership unchanged.
- AI failure must not stop recording; ASR failure must not damage original audio.
- Repository-standard local PostgreSQL host ports remain `15432` / `15433`; container PostgreSQL remains `5432`.
- P2-D, T26–T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region, ordinary real interview data and deployment decisions remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable facts, including when its cached status says `DONE`.

Accepted lifecycle:

`READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> Architect PASS -> merge -> refreshed-main CI -> DONE -> only predefined/newly Owner-authorized next work`.

Architect plans/reviews only. Dispatcher launches Workers, consumes external verdicts, merges only after accepted gates, verifies main, synchronizes state and unlocks only authorized work. Implementation Workers implement/repair only their current Task Card and canonical PR.

## Current states

- `READY`: `DISPATCHER-STALE-DONE-RECONCILIATION-01`.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `BLOCKED`: none currently established by durable facts.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.
- `DONE`: CKPT-A-LOCAL-START-01 through PR #118; DISPATCHER-SAME-TASK-REPAIR-01 through PR #117; FIRST-INTERVIEW-START-01 through PR #116; Local DB Port Maintenance through PR #115; Real-Flow Cleanup through PR #113; Owner Checkpoint A through PR #111; prior P1–P6 stages as recorded in history.

## Authority order

Task Card for scope/entry -> exact Accepted Contract for behavior/invariants -> this file -> stable `00`–`10` specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Persistent Dispatcher fresh-reads `origin/main`, sees the unique READY task `DISPATCHER-STALE-DONE-RECONCILIATION-01`, persists `READY -> IN_PROGRESS`, and launches the declared `luna-high` IMPLEMENTATION_WORKER. Worker must keep the task governance-only, create one PR, publish `ARCHITECT_REVIEW_CONTEXT_V1`, and stop at REVIEW for external Architect exact-head review.
