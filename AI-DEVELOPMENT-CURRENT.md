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

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current maintenance pack.

## Current phase and real progress

Current phase: `POST-CHECKPOINT A / LOCAL DB PORT MAINTENANCE ACTIVE`.

Completed baseline:

- P5 closed through PR #97;
- P6 Runtime T18–T24 closed through PR #103;
- Owner Checkpoint A `CPA-01 → CPA-02 → CPA-03 → CPA-04 → CPA-05` completed through PR #111;
- Real-Flow Cleanup `REAL-IDENTITY-01 → REAL-RUNTIME-02` completed through PR #113;
- dispatcher main-verification recovery hardening merged through PR #114 on `main@bf76fce0a64689adaeb1f46fbd01575bc8c3802e` before this maintenance pack was issued.

The Product Owner has now authorized a bounded one-task Foundation/local-infrastructure maintenance pack to remove normal local-development dependence on host PostgreSQL ports `5432` and `5433`.

Planning source: `docs/agent/tasks/LOCAL-DB-PORT-MAINTENANCE-PACK.md`.

Canonical queue:

```text
LOCAL-DB-PORT-01  standardize local PostgreSQL host ports to 15432/15433
  → null
```

## Local DB port maintenance frozen facts

- `LOCAL-DB-PORT-01` is the only active task and is `READY`.
- Development PostgreSQL must publish `127.0.0.1:15432 -> container:5432`.
- Test PostgreSQL must publish `127.0.0.1:15433 -> container:5432`.
- Container-internal PostgreSQL port `5432`, database names, users, passwords, healthchecks, persistent development volume and test tmpfs semantics remain unchanged.
- `.env.example` must align `DATABASE_URL` / `TEST_DATABASE_URL` to host ports `15432` / `15433`.
- Existing `.env.local` files remain untracked; local developers update them once after pulling this change.
- This maintenance does not introduce dynamic host-port parameterization, a normal-path Compose override file, or OS-level Windows reserved/excluded-port changes.
- `docker compose down -v` is not part of the migration/startup path because the development database uses a persistent named volume.
- API, Prisma migration and database-dependent test processes remain host-side in the current architecture, so host publication of both database services is preserved.
- P1-P6, T0-T27, auth, interview, audio, ASR, transcript, memory/evidence, Director/OpenRouter/Ox, privacy, scoring/evaluation and production provider/model/data semantics are unchanged.

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

- `READY`: `LOCAL-DB-PORT-01`.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `BLOCKED`: none.
- `DONE`: Real-Flow Cleanup through `REAL-RUNTIME-02` / PR #113; Owner Checkpoint A through `CPA-05` / PR #111; prior P1–P6 completed stages remain closed as recorded in repository history.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.

## Worker prohibitions

For `LOCAL-DB-PORT-01`, do not alter P1–P6 ownership, Owner Director Prompt semantics, OpenRouter/Ox binding, Tencent ASR behavior, memory/evidence rules, Accepted Contracts, evaluation/scoring scope, production provider/model/data policy, ordinary real interview data policy, application source behavior, Prisma schema/migrations, database identities/storage semantics, or OS-level networking configuration. Do not create dynamic host-port parameterization or a normal-path Compose override. Do not run `docker compose down -v`. Do not act on PRs #25, #43, #45, #62 or #110. Do not create successors outside the predefined queue.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Dispatcher must fresh-read `origin/main`, reconcile durable state, and mechanically dispatch the single `READY` task `LOCAL-DB-PORT-01` using worker profile `luna-high`. The task stops at `REVIEW` after the Worker reports one PR. `next_task` is `null`; after external Architect PASS, merge and successful refreshed-main CI verification, synchronize the three current-state files and unlock nothing.
