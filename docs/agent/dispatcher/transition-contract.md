# Single Dispatcher transition contract

Assume one Dispatcher and one sequential task queue. The Dispatcher performs only the transitions below and never acts as reviewer.

## Authority and projection semantics

Canonical task identity and topology are read from the formal Task Cards and
predefined queue on refreshed `main`: `id`, `task_card`, `depends_on`, and
`next_task`. The Dispatcher never creates, renames, or derives an ID. GitHub
durable facts override stale local projection: matching PR, current head,
top-level verdict, merge state, and CI. `dispatcher-state.json` is therefore a
reconstructable projection plus canonical topology, not the only runtime truth.

At the start of every bounded pulse, validate the active local ID against the
canonical queue. An invalid ID such as `P4C-02-ASSEMBLY` is never used as a
GitHub search key or dispatch target. Search all canonical IDs using combined
Task Card, PR title/body, branch, predecessor/`next_task`, and phase evidence.
One clear candidate may recover; equal candidates are `PRODUCT_AMBIGUITY`.

## Architect Verdict Protocol V1

The actionable review result is the latest valid top-level GitHub PR
conversation comment containing `<!-- ARCHITECT_VERDICT_V1 -->` and the
required TASK, PR, REVIEWED_HEAD, VERDICT, P0, P1 and P2 fields. GitHub native
`APPROVED` and ordinary comments are not architecture gates. `REVIEWED_HEAD`
must equal a fresh current PR head SHA; old-head verdicts are stale and
ignored. Multiple valid verdicts on one head use the latest valid comment;
malformed or conflicting current-head evidence is `PRODUCT_AMBIGUITY`. No
current-head verdict leaves an open PR in `REVIEW`.

## Closed transitions

| From | Event | To | Mechanical effect |
| --- | --- | --- | --- |
| `READY` | start | `IN_PROGRESS` | Persist before launching the declared worker |
| `IN_PROGRESS` | reconciliation finds unique PR | `REVIEW` or `IN_PROGRESS` | Bind canonical PR; open/no verdict is `REVIEW`, current-head `REQUEST_CHANGES` is same-PR `IN_PROGRESS` |
| `IN_PROGRESS` | worker failed | `BLOCKED` | Stop |
| `REVIEW` | current-head `PASS`, fresh exact-head recheck, merge, refreshed main CI succeeds | `DONE` | Verify main, mark current `DONE`, then only predefined `next_task` becomes `READY` |
| `REVIEW` | current-head `REQUEST_CHANGES` | `IN_PROGRESS` | Return the same canonical task and PR to implementation |
| any active state | product or architecture ambiguity | `BLOCKED` | Stop and request a decision |

There is no transaction, revision, compare-and-swap, reviewer-identity
validation, review-URL validation, or GitHub native-review validation in the
Dispatcher. The external Architect owns actual PR inspection and review.

## Stop rules

- Stop at `REVIEW`, `BLOCKED`, `DEFERRED` and `DONE`.
- If no eligible `READY` task exists, stop.
- A Task Card/Accepted Contract conflict or unresolved product/architecture meaning is `PRODUCT_AMBIGUITY` and blocks dispatch.
- Synthetic launch evidence proves only that the worker profile can be launched.
- `PASS` alone does not unlock a downstream task. The current PR must first be merged into `main`; refresh and verify the accepted task on main, then mark `DONE` and unlock only predefined `next_task`.
- On main CI failure after a valid PASS merge, do not mark `DONE` or unlock `next_task`; set `BLOCKED / MAIN_VERIFY_FAILED` and report the exact main SHA and CI failure.
- Pending/missing main CI is retriable and must not produce `DONE` or successor `READY`.
- On `REQUEST_CHANGES`, retain the same Task Card and PR and repair only the findings. On `PRODUCT_AMBIGUITY`, set `BLOCKED` and stop for an external decision.
- Never run two READY tasks concurrently or advance beyond predefined `next_task`.

