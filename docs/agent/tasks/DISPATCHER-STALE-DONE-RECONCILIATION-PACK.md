# DISPATCHER-STALE-DONE-RECONCILIATION Development Pack

Owner authorization: `2026-08-28`.

## Why this exists

A completed-task projection was written before exact refreshed-current-main CI reached a terminal result. A later pulse then saw `DONE + next_task:null` and no-opped, even though durable GitHub facts still required main verification.

This is a Dispatcher governance defect, not a product/runtime defect.

## Frozen repair line

`DONE` is a reconstructable projection, never irreversible authority.

Every bounded Dispatcher pulse must reconcile an apparently `DONE` current task against durable GitHub facts before allowing status-based no-op. If the accepted merged PR has not yet passed the latest applicable required CI for the exact refreshed current-main SHA, stale `DONE` must not suppress recovery.

Required outcomes:

- exact current-main CI pending/missing -> `DONE` is unconfirmed; restore/wait in the pre-DONE verification path;
- exact current-main CI terminal failure -> stale `DONE` is invalid; project `BLOCKED / TASK_BLOCKED` with reason `MAIN_VERIFY_FAILED`;
- exact current-main CI terminal success -> `DONE` is confirmed and remains `DONE`;
- `next_task:null` never suppresses this reconciliation.

## Scope

Governance only. No product/runtime/application behavior changes.

Primary files:

- `docs/agent/dispatcher/transition-contract.md`
- `docs/agent/dispatcher/dispatcher-dry-run.mjs`
- `docs/agent/dispatcher/fixtures/reconciliation-cases.json`

Optional only for consistency:

- `docs/agent/dispatcher/README.md`
- `AGENTS.md`

Planning/state files may be touched only for normal handoff/stage synchronization:

- `AI-DEVELOPMENT-CURRENT.md`
- `docs/agent/00-task-board.md`
- `docs/agent/dispatcher/dispatcher-state.json`

Forbidden:

- `apps/**`
- Prisma/schema/migrations
- `.github/workflows/**`
- product/runtime contracts
- CI weakening or test deletion

## Required deterministic cases

Add permanent dry-run/fixture coverage for at least:

K. local/projected `DONE`, accepted merge in exact current-main ancestry, latest exact current-main CI pending -> not DONE; wait for main CI.

L. local/projected `DONE`, accepted merge in exact current-main ancestry, latest exact current-main CI FAILURE -> `BLOCKED / MAIN_VERIFY_FAILED`.

M. local/projected `DONE`, accepted merge in exact current-main ancestry, latest exact current-main CI SUCCESS -> confirmed `DONE`.

N. same as K/L with `next_task:null` -> null successor does not suppress reconciliation.

Preserve all existing same-task repair, exact-head Architect verdict, merge, main-CI recovery, durable GitHub authority, heartbeat and single-queue semantics.

## Required validation

- `node docs/agent/dispatcher/dispatcher-dry-run.mjs`
- `pnpm format:check`
- `pnpm lint`
- `git diff --check`

## Completion gate

One implementation PR. Worker stops at REVIEW with exact head and `ARCHITECT_REVIEW_CONTEXT_V1`. External Architect exact-head PASS remains mandatory before merge.

## Authorized task

`DISPATCHER-STALE-DONE-RECONCILIATION-01`

This task is newly Owner-authorized after the prior Checkpoint A local-start task reached a valid exact-current-main CI SUCCESS on rerun. It is governance maintenance and creates no product successor semantics.