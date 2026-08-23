# Single Dispatcher contract

This directory implements a deliberately small governance path:

`Single Dispatcher → Sequential Task Queue → Implementation Worker → External Architect PR Review`.

## Authority and state semantics

Canonical Task Card IDs, dependencies, and `next_task` topology come from the
queue and Task Cards on refreshed `main`. GitHub is authoritative for durable
runtime facts: matching PR, current head, top-level Architect verdict, merge
state, and CI. `dispatcher-state.json` is not the sole runtime truth. It stores
the canonical queue topology plus a last-known/reconstructable local
projection, including temporary pre-PR in-flight state. A stale status or PR
number cannot deny a GitHub fact.

The Dispatcher never derives a task ID from a branch, PR title, or local alias.
If an active local ID is absent from the canonical queue, it is invalidated and
the Dispatcher searches the canonical IDs using combined Task Card, topology,
branch, and phase evidence. One clear candidate is recoverable; equal
candidates fail closed as `PRODUCT_AMBIGUITY`.

## Architect Verdict Protocol V1

GitHub PR is the communication bus between the external Architect and Dispatcher. The Dispatcher does not rely on GitHub native `APPROVED` state or ordinary natural-language comments.

Only a top-level conversation comment containing `<!-- ARCHITECT_VERDICT_V1 -->`
is actionable, with fields:

```text
TASK: <task_id>
PR: <pr_number>
REVIEWED_HEAD: <full_sha>
VERDICT: PASS | REQUEST_CHANGES | PRODUCT_AMBIGUITY
P0: <integer>
P1: <integer>
P2: <integer>
```

The verdict is valid only when TASK and PR match the canonical task/PR and
`REVIEWED_HEAD` equals a fresh current PR head SHA. Older-head verdicts are
stale and ignored. For multiple valid verdicts on the same head, the latest
valid verdict wins. Malformed or conflicting current-head evidence fails closed
as `PRODUCT_AMBIGUITY`. If no valid current-head verdict exists, an open PR is
still projected as `REVIEW`; no merge is eligible.

- `REQUEST_CHANGES`: return the same task to `IN_PROGRESS`, continue/relaunch the same Worker, retain Task Card and PR, and repair only the findings.
- `PRODUCT_AMBIGUITY`: set the task `BLOCKED`, stop, and surface the ambiguity; do not choose a direction.
- `PASS`: recheck exact-head equality, merge the current PR, wait for main CI, and only on success mark `DONE`, unlock only predefined `next_task`, sync main, and dispatch its predefined worker profile. Main CI failure means `BLOCKED / MAIN_VERIFY_FAILED`; do not mark `DONE` or unlock.

Never run two READY tasks concurrently, advance beyond `next_task`, create Task Cards, alter Accepted Contracts, invoke an internal Reviewer or invoke iteration-coach. Routine handoff does not require Product Owner forwarding; involve the Owner only for ambiguity, architecture decisions, scope amendments, or deferred provider/model/cost/product decisions.

## Loop Reconciliation Rules

### Bounded pulse and side-effect ordering

Every Scheduled Run is a bounded pulse. It never waits for a Worker, PR review, CI, or external state change. If the next action depends on a future event, persist the current state and end the pulse immediately.

Every side effect follows `persist state → perform external action`. For dispatch, persist `READY → IN_PROGRESS` successfully before launching the Worker. This prevents a subsequent pulse from dispatching the same task twice.

### Permanent stage-end state synchronization

At every completed development-stage closeout, after the accepted PR has been
merged into `main` and the accepted exact head has been verified on refreshed
`main`, mechanically synchronize exactly these three current-state files before
unlocking the predefined next task:

1. `AI-DEVELOPMENT-CURRENT.md`
2. `docs/agent/00-task-board.md`
3. `docs/agent/dispatcher/dispatcher-state.json`

The synchronization may advance only from accepted and merged facts. It must
not alter historical archives, Accepted Contracts, product or architecture
decisions, or business code. If the three files disagree with accepted merged
repository facts, those facts are authoritative and the files must be repaired
before further development starts. Architect `PASS` alone never advances stage
state.

`IN_PROGRESS` is the default wait state only when no durable GitHub fact can
advance the canonical task. A matching PR, merge, verdict, or CI fact can
correct stale local status; an apparently idle Worker, a temporarily absent
PR, or an unchanged head never proves failure or completion.

Before every side effect, perform a fresh external read: PR state and head before merge; Dispatcher state before dispatch; PR head before verdict handling; actual main SHA before main-CI handling. No cache, previous pulse, or chat context substitutes for the fresh read.

### Reconciliation and deterministic PR discovery

At the beginning of every pulse, reconcile the active canonical task before
selecting a new action. When local `pr` is null or local status is stale,
fresh-query `Li-Ming-G/elder_interview_ai` for open or already-merged PRs that
correspond to the canonical task. Combine exact Task ID, Task Card, branch,
predecessor/`next_task`, and current phase evidence; no single marker is
mandatory. Prefer a clear task branch only as a score, never by recency, PR
number, author, or a fictional local ID.

- Zero candidates: keep the canonical task's in-flight projection and end the pulse.
- More than one equally plausible candidate: set `BLOCKED / PRODUCT_AMBIGUITY`, list candidates, and do not choose.
- Exactly one clear candidate: fresh-read it, persist the canonical task's PR number, then continue reconciliation.

