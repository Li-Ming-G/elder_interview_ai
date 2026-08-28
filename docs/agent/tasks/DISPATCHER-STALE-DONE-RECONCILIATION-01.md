# DISPATCHER-STALE-DONE-RECONCILIATION-01

Status: `DEFERRED`

## Architecture Mapping (P1-P6/T0-T27)

Development governance / Dispatcher reconciliation: `AFFECTED`.

Application/runtime code, P1-P6 and T0-T27 semantics: `UNCHANGED`.

Product consent, interview, audio, ASR, transcript, Director/OpenRouter/Ox, memory/evidence, evaluation/scoring, provider/model/data/deployment semantics: `UNCHANGED`.

## Goal

Make `DONE` mechanically self-correcting when refreshed durable GitHub facts show that exact current-main verification is still pending or has failed, so a stale `DONE + next_task:null` projection can never trap Dispatcher in a false no-op loop.

## Inputs

- Owner-authorized pack: `docs/agent/tasks/DISPATCHER-STALE-DONE-RECONCILIATION-PACK.md`
- current `docs/agent/dispatcher/transition-contract.md`
- current dispatcher dry-run and reconciliation fixtures
- predecessor: `FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01` must be `DONE` before this task becomes `READY`
- motivating incident: `CKPT-A-LOCAL-START-01` was projected `DONE` before exact current-main CI was terminal; the first CI attempt later failed, and a subsequent Dispatcher pulse no-opped on cached `DONE + next_task:null` instead of treating durable main-CI truth as authoritative

## Scope

Governance only.

Primary allowed files:

- `docs/agent/dispatcher/transition-contract.md`
- `docs/agent/dispatcher/dispatcher-dry-run.mjs`
- `docs/agent/dispatcher/fixtures/reconciliation-cases.json`

Optional only if directly needed for consistency:

- `docs/agent/dispatcher/README.md`
- `AGENTS.md`

Planning/state files may be touched only for normal task handoff and stage-end synchronization:

- `AI-DEVELOPMENT-CURRENT.md`
- `docs/agent/00-task-board.md`
- `docs/agent/dispatcher/dispatcher-state.json`

Do not modify:

- `apps/**`
- Prisma schema or migrations
- `.github/workflows/**`
- Accepted Product/Runtime Contracts
- Checkpoint A product/runtime behavior

## Required Behavior

### 1. DONE is a projection, not irreversible authority

Every bounded pulse must reconcile durable GitHub/main facts before allowing a cached/projected `DONE` state to cause no-op.

For a task whose accepted implementation PR is merged:

- prove the accepted merge is in refreshed exact current-main ancestry;
- read the latest applicable required CI attempt for that exact current-main SHA;
- treat that durable result as authoritative over cached `DONE`.

### 2. Stale DONE + pending/missing exact-main CI

If the latest applicable required exact-current-main CI is pending or missing, the task is not durably confirmed DONE.

Dispatcher must restore/use the pre-DONE verification wait path and must not unlock or dispatch a successor from that unconfirmed completion.

### 3. Stale DONE + exact-main CI failure

If the latest applicable required exact-current-main CI is terminal failure, cached/projected `DONE` is invalid.

Project:

- status: `BLOCKED`
- stable error: `TASK_BLOCKED`
- reason/detail: `MAIN_VERIFY_FAILED`
- record exact current-main SHA and applicable CI evidence according to existing contract conventions

A future exact-main rerun SUCCESS must still use the existing automatic `BLOCKED / MAIN_VERIFY_FAILED -> DONE` recovery path.

### 4. Stale DONE + exact-main CI success

If the accepted merge is in refreshed current-main ancestry and the latest applicable required exact-current-main CI is terminal SUCCESS, `DONE` is confirmed and remains `DONE`.

### 5. next_task:null is never an exemption

`next_task:null` only means there is no successor after a genuinely completed task. It must never suppress stale-DONE reconciliation, main verification, blocker projection, or later automatic recovery.

### 6. Preserve existing contracts

Do not weaken or replace:

- durable GitHub truth over stale projection;
- exact-head `ARCHITECT_VERDICT_V1` protocol;
- same-task/same-PR PR-CI repair loop;
- merge gate;
- exact refreshed-main CI verification;
- automatic `MAIN_VERIFY_FAILED -> DONE` recovery after later exact-main SUCCESS;
- persistent bounded-pulse heartbeat;
- one Dispatcher / one sequential queue;
- Dispatcher never acting as Architect or inventing product scope.

## Required Deterministic Tests

Extend the existing dispatcher dry-run/fixtures with at least:

K. projected `DONE` + accepted merge ancestry + exact current-main CI pending -> not DONE; wait for main CI.

L. projected `DONE` + accepted merge ancestry + exact current-main CI FAILURE -> `BLOCKED / TASK_BLOCKED / MAIN_VERIFY_FAILED`.

M. projected `DONE` + accepted merge ancestry + exact current-main CI SUCCESS -> confirmed `DONE`.

N. K or L with `next_task:null` -> reconciliation still occurs; no false `NO_READY_TASK` or terminal no-op caused by the null successor.

All existing reconciliation fixtures must continue to pass.

## Required Validation

Run at minimum:

```text
node docs/agent/dispatcher/dispatcher-dry-run.mjs
pnpm format:check
pnpm lint
git diff --check
```

If a narrower dispatcher governance validation command exists, run it too and report it exactly.

## Completion Criteria

- transition contract explicitly states that `DONE` is not exempt from durable reconciliation;
- executable dry-run logic handles stale DONE correctly;
- K/L/M/N deterministic fixtures pass;
- no application/runtime/CI-workflow behavior changes;
- exactly one implementation PR is created for this task;
- Worker publishes `ARCHITECT_REVIEW_CONTEXT_V1` with exact head and stops at REVIEW;
- external Architect exact-head PASS remains required before merge.

## Explicit Non-Goals

Do NOT:

- repair the realtime Chromium E2E product/test behavior in this task;
- modify Checkpoint A startup/runtime logic;
- change CI YAML or weaken any CI gate;
- create a generic scheduler or new queue service;
- add database/CAS state for Dispatcher;
- invent another successor.

## Review Gate

External Architect exact-head review.

## Next Task

`null`
