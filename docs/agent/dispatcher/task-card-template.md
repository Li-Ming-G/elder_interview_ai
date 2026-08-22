# TASK_ID

Status: `READY|IN_PROGRESS|REVIEW|BLOCKED|DEFERRED|DONE`

## Architecture Mapping (P1-P6/T0-T27)

State every affected T number and P/Foundation layer. Mark all adjacent layers `UNCHANGED`, `DEFERRED` or `OUT OF SCOPE`.

## Goal

One testable outcome.

## Scope

The bounded work package. Task Card controls scope and entry/exit gates only.

## Allowed Files / Areas

Exact paths or narrow globs. Anything else requires a new card or external correction.

## Inputs

Required state, artifacts and predecessor outputs.

## Accepted Contracts — exact identities

For each behavior/invariant authority, list contract name/version, file paths, accepted 40-character commit, PR/review identity and acceptance boundary. Filename-only or candidate identity is invalid. Accepted Contract controls behavior and invariants; this card cannot override it.

## Reference Implementations

Optional, non-authoritative exact commits/paths. State whether read-only and whether integration is forbidden.

## Required Behavior

Observable outcomes derived from the Accepted Contracts. If this section conflicts with an Accepted Contract, stop with `PRODUCT_AMBIGUITY`.

## Explicit Non-Goals

List adjacent work that must not be implemented.

## Tests

Exact commands the worker must run before reporting a PR number. State any intentionally excluded full-suite or real-provider tests.

## Completion Criteria

Mechanical conditions for worker completion, including the reported PR number. Worker completion does not mean review acceptance.

## Review Gate

External Architect PR review and explicit `STOP` at `REVIEW`. The Dispatcher stores only the worker-reported PR number and does not verify the review. Only the external Architect's `PASS` can close the gate. Ordinary tasks do not add iteration-coach or another internal Reviewer unless the Product Owner or Architect explicitly requests it.

## Next Task

Exactly one predefined task ID or `null`. Dispatcher may unlock only this value and only after external `PASS`.
