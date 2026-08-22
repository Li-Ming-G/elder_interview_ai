# Single Dispatcher transition contract

Assume one Dispatcher and one sequential task queue. The Dispatcher performs only the transitions below and never acts as reviewer.

## Closed transitions

| From | Event | To | Mechanical effect |
| --- | --- | --- | --- |
| `READY` | start | `IN_PROGRESS` | Start the first eligible queue item |
| `IN_PROGRESS` | worker reports PR number | `REVIEW` | Store the PR number and stop for external Architect review |
| `IN_PROGRESS` | worker failed | `BLOCKED` | Stop |
| `REVIEW` | external Architect `PASS` | `DONE` | Mark current `DONE`; then mark only predefined `next_task` `READY` |
| `REVIEW` | external Architect `REQUEST_CHANGES` | `IN_PROGRESS` | Return the same task and Task Card to implementation |
| any active state | product or architecture ambiguity | `BLOCKED` | Stop and request a decision |

There is no transaction, revision, compare-and-swap, reviewer-identity validation, review-URL validation, GitHub-review validation, PR-head validation or CI-evidence validation in the Dispatcher. The external Architect owns actual PR inspection and the review decision.

## Stop rules

- Stop at `REVIEW`, `BLOCKED`, `DEFERRED` and `DONE`.
- If no eligible `READY` task exists, stop.
- A Task Card/Accepted Contract conflict or unresolved product/architecture meaning is `PRODUCT_AMBIGUITY` and blocks dispatch.
- Synthetic launch evidence proves only that the worker profile can be launched.

## Stable errors

Only these codes are valid:

| Code | Meaning |
| --- | --- |
| `NO_READY_TASK` | No queue item is eligible to start |
| `WORKER_FAILED` | Worker could not complete and report a PR number |
| `REVIEW_REQUIRED` | A PR number was reported; external Architect review is required |
| `PRODUCT_AMBIGUITY` | Product, architecture or authority meaning needs an external decision |
| `TASK_BLOCKED` | The current task cannot proceed |
