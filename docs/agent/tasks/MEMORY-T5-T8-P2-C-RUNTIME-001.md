# MEMORY-T5-T8-P2-C-RUNTIME-001

Status: `BLOCKED / GOVERNANCE_HANDOFF_RECONCILIATION_REQUIRED`

This card does not authorize implementation or integration. Multiple P2-C implementation candidates already exist, but no candidate is accepted as an integrable combined runtime.

## Architecture Mapping (P1-P6/T0-T27)

| Mapping | Responsibility in this task | State |
| --- | --- | --- |
| T5–T8 / P2 | Working→Mid and session-end Mid/current→Long semantic consolidation runtime | `BLOCKED` pending reconciliation |
| T18–T19 / P6 | Durable trigger, orchestration, retry/recovery/fence | Candidate exists; not accepted |
| T0 / Foundation-Observability | Reference-only Decision Trace bindings | Candidate exists; not accepted |
| T4 / P1 | Accepted current-session Working source | `UNCHANGED`; no Long retrieval |
| T9–T12 / P3–P4 | Retrieval and Context V2/budget | `DEFERRED / OUT OF SCOPE` |
| T13–T17 / P5 | Evidence drill-down/gate/correction | `OUT OF SCOPE` |
| T20–T27 adjacent runtime/evaluation | Separate future cards | `OUT OF SCOPE` |

## Goal

Obtain an external Architect/Reviewer reconciliation pack that selects a single valid P2-C base and explicitly disposes of every candidate and every `FAIL P0=0/P1=6/P2=1` finding before any worker is dispatched.

## Scope

Current scope is governance stop and reconciliation only. Task Card controls this scope/entry gate; Accepted Contracts below control P2 behavior and invariants. A replacement runtime card is required after reconciliation.

## Allowed Files / Areas

Implementation Worker: none. Do not modify or integrate `apps/`, Prisma, migrations, repositories, runtime, packages, contracts or candidate branches under this blocked card.

External Architect/Reviewer may issue a new Development Pack and replacement Task Card, then update machine state through the closed `BLOCKED -> READY` transition.

## Inputs

- Repository baseline: `origin/main@04b3a70b4e7d4050ccc66d3a81b7a86e4250b714`; main CI `32337286827` was `SUCCESS`.
- Database candidate: `87ee56c6ceb1aee7897d1d62a2b18703c304c2e3`.
- Orchestration candidate: `97f647d607b020ef524014cfdab3e7b13eccd098`.
- Trace candidate: `5ada42209e5ab245e1b799456694a1cac9ca7ab9`.
- Integration docs candidate: `419f7bfc447b4b605c87e6c173b09c304cba5a41`.
- Formal old combination verdict: `FAIL P0=0/P1=6/P2=1`.

All four heads are inputs for external reconciliation only. They are not merge bases, Accepted Contracts or approved reference implementations.

## Accepted Contracts — exact identities

Behavior and invariants are controlled only by the following accepted scopes:

1. P1 v1.2 runtime: exact accepted head `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66`, `memory-maintainer-v1.2`, accepted scope recorded by PR #70 / REV-062. P1 remains current-session only and may not consume Long.
2. P2-A evolution contract: exact accepted head `042ec56f2b0362679bf240fcced95c61be77141f`, `memory-evolution-v1` plus reference-only trace v1.1 scope, accepted by PR #69 / REV-061. This is contract-only.
3. P2-A1 semantic envelope: exact accepted head `dbb0cc76f582997a6a647781007648c6937a8992`, PR #71 / REV-063, contract-only. Exact machine artifacts:
   - `docs/contracts/memory-semantic-context-v1.schema.json`;
   - `docs/contracts/memory-semantic-proposal-v1.schema.json`;
   - `docs/contracts/validated-memory-mutation-plan-v1.schema.json`;
   - `docs/contracts/committed-semantic-projection-v1.schema.json`;
   - `docs/contracts/memory-semantic-trace-v1.schema.json`;
   - `docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json`.
4. P2-B persistence contract: exact accepted head `717c5ca39e678c6f953d0430768ae715ef0feef2`, PR #72 / REV-064, database-agnostic contract-only. Exact artifacts:
   - `docs/contracts/memory-persistence-v1.schema.json`;
   - `docs/contracts/memory-persistence-v1.md`;
   - `docs/contracts/fixtures/memory-persistence-v1.fixtures.json`;
   - `apps/api/src/memory/memory-persistence-contract.ts`;
   - `apps/api/src/memory/memory-persistence-contract.spec.ts`.

The P2-C compatibility and physical-FK files found only in candidate heads are not accepted contracts. A filename, branch, local test or earlier contract PASS cannot extend these accepted scopes into runtime acceptance.

## Reference Implementations

The four candidate heads in Inputs are rejected as an integration set and are strictly read-only evidence for the external reconciliation. `DO_NOT_INTEGRATE` applies to each candidate separately and to any old combination.

## Required Behavior

- Dispatcher reads current state and returns `STOP / GOVERNANCE_HANDOFF_RECONCILIATION_REQUIRED`.
- No Implementation Worker is launched and no dispatch run/thread is claimed.
- The external reconciliation must compare every proposed behavior/invariant to the exact accepted identities above.
- Any Task Card/Accepted Contract contradiction becomes `BLOCKED / DISPATCH_AUTHORITY_CONFLICT`.
- A future runtime card must preserve `MemoryClaim`/`MemoryResolution` as semantic authority, transient proposal/plan, program-owned persistence/CAS/revision/evidence/transaction, P1 no-Long, and reference-only layer/Long/Trace semantics.

## Explicit Non-Goals

- No P2-C code, database, migration, repository, orchestration or trace integration.
- No P2-D provider/model/region/secret/data selection.
- No P3/pgvector/embedding/Graph, P4 Context budget/Director, UI or API expansion.
- No modification of Accepted Contract bytes or historical review evidence.
- No real data, real provider call, public deployment or production claim.

## Tests

Current blocked card has no implementation tests. Governance validation is limited to JSON/schema parse, deterministic dispatcher dry-run, Markdown/link/format/diff checks and current-state `STOP` verification. A replacement runtime card must explicitly name its targeted, PostgreSQL migration/integration, concurrency, fault-injection and exact-head gates; it may not inherit “tests passed” from a candidate.

## Completion Criteria

All must be externally supplied:

1. A reconciliation decision names the exact accepted base and exact disposition of all four candidates.
2. Every old P0/P1/P2 finding is mapped to a closed requirement or retained blocker.
3. Any needed contract correction is separately accepted before implementation.
4. A replacement Task Card lists exact allowed files, behavior derived from exact Accepted Contracts, tests, review gate and predefined next task.
5. Dispatcher state revision is advanced from `BLOCKED` to `READY` by an authorized external resolution.

## Review Gate

External Architect/Reviewer and project owner. This worker, Dispatcher, local checks, synthetic Luna task and CI cannot produce `PASS`. Stop at `BLOCKED`; after a future real PR, stop again at `REVIEW`.

## Next Task

`null`. P2-D is not mechanically unlockable from this blocked card. A reconciled replacement card may predefine it only after owner provider/data gates are stated.
