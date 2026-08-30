# Single Dispatcher transition contract

Assume one Dispatcher and one sequential task queue. The Dispatcher performs only the transitions below and never acts as reviewer.

> **PRE-MERGE MAIN-CI GUARD:** Main CI is task main-verification evidence only
> after an accepted implementation PR exists, is proven merged from the exact
> Architect-reviewed `PASS` head, and its accepted merge commit is proven to be
> an ancestor of refreshed current main. Before all of those facts hold, any
> main CI result—including `FAILURE` or `SUCCESS` from a Worker-launch or state-
> projection commit—MUST NOT produce `MAIN_VERIFY_FAILED` or `DONE`.

## Authority and projection semantics

Canonical task identity and topology are read from the formal Task Cards and
predefined queue on refreshed `main`: `id`, `task_card`, `depends_on`, and
`next_task`. The Dispatcher never creates, renames, or derives an ID. GitHub
durable facts override stale local projection: matching PR, current head,
top-level verdict, merge state, and CI. `dispatcher-state.json` is therefore a
reconstructable projection plus canonical topology, not the only runtime truth.
Every pulse reconciles fresh durable facts, including recoverable main-CI
blockers, before any status-based stop or ordinary dispatch decision. A local
`BLOCKED` projection cannot suppress a mechanically authorized recovery.
`DONE` is also only a projection: it is never exempt from that reconciliation,
even when its `next_task` is `null`. A cached `DONE` may cause a pulse to stop
only after the accepted merge is proven in refreshed current-main ancestry and
the latest applicable required CI for that exact current-main SHA is terminal
`SUCCESS`.

**Remote-main refresh is mandatory before canonical queue reads.** At the start
of every bounded pulse, first run a safe `git fetch origin main`. Canonical queue
and Task Card reads must come from freshly fetched `origin/main` (or from a
local `main` that has just been proven equal to `origin/main`). A stale local
checkout/worktree is never evidence that no READY task or predefined successor
exists. The Dispatcher may inspect canonical files directly from `origin/main`
without mutating the working tree. If a local main/worktree must be synchronized
for dispatch, use only a safe fast-forward after checking repository identity and
working-tree safety; never force-reset or overwrite unknown changes.

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

`ARCHITECT_RECOVERY_V1` is recovery guidance, not an extra approval gate. A
missing, stale or malformed recovery comment must never block a transition that
is already mechanically authorized by the canonical Task Card, durable GitHub
facts and a valid current-head `ARCHITECT_VERDICT_V1`. Recovery metadata may
help resolve a mechanical stall, but it does not supersede or add prerequisites
to the closed transition table below.

## Required PR CI and same-task repair

For the current canonical task, PR, and exact PR head, required PR CI is a
first-class implementation gate. The Dispatcher fresh-reads the applicable
required PR CI before treating an open PR as review-only:

- missing or pending required PR CI is `REVIEW` / wait for PR CI;
- terminal `SUCCESS` permits the normal external Architect review gate;
- terminal failure is unfinished implementation and returns the same task and
  same PR to `IN_PROGRESS` for a bounded `luna-high` repair worker.

A current-head `REQUEST_CHANGES` is also same-task/same-PR repair. It is an
actionable external finding even when the PR-CI result is pending. A current-
head `PASS` never bypasses the PR-CI gate: pending/missing or failed PR CI is
not merge-eligible; only exact-head PR CI `SUCCESS` can reach the existing
fresh-head merge gate.

Before launching repair for a PR-CI failure, the Dispatcher writes this
top-level PR comment to GitHub:

```text
<!-- DISPATCHER_REPAIR_V1 -->
TASK: <task_id>
PR: <pr_number>
HEAD: <full_sha>
FAILED_CHECK: <stable job/check/step identity>
ACTION: LAUNCHED
```

