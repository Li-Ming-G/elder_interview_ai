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
| P6 | Director/runtime orchestration, generation fences, deadlines and evaluation feedback | T18–T24 complete through PR #103; Owner Checkpoint A baseline through PR #111; T26–T27 deferred |

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current Checkpoint A maintenance repair.

## Current phase

Current phase: `CHECKPOINT A RETEST / FIRST CAPTURE AUTHORITY GATE`.

Completed baseline:

- P5 through PR #97;
- P6 Runtime T18–T24 through PR #103;
- Owner Checkpoint A baseline through PR #111;
- Real-Flow Cleanup through PR #113;
- Dispatcher main-verification recovery hardening through PR #114;
- Local DB Port Maintenance through PR #115;
- fresh first-interview start repair through PR #116;
- same-task/same-PR repair-loop governance through PR #117;
- Checkpoint A local-start repair through PR #118;
- stale-DONE reconciliation through PR #121;
- backend legacy first-session draft recovery through PR #122;
- frontend legacy prepare bridge through PR #123;
- Checkpoint A Web cwd launcher repair through PR #125.

Exact current main `1805d63dbe63366a82692d81157dd4642b786216` has successful CI run `33299450389`. PR #125 remains merged in accepted ancestry, so `CKPT-A-WEB-CWD-01` is reconciled `DONE`. The earlier projection that marked it `BLOCKED` after an older failed current-main run is stale.

The Owner's next live Checkpoint A attempt now loads the preparation page, validates current formal consent and current-page microphone input, and reaches the formal Start action. The remaining product blocker occurs after `startSession`: first-session capture confirmation/recovery is rejected because `SessionCaptureService` still universally requires repeat/continuing consent even for sequence 1.

The Product Owner explicitly authorized the ultra-small first-principles repair `CKPT-A-FIRST-CAPTURE-GATE-01`, prioritizing the fastest safe return to live Checkpoint A testing.

## Canonical current queue

```text
DISPATCHER-STALE-DONE-RECONCILIATION-01  [DONE]
  -> FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01  [DONE]
  -> CKPT-A-LEGACY-PREPARE-BRIDGE-01  [DONE]

CKPT-A-WEB-CWD-01  [DONE]
  -> null

CKPT-A-FIRST-CAPTURE-GATE-01  [IN_PROGRESS]
  -> null
```

`MEMORY-T5-T8-P2-C-RUNTIME-001` is historical `DONE` through PR #80. A stale Dispatcher projection that changed it to `BLOCKED` is corrected here and must not become active work.

Task source:

- `docs/agent/tasks/CKPT-A-FIRST-CAPTURE-GATE-01.md`

## Current task truth

`CKPT-A-FIRST-CAPTURE-GATE-01` is `IN_PROGRESS`, with no PR yet; its declared `luna-high` Worker is being launched.

Proven defect boundary:

- `ProjectFoundationService.startSession()` already applies the correct sequence-1 current-formal-consent rule;
- browser capture then calls `confirmCaptureActive()`;
- `SessionCaptureService.assertCurrentGate()` still requires `consentContinuation.status === 'covered'` for every sequence;
- the production/default continuation policy is intentionally unavailable until its future policy is accepted;
- therefore sequence 1 can formally start and then immediately fail capture confirmation with `FORBIDDEN`;
- the same shared gate can also block recovery of the already-interrupted sequence-1 capture.

Frozen repair outcome:

- sequence 1 capture confirm/recovery uses latest current valid formal `recording_transcription_ai` consent;
- sequence > 1 keeps the existing covered-continuation rule unchanged;
- active actor, assignment/access, ordinary visibility, project-state availability, project status, capture generation/state, idempotency and evidence safety remain unchanged;
- missing/revoked/invalid first-session consent fails closed;
- no continuing-consent policy activation;
- no UI, DB, ASR, Director, memory or P1–P6 changes.

## Local Owner prerequisite

The Owner has already verified local PostgreSQL development/test instances are healthy, all 28 migrations are current, the API is healthy, and the Workbench launcher cwd repair is present. After this maintenance task is accepted, merged and exact-main verified, use:

```text
pnpm checkpoint-a:start
```

Resume the SAME existing interview record. Do not wipe the database/IndexedDB or create a replacement record merely to bypass the interrupted capture.

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

Architect plans/reviews. Dispatcher launches Workers, consumes external verdicts, merges only after accepted gates, verifies main, synchronizes state and unlocks only authorized work. Implementation Workers implement/repair only their current Task Card and canonical PR.

## Current states

- `READY`: none.
- `IN_PROGRESS`: `CKPT-A-FIRST-CAPTURE-GATE-01`.
- `REVIEW`: none.
- `BLOCKED`: none among current Checkpoint A maintenance work; historical records remain as recorded in the canonical queue.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.
- `DONE`: `MEMORY-T5-T8-P2-C-RUNTIME-001`; `CKPT-A-WEB-CWD-01`; legacy frontend bridge through PR #123; legacy backend recovery through PR #122; Dispatcher governance through PR #121; Checkpoint A local-start through PR #118; prior P1–P6 stages as recorded in history.

## Authority order

Task Card for scope/entry -> exact Accepted Contract for behavior/invariants -> this file -> stable `00`–`10` specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Dispatcher selected the unique READY task `CKPT-A-FIRST-CAPTURE-GATE-01`, persisted `IN_PROGRESS`, and will launch one luna-high implementation Worker. The Owner does not need to manually redistribute this bug to other roles.
