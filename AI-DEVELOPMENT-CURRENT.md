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

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current bugfix/governance/local-start maintenance queue.

## Current phase

Current phase: `POST-CHECKPOINT A / FIRST INTERVIEW START REPAIR + DISPATCHER REPAIR + CKPT-A LOCAL START PRELOAD`.

Completed baseline:

- P5 through PR #97;
- P6 Runtime T18–T24 through PR #103;
- Owner Checkpoint A through PR #111;
- Real-Flow Cleanup through PR #113;
- Dispatcher main-verification recovery hardening through PR #114;
- Local DB Port Maintenance through PR #115 and refreshed-main CI success.

## Canonical queue

```text
FIRST-INTERVIEW-START-01
  -> DISPATCHER-SAME-TASK-REPAIR-01
  -> CKPT-A-LOCAL-START-01
  -> null
```

## FIRST-INTERVIEW-START-01 current truth

- Canonical PR: `#116`.
- Accepted implementation head: `c218087b8189e12b30a425011571edfcd74ad59e`.
- External Architect verdict on that head: `PASS`; exact-head CI run `33132032390` is `SUCCESS`.
- PR #116 was merged into refreshed `main` at `2faf0179d97d1a40378e76f0488d2fe9c3db2f81`.
- Durable GitHub verdict/PR/head/CI state overrides stale cached status.
- First-session product rule remains: `sequence_no === 1` may use current valid non-revoked formal `recording_transcription_ai` consent; later sessions remain governed by existing continuation policy and production `unavailable` remains fail-closed.
- No `mvp-v1` cross-session continuing-consent decision is introduced.

## Preloaded governance successor

`DISPATCHER-SAME-TASK-REPAIR-01` is Owner/Architect-predefined and is complete through PR #117.

Planning sources:

- `docs/agent/tasks/DISPATCHER-SAME-TASK-REPAIR-PACK.md`
- `docs/agent/tasks/DISPATCHER-SAME-TASK-REPAIR-01.md`

It became `DONE` after its Architect PASS, merge into refreshed `main`, and successful main CI verification.

Its frozen outcome is to close the liveness gap where unfinished implementation becomes inert merely because a PR exists or `next_task` is null:

- required PR CI pending -> wait;
- required PR CI failure -> same Task/same PR repair;
- Architect `REQUEST_CHANGES` -> same Task/same PR repair;
- durable repair-launch dedupe per exact head + failing-check signature;
- required exact-head PR CI success + Architect PASS -> merge eligible;
- only after merge + refreshed-main CI success + DONE may predefined successor logic run.

## CKPT-A-LOCAL-START-01 current truth

- Product Owner-authorized Task Card is complete through canonical PR `#118`.
- Accepted implementation head: `0ba8d07f130174c78a47e69f6273696379ab9d6a`.
- Required task checks and exact-head PR CI succeeded; the Worker did not expose secrets or `.env.local` contents.

## Preloaded CKPT A local-start successor

`CKPT-A-LOCAL-START-01` is separately Product Owner-authorized and is complete through PR #118.

Planning sources:

- `docs/agent/tasks/CKPT-A-LOCAL-START-REPAIR-PACK.md`
- `docs/agent/tasks/CKPT-A-LOCAL-START-01.md`

It became active after `DISPATCHER-SAME-TASK-REPAIR-01` was Architect-PASSed, merged, refreshed-main CI verified and marked `DONE`, and is now complete.

Its frozen outcome is local operability only:

- preserve tracked PostgreSQL host ports `15432` / `15433`;
- provide a safe explicit one-time migration for an existing ignored `.env.local` still using legacy `5432` / `5433` local DB ports;
- never commit or print real `.env.local` secrets;
- repair the native-Windows `pnpm checkpoint-a:start` child-process launch/cleanup path;
- preserve API/server versus Vite/browser secret isolation;
- remove the need for process-level DB URL overrides as the steady-state Owner workflow;
- change no application/runtime, P1-P6/T0-T27, consent, auth, ASR, Director, memory/evidence, privacy or provider semantics.

## Preserved decisions

- OpenRouter/Ox and Owner Prompt meaning unchanged.
- Tencent real-ASR unchanged.
- Automatic/manual Director orchestration, generation fences, deadlines, publication authority and background isolation unchanged.
- P1–P5 semantic/data ownership unchanged.
- AI failure must not stop recording; ASR failure must not damage original audio.
- Repository-standard local PostgreSQL host ports remain `15432` / `15433`; container PostgreSQL remains `5432`.
- P2-D, T26–T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region, ordinary real interview data and deployment decisions remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable facts.

Accepted lifecycle:

`READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> Architect PASS -> merge -> refreshed-main CI -> DONE -> only predefined next_task`.

Architect plans/reviews only. Dispatcher launches Workers, consumes external verdicts, merges only after accepted gates, verifies main, synchronizes state and unlocks only predefined successors. Implementation Workers implement/repair only their current Task Card and canonical PR.

## Current states

- `READY`: none.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `BLOCKED`: none currently established by durable facts.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.
- `DONE`: CKPT-A-LOCAL-START-01 through PR #118; DISPATCHER-SAME-TASK-REPAIR-01 through PR #117; FIRST-INTERVIEW-START-01 through PR #116; Local DB Port Maintenance through PR #115; Real-Flow Cleanup through PR #113; Owner Checkpoint A through PR #111; prior P1–P6 stages as recorded in history.

## Authority order

Task Card for scope/entry -> exact Accepted Contract for behavior/invariants -> this file -> stable `00`–`10` specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

`CKPT-A-LOCAL-START-01` is complete through PR #118; no predefined successor remains.