The tuple `(TASK, PR, HEAD, FAILED_CHECK)` is the durable repair-event
fingerprint. A matching marker suppresses another launch for that exact event;
a new head or different failing check is a new event. The repair launch must
include the Task Card verbatim, PR number, current head, failed-check/run
evidence, and an instruction to keep the same PR. A plausible transient may
receive at most one bounded no-code rerun, whose terminal result must be
observed before handoff; a second failure requires a scoped same-PR repair or a
concrete `WORKER_FAILED` / `PRODUCT_AMBIGUITY` report.

## Closed transitions

| From | Event | To | Mechanical effect |
| --- | --- | --- | --- |
| `READY` | start | `IN_PROGRESS` | Persist before launching the declared worker |
| `IN_PROGRESS` | reconciliation finds unique PR | `REVIEW` or `IN_PROGRESS` | Bind canonical PR; open/no verdict is `REVIEW`, current-head `REQUEST_CHANGES` is same-PR `IN_PROGRESS` |
| `REVIEW` | current exact-head required PR CI pending/missing | `REVIEW` | Wait; do not launch repair or merge |
| `REVIEW` | current exact-head required PR CI failure | `IN_PROGRESS` | Same-task/same-PR repair; launch once per durable `(TASK, PR, HEAD, FAILED_CHECK)` marker |
| `REVIEW` | current-head `PASS` with required PR CI not `SUCCESS` | `REVIEW` or `IN_PROGRESS` | Pending/missing waits; failure uses same-task/same-PR repair; never merge |
| `IN_PROGRESS` | worker failed | `BLOCKED` | Stop current pulse |
| `REVIEW` | current-head `PASS`, fresh exact-head recheck, merge, refreshed main CI succeeds | `DONE` | Verify main, mark current `DONE`, then only predefined `next_task` becomes `READY` |
| `REVIEW` | current-head `REQUEST_CHANGES` | `IN_PROGRESS` | Return the same canonical task and PR to implementation |
| `BLOCKED / MAIN_VERIFY_FAILED` | accepted implementation PR remains merged from the exact Architect-reviewed `PASS` head; its accepted merge is in refreshed current-main ancestry; latest applicable required CI for exact refreshed current main is terminal `SUCCESS` | `DONE` | Clear stale `MAIN_VERIFY_FAILED`; mark current `DONE`; synchronize the three current-state files; unlock only predefined `next_task`, or unlock nothing when `next_task` is `null`; stop the current pulse |
| any active state | product or architecture ambiguity | `BLOCKED` | Stop current pulse and request a decision |

There is no transaction, revision, compare-and-swap, reviewer-identity
validation, review-URL validation, or GitHub native-review validation in the
Dispatcher. The external Architect owns actual PR inspection and review.

## Persistent scheduler / heartbeat invariant

The Dispatcher is a persistent scheduled executor made of bounded pulses.
Ending a pulse is never permission to disable or delete the schedule that will
run future pulses.

- `NO_READY_TASK`, `REVIEW`, `BLOCKED`, `DEFERRED`, `DONE`, `next_task: null`, and an Owner Checkpoint end only the current pulse.
- When no eligible `READY` task exists, the current pulse performs no implementation action and exits cleanly; the dispatcher-loop heartbeat remains installed and enabled.
- At an Owner Checkpoint, future pulses may continue to fresh-read and no-op until the external/web Architect publishes a newly Owner-authorized Development Pack with a `READY` task.
- No Dispatcher, Implementation Worker, or Codex-hosted agent may delete, disable, pause, or replace the persistent dispatcher-loop heartbeat because a queue is empty or a stage is complete.
- Only an explicit Product Owner instruction may disable or delete the persistent dispatcher-loop schedule.

## Stop rules

