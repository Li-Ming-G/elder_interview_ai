# DISPATCHER-RECOVERY-001

Status: `IN_PROGRESS`

## Architecture Mapping (P1-P6/T0-T27)

| Mapping | State |
| --- | --- |
| Governance route / dispatcher transition machinery | `IN SCOPE` |
| P1–P6 product/runtime responsibilities and T0–T27 product behavior | `UNCHANGED` |

## Goal

Make the Single Dispatcher reconstruct its projection from canonical Task Cards and durable GitHub PR facts without inventing task IDs, while keeping every pulse bounded and fail-closed on ambiguity.

## Scope

Reconciliation rules, verdict parsing, fresh-read gates, one-time P4 governance topology/state synchronization, synthetic fixtures, and the dispatcher dry-run validator.

## Allowed Files / Areas

- `docs/agent/dispatcher/README.md`
- `docs/agent/dispatcher/transition-contract.md`
- `docs/agent/dispatcher/dispatcher-state.json`
- `docs/agent/00-task-board.md`
- `docs/agent/dispatcher/fixtures/*`
- `docs/agent/dispatcher/dispatcher-dry-run.mjs`
- `docs/agent/tasks/DISPATCHER-RECOVERY-001.md`

## Inputs

- Canonical Task Card IDs and predefined queue topology on `main`.
- GitHub PR number, title/body, branch, current head, top-level conversation comments, merge state, and main CI verification.
- Existing dispatcher state as a reconstructable projection only.

## Accepted Contracts — exact identities

No P1–P6 Accepted Contract is changed or consumed as product behavior. The governing authority for this task is the user-issued Dispatcher Recovery architecture decision and the bounded dispatcher transition contract in `docs/agent/dispatcher/transition-contract.md`; any contradiction is `PRODUCT_AMBIGUITY`.

## Required Behavior

- Reconcile at the beginning of every bounded pulse.
- Validate active IDs against the canonical queue; never search GitHub or dispatch using an invented local ID.
- Recover a unique canonical PR using combined task-card/topology/branch/phase evidence; fail closed on equal candidates.
- Consume only top-level `ARCHITECT_VERDICT_V1` comments whose `REVIEWED_HEAD` equals the fresh PR head; stale, malformed, or conflicting evidence cannot advance state.
- Treat open PR facts, current-head verdicts, merged state, and main CI in the order defined by the transition contract.
- Require a fresh read immediately before merge, DONE/READY unlock, verdict handling, or worker launch.
- Advance at most one safe stage and never dispatch P4C-03 in this task.

## Explicit Non-Goals

No application/runtime code, P1–P6 architecture change, Accepted Contract change, provider/model/tokenizer/embedding/budget decision, new queue service/database, issue-based state machine, event sourcing, multi-Dispatcher design, or P4C-03 implementation.

## Tests

```text
node docs/agent/dispatcher/dispatcher-dry-run.mjs
node -e "JSON.parse(require('fs').readFileSync('docs/agent/dispatcher/dispatcher-state.json'))"
git diff --check
```

The dry-run covers stale merged projections, invented IDs, null PR binding, stale verdicts, current-head REQUEST_CHANGES/PASS, ambiguity, pending CI, and merged-successful-main verification.

## Completion Criteria

All dry-run cases and format checks pass; the P4 queue has the temporary governance gate `P4C-02 → DISPATCHER-RECOVERY-001 → P4C-03`; one PR is opened with `ARCHITECT_REVIEW_CONTEXT_V1`; the worker stops at `REVIEW` and does not dispatch P4C-03.

## Review Gate

External Architect PR review; stop at `REVIEW`. Include `ARCHITECT_REVIEW_CONTEXT_V1` in the PR body. This worker does not claim review acceptance.

## Next Task

`P4C-03`
