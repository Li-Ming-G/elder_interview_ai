# CKPT-A-LOCAL-START-01

Status: `DEFERRED`

## Architecture Mapping (P1-P6/T0-T27)

Foundation / Owner local Checkpoint A startup: `AFFECTED`.

P1-P6 and T0-T27 semantics: `UNCHANGED`.

First-interview consent/start semantics, repeat-interview policy, auth/session behavior, audio, Tencent ASR, transcript, Director/OpenRouter/Ox, memory/evidence, privacy, evaluation/scoring, provider/model/data/deployment decisions: `UNCHANGED`.

## Goal

Make the formal Owner Checkpoint A local startup deterministic on native Windows without process-level PostgreSQL URL overrides by providing a safe one-time migration for legacy ignored `.env.local` DB ports and repairing the Windows child-process launcher path used by `pnpm checkpoint-a:start`.

## Entry / Dependencies

This Task is pre-authorized but must remain `DEFERRED` until:

1. `FIRST-INTERVIEW-START-01` is `DONE`;
2. `DISPATCHER-SAME-TASK-REPAIR-01` is `DONE`;
3. Dispatcher refreshes `origin/main` and mechanically unlocks this exact predefined successor.

Development Pack:

- `docs/agent/tasks/CKPT-A-LOCAL-START-REPAIR-PACK.md`

Planning baseline:

- `main@0cc2bf6e97da4c9e751d705da46d4ddb52ba8d7e`

## Scope

Perform one bounded local-operability repair:

1. add an explicit, safe one-time migration path for an existing ignored `.env.local` that still uses the known legacy local PostgreSQL ports;
2. repair the native-Windows process launch path for the formal Checkpoint A launcher;
3. preserve secret isolation between API/server and Vite/browser processes;
4. update the Owner runbook so the stable path no longer relies on temporary `DATABASE_URL`/`TEST_DATABASE_URL` process overrides;
5. prove the ordinary local startup uses the repository-standard PostgreSQL host ports and can start the formal API + Workbench path on Windows.

## Allowed Files / Areas

Primary:

- `package.json`
- `scripts/start-checkpoint-a.mjs`
- a narrowly scoped new migration/preflight helper under `scripts/`, such as `scripts/migrate-local-db-ports.mjs`
- narrowly necessary launcher/migration tests under `scripts/` or existing root test areas
- `docs/agent/tasks/CPA-05-runbook.md`

Optional only if directly required by the repair:

- `.env.example` for non-secret guidance consistency only; its `15432` / `15433` values must not regress;
- one small reusable process-launch helper under `scripts/` if needed for cross-platform spawning/cleanup;
- root test configuration only if required to run the new focused tests.

Do not modify:

- `apps/*/src/**` application behavior;
- Prisma schema or migrations;
- Docker Compose port mappings;
- Accepted Contracts;
- first-interview consent/start code;
- Dispatcher governance files except normal stage-end state synchronization performed by Dispatcher;
- any production/staging configuration.

## Required Behavior

### A. Safe `.env.local` migration

Provide an explicit one-time repository command for the Owner to migrate legacy local DB ports in the ignored `.env.local`.

The migration must:

1. operate only on the local file path `.env.local` unless an explicit test-only path is injected by the test harness;
2. recognize the repository's known local development/test PostgreSQL URLs and update only:
   - development host port `5432 -> 15432`;
   - test host port `5433 -> 15433`;
3. preserve all unrelated lines and values, including Tencent ASR, OpenRouter, auth/retention peppers and any other secrets;
4. never print the complete `.env.local`, connection strings with credentials, or secret values;
5. be idempotent when the file already uses `15432` / `15433`;
6. fail closed with a clear key-name-only diagnostic when an existing DB URL is ambiguous, points to a different host/database, or cannot be safely recognized;
7. never commit `.env.local`;
8. not create a second long-lived environment-file convention.

A suitable public command name is expected, for example:

```text
pnpm local:env:migrate-db-ports
```

Exact naming may differ if the Worker finds an existing repository naming convention, but the result must be obvious and documented.

### B. Native Windows Checkpoint A launcher

`pnpm checkpoint-a:start` must work from native Windows PowerShell/cmd using the repository's supported Node/pnpm versions.

The repair must:

