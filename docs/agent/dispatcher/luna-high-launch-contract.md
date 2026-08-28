# Luna High native launch contract

## Required launch

Dispatcher uses the Codex Desktop native visible-task creation interface with exactly:

```text
model = gpt-5.6-luna
thinking = high
```

The created task receives the bounded Task Card verbatim and must remain sidebar-visible. The single Dispatcher starts the first eligible sequential queue item. Do not build a custom agent framework or silently substitute another model/effort.

If Desktop rejects the launch or the worker cannot confirm the requested profile, set `BLOCKED / WORKER_FAILED`.

## Same-task repair launch

When the current canonical PR has terminal required exact-head CI failure, or a
valid current-head Architect `REQUEST_CHANGES`, Dispatcher returns the same
canonical Task and same PR to `IN_PROGRESS` and launches one bounded repair with
the `luna-high` profile. The launch includes the Task Card verbatim, PR number,
current head, failed check/run evidence, and an explicit instruction to keep the
same PR. It never creates a replacement Task or PR unless the external
Architect changes the Task Card.

For a plausible transient PR-CI failure, the worker may perform at most one
bounded no-code rerun and must observe its terminal result. A second failure
requires a scoped repair pushed to the same PR or a concrete `WORKER_FAILED` /
`PRODUCT_AMBIGUITY` hand-back; silently exiting after requesting a rerun is not
valid completion.

Before a PR-CI failure launch, Dispatcher persists a top-level
`DISPATCHER_REPAIR_V1` comment on the canonical PR with `TASK`, `PR`, `HEAD`,
`FAILED_CHECK`, and `ACTION: LAUNCHED`. The tuple of those first four values is
the durable fingerprint, so a matching marker suppresses duplicate launch for
the same failure event. A new head or failed-check identity is a new event.

## Native capability evidence

- Desktop package: `OpenAI.Codex_26.818.3698.0_x64__2p2nqsd0c76g0`.
- Synthetic visible task: `01a0271d-203a-7732-9e6d-425fddba21aa`.
- Desktop accepted `model=gpt-5.6-luna, thinking=high`.
- The task was projectless and used no repository, file, command or network access.
- It returned `worker_profile=luna-high`, `work_result=synthetic_noop`, `tests=NOT_APPLICABLE`, `pr_url=SYNTHETIC`, `next_state=REVIEW`, `review_gate_action=STOP`, then was archived.

This proves only native launch/profile acceptance and REVIEW-stop behavior. `SYNTHETIC` is never a real PR, the no-op is never implementation evidence, and this record is never external `PASS`.

## Completion hand-back

The worker runs the tests named by its Task Card and reports a PR number. Dispatcher stores that number, sets `REVIEW` and stops. It does not validate the PR, reviewer, review URL, exact head or CI evidence; the external Architect owns the actual PR review and outcome.

For an ordinary Implementation Task, do not add iteration-coach or another internal Reviewer by default. Upgrade only when the Product Owner or Architect explicitly requests it.

## Local CLI fact

`codex.exe` resolves inside WindowsApps, but `codex --version` fails to start with Windows `Access denied` in this environment. Dispatcher therefore uses the verified Desktop native interface; it does not upgrade Codex or weaken the launch contract.
