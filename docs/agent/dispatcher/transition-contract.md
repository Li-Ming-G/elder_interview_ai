# Single Dispatcher transition contract

Assume one low-intelligence Dispatcher and one sequential task queue. The
Dispatcher reconciles durable facts, validates machine protocols, performs
idempotent state changes, and launches the declared Worker. It never acts as
Architect, performs technical review, invents a task, or changes queue topology.

`architect-directive-v1.md` is the sole syntax, identity, digest, ACK, and
effective-overlay contract for Directives. This file defines where Directive
reconciliation enters the task state machine.

> **PRE-MERGE MAIN-CI GUARD:** Main CI is task main-verification evidence only
> after an accepted implementation PR is proven merged from the exact
> Architect-reviewed `PASS` head and its accepted merge commit is an ancestor
> of refreshed current main. Before those facts hold, no main CI result can
> produce `MAIN_VERIFY_FAILED` or `DONE`.

## Authority and runtime projection

Product Owner decisions and exact Accepted Contracts control product behavior,
architecture boundaries, provider/model/data-policy/cost decisions, and
reserved/deferred choices. The Task Card controls base task identity, goal,
scope, dependencies, tests, completion gates, and immutable `depends_on` /
`next_task`. Successful current-task Directive ACK snapshots add implementation
files, tests, and bounded instructions. They cannot subtract or override.

The effective execution envelope is:

```text
base Task Card
+ every successful ARCHITECT_DIRECTIVE_V1 ACK overlay for the current task
```

Task Card `Status:` is an issuance/planning snapshot. Runtime status is read
from the freshly reconciled canonical queue/state. `Status: DEFERRED` in a card
plus canonical `IN_PROGRESS` is mechanically valid and never
`PRODUCT_AMBIGUITY`.

`dispatcher-state.json` is a reconstructable projection plus canonical
topology, not a sole truth source. GitHub durable PR/head/directive-ACK/review-
context/verdict/merge/CI facts correct stale projection. `IN_PROGRESS` and
`BLOCKED` may retain an implementation PR; projection status never erases it.

## Mandatory bounded-pulse order

Every pulse advances at most one safe stage and uses this exact priority:

1. first external action: `git fetch origin main`;
2. record exact `origin/main`, then read canonical governance, control-plane
   configuration, queue/state, active Task Card, and its declared contracts from
   that exact SHA;
3. read the configured Architect Command Bus issue, including comment authors,
   markers, timestamps, and ACKs;
4. read the active or uniquely discoverable PR, exact head, exact-head required
   CI, top-level comments, merge state, accepted merge, current main ancestry,
   and exact-current-main CI as applicable;
5. reconcile all durable facts, including projected `DONE` and recoverable
   `BLOCKED / MAIN_VERIFY_FAILED`, before any cached-status stop;
6. evaluate the next valid unconsumed current-task Directive;
7. only when no Directive action applies, execute the ordinary task-state action.

Directive handling therefore outranks ordinary `BLOCKED` no-op,
`WAIT_FOR_WORKER_PR`, `WAIT_FOR_ARCHITECT_VERDICT`, an existing
`DISPATCHER_REPAIR_V1` dedupe marker, and an unmerged old `PASS`. It never
outranks or bypasses the implementation, exact-head PR CI, Review Context,
Architect review, `PASS`, merge, ancestry, exact-main CI, `DONE`, or predefined-
successor gates.

Remote-main refresh is mandatory before canonical reads. A local checkout may
be used only after it is proven equal to freshly fetched `origin/main`. Never
force-reset or overwrite unknown changes. Temporary network/GitHub/CI absence is
a wait/no-op, not invented evidence.

## Directive reconciliation

Read `control-plane.json` from exact refreshed main. If absent, disabled, or not
naming `ARCHITECT_DIRECTIVE_V1`, issue #135 comments remain inert and the pulse
uses legacy ordinary transitions. If enabled, validate directives exactly as
`architect-directive-v1.md` requires: configured repository/issue and authorized
author, exact field set, normalized digest, current task/runtime state, satisfied
dependencies, protected paths, `PR`/`HEAD` pair freshness, duplicate/conflict
identity, deterministic Worker discovery, and prior ACKs.

The Dispatcher does not assess whether the Architect's technical judgment is
good. `DECISION_CLASS: IMPLEMENTATION_ONLY` is the Architect's attestation.
Directive-marker comments from a login outside `authorized_architect_logins`
are inert: do not parse, reject, ACK, or let them affect scan order. Authorized
machine-invalid or stale directives are not executed and receive at most one
deterministic rejection ACK for their rejection identity. On a later pulse, an
authorized Dispatcher rejection ACK for that exact identity makes the
Dispatcher skip the rejected comment and continue scanning later comments in
creation order. A rejected comment therefore cannot starve a later valid
Directive. Same ID/different digest,
crossing a protected governance/Accepted-Contract path, or another fact that
cannot be mechanically reconciled is `PRODUCT_AMBIGUITY` and escalates to Owner.
The Worker separately fails closed if the actual instruction conflicts with an
Owner-frozen decision, Accepted Contract, architecture boundary, identity,
topology, provider/model/data-policy/cost decision, or Owner-deferred choice.

