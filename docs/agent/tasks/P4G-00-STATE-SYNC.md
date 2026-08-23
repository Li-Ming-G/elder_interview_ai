# P4G-00-STATE-SYNC

Status: `IN_PROGRESS`

## Architecture Mapping (P1-P6/T0-T27)

| Mapping | State |
| --- | --- |
| T9–T10 / P3 Retrieval | `ACCEPTED / COMPLETE`; final main merge `18c4320f417fbfa90e41924ac7b049ea72b82379` |
| T11–T12 / P4 Context | Governance queue only; implementation `DEFERRED` |
| T5–T8 / P2 | P2-C `COMPLETE`; P2-D `DEFERRED` |
| P1, P5, P6 and T0–T4/T13–T27 | `UNCHANGED / OUT OF SCOPE` |

## Goal

Mechanically synchronize current-state and Dispatcher governance with the accepted P2-C/P3 facts, retire the combined P3/P4 placeholder, and issue the sequential P4C-01 → P4C-02 → P4C-03 → P4C-04 queue without starting P4 implementation.

## Scope

Only current-state/governance files and new P4 Task Cards. Record P2-C complete, P3 complete, P3 final merge main `18c4320f417fbfa90e41924ac7b049ea72b82379`, and retain P2-D plus real provider/model/tokenizer/embedding and P4 numeric-budget decisions as deferred.

## Allowed Files / Areas

- `AI-DEVELOPMENT-CURRENT.md`;
- `docs/agent/00-task-board.md`;
- `docs/agent/dispatcher/dispatcher-state.json`;
- `docs/agent/tasks/P4G-00-STATE-SYNC.md`;
- new `docs/agent/tasks/P4C-01.md` through `docs/agent/tasks/P4C-04.md`.

No business code, Accepted Contracts, architecture decision records, historical archive, or P4 implementation.

## Inputs

- Development Pack baseline: `18c4320f417fbfa90e41924ac7b049ea72b82379` or descendant;
- P2-C completion merge `b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`, with binding merge `279fe3d142bd87fc0ab215994ad8ab5dc6a2ee4a`;
- P3 final merge main `18c4320f417fbfa90e41924ac7b049ea72b82379`;
- existing single-Dispatcher transition contract.

## Accepted Contracts — exact identities

P2-C and P3 identities above are accepted historical inputs for governance synchronization only. This task does not modify or extend any Accepted Contract.

## Required Behavior

- Remove stale P2-C blocked/unaccepted and P3 not-started statements.
- Replace the old combined `MEMORY-T9-T12-P3-P4-001` placeholder with the P4 governance gate and four P4C cards.
- Preserve P2-D and real provider/model/tokenizer/embedding/P4 numeric-budget decisions as deferred.
- Keep P4C-01 as the only predefined successor; Dispatcher may mark it `READY` only after external Architect `PASS` on this task.
- Include `ARCHITECT_REVIEW_CONTEXT_V1` in the PR body or top-level comment.

## Explicit Non-Goals

No P4 runtime, context assembly, budget selection, provider/model/tokenizer/embedding selection, P2-D, code, contract, architecture, or historical-archive changes.

## Tests

JSON parse/schema validation, task-card link/existence checks, stale-state search, and changed-file allowlist verification. No application or real-provider tests.

## Completion Criteria

Allowed files only; accepted facts and deferred decisions are synchronized; P4C chain is present; PR title/body explicitly includes `P4G-00-STATE-SYNC`; worker reports PR number, exact head, changed files and validation results, then stops at `REVIEW`.

## Review Gate

External Architect PR review. Worker must not claim `PASS`, `DONE`, merge, or unlock P4C-01.

## Next Task

`P4C-01`