- **Stop means end the current bounded pulse only. It never means stop the persistent scheduler.**
- After mandatory durable and recoverable-blocker reconciliation, stop the current pulse at `REVIEW`, a still-`BLOCKED` task, `DEFERRED`, and `DONE`. `BLOCKED` is not globally terminal across future pulses.
- If no eligible `READY` task exists on freshly fetched `origin/main`, end the current pulse with `NO_READY_TASK` and leave the dispatcher heartbeat untouched.
- A Task Card/Accepted Contract conflict or unresolved product/architecture meaning is `PRODUCT_AMBIGUITY` and blocks dispatch for the current pulse.
- Synthetic launch evidence proves only that the worker profile can be launched.
- `PASS` alone does not unlock a downstream task. The current PR must first be merged into `main`; refresh and verify the accepted task on main, then mark `DONE` and unlock only predefined `next_task`.
- On main CI failure after a valid PASS merge whose accepted merge commit is proven in refreshed current-main ancestry, do not mark `DONE` or unlock `next_task`; set `BLOCKED / TASK_BLOCKED` with reason `MAIN_VERIFY_FAILED` and report the exact main SHA and CI failure. Before that merge proof exists, main CI is not task verification evidence and cannot cause `MAIN_VERIFY_FAILED` or `DONE`.
- Pending/missing main CI is retriable and must not produce `DONE` or successor `READY`.
- On `REQUEST_CHANGES`, retain the same Task Card and PR and repair only the findings. On `PRODUCT_AMBIGUITY`, set `BLOCKED` and stop the current pulse for an external decision.
- An open PR's exact-head required CI is a first-class gate: pending/missing is `REVIEW` wait; terminal failure is same-task/same-PR `IN_PROGRESS` repair with one durable launch per `(TASK, PR, HEAD, FAILED_CHECK)` marker. `REQUEST_CHANGES` is same-task/same-PR repair; `PASS` cannot bypass pending/missing/failed PR CI.
- Never run two READY tasks concurrently or advance beyond predefined `next_task`.

## Reconciliation and safety gates

