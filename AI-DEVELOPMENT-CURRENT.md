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

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current Checkpoint A UI bridge repair.

## Current phase

Current phase: `CHECKPOINT A RETEST / FINAL LEGACY PREPARE BRIDGE`.

Completed baseline:

- P5 through PR #97;
- P6 Runtime T18–T24 through PR #103;
- Owner Checkpoint A through PR #111;
- Real-Flow Cleanup through PR #113;
- Dispatcher main-verification recovery hardening through PR #114;
- Local DB Port Maintenance through PR #115;
- fresh first-interview start repair through PR #116;
- same-task/same-PR repair-loop governance through PR #117;
- Checkpoint A local-start repair through PR #118;
- stale-DONE reconciliation through PR #121;
- backend legacy first-session draft recovery through PR #122.

Owner retest after PR #122 exposed one remaining frontend-only compatibility gap: `/prepare` still disables Start for a recoverable first-session legacy `draft`, so the explicit Start request never reaches the backend self-heal path already accepted in PR #122.

The Product Owner explicitly authorized one narrow successor task, `CKPT-A-LEGACY-PREPARE-BRIDGE-01`, to bridge that UI gate without broadening backend authority or other product semantics.

## Canonical current queue

```text
DISPATCHER-STALE-DONE-RECONCILIATION-01  [DONE]
  -> FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01  [DONE]
  -> CKPT-A-LEGACY-PREPARE-BRIDGE-01  [BLOCKED / MAIN_VERIFY_FAILED]
  -> null
```

Task source:

- `docs/agent/tasks/CKPT-A-LEGACY-PREPARE-BRIDGE-01.md`

## Current task truth

`CKPT-A-LEGACY-PREPARE-BRIDGE-01` is `BLOCKED / MAIN_VERIFY_FAILED` because exact current-main CI run `33247160691` failed in the existing realtime Chromium E2E (`realtime-connection` expected `connected`, received `unavailable`).

Frozen outcome:

- `/prepare` must retain current valid consent, current-page microphone pass, `device_check`, reminder-present and single-submit gates;
- normal `ready`/`active` behavior stays unchanged;
- exactly one bounded frontend allowance may let a first-session legacy `draft` (`sequence_no === 1`) send the Start request;
- frontend does not mutate project state or duplicate backend authority logic;
- backend remains final authority and may still reject;
- repeat sessions and invalid/revoked/pending consent remain blocked;
- no database wipe, IndexedDB clearing, schema migration or frontend redesign.

The predefined queue continues with the Owner-authorized `CKPT-A-LEGACY-PREPARE-BRIDGE-01`, a narrow frontend bridge for the already accepted backend recovery path.

## Local Owner prerequisite

The accepted Windows/local-start repair intentionally does not mutate ignored secret-bearing `.env.local` automatically. Before formal local Checkpoint A startup, Owner must run once if legacy ports remain:

```text
pnpm local:env:migrate-db-ports
```

Then use the stable formal command:

```text
pnpm checkpoint-a:start
```

No process-level `DATABASE_URL` / `TEST_DATABASE_URL` override should be needed afterward.

## Preserved decisions

- OpenRouter/Ox and Owner Prompt meaning unchanged.
- Tencent real-ASR unchanged.
- Automatic/manual Director orchestration, generation fences, deadlines, publication authority and background isolation unchanged.
- P1–P5 semantic/data ownership unchanged.
- AI failure must not stop recording; ASR failure must not damage original audio.
- Repository-standard local PostgreSQL host ports remain `15432` / `15433`; container PostgreSQL remains `5432`.
- Unfinished/new-interview delete/abandon UX remains a separate later product task.
- P2-D, T26–T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region, ordinary real interview data and deployment decisions remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable facts.

Accepted lifecycle:

`READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> Architect PASS -> merge -> refreshed-main CI -> DONE -> only predefined/newly Owner-authorized next work`.

Architect plans/reviews only. Dispatcher launches Workers, consumes external verdicts, merges only after accepted gates, verifies main, synchronizes state and unlocks only authorized work. Implementation Workers implement/repair only their current Task Card and canonical PR.

## Current states

- `READY`: none.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `BLOCKED`: `CKPT-A-LEGACY-PREPARE-BRIDGE-01` / `MAIN_VERIFY_FAILED` due to main CI run `33247160691`; Owner Checkpoint A retest remains blocked by this final frontend bridge plus the Owner-local `.env.local` one-time port migration.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.
- `DONE`: legacy backend recovery through PR #122; Dispatcher governance through PR #121; Checkpoint A local-start through PR #118; prior P1–P6 stages as recorded in history.

## Authority order

Task Card for scope/entry -> exact Accepted Contract for behavior/invariants -> this file -> stable `00`–`10` specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Persistent Dispatcher fresh-read `origin/main`, persisted `CKPT-A-LEGACY-PREPARE-BRIDGE-01` as IN_PROGRESS, then exact current-main CI run `33247160691` failed in the existing realtime Chromium E2E. The task is now BLOCKED / MAIN_VERIFY_FAILED and must be mechanically rechecked on a later pulse.
