# Dispatcher contract

This directory is the machine-governed entry for low-cost dispatch. The Dispatcher performs closed transitions only; it does not plan work.

## Files

- [`dispatcher-state.json`](dispatcher-state.json): current task state.
- [`dispatcher-state.schema.json`](dispatcher-state.schema.json): closed state shape and status-dependent fields.
- [`transition-contract.md`](transition-contract.md): allowed transitions, stop rules and stable error codes.
- [`worker-profiles/luna-high.json`](worker-profiles/luna-high.json): required native Desktop worker profile.
- [`luna-high-launch-contract.md`](luna-high-launch-contract.md): launch and evidence rules.
- [`task-card-template.md`](task-card-template.md): mandatory Task Card structure.
- [`fixtures/dispatcher-dry-run-v1.json`](fixtures/dispatcher-dry-run-v1.json): synthetic state path and negative cases.
- [`dispatcher-dry-run.mjs`](dispatcher-dry-run.mjs): dependency-free deterministic validation.

## Mechanical algorithm

1. Validate state against the JSON Schema and compare the expected `state_revision`.
2. If status is `REVIEW`, `BLOCKED`, `DEFERRED` or `DONE`, return `STOP`.
3. Select exactly one `READY` task whose dependencies are `DONE`; otherwise return a stable error and stop.
4. Verify the Task Card exists, uses the fixed template, names exact Accepted Contract identities and declares a known worker profile.
5. Claim exactly once and launch through the profile contract.
6. Require declared test evidence and a real PR before `REVIEW`; at `REVIEW`, stop.
7. Apply only an external review outcome. `PASS` marks the task `DONE` and unlocks only its predefined `next_task`; `REQUEST_CHANGES` resumes the same task; ambiguity or conflict blocks it.

The Markdown board is a compact index. `dispatcher-state.json` is the machine state authority. A Task Card cannot override an Accepted Contract.