- Every Scheduled Run is a bounded pulse. Do not wait for Workers, reviews, CI, or external state changes; persist the projection and end the pulse when a future event is required. The recurring schedule remains enabled for the next pulse.
- The first external action of every pulse is a safe `git fetch origin main`; only after that may the Dispatcher determine canonical queue/task-card state.
- After the refresh, reconcile durable GitHub/main facts and every projected `BLOCKED / MAIN_VERIFY_FAILED` task before applying any status-based stop or ordinary dispatch logic. Never return early merely because the cached status is `BLOCKED`.
- After the refresh, reconcile every projected `DONE` task as well as every projected `BLOCKED / MAIN_VERIFY_FAILED` task before applying any status-based stop or ordinary dispatch logic. Pending/missing exact-current-main CI restores the verification wait path; terminal failure projects `BLOCKED / TASK_BLOCKED` with reason `MAIN_VERIFY_FAILED`; only terminal success confirms `DONE`.
- `next_task: null` is not a reconciliation exemption. Once durable reconciliation confirms completion, scan the complete freshly fetched canonical queue for eligible `READY` work; an old `DONE + next_task:null` pointer cannot suppress an independently Owner-authorized READY task.
- Queue-wide READY selection is authoritative after reconciliation: exactly one eligible READY task transitions to `IN_PROGRESS`, zero yields `NO_READY_TASK`, and more than one yields `DISPATCHER_STATE_INVALID`. For `depends_on`, only entries matching a task ID in the freshly read canonical queue are resolved through local task status; durable pack, `main@...`, and other non-task prerequisites are not implicit missing-task blockers.
- Before any side effect, persist the state transition successfully, then perform the external action. In particular, persist `READY → IN_PROGRESS` before launching a Worker.
- `IN_PROGRESS` is the default wait state only when no durable GitHub fact can advance it. A stale status or missing local PR cannot deny a matching GitHub PR.
- Fresh reads are mandatory immediately before merge, verdict handling, dispatch, `DONE`, and `READY` unlock: PR state/head/comments, canonical queue from freshly fetched `origin/main`, and actual main SHA/CI must be read at the gate.
- If local `pr` is null or status is stale, fresh-query `Li-Ming-G/elder_interview_ai` across open and merged PRs. Use combined canonical Task Card, title/body, branch, predecessor/`next_task`, and phase evidence; no one marker is mandatory. Zero candidates is a no-op; one clear candidate is persisted and reconciled; equal candidates are `PRODUCT_AMBIGUITY`.
- Open + current-head `REQUEST_CHANGES` is same canonical task `IN_PROGRESS`; open + no current-head verdict is `REVIEW`; open + current-head `PASS` requires a fresh exact-head recheck before merge. Merged PRs skip merge and continue through main verification.
- For an open PR, fresh-read exact-head required PR CI before the review/merge decision: pending/missing waits, terminal failure returns the same task and PR to repair, and only terminal success permits the Architect gate. A matching `DISPATCHER_REPAIR_V1` marker suppresses duplicate repair for the same task, PR, head, and failed-check identity.
- Formal REVIEW requires `ARCHITECT_REVIEW_CONTEXT_V1` with `TASK`, `PR`, `CURRENT_HEAD`, `BASE_MAIN_SHA`, `TASK_CARD`, `ALLOWED_SCOPE`, `ACCEPTED_CONTRACTS`, and `REQUIRED_TESTS`; missing context holds `REVIEW` and is not a verdict.
- If an already-accepted PR is merged, skip merge and perform main verification. Merge conflict/rejection and closed-unmerged PRs use stable `TASK_BLOCKED` with a specific reason.
- Pending/missing main CI and temporary GitHub API/network/rate-limit/auth/service failures are wait/no-op conditions retried on the next cadence without business-state mutation. Confirmed main CI failure is `BLOCKED / TASK_BLOCKED` with reason `MAIN_VERIFY_FAILED`, main SHA, and CI run recorded.
- Before main sync, verify repository identity and safe local working-tree state; unsafe dirty sync is `BLOCKED / TASK_BLOCKED` with reason `LOCAL_SYNC_UNSAFE`. Never force-reset or overwrite unknown changes.
- More than one active task or READY task is `BLOCKED / TASK_BLOCKED` with reason `DISPATCHER_STATE_INVALID`; Dispatcher never chooses between contradictory queue entries.
- A pulse advances at most one safe stage.

### Applicable current-main CI and blocker recovery

For a candidate refreshed current-main SHA `M`, the accepted implementation
merge commit `A` must be proven as an ancestor of `M`. Required CI is then read
for exact `M`, not for an earlier main SHA or an unrelated successful SHA. If
the workflow has been rerun on exact `M`, the latest applicable run attempt is
authoritative:

- latest attempt `SUCCESS`: current-main verification succeeds;
- latest attempt pending, or no applicable attempt: wait and retry on the next pulse;
- latest attempt `FAILURE`: remain `BLOCKED / MAIN_VERIFY_FAILED` and retry on the next pulse;
- `SUCCESS` for a SHA whose ancestry does not contain `A`: fail closed and never clear the blocker.

When exact-current-main verification later succeeds, the closed transition
from `BLOCKED / MAIN_VERIFY_FAILED` to `DONE` is automatic. It requires no new
Architect verdict, `ARCHITECT_RECOVERY_V1`, Worker repair commit, Worker PR, or
Product Owner signal because the implementation was already accepted. Clear
the stale blocker, perform the required three-file synchronization, and unlock
only the predefined `next_task`; if it is `null`, unlock nothing and end the
current pulse.

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
| `NO_READY_TASK` | No queue item is eligible to start; end the current pulse only and keep the persistent dispatcher heartbeat enabled |
| `WORKER_FAILED` | Worker could not complete and report a PR number |
| `REVIEW_REQUIRED` | A PR number was reported; external Architect review is required |
| `PRODUCT_AMBIGUITY` | Product, architecture, identity, or evidence meaning needs an external decision |
| `TASK_BLOCKED` | The current task cannot proceed |
