# TASK_ID

Status: `READY|IN_PROGRESS|REVIEW|BLOCKED|DEFERRED|DONE`

`Status:` records the issuance/planning snapshot only. Runtime authorization is
read from the freshly reconciled canonical queue/state. The header is not edited
for every transition and cannot make a canonical `IN_PROGRESS` task ambiguous.

## Architecture Mapping (P1-P6/T0-T27)

State every affected T number and P/Foundation layer. Mark all adjacent layers `UNCHANGED`, `DEFERRED` or `OUT OF SCOPE`.

## Goal

One testable outcome.

## Scope

The bounded base work package. The Task Card controls task identity, goal, base
scope/files, dependencies, required tests, completion semantics, entry/exit
gates, and predefined queue topology.

## Allowed Files / Areas

Exact paths or narrow globs. An authenticated `ARCHITECT_DIRECTIVE_V1` may add
implementation files for this same task. Anything outside the base list plus all
successful additive Directive ACK snapshots is unauthorized.

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

Exact base commands the worker must run before reporting a PR number. Successful
Directive ACK snapshots may add required tests; the effective required tests are
the stable union. State any intentionally excluded full-suite or real-provider
tests.

## Completion Criteria

Mechanical conditions for worker completion, including the reported PR number. Worker completion does not mean review acceptance.

## Review Gate

External Architect PR review and explicit `STOP` at `REVIEW`. Review uses the
effective execution envelope and a current `ARCHITECT_REVIEW_CONTEXT_V1` listing
all applied Directive IDs. Only an exact-head `PASS` created after that context
can close the gate. A successful later Directive invalidates the earlier context
and verdict. Ordinary tasks do not add iteration-coach or another internal
Reviewer unless the Product Owner or Architect explicitly requests it.

## Next Task

Exactly one predefined task ID or `null`. Dispatcher may unlock only this value and only after external `PASS`.