For a valid Directive:

1. reconstruct prior overlays only from successful ACK snapshots;
2. compute effective allowed files/tests as stable base-plus-overlay unions;
3. if runtime is `READY` or `BLOCKED`, persist `IN_PROGRESS` without modifying
   task identity, PR binding, dependencies, or `next_task`;
4. if runtime is `IN_PROGRESS` or `REVIEW`, retain the task and return it to
   `IN_PROGRESS` as needed;
5. discover the deterministic Directive Worker identity; create exactly one
   `luna-high` Worker if absent, otherwise recover it after ACK loss;
6. publish the success ACK with digest, `WORKER_REF`, and complete effective
   overlay snapshots;
7. end the pulse.

`DEFERRED` and `DONE` cannot be revived by Directive. A null `PR`/`HEAD` pair is
valid only when no canonical PR is bound or durably discoverable and supports
pre-PR/failed-launch/never-created-PR recovery. A concrete pair must match the
current canonical PR/head and retains the same PR. No Directive creates a new
Task or successor.

A matching old `DISPATCHER_REPAIR_V1` fingerprint suppresses only its own
failure event. A new unique valid Directive is a new execution authorization and
must be allowed to launch. Successful overlays remain effective across later
heads, ordinary repairs, `REQUEST_CHANGES`, CI repairs, and review until `DONE`.

Successful Directive consumption creates an immediate review/merge fence. All
Review Context and verdict comments created before the latest successful ACK are
stale even if the head has not changed. No merge is eligible until a post-ACK
current-envelope Review Context exists and a later exact-head verdict is valid.

## Review Context and verdict

Formal review requires the latest valid top-level comment:

```text
<!-- ARCHITECT_REVIEW_CONTEXT_V1 -->
TASK: <task id>
PR: <pr number>
CURRENT_HEAD: <full sha>
BASE_MAIN_SHA: <full sha>
TASK_CARD: <canonical path>
ALLOWED_SCOPE: <base + applied overlay union, semicolon-separated>
ACCEPTED_CONTRACTS: <Task Card declarations or none declared in Task Card>
REQUIRED_TESTS: <base + applied overlay union, semicolon-separated>
APPLIED_DIRECTIVES: <ordered directive ids or none>
```

The Dispatcher mechanically publishes this only after exact-head required PR CI
success. The comment author must be an exact member of
`authorized_dispatcher_logins`; every other Review Context marker is inert.
`TASK`, `PR`, and `CURRENT_HEAD` must match fresh facts;
`BASE_MAIN_SHA` must come from durable task-start/Worker-launch/PR evidence and
must never be guessed from current main; scope/tests/directives must exactly
represent the effective envelope reconstructed from successful ACKs. Missing or
stale context holds `REVIEW`. A successful later Directive invalidates it.

The actionable review result is the latest valid top-level PR comment from an
exact `authorized_architect_logins` member containing `ARCHITECT_VERDICT_V1`
with required `TASK`, `PR`, `REVIEWED_HEAD`, `VERDICT`,
`P0`, `P1`, and `P2`. `REVIEWED_HEAD` must equal the fresh current PR head and
the verdict must be created after the valid current-envelope Review Context.
Ordinary comments, unauthorized marker comments, and GitHub native approval are
inert. Multiple conflicting authorized valid current-head verdicts are
`PRODUCT_AMBIGUITY`.

`ARCHITECT_RECOVERY_V1` remains legacy/advisory compatibility and is never an
execution command or extra approval gate. In Directive mode, implementation
execution commands use only `ARCHITECT_DIRECTIVE_V1` on the configured bus.

## Exact-head PR CI and ordinary repair

Required PR CI is a first-class implementation gate for the current exact head:

- missing/pending: `REVIEW`, wait;
- terminal failure: same-task/same-PR `IN_PROGRESS` repair;
- terminal success: publish/validate effective Review Context and wait for the
  later external Architect verdict;
- current-context `REQUEST_CHANGES`: same-task/same-PR repair even when CI is
  pending;
- current-context `PASS`: merge-eligible only after exact-head CI success and a
  fresh head/context/verdict/CI recheck.

Before ordinary CI-failure repair, post `DISPATCHER_REPAIR_V1` with `TASK`, `PR`,
`HEAD`, `FAILED_CHECK`, and `ACTION: LAUNCHED`. Its fingerprint is
`(TASK, PR, HEAD, FAILED_CHECK)`. It deduplicates only that ordinary failure
event, and only a marker from `authorized_dispatcher_logins` may suppress a
launch; unauthorized lookalikes are inert. The repair launch includes the effective envelope, current PR/head, failed
check/run evidence, and same-PR instruction. One plausible transient may receive
one bounded no-code rerun; a second failure needs scoped repair or a concrete
`WORKER_FAILED` / `PRODUCT_AMBIGUITY` hand-back.

