# Dispatcher Same-Task Repair Development Pack

Status: `DEFERRED`

## Owner authorization

The Product Owner authorizes one bounded governance maintenance task to close a dispatcher liveness gap exposed by `FIRST-INTERVIEW-START-01` / PR #116: an implementation task can still have actionable work remaining after a PR exists, but the current dispatcher can enter `REVIEW` and then no-op indefinitely when required PR CI is failed and no Architect verdict has yet returned it to implementation.

Predefined sequence now participates in the later Owner-authorized queue extension:

```text
FIRST-INTERVIEW-START-01
  -> DISPATCHER-SAME-TASK-REPAIR-01
  -> CKPT-A-LOCAL-START-01
  -> null
```

This pack itself still authorizes only `DISPATCHER-SAME-TASK-REPAIR-01`. The appended `CKPT-A-LOCAL-START-01` is separately authorized by `docs/agent/tasks/CKPT-A-LOCAL-START-REPAIR-PACK.md`; its presence here records canonical queue topology and does not broaden this governance task.

This pack is preloaded while `FIRST-INTERVIEW-START-01` is active. `DISPATCHER-SAME-TASK-REPAIR-01` remains `DEFERRED` until its predecessor is Architect-accepted, merged, refreshed-main CI verified, and mechanically marked `DONE`.

## Product outcome

A task remains mechanically live until it is truly complete. An open implementation PR does not become a dead-end wait state merely because the dispatcher has bound it to `REVIEW`.

For the same canonical Task and same canonical PR:

1. required PR CI pending/missing is a wait condition;
2. required PR CI failure without a current-head Architect verdict is actionable same-task repair;
3. `ARCHITECT_VERDICT_V1: REQUEST_CHANGES` is actionable same-task repair;
4. repair always returns to the same Task and same PR unless the Architect explicitly authorizes otherwise;
5. repair launch is durable and idempotent for the same head + failing-check signature;
6. only required exact-head PR CI success plus a valid current-head Architect PASS permits merge;
7. `next_task` is consulted only after the current task is merged, refreshed-main CI verified, and marked `DONE`.

## Architecture mapping

This pack affects development governance / dispatcher state-machine behavior only.

- Dispatcher transition contract: `AFFECTED`.
- Dispatcher reconciliation dry-run/fixtures: `AFFECTED`.
- Dispatcher operational README: `AFFECTED`.
- Same-task luna-high repair launch semantics: `AFFECTED` only as governance text/instructions.
- Application/runtime code: `UNCHANGED`.
- P1-P6/T0-T27 semantics: `UNCHANGED`.
- Product consent/interview/audio/ASR/Director/memory/evidence behavior: `UNCHANGED`.

## Hard boundaries

This pack must not:

- change application source code or product behavior;
- create a second implementation PR for the same task as the normal repair path;
- make Dispatcher an Architect or allow it to self-approve;
- allow merge while required exact-head PR CI is pending, missing, or failed;
- treat `next_task` as a repair mechanism;
- launch duplicate repair workers for the same canonical task, PR, exact head and failing-check signature;
- add a database, service, scheduler role, reviewer role, CAS/revision subsystem, or general-purpose workflow engine;
- weaken exact-head verdict, merge, refreshed-main CI, or three-file stage-end synchronization safeguards;
- act on unrelated historical PRs.

## Governance invariant

`REVIEW` means "this exact PR/head is awaiting or undergoing external review", not "implementation can no longer be re-entered".

Any durable fact that makes more implementation work mechanically necessary must route the same canonical task back to `IN_PROGRESS` and, when not already launched for that exact repair event, start one bounded luna-high repair worker on the same PR.

## Baseline

Planning baseline: `main@217d106ddd0a9791bed4d551505cc5d64ae34066`.

No new Accepted Product/Runtime Contract is introduced. This is a governance repair only.
