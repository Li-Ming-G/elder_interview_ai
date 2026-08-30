# CKPT-A-WEB-CWD-01

Status: `READY`

## Goal

Repair the formal Checkpoint A local launcher so the Vite Workbench starts with `apps/web` as its working directory and `http://127.0.0.1:5173` serves the existing web app instead of repository-root 404 responses.

## Entry / Dependencies

Owner explicitly authorized this ultra-small maintenance task after a local Checkpoint A run on `main@ed5f522dd636f06638ea859de0558f827e15eb8a` proved:

- development and test PostgreSQL are healthy;
- 28 migrations are current;
- API starts and health-checks at HTTP 200;
- Vite starts on port 5173 but all routes return 404 because the launcher does not set the Vite working directory to `apps/web`.

Dependencies:

- `CKPT-A-LEGACY-PREPARE-BRIDGE-01` is `DONE`;
- planning baseline `main@ed5f522dd636f06638ea859de0558f827e15eb8a`.

## Allowed Files

Only:

- `scripts/start-checkpoint-a.mjs`
- `scripts/local-operability.test.mjs`

No other file is authorized unless the Worker stops and reports a concrete blocker.

## Required Behavior

1. The formal `pnpm checkpoint-a:start` launcher must start the Vite child with working directory `<repositoryRoot>/apps/web`.
2. Keep the existing direct Node Vite entrypoint, host `127.0.0.1`, port `5173`, and `--strictPort` behavior unless a change is strictly necessary to satisfy item 1.
3. Keep the API launch behavior and API port `3101` unchanged.
4. Preserve server/browser environment separation and secret filtering exactly as today.
5. Preserve current child-process cleanup behavior on Windows and non-Windows platforms.
6. Do not modify product/UI behavior. This is launcher-path maintenance only.

## Regression Coverage

Update `scripts/local-operability.test.mjs` so deterministic coverage proves the web launch definition includes the `apps/web` working directory and the launcher actually passes that cwd to the web child process.

The test must fail against the pre-fix launcher shape and pass after the repair.

## Required Verification

Run at minimum:

```text
node --test scripts/local-operability.test.mjs
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

If repository-wide lint fails only for already-known unrelated files, report the exact unrelated failure without expanding scope.

When native Windows runtime is available, also run the formal local startup without process-level workarounds and verify:

```text
API http://127.0.0.1:3101 -> HTTP 200
Workbench http://127.0.0.1:5173 -> HTTP 200
```

Then stop the launcher safely. No real/private interview data is needed for this repair verification.

## Non-Goals

Do not change:

- `apps/**`;
- database schema, migrations, Docker ports, or `.env.local`;
- consent/start semantics;
- auth;
- Tencent ASR;
- OpenRouter/Director;
- P1-P6/T0-T27 behavior;
- Dispatcher governance/transition rules;
- production/deployment configuration.

Do not add a process manager, dynamic port selection, fallback web root, or temporary runtime workaround.

## Completion / Handoff

- exactly one implementation PR for this task;
- Worker stops at `REVIEW` and reports PR number + exact head SHA;
- external Architect exact-head review is required before merge;
- Dispatcher performs merge and refreshed-main verification only after valid Architect PASS.

## Next Task

`null`
