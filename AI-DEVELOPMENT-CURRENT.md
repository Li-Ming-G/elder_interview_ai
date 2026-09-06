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

P1-P6 ownership, T0-T27 semantic boundaries, Tencent ASR, evidence authority and consent/capture
safety are unchanged by the current product-flow and interview-usability work. For local Owner
Checkpoint A only, the retired OpenRouter/Ox binding is superseded by the Owner-authorized
configurable Director V2: `.env.local` selects a bounded Anthropic Messages, OpenAI-compatible, or
OpenRouter-compatible endpoint/model while P1 and P2 external providers remain inactive and
production provider/model/data decisions remain deferred.

## Current phase

Current phase: `REAL INTERVIEW USABILITY 01`.

The Product Owner ran the first real end-to-end browser interview against the completed Product Flow
Closure product. The chain of screens worked; three things inside that chain did not. The Owner
authorized a bounded follow-up pack whose objective is that **a listener conducting a real interview
can tell who is speaking, and can always tell what the AI assistant is doing — including when it is
failing.**

Development Pack:

- `docs/agent/tasks/REAL-INTERVIEW-USABILITY-01.md`

Predefined queue:

```text
RIU-01-DIRECTOR-LANDING          [DONE]
  -> RIU-02-CALIBRATION-USABLE   [DONE]
  -> RIU-03-AI-STATUS-CONTRACT   [DONE]
  -> RIU-04-AI-STATUS-UI         [DONE]
  -> RIU-05-REPO-HEALTH          [READY]
  -> null
```

Owner product decision for this pack: **the AI assistance status surface is a permanent ordinary
product feature and is always visible.** It is not a debug mode and is not gated behind a flag.

Owner prerequisite, not an implementation task: the local `.env.local` Director binding is
misconfigured in two independent ways — `ANTHROPIC_BASE_URL` points at `https://agentrouter.org`
instead of the documented API host `https://co.agentrouter.org`, and the configured credential is
rejected as invalid by the correct host under every supported authentication header. No code change
repairs either. `RIU-01` adds a non-blocking startup diagnostic so this class of misconfiguration is
reported at launch instead of after a completed interview.

## Preceding phase

Preceding phase: `PRODUCT FLOW CLOSURE 01`, now closed.

The Product Owner completed the adversarial product-surface review and authorized all audited fixes F1-F20. Its objective was the ordinary first-interview lifecycle, not deeper feature expansion:

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

Closed queue:

```text
PFC-01-NEW-INTENT-TRUTH          [DONE]
  -> PFC-02-PRESTART-DISCARD     [DONE]
  -> PFC-03-RECORDING-NAV-SAFETY [DONE]
  -> PFC-04-SUGGESTION-RECOVERY  [DONE]
  -> PFC-05-ROUTE-ACTION-CLOSURE [DONE]
  -> PFC-06-ERROR-AUTH-RESILIENCE [DONE]
  -> PFC-07A-QUERY-MODE-NAV-STATE [DONE]
  -> PFC-07-FULL-FLOW-E2E         [DONE]
  -> null
```

Task source:

- `docs/agent/tasks/PRODUCT-FLOW-CLOSURE-01.md`

Only the first eligible task may run. Successors remain locked until predecessor external Architect PASS + merge + refreshed-main CI + state synchronization.

## Current task truth

`RIU-01-DIRECTOR-LANDING` is complete: Architect PASS was issued for exact head `ce2381b8babc670de29f10aa25c6cfff1fd68eee`, PR #142 was merged as `3967ac79fc01925fa7d6c53884ca7a5b21488bf1`, and exact-current-main CI run `33881518632` succeeded. `RIU-02-CALIBRATION-USABLE` is complete: Architect PASS was issued for exact head `1e7aa3752adfcc41189fc1ae0b7a24554b3444cb`, PR #143 was merged as `5b020695b75646f238ffffd7c2b16714e0420c84`, and exact-current-main CI run `101329694130` succeeded. `RIU-03-AI-STATUS-CONTRACT` is complete: Architect PASS was issued for exact head `bd9e83a5fb0d4fac579b8f4a9dee0ffaf017422f`, PR #144 was merged as `3d361faa853f86a99e2abb672b323bd1126d084e`, and exact-current-main CI run `34001459694` succeeded. `RIU-04-AI-STATUS-UI` is complete: Architect PASS was issued for exact head `370d13171314318f225ecfb1098670754c14c936`, PR #145 was merged as `b2b8d2b82b8d4091787950a1a2ea1dd75231af74`, and exact-current-main CI run `34023472262` succeeded. `RIU-05-REPO-HEALTH` is now the sole eligible `READY` task.