## Closed transitions

| From | Event | To | Mechanical effect |
| --- | --- | --- | --- |
| `READY` | ordinary start | `IN_PROGRESS` | Persist, then launch declared Worker with effective envelope |
| `READY` | valid Directive | `IN_PROGRESS` | Persist, launch deterministic Directive Worker, ACK, end pulse |
| `IN_PROGRESS` | unique PR discovered | `REVIEW` or `IN_PROGRESS` | Bind PR and reconcile exact-head facts |
| `IN_PROGRESS` | valid Directive, including `PR:null` | `IN_PROGRESS` | Launch/recover current Worker, ACK, end pulse |
| `REVIEW` | valid Directive | `IN_PROGRESS` | Fence old review/PASS, launch same-task Worker, ACK, end pulse |
| `BLOCKED` | valid implementation Directive | `IN_PROGRESS` | Mechanically recover same task/PR, launch Worker, ACK, end pulse |
| `REVIEW` | exact-head PR CI pending/missing | `REVIEW` | Wait |
| `REVIEW` | exact-head PR CI failure | `IN_PROGRESS` | Ordinary fingerprinted same-PR repair |
| `REVIEW` | valid current-context `REQUEST_CHANGES` | `IN_PROGRESS` | Same-task/same-PR repair |
| `REVIEW` | valid current-context `PASS` + exact-head CI success + fresh recheck + merge + refreshed-main CI success | `DONE` | Synchronize, then unlock only predefined successor |
| `BLOCKED / MAIN_VERIFY_FAILED` | accepted PASS head merge remains in current-main ancestry and latest exact-main CI succeeds | `DONE` | Clear blocker; no Directive, Worker, recovery marker, or Owner signal required |
| any active state | product/architecture/identity/evidence ambiguity | `BLOCKED` | Stop pulse and escalate |

No Directive can produce `DONE` or `READY` for a successor.

## Merge and exact-main verification

`PASS` alone is never `DONE`. Immediately before merge, fresh-read the exact PR
head, exact-head CI, current-envelope Review Context, post-context verdict, and
unconsumed Directives. If a Directive exists, it wins ordering and merge stops.
After merge, refresh main, prove the accepted merge commit is an ancestor of the
exact current-main SHA, and select the latest applicable required CI attempt for
that exact SHA. Success permits `DONE`; pending/missing waits; failure becomes
`BLOCKED / MAIN_VERIFY_FAILED`. Success for another SHA is irrelevant.

Every later pulse rechecks a projected `BLOCKED / MAIN_VERIFY_FAILED`. A later
successful exact-current-main rerun mechanically clears it, synchronizes exactly
`AI-DEVELOPMENT-CURRENT.md`, `docs/agent/00-task-board.md`, and
`docs/agent/dispatcher/dispatcher-state.json`, and unlocks only predefined
`next_task` (or nothing when null). A projected `DONE`, including
`next_task:null`, is also revalidated before no-op.

## Queue selection, pulse boundaries, and safety

After reconciliation, one active task has priority. Only when none exists may the
Dispatcher scan the complete canonical queue: exactly one eligible `READY`
dispatches, zero yields `NO_READY_TASK`, and more than one yields
`TASK_BLOCKED / DISPATCHER_STATE_INVALID`. Only dependencies that are canonical
task IDs resolve through queue status; durable pack/main prerequisites are not
invented missing tasks.

Before any side effect, persist the authorized state transition. Fresh-read the
relevant external fact immediately before dispatch, Directive ACK, Review Context,
verdict handling, merge, `DONE`, and successor unlock. Unsafe local sync is
`TASK_BLOCKED / LOCAL_SYNC_UNSAFE`; never force-reset unknown work.

Waiting for Worker, PR, CI, Architect, or external state ends the current bounded
pulse. `NO_READY_TASK`, `REVIEW`, `BLOCKED`, `DEFERRED`, `DONE`, `next_task:null`,
and Owner Checkpoint never disable/delete/replace the persistent dispatcher
heartbeat. Only an explicit Product Owner instruction may do so.

## Stable errors

| Code | Meaning |
| --- | --- |
| `NO_READY_TASK` | No canonical queue item is eligible; end only this pulse |
| `WORKER_FAILED` | Worker could not be launched/recovered or report a PR |
| `REVIEW_REQUIRED` | A PR is ready for external Architect review |
| `PRODUCT_AMBIGUITY` | Product, architecture, identity, command, or evidence meaning needs external/Owner decision |
| `TASK_BLOCKED` | A mechanically identified blocker prevents progress |
