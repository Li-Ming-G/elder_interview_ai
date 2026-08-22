# Dispatcher state transition contract

## Closed status set

`READY`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`, `DEFERRED`, `DONE`.

No alias (`TODO`, `VERIFY`, `CANCELLED`, composite status text) is valid machine state.

## Closed transitions

| From | Event | To | Required effect |
| --- | --- | --- | --- |
| `READY` | `CLAIM` | `IN_PROGRESS` | Compare-and-swap `state_revision`; create one dispatch plan; record unique run and native worker thread |
| `IN_PROGRESS` | `WORKER_COMPLETE` | `REVIEW` | All declared test evidence present and real HTTPS PR present; set `review_outcome=PENDING`; stop |
| `IN_PROGRESS` | `BLOCKED` or `PRODUCT_AMBIGUITY` | `BLOCKED` | Record stable code and stop |
| `REVIEW` | external `PASS` | `DONE` | Bind external outcome; atomically unlock only predefined `next_task`, if any |
| `REVIEW` | external `REQUEST_CHANGES` | `IN_PROGRESS` | Same `task_id`, Task Card, worker profile and scope; new run/thread is allowed, new task is not |
| `REVIEW` | external `BLOCKED` or `PRODUCT_AMBIGUITY` | `BLOCKED` | Record decision requirement and stop |
| `BLOCKED` | external `RESOLVED` | `READY` | Only with a new accepted decision/contract/card identity and revision increment |
| `DEFERRED` | external `RELEASE` | `READY` | Only when the named owner-return gate is satisfied |

`DONE` has no outgoing transition. Unlocking `next_task` updates that other predefined task; it does not mutate the completed task back to another status.

## Stop rules

- Dispatcher always stops at `REVIEW`, `BLOCKED`, `DEFERRED` and `DONE`.
- Zero or multiple eligible `READY` tasks is a stop, not a planning request.
- Any authority conflict, missing exact Accepted Contract identity or product/architecture ambiguity becomes `BLOCKED`.
- Synthetic launch evidence may exercise the path but cannot satisfy real tests, PR or review.

## Stable error codes

| Code | Meaning |
| --- | --- |
| `DISPATCH_NO_READY_TASK` | No task is eligible for claim |
| `DISPATCH_MULTIPLE_READY_TASKS` | More than one task would be selected |
| `DISPATCH_DEPENDENCY_NOT_DONE` | A declared dependency is not accepted DONE |
| `DISPATCH_TASK_CARD_MISSING` | Task Card path is missing |
| `DISPATCH_TASK_CARD_INVALID` | Fixed template or exact identity is incomplete |
| `DISPATCH_WORKER_PROFILE_UNKNOWN` | Profile is not registered |
| `DISPATCH_WORKER_LAUNCH_REJECTED` | Native Desktop rejected the launch contract |
| `DISPATCH_WORKER_PROFILE_UNVERIFIED` | Requested model/effort cannot be verified |
| `DISPATCH_STALE_STATE_REVISION` | Compare-and-swap revision lost |
| `DISPATCH_ALREADY_CLAIMED` | A second claim or plan was attempted |
| `DISPATCH_TEST_EVIDENCE_MISSING` | Worker completion lacks a declared test result |
| `DISPATCH_PR_MISSING` | Worker completion lacks a real HTTPS PR |
| `DISPATCH_REVIEW_GATE_STOP` | Status is REVIEW; external outcome required |
| `DISPATCH_REVIEW_OUTCOME_INVALID` | Outcome is not an allowed external value |
| `DISPATCH_NEXT_TASK_UNDEFINED` | PASS attempted to unlock a non-predefined task |
| `DISPATCH_TRANSITION_INVALID` | Transition is not in the closed table |
| `DISPATCH_AUTHORITY_CONFLICT` | Task Card/Accepted Contract/CURRENT/stable spec conflict |
| `DISPATCH_PRODUCT_AMBIGUITY` | Product meaning requires external decision |
| `GOVERNANCE_HANDOFF_RECONCILIATION_REQUIRED` | Candidate work exists without an accepted integrable reconciliation pack |

All transition writes increment `state_revision` exactly once and must preserve `task_id` unless atomically unlocking the predefined next task.
