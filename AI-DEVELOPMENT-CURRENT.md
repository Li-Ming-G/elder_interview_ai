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

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current cleanup pack.

## Current phase and real progress

Current phase: `POST-CHECKPOINT A / REAL-FLOW CLEANUP COMPLETE`.

Completed baseline:

- P5 closed through PR #97;
- P6 Runtime T18–T24 closed through PR #103;
- Owner Checkpoint A `CPA-01 → CPA-02 → CPA-03 → CPA-04 → CPA-05` completed through PR #111;
- `OWNER_CHECKPOINT_A_READY: YES` was reached before the Product Owner authorized this cleanup pack.

The Product Owner has now authorized a bounded real-flow cleanup pack that removes owner-facing/local-runtime dependence on synthetic/test/harness artifacts without changing P1–P6 semantics or provider behavior.

Planning source: `docs/agent/tasks/REAL-FLOW-CLEANUP-DEVELOPMENT-PACK.md`.

Canonical queue:

```text
REAL-IDENTITY-01  ordinary persisted local application identity path
  → REAL-RUNTIME-02  isolate engineering harnesses from normal web entry
  → null
```

## Real-flow cleanup frozen facts

- `REAL-IDENTITY-01` is DONE after exact-head Architect PASS, merge, and successful main verification on main `1b0529af47bb9e5f437ff9041b465daad1c30c7a`.
- `REAL-RUNTIME-02` is DONE after exact-head Architect PASS on `c57d1172e65d7944137dd83be330e49eb68ceaf5`, accepted merge `195a0b95a7972e9cc38b34adf3bb07520373ed45`, refreshed descendant main `684f32b558b00ef48d4785315e1d230bc1be1c40`, and exact-main CI run `32914392387` attempt 2 SUCCESS.
- Existing `apps/api/src/cli/user-cli.ts` and `apps/api/package.json` already provide operator-managed `user:create`, `user:set-password`, `user:disable`, and `user:enable` commands.
- Secret input for the existing user CLI is interactive/hidden and command-argument secret input is rejected; this safety invariant must not be weakened.
- Synthetic identities and `seed-test-users.ts` remain for automated tests only.
- `docs/agent/tasks/CPA-05-runbook.md` currently tells the Owner to use a local synthetic account; `REAL-IDENTITY-01` removes that owner-facing dependency.
- `apps/web/src/main.tsx` currently allows engineering harnesses to replace the normal `App` using query parameters such as `audio_harness`, `capture_core_harness`, `realtime_harness`, `interview_controller_harness`, and `suggestion_harness`, with fake/default harness identifiers. `REAL-RUNTIME-02` isolates those switches from the ordinary product entry while preserving explicit test/dev harness access.
- Genuine unfinished product placeholders encountered during this pack are not to be silently implemented or deleted; they must be reported as separate Owner decisions.
- Open PRs #25, #43, #45, #62, and #110 are explicitly outside this pack. Do not modify, merge, close, or otherwise act on them.

## Preserved Checkpoint A and P6 decisions

- OpenRouter/Ox and Owner Prompt meaning remain unchanged.
- Tencent real-ASR behavior remains unchanged.
- Automatic/manual Director orchestration, generation fences, deadlines, publication authority and background isolation remain unchanged.
- P1–P5 semantic/data ownership remains unchanged.
- AI failure must not stop recording; ASR failure must not damage original audio.
- No scoring/evaluation/model-comparison UI is activated by this pack.
- P2-D, T26–T27, real embeddings, tokenizer, production P4 numeric budget, production provider/model/region, ordinary real interview data and deployment decisions remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub durable PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are durable runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable GitHub facts.

Accepted lifecycle:

`READY → Worker → PR REVIEW → external Architect verdict → merge → main CI → DONE → only predefined next_task READY`.

Architect plans/reviews only. Dispatcher launches Workers, consumes external verdicts, merges after PASS, verifies main, synchronizes state and unlocks only predefined successors. Implementation Workers implement only their current Task Card.

## Current states

- `READY`: none.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `BLOCKED`: none.
- `DONE`: Real-Flow Cleanup through `REAL-RUNTIME-02` / PR #113; Owner Checkpoint A through `CPA-05` / PR #111; prior P1–P6 completed stages remain closed as recorded in repository history.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.

## Worker prohibitions

Do not alter P1–P6 ownership, Owner Director Prompt semantics, OpenRouter/Ox binding, Tencent ASR behavior, memory/evidence rules, Accepted Contracts, evaluation/scoring scope, production provider/model/data policy, or ordinary real interview data policy. Do not act on PRs #25, #43, #45, #62 or #110. Do not create successors outside the predefined queue.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

`REAL-IDENTITY-01` and `REAL-RUNTIME-02` are DONE after exact-head Architect PASS, accepted merges, and successful main verification. `REAL-RUNTIME-02` has `next_task: null`; unlock nothing and invent no successor without a newly authorized Development Pack.
