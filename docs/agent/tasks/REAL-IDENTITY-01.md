# REAL-IDENTITY-01

Status: `READY`

## Architecture Mapping (P1-P6/T0-T27)

- Foundation / owner-facing local operations: `AFFECTED`.
- Authentication storage/session semantics: `UNCHANGED`.
- P1-P6: `UNCHANGED`.
- T0-T27 runtime semantics: `UNCHANGED`.
- T26-T27 evaluation/scoring: `DEFERRED`.

## Goal

Remove the Owner Checkpoint/local normal-login dependency on the repository synthetic `.test` account by making the existing persisted operator-managed user path the documented normal Owner path.

## Scope

Use the already-existing user-management CLI and the smallest supporting script/runbook change needed so an ordinary persisted application user can be provisioned locally and used through the existing login page.

## Allowed Files / Areas

- `docs/agent/tasks/CPA-05-runbook.md`
- `package.json`
- `apps/api/package.json`
- `apps/api/src/cli/user-cli.ts`
- `apps/api/src/cli/user-cli*.spec.ts`
- narrowly necessary user-management CLI documentation/tests only

Anything outside this list requires external correction or a new Task Card.

## Inputs

- Product Owner authorization in `docs/agent/tasks/REAL-FLOW-CLEANUP-DEVELOPMENT-PACK.md`.
- Existing operator CLI in `apps/api/src/cli/user-cli.ts`.
- Existing API package commands: `user:create`, `user:set-password`, `user:disable`, `user:enable`.
- Existing Checkpoint A runbook.
- Planning baseline `main@055bb9b9a91ff9ae696495f9688da7d8d02d3552`.

## Accepted Contracts — exact identities

No new Accepted Contract is created or modified by this task.

Preserve all accepted/stable auth, privacy and Checkpoint A invariants present on `main@055bb9b9a91ff9ae696495f9688da7d8d02d3552`. In particular, do not weaken the existing CLI invariant in `apps/api/src/cli/user-cli.ts` that secret input is interactive/hidden and rejected as a command argument.

If implementation would require changing auth/session semantics rather than only operator provisioning/runbook ergonomics, stop with `PRODUCT_AMBIGUITY`.

## Reference Implementations

Read-only baseline:

- `apps/api/src/cli/user-cli.ts@f76b4e62c478fbec81639f34c90fc3d86deb2c39`
- `apps/api/package.json@8692df2481c22416e91a53fdbfbf52db030597df`
- `docs/agent/tasks/CPA-05-runbook.md@137a365d8bd2a23e7becf260a7429dbbebde9f13`

## Required Behavior

1. The Owner Checkpoint runbook no longer instructs the Owner to log in with an existing local synthetic account.
2. It instead documents the existing operator-managed path for creating an ordinary persisted local application user with Owner-chosen display name/email and interactive hidden secret entry.
3. The documented command must not accept the secret as a CLI argument or expose it in shell history/log output.
4. The account created by that path uses the existing persisted `User` model and existing login endpoint; no alternate auth path is introduced.
5. Synthetic identities and `seed-test-users.ts` remain available for automated tests only.
6. If a small wrapper/package script is added, it must only make the existing safe CLI easier to invoke; it must not change auth semantics.
7. No actual Owner account data or private credential is committed or included in PR evidence.

## Explicit Non-Goals

- public self-signup;
- email verification;
- OAuth/social login;
- password reset product flow;
- new auth provider/session model;
- deleting test identities or test seed tooling;
- production account provisioning/deployment policy;
- any P1-P6, Director, ASR, memory/evidence or evaluation change.

## Tests

Run at minimum:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:auth --run
pnpm test:unit --run
```

Also add/run a narrow test for any changed CLI wrapper/guard behavior. No real Owner secret may be used in automated tests; use synthetic test values only.

## Completion Criteria

- required behavior is implemented within allowed scope;
- tests above pass;
- no real secret/private account data appears in diff, logs or PR body;
- Worker opens/reuses one PR and reports its PR number;
- task stops at `REVIEW` and does not claim PASS/DONE.

## Review Gate

External Architect exact-head PR review. The Worker and Dispatcher stop at `REVIEW`; only external Architect `PASS` can authorize merge.

## Next Task

`REAL-RUNTIME-02`
