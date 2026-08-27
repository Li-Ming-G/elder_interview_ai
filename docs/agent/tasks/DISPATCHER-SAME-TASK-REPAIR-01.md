# DISPATCHER-SAME-TASK-REPAIR-01

Status: `DEFERRED`

## Architecture Mapping (P1-P6/T0-T27)

Development governance / Dispatcher state machine: `AFFECTED`.

Application/runtime code, P1-P6 and T0-T27 semantics: `UNCHANGED`.

Product consent, interview, audio, ASR, transcript, Director/OpenRouter/Ox, memory/evidence, evaluation/scoring, provider/model/data/deployment semantics: `UNCHANGED`.

## Goal

Make unfinished implementation work mechanically re-enter the same Task and same PR instead of stalling in `REVIEW` when required exact-head PR CI has failed or when the external Architect has issued `REQUEST_CHANGES`.

## Scope

Repair the Dispatcher governance contract and dry-run fixtures only.

The accepted state-machine meaning is:

```text
same canonical Task
  -> same canonical PR
  -> PR CI pending: wait
  -> PR CI failed: same-task repair
  -> PR CI success: Architect review gate
  -> Architect REQUEST_CHANGES: same-task repair
  -> Architect PASS + required exact-head PR CI success: merge
  -> refreshed-main CI success: DONE
  -> only then consult predefined next_task
```

A PR existing is not evidence that implementation is complete.

## Allowed Files / Areas

Primary:

- `docs/agent/dispatcher/transition-contract.md`
- `docs/agent/dispatcher/README.md`
- `docs/agent/dispatcher/dispatcher-dry-run.mjs`
- `docs/agent/dispatcher/fixtures/reconciliation-cases.json`

Optional, only for consistency with the accepted repair-loop semantics:

- `docs/agent/dispatcher/luna-high-launch-contract.md`
- `docs/agent/dispatcher/task-card-template.md`
- `AGENTS.md`

Planning/task-state files may be touched only for the normal Task handoff/state synchronization required by governance:

- `AI-DEVELOPMENT-CURRENT.md`
- `docs/agent/00-task-board.md`
- `docs/agent/dispatcher/dispatcher-state.json`

Do not modify application source, tests outside dispatcher governance, Prisma/schema/migrations, CI workflow YAML, or product/runtime contracts.

## Inputs

- predecessor: `FIRST-INTERVIEW-START-01` must be `DONE` before this Task becomes `READY`;
- Development Pack: `docs/agent/tasks/DISPATCHER-SAME-TASK-REPAIR-PACK.md`;
- current dispatcher transition contract and existing main-CI recovery semantics;
- concrete motivating incident: PR #116 entered `REVIEW` while required exact-head CI was failed, so Dispatcher no-opped until an external Architect manually returned it with `REQUEST_CHANGES`.

## Accepted Contracts — exact identities

No new Product/Runtime Accepted Contract is introduced.

Preserve:

- `docs/agent/dispatcher/transition-contract.md` exact-head Architect verdict protocol;
- durable GitHub state authority over stale projection;
- main-verification recovery behavior accepted through PR #114;
- persistent bounded-pulse heartbeat invariant;
- one Dispatcher / one sequential canonical task queue;
- Dispatcher never becomes Architect and never invents a successor.

Planning baseline: `main@217d106ddd0a9791bed4d551505cc5d64ae34066` plus the Owner-authored deferred pack/task preload commits.

## Required Behavior

### 1. Required PR CI is a first-class current-task gate

For the current canonical Task and current canonical PR head, Dispatcher must fresh-read applicable required PR CI before deciding the task has no implementation action remaining.

- pending/missing required PR CI: wait/no-op for the current pulse;
- terminal SUCCESS: the PR may remain/enter `REVIEW` awaiting Architect verdict;
- terminal FAILURE: implementation remains unfinished and the same Task/PR must return to `IN_PROGRESS` for repair unless a repair for the exact same event is already durably in flight/completed.

A failed required PR CI must never be treated as a reason to wait forever for Architect intervention.

### 2. Architect REQUEST_CHANGES remains same-task repair

A valid current-head `ARCHITECT_VERDICT_V1: REQUEST_CHANGES` must return the same canonical Task and same canonical PR to `IN_PROGRESS` and launch a bounded luna-high repair worker.

Do not create a replacement Task or replacement PR unless the external Architect explicitly changes the Task Card.

### 3. PASS cannot bypass failed/pending PR CI

