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

Foundation/Observability T0 Decision Trace remains accepted. P1–P6 ownership and T0–T27 semantic boundaries are unchanged by the current local-launch maintenance repair.

## Current phase

Current phase: `CHECKPOINT A RETEST / LOCAL WEB CWD MAINTENANCE`.

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
- backend legacy first-session draft recovery through PR #122;
- frontend legacy prepare bridge through PR #123;
- final bridge-state synchronization at `main@ed5f522dd636f06638ea859de0558f827e15eb8a` with exact-main CI SUCCESS.

The next Owner Checkpoint A local run proved PostgreSQL healthy, all 28 migrations current, and API health HTTP 200. The remaining blocker is launcher-only: Vite starts on `5173` but serves repository-root 404 responses because `scripts/start-checkpoint-a.mjs` does not set the web child working directory to `apps/web`.

The Product Owner explicitly authorized one ultra-small maintenance task, `CKPT-A-WEB-CWD-01`, to repair only that launcher working-directory defect.

## Canonical current queue

```text
DISPATCHER-STALE-DONE-RECONCILIATION-01  [DONE]
  -> FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01  [DONE]
  -> CKPT-A-LEGACY-PREPARE-BRIDGE-01  [DONE]

CKPT-A-WEB-CWD-01  [REVIEW]
  -> null
```

The older `DONE + next_task:null` chain describes those completed tasks only. The newly Owner-authorized `READY` maintenance task is independently eligible and must be found by full canonical queue scan.

Task source:

- `docs/agent/tasks/CKPT-A-WEB-CWD-01.md`

## Current task truth

`CKPT-A-WEB-CWD-01` is `REVIEW` on PR #125 at exact head `60cdce838394467379254890d3b2536cca3383c6`; the Worker completed within scope and stopped for external Architect review.

Frozen outcome:

- formal `pnpm checkpoint-a:start` launches Vite with `<repositoryRoot>/apps/web` as working directory;
- API launch behavior and port `3101` stay unchanged;
- Vite host `127.0.0.1`, port `5173`, strict-port behavior and direct Node entrypoint stay unchanged unless strictly necessary for the cwd repair;
- backend-only secrets remain absent from the Vite child environment;
- child cleanup behavior remains intact;
- no `apps/**` product behavior changes;
- no database, Docker, consent, auth, ASR, Director, memory/evidence, evaluation or deployment changes.

## Local Owner prerequisite

The accepted Windows/local-start repair intentionally does not mutate ignored secret-bearing `.env.local` automatically. If legacy ports remain, the already accepted one-time command is:

```text
pnpm local:env:migrate-db-ports
```

The Owner has already verified the development/test PostgreSQL instances are healthy and migrations are current for the latest Checkpoint A attempt. After this maintenance task is accepted and merged, use the stable formal command:

```text
pnpm checkpoint-a:start
```

No process-level `DATABASE_URL` / `TEST_DATABASE_URL` override should be needed.

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
- `REVIEW`: `CKPT-A-WEB-CWD-01` on PR #125.
- `BLOCKED`: none.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions.
- `DONE`: legacy frontend bridge through PR #123; legacy backend recovery through PR #122; Dispatcher governance through PR #121; Checkpoint A local-start through PR #118; prior P1–P6 stages as recorded in history.

## Authority order

Task Card for scope/entry -> exact Accepted Contract for behavior/invariants -> this file -> stable `00`–`10` specs -> history. Any unresolvable contradiction is `PRODUCT_AMBIGUITY`.

## Next step

Persistent Dispatcher reconciled the Worker handoff for `CKPT-A-WEB-CWD-01`, bound PR #125 at exact head `60cdce838394467379254890d3b2536cca3383c6`, and stopped at `REVIEW` for external Architect review. The Worker changed only the two Task Card-authorized files.
