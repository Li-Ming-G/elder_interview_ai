# Single Dispatcher contract

This directory implements a deliberately small governance path:

`Single Dispatcher → Sequential Task Queue → Implementation Worker → External Architect PR Review`.

## Files

- [`dispatcher-state.json`](dispatcher-state.json): current sequential queue.
- [`dispatcher-state.schema.json`](dispatcher-state.schema.json): minimal queue/task shape.
- [`transition-contract.md`](transition-contract.md): closed transitions and five stable errors.
- [`worker-profiles/luna-high.json`](worker-profiles/luna-high.json): native Desktop worker profile.
- [`luna-high-launch-contract.md`](luna-high-launch-contract.md): launch and worker hand-back.
- [`task-card-template.md`](task-card-template.md): mandatory bounded Task Card.
- [`fixtures/sequential-queue-smoke.json`](fixtures/sequential-queue-smoke.json): two-task sequential smoke fixture.
- [`dispatcher-dry-run.mjs`](dispatcher-dry-run.mjs): A→B smoke validation.

## Mechanical algorithm

1. Read the queue in order and select the first eligible `READY` task.
2. Read its Task Card, verify named dependencies and launch its declared worker profile.
3. Set `IN_PROGRESS`.
4. When the worker reports a PR number, store that number, set `REVIEW` and stop.
5. The external Architect performs the actual PR review.
6. On external `PASS`, set current `DONE`, then set only predefined `next_task` `READY`. On `REQUEST_CHANGES`, return the same task to `IN_PROGRESS`.
7. Worker failure, product/architecture ambiguity or another blocker sets `BLOCKED` and stops.

The Dispatcher does not validate reviewer identity, review URLs, GitHub review objects, exact heads or CI evidence. It has no state revision, compare-and-swap or atomic snapshot requirement. A Task Card controls scope and entry; an exact Accepted Contract controls behavior and invariants.

## Ordinary-task review policy

For an ordinary Implementation Task, do not start iteration-coach or an additional internal Reviewer by default. The external Architect's PR review is the default independent review. Upgrade only when the Product Owner or Architect explicitly requires it.

Use Task Card + PR as the normal handoff. Do not generate per-task REV, handoff, traceability, conflict-history or ADR files; batch stage records at stage end, except when a real architecture decision explicitly requires an ADR.
