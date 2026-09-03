# Luna High native launch contract

## Required launch

Dispatcher uses the Codex Desktop native visible-task creation interface with exactly:

```text
model = gpt-5.6-luna
thinking = high
```

The created task receives the canonical runtime authorization, base Task Card
verbatim, every successful `ARCHITECT_DIRECTIVE_V1` ACK overlay for the task,
the current Directive when one is being executed, and PR/head/CI evidence when
relevant. It must remain sidebar-visible. The single Dispatcher starts the first
eligible sequential queue item or executes a valid current-task Directive. Do
not build a custom agent framework or silently substitute another model/effort.

The launch must state the effective allowed files and effective required tests.
A Worker must not reject an added file merely because it is absent from the base
Task Card when a successful Directive ACK authorizes it. Conversely, the Worker
cannot enlarge the union itself. A Task Card header `Status: DEFERRED` is an
issuance snapshot and cannot override canonical runtime `IN_PROGRESS`.

If Desktop rejects the launch or the worker cannot confirm the requested profile, set `BLOCKED / WORKER_FAILED`.

## Same-task repair launch

When the current canonical PR has terminal required exact-head CI failure, a
valid current-head Architect `REQUEST_CHANGES`, or a valid implementation
Directive, Dispatcher returns or recovers the same canonical Task and same PR to
`IN_PROGRESS` and launches one bounded repair with the `luna-high` profile. The
launch includes the complete effective envelope, PR number, current head,
failed check/run evidence when relevant, and the required same-PR instruction.
It never creates a replacement Task and cannot change queue topology.

For a plausible transient PR-CI failure, the worker may perform at most one
bounded no-code rerun and must observe its terminal result. A second failure
requires a scoped repair pushed to the same PR or a concrete `WORKER_FAILED` /
`PRODUCT_AMBIGUITY` hand-back; silently exiting after requesting a rerun is not
valid completion.

Before a PR-CI failure launch, Dispatcher persists a top-level
`DISPATCHER_REPAIR_V1` comment on the canonical PR with `TASK`, `PR`, `HEAD`,
`FAILED_CHECK`, and `ACTION: LAUNCHED`. The tuple of those first four values is
the durable fingerprint, so a matching marker suppresses duplicate launch for
the same failure event only when its author is in the configured
`authorized_dispatcher_logins`; unauthorized lookalikes are inert. A new head
or failed-check identity is a new event. A
new unique valid `ARCHITECT_DIRECTIVE_V1` is a separate execution authorization
and is never suppressed by an old repair fingerprint.

## Directive launch

Directive Workers use deterministic identity
`architect-directive/<TASK>/<DIRECTIVE_ID>`. Before launch, Dispatcher scans
existing Codex tasks for that identity. It persists any authorized runtime
transition first, creates or rediscovers the Worker, and then publishes the ACK
required by `architect-directive-v1.md`. Rediscovery after ACK loss produces
`ACTION: APPLIED`, not a duplicate Worker.

A successful Directive remains in the effective envelope until task `DONE`.
Launching it creates an immediate review/merge fence: previous Review Context
and verdict cannot authorize merge even when the PR head has not changed yet.

## Native capability evidence

- Desktop package: `OpenAI.Codex_26.818.3698.0_x64__2p2nqsd0c76g0`.
- Synthetic visible task: `01a0271d-203a-7732-9e6d-425fddba21aa`.
- Desktop accepted `model=gpt-5.6-luna, thinking=high`.
- The task was projectless and used no repository, file, command or network access.
- It returned `worker_profile=luna-high`, `work_result=synthetic_noop`, `tests=NOT_APPLICABLE`, `pr_url=SYNTHETIC`, `next_state=REVIEW`, `review_gate_action=STOP`, then was archived.

This proves only native launch/profile acceptance and REVIEW-stop behavior. `SYNTHETIC` is never a real PR, the no-op is never implementation evidence, and this record is never external `PASS`.

## Completion hand-back

The worker runs every test in the effective required-test union and reports a PR
number. Dispatcher stores that number, sets `REVIEW` and stops. The external
Architect owns actual PR review and outcome; Dispatcher only validates the
machine-readable exact-head/context/CI facts required by the transition contract.

For an ordinary Implementation Task, do not add iteration-coach or another internal Reviewer by default. Upgrade only when the Product Owner or Architect explicitly requests it.

## Local CLI fact

`codex.exe` resolves inside WindowsApps, but `codex --version` fails to start with Windows `Access denied` in this environment. Dispatcher therefore uses the verified Desktop native interface; it does not upgrade Codex or weaken the launch contract.
