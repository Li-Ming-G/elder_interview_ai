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
PFC-01-NEW-INTENT-TRUTH          [DONE]
  -> PFC-02-PRESTART-DISCARD     [DONE]
  -> PFC-03-RECORDING-NAV-SAFETY [DONE]
  -> PFC-04-SUGGESTION-RECOVERY  [DONE]
  -> PFC-05-ROUTE-ACTION-CLOSURE [DONE]
  -> PFC-06-ERROR-AUTH-RESILIENCE [DONE]
  -> PFC-07A-QUERY-MODE-NAV-STATE [DONE]
  -> PFC-07-FULL-FLOW-E2E         [IN_PROGRESS]
  -> null
```

Only the first eligible task may run. Successors remain locked until predecessor external Architect PASS + merge + refreshed-main CI + state synchronization.

## Current task truth

`PFC-01-NEW-INTENT-TRUTH` through `PFC-06-ERROR-AUTH-RESILIENCE` are `DONE`; PR #132 exact Architect-reviewed PASS head `899b112bdde58a872c2537a132264170a7884f95` was accepted and merged as `48f5130a097c7aebbfe46d15ace36b41fd1fe272`, with exact-current-main CI run `33595083657` succeeded.

PFC-07 PR #133 remains open at exact head `8c9b7192376280b2e7860fc01bbb20afeb708802`; exact-head CI run `33659276060` failed in the authenticated browser flow. Its matching legacy `DISPATCHER_REPAIR_V1` event has already been launched and is stalled. No new Directive has been published; the cutover itself does not repair the product defect.

`PFC-07A-QUERY-MODE-NAV-STATE` is `DONE` through PR #134 exact Architect-reviewed PASS head `e2549929f4d1d0ccdc2996a2390c5159ebb342e9`, merged as `6b0dbd8f73c6bca44cf55f68a7ebd3f324eb20f2`; exact-current-main CI run `33654978336` succeeded. `PFC-07-FULL-FLOW-E2E` is now the active `IN_PROGRESS` task, resuming existing PR #133.

Current task responsibility remains the full browser-flow acceptance in the PFC-07 Task Card. If that acceptance exposes an implementation-only defect inside the already authorized Product Flow Closure invariants, the External/Web Architect may keep PFC-07 and PR #133 and issue an `ARCHITECT_DIRECTIVE_V1` additive overlay for the needed files/tests. Product or architecture ambiguity still escalates to the Product Owner.

Task source:

- `docs/agent/tasks/PFC-07-FULL-FLOW-E2E.md`

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

The Product Owner retains product, architecture, cost, provider, model, data-policy, deployment, and Accepted Contract authority. The External/Web Architect plans/reviews and has bounded implementation execution authority only through `ARCHITECT_DIRECTIVE_V1` on standing Command Bus issue #135. The Dispatcher mechanically validates and executes valid Directives before ordinary waits/no-ops; it does not judge their technical merit. The Worker executes the effective envelope: base Task Card plus all successful Directive ACK overlays.

Task Card `Status:` is an issuance/planning snapshot. Freshly reconciled canonical queue/state is runtime authority, so a legacy Task Card `Status: DEFERRED` does not block canonical `IN_PROGRESS` execution.

A Directive never bypasses implementation, exact-head PR CI, effective-envelope Review Context, exact-head Architect verdict, `PASS`, merge ancestry, exact-current-main CI, `DONE`, or predefined-successor gates. Owner-frozen decisions, Accepted Contracts, architecture boundaries, task identity, and queue topology remain non-overridable.

## Current states

- `DONE`: `PFC-06-ERROR-AUTH-RESILIENCE` through PR #132 exact Architect-reviewed PASS head `899b112bdde58a872c2537a132264170a7884f95`, merged as `48f5130a097c7aebbfe46d15ace36b41fd1fe272`; exact-current-main CI run `33595083657` succeeded.
- `DONE`: `PFC-07A-QUERY-MODE-NAV-STATE` through PR #134 exact Architect-reviewed PASS head `e2549929f4d1d0ccdc2996a2390c5159ebb342e9`, merged as `6b0dbd8f73c6bca44cf55f68a7ebd3f324eb20f2`; exact-current-main CI run `33654978336` succeeded.
- `IN_PROGRESS`: `PFC-07-FULL-FLOW-E2E`, existing PR #133 is preserved for resume.
- `BLOCKED`: none in the Product Flow Closure pack after the Owner resolved the reported scope ambiguity by authorizing PFC-07A.
- `DONE`: `PFC-05-ROUTE-ACTION-CLOSURE` through PR #131 and exact-current-main CI run `33580001375`.
- `DONE`: `PFC-04-SUGGESTION-RECOVERY` through PR #130 and exact-current-main CI run `33545438599`.
- `DONE`: `PFC-03-RECORDING-NAV-SAFETY` through PR #129 and exact-current-main CI run `33534495664`.
- `DONE`: `PFC-01-NEW-INTENT-TRUTH` through `PFC-05-ROUTE-ACTION-CLOSURE`, Checkpoint A maintenance through PR #126, and prior accepted baseline tasks.
- Other deferred work remains P2-D/T26-T27/production activation decisions.

## Authority order

Product Owner decisions and exact Accepted Contracts -> base Task Card identity/goal/topology/gates -> successful additive Architect Directive ACK overlays -> freshly reconciled canonical runtime state -> Product Flow Closure Development Pack -> this file -> stable architecture specs -> history. A Task Card header status is only a planning snapshot. Any non-additive or otherwise unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

PFC-07A is complete. PFC-07-FULL-FLOW-E2E remains canonical `IN_PROGRESS` on PR #133. After this migration reaches `main`, a real, authenticated Architect Directive may authorize its implementation-only repair under the same task and PR; this migration publishes no such Directive.
