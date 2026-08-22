# Dispatcher contract

This directory is the machine-governed entry for low-cost dispatch. The Dispatcher performs closed transitions only; it does not plan work.

## Files

- [`dispatcher-state.json`](dispatcher-state.json): schema-managed multi-task snapshot and permanent exact-head review history.
- [`dispatcher-state.schema.json`](dispatcher-state.schema.json): closed state shape and status-dependent fields.
- [`transition-contract.md`](transition-contract.md): allowed transitions, stop rules and stable error codes.
- [`worker-profiles/luna-high.json`](worker-profiles/luna-high.json): required native Desktop worker profile.
- [`luna-high-launch-contract.md`](luna-high-launch-contract.md): launch and evidence rules.
- [`task-card-template.md`](task-card-template.md): mandatory Task Card structure.
- [`fixtures/dispatcher-dry-run-v2.json`](fixtures/dispatcher-dry-run-v2.json): synthetic snapshot with the exact same state schema.
- [`dispatcher-dry-run.mjs`](dispatcher-dry-run.mjs): dependency-free deterministic validation.

## Mechanical algorithm

1. Validate the complete multi-task snapshot against the JSON Schema. Every write supplies the expected `state_revision`; stale input is rejected and a successful write increments it exactly once.
2. If status is `REVIEW`, `BLOCKED`, `DEFERRED` or `DONE`, return `STOP`.
3. Select exactly one `READY` task whose dependencies are `DONE`; otherwise return a stable error and stop.
4. Verify the Task Card exists, uses the fixed template, names exact Accepted Contract identities and declares a known worker profile.
5. Claim exactly once from one READY snapshot and launch through the profile contract. A second claim or late completion loses the revision CAS.
6. Before `REVIEW`, bind owner/repository, PR number, exact head and passing test/CI evidence to that head; at `REVIEW`, stop.
7. Apply only complete external review evidence: reviewer identity, review URL/id, outcome and the same reviewed exact head. `PASS` atomically marks the current task `DONE` and unlocks only its predefined `next_task` in one revision; `REQUEST_CHANGES` resumes the same card; ambiguity or conflict blocks it.

The Markdown board is a compact index. `dispatcher-state.json` is the only machine state authority; fixtures do not define an alternative task shape. Fake/example PRs, bare outcomes, stale heads, missing tests and `review_required=false` all fail closed. A Task Card cannot override an Accepted Contract.