Even with a syntactically valid current-head Architect PASS, merge is fail-closed until the required exact-head PR CI is terminal SUCCESS.

- PASS + PR CI pending/missing: wait;
- PASS + PR CI failure: no merge; route to same-task repair or await already-launched repair for that exact event;
- PASS + PR CI success: existing exact-head merge gate may proceed.

### 4. Durable repair-launch idempotency

Before launching a repair worker for a PR-CI failure, Dispatcher must write durable GitHub evidence on the canonical PR using:

```text
<!-- DISPATCHER_REPAIR_V1 -->
TASK: <task_id>
PR: <pr_number>
HEAD: <full_sha>
FAILED_CHECK: <stable job/check/step identity>
ACTION: LAUNCHED
```

The tuple `(TASK, PR, HEAD, FAILED_CHECK)` is the repair-event fingerprint.

If a valid matching marker already exists, a later pulse must not launch another worker for that same failure event.

A new PR head or a different failing check is a new event and may authorize one new repair launch.

Do not add database/CAS/revision state merely for repair dedupe.

### 5. Repair worker behavior is bounded

The same-task repair launch must include the exact Task Card, PR number, current head, failed check/run evidence and instruction to keep the same PR.

If the failure is plausibly transient, the repair worker may perform at most one bounded no-code rerun of the failed CI and must observe the terminal result before handoff. If the rerun fails again, it must diagnose and either:

- push a scoped repair to the same PR; or
- report a concrete `WORKER_FAILED` / `PRODUCT_AMBIGUITY` condition.

It must not silently exit after merely requesting another rerun.

### 6. next_task is completion-only

`next_task` must never be consulted to decide how to repair unfinished current work.

Only after:

`Architect PASS -> accepted PR merge -> refreshed main -> required main CI SUCCESS -> current Task DONE -> three-file stage-end sync`

may Dispatcher unlock the predefined successor.

## Explicit Non-Goals

Do NOT:

- change application/runtime code;
- fix PR #116's product code in this governance Task;
- create a new AI role or reviewer role;
- let Dispatcher interpret product/architecture meaning;
- let Dispatcher self-PASS or self-review;
- merge on failed/pending PR CI;
- redesign GitHub Actions CI;
- add a generic retry framework;
- add persistent database state, CAS/revision, queue services or scheduler infrastructure;
- remove the existing heartbeat/bounded-pulse behavior;
- weaken main-CI recovery rules from PR #114.

## Tests

Extend deterministic dispatcher dry-run/fixtures to prove at least these cases:

A. `IN_PROGRESS/REVIEW + open PR + required PR CI pending + no verdict` -> wait/no repair launch.

B. `REVIEW + open PR + required PR CI FAILURE + no verdict` -> same Task/same PR `IN_PROGRESS` + exactly one repair launch.

C. Repeat pulse with same `TASK/PR/HEAD/FAILED_CHECK` and existing `DISPATCHER_REPAIR_V1` -> no duplicate repair launch.

D. Same PR receives a new head after repair -> old repair marker does not suppress evaluation of the new head.

E. Current-head `REQUEST_CHANGES` -> same Task/same PR `IN_PROGRESS` repair path.

F. Required PR CI SUCCESS + no current-head verdict -> `REVIEW`, no repair launch.

G. Current-head PASS + required PR CI SUCCESS -> existing merge gate remains eligible.

H. Current-head PASS + required PR CI pending/failure -> no merge.

I. Current Task merged + refreshed-main required CI SUCCESS -> DONE, then and only then predefined `next_task` may unlock.

J. `next_task:null` on unfinished current task does not affect same-task repair behavior.

Required commands before Worker handoff:

- `node docs/agent/dispatcher/dispatcher-dry-run.mjs`
- `pnpm format:check`
- `pnpm lint`
- `git diff --check`

If governance files have an existing narrower validation command, run it too and report it exactly.

## Completion Criteria

- transition contract explicitly encodes same-task PR-CI failure repair;
- exact-head required PR CI is a merge gate;
- durable repair marker/idempotency is defined and covered by deterministic fixtures;
- REQUEST_CHANGES continues to repair the same PR;
- no current task can become inert merely because `next_task` is `null`;
- dry-run cases A-J pass;
- one implementation PR is created;
- Worker publishes `ARCHITECT_REVIEW_CONTEXT_V1` for this Task and stops at REVIEW.

## Review Gate

External Architect exact-head review is required. Dispatcher/Worker cannot self-declare PASS.

## Next Task

`null`