The declared Accepted Contract `docs/contracts/checkpoint-a-configurable-director-v2.md` is durable on GitHub main. The authorized current-task Directive `RIU01-SEED-20260904-01` launched the deterministic Worker from durable seed `wip/riu-01-director-v2@d4a311c0ce04ec5f51f1e34a1f0a629fe259b751`; its effective overlay remains recorded through stage completion.

`RIU-01` landed the Checkpoint A Configurable Director V2 implementation, corrected the `anthropic_messages` profile to send the documented `x-api-key` authentication header alongside the existing bearer header, and added the non-blocking startup binding diagnostic.

Task source:

- `docs/agent/tasks/RIU-01-DIRECTOR-LANDING.md`

## Preceding task truth

`PFC-01-NEW-INTENT-TRUTH` through `PFC-06-ERROR-AUTH-RESILIENCE` are `DONE`; PR #132 exact Architect-reviewed PASS head `899b112bdde58a872c2537a132264170a7884f95` was accepted and merged as `48f5130a097c7aebbfe46d15ace36b41fd1fe272`, with exact-current-main CI run `33595083657` succeeded.

PFC-07 PR #133 exact Architect-reviewed PASS head `3aeb06975a60c8987200b7eaf03b9cce6fd1ad6c` was merged as `a7a49e69dd15d6e4fb3f41b4e0f5f531c3f388ed`; exact-current-main CI run `33794204208` succeeded. The task is complete.

`PFC-07A-QUERY-MODE-NAV-STATE` is `DONE` through PR #134 exact Architect-reviewed PASS head `e2549929f4d1d0ccdc2996a2390c5159ebb342e9`, merged as `6b0dbd8f73c6bca44cf55f68a7ebd3f324eb20f2`; exact-current-main CI run `33654978336` succeeded. `PFC-07-FULL-FLOW-E2E` is `DONE` through PR #133 exact Architect-reviewed PASS head `3aeb06975a60c8987200b7eaf03b9cce6fd1ad6c`, merged as `a7a49e69dd15d6e4fb3f41b4e0f5f531c3f388ed`; exact-current-main CI run `33794204208` succeeded.

The Product Flow Closure browser-flow acceptance is complete and its queue is closed. Task source for the closed pack's final task:

- `docs/agent/tasks/PFC-07-FULL-FLOW-E2E.md`

## Product invariants

Product-flow closure invariants 1-10 remain in force unchanged:

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

`REAL INTERVIEW USABILITY 01` adds four refinements of existing safeguards:

11. Speaker attribution is never invented. Provider diarization alone never becomes a trusted role; only explicit human confirmation or correction does. A calibration surface that cannot be satisfied must say what is missing rather than silently degrade.
12. AI state is always legible. During formal recording the listener can always see whether the assistant is working, waiting, or failed. Silence is never the representation of failure.
13. A timing indicator never promises an outcome it cannot guarantee. Automatic generation needs both an elapsed minimum interval and new finalized transcript, so a countdown may promise only that an attempt may begin. This is invariant 2 applied to time.
14. Diagnostics never expose secrets or model payloads. Credentials, prompts, context, and raw provider payloads stay out of user-facing surfaces, logs, and traces; only sanitized status and error codes are exposed.

## Completed baseline

- P1-P6 core through PR #103;
- Checkpoint A baseline through PR #111;
- ordinary identity/runtime cleanup through PR #113;
- local DB/start/governance maintenance through PR #121;
- legacy first-interview backend/frontend recovery through PR #122/#123;
- Checkpoint A Vite cwd repair through PR #125;
- first-session capture authority gate through PR #126;
- `CKPT-A-FIRST-CAPTURE-GATE-01` is historical `DONE` and is the dependency baseline for the Product Flow Closure pack;
- the closed `PRODUCT FLOW CLOSURE 01` pack, PFC-01 through PFC-07, is the dependency baseline for the Real Interview Usability pack.

Historical `MEMORY-T5-T8-P2-C-RUNTIME-001` remains `DONE`; stale Dispatcher projections must not reactivate it.

## Preserved decisions / deferred work

- AI failure must not stop recording; ASR failure must not damage original audio.
- Repository-standard local PostgreSQL host ports remain `15432` / `15433`; container PostgreSQL remains `5432`.
- P2-D, T26-T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region/data/deployment decisions remain deferred.
- No ordinary real/private elder data is introduced by this pack.
- No broad UI redesign.
- The Real Interview Usability pack adds no provider, model, embedding, or fallback-model decision, and no Director prompt or context/output schema change. `AI_P1_*` and `AI_P2_*` remain reserved and inactive.
- The Owner's local Director binding misconfiguration — wrong `ANTHROPIC_BASE_URL` host and an invalid credential — is an Owner action item, not implementation scope. `RIU-01` only makes it visible at startup.

## Governance