After binding, fresh-read the PR head and top-level comments. Open + current-head
`REQUEST_CHANGES` becomes canonical `IN_PROGRESS` on the same PR. Open + no
current-head verdict becomes `REVIEW`. Open + current-head `PASS` is merge
eligible only after another fresh exact-head recheck. Merged PRs skip merge and
continue through main verification. GitHub PR facts, not Worker chat, are the
discovery authority.

- A PR's existence, non-draft state, completed PR CI, or stable head does not prove PASS or merge safety. Formal PRs must include `ARCHITECT_REVIEW_CONTEXT_V1` with `TASK`, `PR`, `CURRENT_HEAD`, `BASE_MAIN_SHA`, `TASK_CARD`, `ALLOWED_SCOPE`, `ACCEPTED_CONTRACTS`, and `REQUIRED_TESTS`; missing context holds the task in `REVIEW`.
- If a PASS PR is already merged, do not merge again; proceed to main verification. Open merge conflicts/rejection yield `BLOCKED / MERGE_FAILED`; closed-unmerged PR yields `BLOCKED / PR_CLOSED_UNMERGED`.
- Pending or temporarily missing main CI is not failure: retain a pending verification state and retry next cadence. GitHub API/network/rate-limit/auth/service errors are transient and do not change business state. Only confirmed main CI failure yields `BLOCKED / MAIN_VERIFY_FAILED`.
- Before syncing main, verify repository identity and a safe clean/savable working tree. If local sync could overwrite uncommitted work, stop with `BLOCKED / LOCAL_SYNC_UNSAFE`; never force-reset or overwrite unknown changes.
- At all times there is at most one active task and one READY task; any queue contradiction yields `BLOCKED / DISPATCHER_STATE_INVALID`.

Every irreversible transition performs a fresh read immediately before the
action: PR head before merge, current queue before dispatch, PR head/comments
before verdict handling, and actual main SHA/CI before `DONE` and `READY`
unlock. A bounded pulse persists state before external action, advances at most
one safe stage, and exits when worker, review, or CI state is pending. Pending
main CI never produces `DONE` or a successor `READY`.

## Files

- [`dispatcher-state.json`](dispatcher-state.json): current sequential queue.
- [`dispatcher-state.schema.json`](dispatcher-state.schema.json): minimal queue/task shape.
- [`transition-contract.md`](transition-contract.md): closed transitions and five stable errors.
- [`worker-profiles/luna-high.json`](worker-profiles/luna-high.json): native Desktop worker profile.
- [`luna-high-launch-contract.md`](luna-high-launch-contract.md): launch and worker hand-back.
- [`task-card-template.md`](task-card-template.md): mandatory bounded Task Card.
- [`fixtures/sequential-queue-smoke.json`](fixtures/sequential-queue-smoke.json): two-task sequential smoke fixture.
- [`dispatcher-dry-run.mjs`](dispatcher-dry-run.mjs): A→B smoke plus A–I reconciliation validation.
- [`fixtures/reconciliation-cases.json`](fixtures/reconciliation-cases.json): stale-state, identity, verdict, ambiguity, and CI fixtures.

## Mechanical algorithm

1. Fresh-read canonical queue/Task Cards and GitHub facts; reconcile stale projection first.
2. Validate the active ID; recover only to an existing canonical ID and bind a unique matching PR.
3. For a `READY` task, persist `IN_PROGRESS` before launching its declared worker profile.
4. When an open PR exists, project `REVIEW` unless the fresh current-head verdict is `REQUEST_CHANGES`; retain the same PR for repair.
5. The external Architect performs the actual PR review.
6. On external `PASS`, do not unlock `next_task` until the current PR is merged into `main`; refresh/sync local `main` and verify it contains the accepted task.
7. Then, after fresh main verification, set current `DONE` and only the predefined `next_task` `READY`. On `REQUEST_CHANGES`, return the same task to `IN_PROGRESS`.
8. Worker failure, product/architecture ambiguity or another blocker sets `BLOCKED` and stops.

### Accepted-baseline lifecycle gate

`PASS` alone never unlocks a downstream task. The mandatory sequence is:

`Architect PASS → current PR MERGED into main → refresh/sync main → verify accepted task is in main → current DONE → predefined next_task READY → next Worker branches from refreshed main`.

A downstream Worker must not start from a `main` that does not contain its accepted predecessor.

The Dispatcher does not validate reviewer identity, review URLs, or GitHub
native review objects. It does validate exact PR heads, machine verdict fields,
merge state, and main CI for reconciliation safety. It has no state revision,
compare-and-swap or atomic snapshot requirement. A Task Card controls scope
and entry; an exact Accepted Contract controls behavior and invariants.

## Ordinary-task review policy

For an ordinary Implementation Task, do not start iteration-coach or an additional internal Reviewer by default. The external Architect's PR review is the default independent review. Upgrade only when the Product Owner or Architect explicitly requires it.

Use Task Card + PR as the normal handoff. Do not generate per-task REV, handoff, traceability, conflict-history or ADR files; batch stage records at stage end, except when a real architecture decision explicitly requires an ADR.