## Reconciliation and safety gates

- Every Scheduled Run is a bounded pulse. Do not wait for Workers, reviews, CI, or external state changes; persist the projection and end the pulse when a future event is required.
- Before any side effect, persist the state transition successfully, then perform the external action. In particular, persist `READY → IN_PROGRESS` before launching a Worker.
- `IN_PROGRESS` is the default wait state only when no durable GitHub fact can advance it. A stale status or missing local PR cannot deny a matching GitHub PR.
- Fresh reads are mandatory immediately before merge, verdict handling, dispatch, `DONE`, and `READY` unlock: PR state/head/comments, current queue, and actual main SHA/CI must be read at the gate.
- If local `pr` is null or status is stale, fresh-query `Li-Ming-G/elder_interview_ai` across open and merged PRs. Use combined canonical Task Card, title/body, branch, predecessor/`next_task`, and phase evidence; no one marker is mandatory. Zero candidates is a no-op; one clear candidate is persisted and reconciled; equal candidates are `PRODUCT_AMBIGUITY`.
- Open + current-head `REQUEST_CHANGES` is same canonical task `IN_PROGRESS`; open + no current-head verdict is `REVIEW`; open + current-head `PASS` requires a fresh exact-head recheck before merge. Merged PRs skip merge and continue through main verification.
- Formal REVIEW requires `ARCHITECT_REVIEW_CONTEXT_V1` with `TASK`, `PR`, `CURRENT_HEAD`, `BASE_MAIN_SHA`, `TASK_CARD`, `ALLOWED_SCOPE`, `ACCEPTED_CONTRACTS`, and `REQUIRED_TESTS`; missing context holds `REVIEW` and is not a verdict.
- If an already-accepted PR is merged, skip merge and perform main verification. Merge conflict/rejection is `BLOCKED / MERGE_FAILED`; closed-unmerged is `BLOCKED / PR_CLOSED_UNMERGED`.
- Pending/missing main CI and temporary GitHub API/network/rate-limit/auth/service failures are retried on the next cadence without business-state mutation. Confirmed main CI failure is `BLOCKED / MAIN_VERIFY_FAILED` with main SHA and CI run recorded.
- Before main sync, verify repository identity and safe local working-tree state; unsafe dirty sync is `BLOCKED / LOCAL_SYNC_UNSAFE`. Never force-reset or overwrite unknown changes.
- More than one active task or READY task is `BLOCKED / DISPATCHER_STATE_INVALID`; Dispatcher never chooses between contradictory queue entries.
- A pulse advances at most one safe stage and never dispatches P4C-03 as a side effect of this recovery task.

## Permanent stage-end state synchronization

Every completed development stage follows this mechanical sequence:

`Architect PASS → merge accepted PR → refresh latest main → verify accepted exact head landed → mark completed task/stage DONE → synchronize current-state files → unlock only predefined next task`.

The synchronization must update exactly:

- `AI-DEVELOPMENT-CURRENT.md`
- `docs/agent/00-task-board.md`
- `docs/agent/dispatcher/dispatcher-state.json`

Only accepted and merged facts may advance these files. Do not rewrite
historical archives, alter Accepted Contracts, invent product or architecture
decisions, or change business code during state synchronization. If these
files disagree with accepted merged repository facts, the merged facts are
authoritative; repair the files before further development starts. Architect
`PASS` alone does not advance stage state.

## Stable errors

Only these codes are valid:

| Code | Meaning |
| --- | --- |
| `NO_READY_TASK` | No queue item is eligible to start |
| `WORKER_FAILED` | Worker could not complete and report a PR number |
| `REVIEW_REQUIRED` | A PR number was reported; external Architect review is required |
| `PRODUCT_AMBIGUITY` | Product, architecture, identity, or evidence meaning needs an external decision |
| `TASK_BLOCKED` | The current task cannot proceed |
