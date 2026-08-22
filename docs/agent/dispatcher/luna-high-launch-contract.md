# Luna High native launch contract

## Required launch

Dispatcher uses the Codex Desktop native visible-task creation interface with exactly:

```text
model = gpt-5.6-luna
thinking = high
```

The created task receives the bounded Task Card verbatim and must remain sidebar-visible. Dispatcher records the returned `worker_thread_id` and its own unique `dispatch_run_id` in the same claimed state revision. Do not build a custom agent framework or silently substitute another model/effort.

If Desktop rejects either argument, set `BLOCKED / DISPATCH_WORKER_LAUNCH_REJECTED`. If the returned task cannot expose or confirm the requested profile, set `BLOCKED / DISPATCH_WORKER_PROFILE_UNVERIFIED`.

## Native capability evidence

- Desktop package: `OpenAI.Codex_26.818.3698.0_x64__2p2nqsd0c76g0`.
- Synthetic visible task: `01a0271d-203a-7732-9e6d-425fddba21aa`.
- Desktop accepted `model=gpt-5.6-luna, thinking=high`.
- The task was projectless and used no repository, file, command or network access.
- It returned `worker_profile=luna-high`, `work_result=synthetic_noop`, `tests=NOT_APPLICABLE`, `pr_url=SYNTHETIC`, `next_state=REVIEW`, `review_gate_action=STOP`, then was archived.

This proves only native launch/profile acceptance and REVIEW-stop behavior. `SYNTHETIC` is never a real PR, the no-op is never implementation evidence, and this record is never external `PASS`.

## Local CLI fact

`codex.exe` resolves inside WindowsApps, but `codex --version` fails to start with Windows `Access denied` in this environment. Dispatcher therefore uses the verified Desktop native interface; it does not upgrade Codex or weaken the launch contract.
