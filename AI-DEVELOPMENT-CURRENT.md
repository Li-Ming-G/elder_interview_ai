# AI Development Current

## Product goal

Deliver a responsive web MVP where a listener can conduct a consented elder interview, preserve original audio/transcript evidence, receive evidence-linked AI assistance, safely finish/save/review the session, and continue the same elder project across sessions. AI assists the listener; it does not autonomously interview or write the final biography.

## P1-P6 architecture

| Layer | Frozen responsibility | Current truth |
| --- | --- | --- |
| P1 | Current-session Working Memory only; no Long retrieval | v1.2 runtime accepted |
| P2 | LLM semantic consolidation Working->Mid and session-end Mid/current->Long; program owns persistence/CAS/revision/evidence/transaction | P2-C complete through PR #80; P2-D deferred |
| P3 | PostgreSQL + pgvector retrieval, provider-neutral embeddings, minimal continuation/branch/related graph | Complete through PR #86; real embedding model deferred |
| P4 | Programmatic Context V2, priority, configurable budget and frozen membership/digest | Complete through PR #88-#92; production numeric budget deferred |
| P5 | Evidence drill-down, Evidence Gate and non-destructive Correction | Complete through PR #93-#97 |
| P6 | Director/runtime orchestration, generation fences, deadlines and evaluation feedback | T18-T24 complete through PR #103; Owner Checkpoint A baseline through PR #111; T26-T27 deferred |

P1-P6 ownership, T0-T27 semantic boundaries, OpenRouter/Ox Director behavior, Tencent ASR, evidence authority and consent/capture safety are unchanged by the current product-flow work.

## Current phase

Current phase: `PRODUCT FLOW CLOSURE 01`.

The Product Owner completed the adversarial product-surface review and authorized all audited fixes F1-F20. Primary objective is now the ordinary first-interview lifecycle, not deeper feature expansion:

```text
Home
-> explicit New vs Resume
-> safe pre-start discard if requested
-> microphone + recorded verbal consent
-> formal recording
-> speaker calibration or explicit safe skip/degrade
-> Workbench transcript + AI next question
-> safe End Interview
-> save/finalization
-> Review
-> Home
```

Owner-frozen v1 product decision: **no deliberate pause-then-resume feature.** Ordinary product copy must not promise it. Existing interruption recovery remains a safety/recovery mechanism and is not a user-facing pause product.

Development Pack:

- `docs/agent/tasks/PRODUCT-FLOW-CLOSURE-01.md`

Predefined queue:

```text
PFC-01-NEW-INTENT-TRUTH        [REVIEW]
  -> PFC-02-PRESTART-DISCARD   [DEFERRED]
  -> PFC-03-RECORDING-NAV-SAFETY [DEFERRED]
  -> PFC-04-SUGGESTION-RECOVERY  [DEFERRED]
  -> PFC-05-ROUTE-ACTION-CLOSURE [DEFERRED]
  -> PFC-06-ERROR-AUTH-RESILIENCE [DEFERRED]
  -> PFC-07-FULL-FLOW-E2E        [DEFERRED]
  -> null
```

Only the first eligible task may run. Successors are already Owner-authorized but remain locked until predecessor external Architect PASS + merge + refreshed-main CI + state synchronization.

## Current task truth

`PFC-01-NEW-INTENT-TRUTH` is `REVIEW` on PR #127 at repaired exact head `9ca072b2544950eb721ebcb04bfe9df7af4491bc`. Exact-head required CI `verify` is pending, and the prior-head `REQUEST_CHANGES` verdict is stale.

Its responsibility is intentionally narrow:

- Home `新建访谈` must not silently resume an older local workflow;
- unfinished creation gets an explicit `继续未完成访谈` entry;
- stale IndexedDB recovery is reconciled against server project/session facts before it can become active again;
- server facts outrank browser workflow state;
- normal in-page progress must not falsely render “已恢复旧流程” copy;
- no backend discard/delete is implemented in PFC-01; PFC-02 owns the safe server-authoritative pre-start discard.

Task source:

- `docs/agent/tasks/PFC-01-NEW-INTENT-TRUTH.md`

## Product-flow closure invariants

1. Server truth > browser recovery state.
2. Button label and actual action must agree.
3. A visible ordinary action either works end-to-end or is honestly unavailable in place; it must not route into a known placeholder/dead end.
4. Formal recording cannot be silently left behind by SPA navigation/history/back/refresh/close.
5. Once formal recording starts, safe End Interview is always available, including during calibration.
6. Calibration failure cannot hard-lock completion and must never invent speaker identity.
7. AI suggestion failure never stops recording and must have a visible retry path.
8. One unresolved formal interview takes precedence over creating another.
9. No deliberate pause/resume feature in v1.
10. Happy-path interview completion outranks visual polish.

## Completed baseline

- P1-P6 core through PR #103;
- Checkpoint A baseline through PR #111;
- ordinary identity/runtime cleanup through PR #113;
- local DB/start/governance maintenance through PR #121;
- legacy first-interview backend/frontend recovery through PR #122/#123;
- Checkpoint A Vite cwd repair through PR #125;
- first-session capture authority gate through PR #126;
- `CKPT-A-FIRST-CAPTURE-GATE-01` is historical `DONE` and is the dependency baseline for the Product Flow Closure pack.

Historical `MEMORY-T5-T8-P2-C-RUNTIME-001` remains `DONE`; stale Dispatcher projections must not reactivate it.

## Preserved decisions / deferred work

- AI failure must not stop recording; ASR failure must not damage original audio.
- Repository-standard local PostgreSQL host ports remain `15432` / `15433`; container PostgreSQL remains `5432`.
- P2-D, T26-T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region/data/deployment decisions remain deferred.
- No ordinary real/private elder data is introduced by this pack.
- No broad UI redesign.

## Governance

Canonical Task Cards + canonical queue on refreshed main define authorized work. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable facts.

Accepted lifecycle:

```text
READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> external Architect PASS -> merge -> refreshed-main CI -> DONE -> predefined successor
```

Architect plans/reviews. Dispatcher is mechanical and may not invent Product Flow tasks or product behavior. Worker implements only the active Task Card.

## Current states

- `READY`: none.
- `IN_PROGRESS`: none.
- `REVIEW`: `PFC-01-NEW-INTENT-TRUTH` on PR #127.
- `BLOCKED`: none in the Product Flow Closure pack.
- `DEFERRED`: `PFC-02` through `PFC-07`, plus prior P2-D/T26-T27/production activation decisions.
- `DONE`: Checkpoint A maintenance through PR #126 and prior accepted baseline tasks.

## Authority order

Current Task Card -> Product Flow Closure Development Pack -> exact accepted lower-level contracts/invariants -> this file -> stable architecture specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Dispatcher reconciled the repaired head for PR #127, persisted `IN_PROGRESS -> REVIEW`, and is waiting for exact-head required CI before publishing refreshed review context.
