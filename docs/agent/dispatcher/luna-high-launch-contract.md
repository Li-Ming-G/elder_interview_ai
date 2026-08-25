# Luna High native launch contract

## Required launch

Dispatcher uses the Codex Desktop native visible-task creation interface with exactly:

```text
model = gpt-5.6-luna
thinking = high
```

The created task receives the bounded Task Card verbatim and must remain sidebar-visible. The single Dispatcher starts the first eligible sequential queue item. Do not build a custom agent framework or silently substitute another model/effort.

If Desktop rejects the launch or the worker cannot confirm the requested profile, set `BLOCKED / WORKER_FAILED`.

## Native capability evidence

- Desktop package: `OpenAI.Codex_26.818.3698.0_x64__2p2nqsd0c76g0`.
- Synthetic visible task: `01a0271d-203a-7732-9e6d-425fddba21aa`.
- Desktop accepted `model=gpt-5.6-luna, thinking=high`.
- The task was projectless and used no repository, file, command or network access.
- It returned `worker_profile=luna-high`, `work_result=synthetic_noop`, `tests=NOT_APPLICABLE`, `pr_url=SYNTHETIC`, `next_state=REVIEW`, `review_gate_action=STOP`, then was archived.

This proves only native launch/profile acceptance and REVIEW-stop behavior. `SYNTHETIC` is never a real PR, the no-op is never implementation evidence, and this record is never external `PASS`.

## Completion hand-back

The worker runs the tests named by its Task Card, reports a PR number and prepares the factual exact-head `ARCHITECT_REVIEW_CONTEXT_V1` required by the Task Card. Dispatcher stores the PR number, sets `REVIEW` and stops. The context is not a verdict and cannot authorize repair or merge. The Dispatcher does not validate the PR, reviewer, review URL, exact head or CI evidence; the external ChatGPT Architect owns the actual PR review and is the sole verdict producer.

For an ordinary Implementation Task, do not add iteration-coach or another internal Reviewer by default. Upgrade only when the Product Owner or Architect explicitly requests it.

## Local CLI fact

`codex.exe` resolves inside WindowsApps, but `codex --version` fails to start with Windows `Access denied` in this environment. Dispatcher therefore uses the verified Desktop native interface; it does not upgrade Codex or weaken the launch contract.