Canonical Task Cards + canonical queue on refreshed main define authorized work. GitHub durable PR/head/authenticated top-level machine-marker/merge/main-CI facts are runtime truth. `ARCHITECT_VERDICT_V1` and `ARCHITECT_DIRECTIVE_V1` require a configured `authorized_architect_logins` issuer; `ARCHITECT_REVIEW_CONTEXT_V1`, `DISPATCHER_REPAIR_V1`, and Directive ACKs require `authorized_dispatcher_logins`. Unauthorized marker comments are inert. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable facts.

Accepted lifecycle:

```text
READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> external Architect PASS -> merge -> refreshed-main CI -> DONE -> predefined successor
```

The Product Owner retains product, architecture, cost, provider, model, data-policy, deployment, and Accepted Contract authority. The External/Web Architect plans/reviews and has bounded implementation execution authority only through `ARCHITECT_DIRECTIVE_V1` on standing Command Bus issue #135. The Dispatcher mechanically validates and executes valid Directives before ordinary waits/no-ops; it does not judge their technical merit. The Worker executes the effective envelope: base Task Card plus all successful Directive ACK overlays.

Task Card `Status:` is an issuance/planning snapshot. Freshly reconciled canonical queue/state is runtime authority, so a legacy Task Card `Status: READY` does not override canonical `BLOCKED` state.

A Directive never bypasses implementation, exact-head PR CI, effective-envelope Review Context, exact-head Architect verdict, `PASS`, merge ancestry, exact-current-main CI, `DONE`, or predefined-successor gates. Owner-frozen decisions, Accepted Contracts, architecture boundaries, task identity, and queue topology remain non-overridable.

Authorized malformed/stale Directives receive deterministic rejection evidence. Later pulses skip exact identities with authenticated rejection ACKs and continue scanning, so rejected or unauthorized comments cannot starve a later valid Directive.

## Current states

- `DONE`: `RIU-01-DIRECTOR-LANDING`, `RIU-02-CALIBRATION-USABLE`, `RIU-03-AI-STATUS-CONTRACT`, and `RIU-04-AI-STATUS-UI` have passed their Architect, merge, exact-current-main CI, and stage-end synchronization gates.
- `READY`: `RIU-05-REPO-HEALTH`.
- `DONE`: `RIU-02-CALIBRATION-USABLE` through PR #143 exact Architect-reviewed PASS head `1e7aa3752adfcc41189fc1ae0b7a24554b3444cb`, merged as `5b020695b75646f238ffffd7c2b16714e0420c84`; exact-current-main CI run `101329694130` succeeded.
- `DONE`: `PFC-06-ERROR-AUTH-RESILIENCE` through PR #132 exact Architect-reviewed PASS head `899b112bdde58a872c2537a132264170a7884f95`, merged as `48f5130a097c7aebbfe46d15ace36b41fd1fe272`; exact-current-main CI run `33595083657` succeeded.
- `DONE`: `PFC-07A-QUERY-MODE-NAV-STATE` through PR #134 exact Architect-reviewed PASS head `e2549929f4d1d0ccdc2996a2390c5159ebb342e9`, merged as `6b0dbd8f73c6bca44cf55f68a7ebd3f324eb20f2`; exact-current-main CI run `33654978336` succeeded.
- `DONE`: `PFC-07-FULL-FLOW-E2E` through PR #133 exact Architect-reviewed PASS head `3aeb06975a60c8987200b7eaf03b9cce6fd1ad6c`, merged as `a7a49e69dd15d6e4fb3f41b4e0f5f531c3f388ed`; exact-current-main CI run `33794204208` succeeded.
- Other deferred work remains P2-D/T26-T27/production activation decisions.

## Authority order

Product Owner decisions and exact Accepted Contracts -> base Task Card identity/goal/topology/gates -> successful additive Architect Directive ACK overlays -> freshly reconciled canonical runtime state -> Real Interview Usability Development Pack -> this file -> stable architecture specs -> history. The closed Product Flow Closure Development Pack remains authoritative for its own invariants 1-10. A Task Card header status is only a planning snapshot. Any non-additive or otherwise unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

The Product Flow Closure pack is closed: PFC-07A and PFC-07-FULL-FLOW-E2E are canonical `DONE`, and PFC-07's predefined `next_task` was `null`.

The Product Owner has authorized the new Development Pack `REAL INTERVIEW USABILITY 01`. `RIU-01-DIRECTOR-LANDING`, `RIU-02-CALIBRATION-USABLE`, `RIU-03-AI-STATUS-CONTRACT`, and `RIU-04-AI-STATUS-UI` are complete through their predefined gates. `RIU-05-REPO-HEALTH` is the sole next eligible task.

Separately and in parallel, the Owner action item stands: repair `.env.local` so `ANTHROPIC_BASE_URL` is `https://co.agentrouter.org` and the Director credential is valid. Until that is done, no AI-visible acceptance in this pack can be exercised against a working provider.