1. launch the built API in explicit `--checkpoint-a` mode exactly as today;
2. launch the Vite Workbench on `127.0.0.1:5173` without relying on a Windows-incompatible `.cmd` child invocation shape;
3. preserve API port `3101` and strict Vite port behavior;
4. preserve current server/browser environment separation so secrets remain absent from the Vite child environment;
5. propagate startup failure as a non-zero launcher exit;
6. terminate both child processes when the launcher stops; on Windows, avoid leaving an orphaned API/Vite process tree after Ctrl-C or child failure;
7. preserve the working non-Windows launch path;
8. not use shell string concatenation containing secrets or other unsafe interpolation.

The Worker must diagnose the concrete Windows launch failure before choosing the implementation mechanism. A bounded `cmd.exe`/`ComSpec` launch, direct Node entrypoint, or other standard Node child-process pattern is acceptable if it satisfies the above invariants. Do not add a new process manager.

### C. Stable no-override Owner path

After the one-time `.env.local` migration, the formal path must not require commands such as:

```text
$env:DATABASE_URL=...15432...
pnpm ...
```

or POSIX inline equivalents merely to compensate for stale local DB ports.

The steady-state flow is:

```text
tracked Compose 15432/15433
  -> migrated ignored .env.local 15432/15433
  -> normal migration/status command using that local configuration
  -> pnpm checkpoint-a:start
  -> API 127.0.0.1:3101 + Workbench 127.0.0.1:5173
```

No dynamic port parameterization, Compose override, or Windows reserved-port change is authorized.

## Secret / Safety Requirements

- Never commit `.env.local`.
- Never emit secret values into PR bodies, logs, test snapshots, fixtures, shell history examples, or Architect handoff evidence.
- Tests for `.env.local` migration must use synthetic fake values in temporary files only.
- Do not run `docker compose down -v`.
- Do not delete the persistent development PostgreSQL volume.
- Real interview/private family data is not required for this task.

## Tests

Run at minimum:

### Static

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

### Migration helper

Use temporary synthetic `.env.local` fixtures to prove:

A. legacy dev/test ports migrate to `15432` / `15433`;
B. unrelated fake secret values are byte-preserved;
C. already-migrated input is idempotent;
D. ambiguous/non-local DB URLs fail closed without printing their values;
E. missing file produces a clear non-secret diagnostic;
F. only the two intended DB URL values can change.

### Repository port invariants

Prove tracked configuration still resolves to:

```text
postgres      127.0.0.1:15432 -> container:5432
postgres-test 127.0.0.1:15433 -> container:5432
```

and `.env.example` still uses those ports.

### Windows launcher

On a native Windows environment when available:

1. migrate a local `.env.local` once using the new command;
2. start PostgreSQL normally without port overrides;
3. run existing migrations/status using the migrated local configuration;
4. run `pnpm checkpoint-a:start` with no DB URL process override;
5. verify the API reaches its expected local health/start state on port `3101` and the Workbench responds on `5173`;
6. stop the launcher and confirm neither child remains orphaned.

If the Worker execution environment is not native Windows, it must still add deterministic focused coverage for Windows command construction/spawn behavior and report `WINDOWS_RUNTIME_EVIDENCE_PENDING` rather than fabricating a native-Windows pass. The task may proceed to REVIEW only if all code/static gates pass and the PR explicitly calls out the missing native-Windows runtime evidence; external Architect decides whether that is sufficient or requires Owner-side evidence before PASS.

No live OpenRouter/Tencent network call is required merely to prove child-process launch mechanics, but the launcher must not weaken existing Checkpoint A configuration validation.

## Completion Criteria

- safe one-time ignored `.env.local` migration command exists and is documented;
- the migration updates only the known legacy local DB ports and preserves unrelated secret-bearing configuration;
- stable local configuration uses `15432` / `15433` with no process-level DB override;
- native-Windows launcher defect is repaired with no secret leakage and no orphaned child processes;
- non-Windows path remains working;
- tracked Compose and `.env.example` remain on `15432` / `15433`;
- required focused/static tests pass;
- exactly one implementation PR is created/reused for this Task;
- Worker stops at `REVIEW` and reports PR number + exact head SHA;
- external Architect exact-head PASS is required before merge.

## Explicit Non-Goals

Do NOT:

- change first-interview consent/start semantics;
- redesign Checkpoint A product behavior;
- add automatic production migrations or deployment orchestration;
- change database schema/migrations/credentials/identities;
- change Docker host/container port policy;
- change Windows excluded/reserved port ranges;
- introduce free-port discovery or dynamic port environment variables;
- change auth, ASR, transcript, Director, memory/evidence, evaluation/scoring or privacy semantics;
- add a process manager/service supervisor;
- commit, copy or normalize the Owner's real secret values;
- invent a successor.

## Review Gate

External Architect exact-head PR review.

## Next Task

`null`
