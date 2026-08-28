# Checkpoint A Local Start Repair Development Pack

Status: `DEFERRED`

## Owner authorization

The Product Owner authorizes one bounded local-start repair task to remove the remaining Owner-side Checkpoint A startup workaround on Windows.

Observed remaining issues after `LOCAL-DB-PORT-01`:

- tracked repository defaults now correctly use PostgreSQL host ports `15432` / `15433`;
- the Owner's existing untracked `.env.local` may still contain legacy `5432` / `5433` values because Git intentionally does not manage that file;
- the current Checkpoint A launcher still has a native-Windows launch failure in the Owner environment;
- the Owner can proceed only by applying a process-level `DATABASE_URL` override, which is explicitly not the intended steady-state local workflow.

This pack extends the already-authorized sequential queue without changing the currently active task or its scope.

Predefined sequence after the current work closes:

```text
FIRST-INTERVIEW-START-01
  -> DISPATCHER-SAME-TASK-REPAIR-01
  -> CKPT-A-LOCAL-START-01
  -> null
```

`CKPT-A-LOCAL-START-01` remains `DEFERRED` until both predecessors are truly `DONE` under the normal Architect PASS -> merge -> refreshed-main CI -> stage-end sync lifecycle.

## Product outcome

The ordinary Owner Checkpoint A path on Windows must work without an ad-hoc process-level PostgreSQL port override.

The stable outcome is:

1. repository-standard local PostgreSQL host ports remain `15432` for development and `15433` for test;
2. an existing ignored `.env.local` can be migrated once, safely and explicitly, from the legacy local DB ports to the repository-standard ports without exposing or rewriting unrelated secrets;
3. subsequent Checkpoint A startup reads the corrected `.env.local` directly;
4. `pnpm checkpoint-a:start` launches successfully on native Windows as well as preserving the existing non-Windows path;
5. the formal local Workbench/API path starts without introducing dynamic DB ports, Compose overrides, OS-level port changes, or process-level DB URL workarounds.

## Architecture mapping

Foundation/local developer experience only.

- ignored local environment migration tooling: `AFFECTED`;
- Checkpoint A local launcher process spawning/cleanup: `AFFECTED`;
- Owner local runbook: `AFFECTED`;
- Docker Compose host publication: `UNCHANGED` (`15432` / `15433` remain authoritative);
- application runtime semantics, P1-P6/T0-T27, auth, interview, consent, audio, ASR, transcript, memory/evidence, Director/OpenRouter/Ox, privacy, evaluation/scoring: `UNCHANGED`;
- production/staging deployment and provider/model/data decisions: `UNCHANGED / OUT OF SCOPE`.

## Hard boundaries

This pack must not:

- commit `.env.local` or any secret;
- print, serialize, log, diff, or echo Tencent/OpenRouter/auth/retention/database secret values;
- change database names, credentials, schema, migrations, healthchecks, volumes, tmpfs, container port `5432`, or Compose host mappings;
- reintroduce host ports `5432` / `5433` as repository defaults;
- add dynamic/free-port selection, a normal-path Compose override, or Windows reserved-port mutation;
- modify application product behavior or any P1-P6/T0-T27 semantic;
- alter first-interview consent/start semantics from `FIRST-INTERVIEW-START-01`;
- alter Dispatcher repair semantics from `DISPATCHER-SAME-TASK-REPAIR-01`;
- add a second launcher framework or unrelated infrastructure.

## Baseline

Planning baseline: `main@0cc2bf6e97da4c9e751d705da46d4ddb52ba8d7e`.

No new Accepted Product/Runtime Contract is introduced. This is a bounded local-operability repair only.
