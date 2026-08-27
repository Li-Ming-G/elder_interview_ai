# LOCAL-DB-PORT-01

Status: `READY`

## Architecture Mapping (P1-P6/T0-T27)

- Foundation / local Docker Compose database publication: `AFFECTED`.
- Foundation / tracked local environment examples and engineering documentation: `AFFECTED`.
- P1-P6 responsibilities: `UNCHANGED`.
- T0-T27 semantics: `UNCHANGED`.
- Authentication, web product flow, audio, ASR, transcript, memory/evidence, Director/OpenRouter/Ox and privacy behavior: `UNCHANGED`.
- Staging/production deployment topology, provider/model/data decisions and T26-T27 evaluation/scoring: `DEFERRED / OUT OF SCOPE`.

## Goal

Make the repository's normal local PostgreSQL startup deterministic on host ports `15432` (development) and `15433` (test), with all tracked local connection examples and engineering documentation aligned, while preserving PostgreSQL container-internal port `5432` and all application behavior.

## Scope

Perform one bounded local-infrastructure maintenance change:

1. change only the host-side Docker Compose publication for the development and test PostgreSQL services;
2. synchronize tracked local connection-string examples;
3. document the repository-standard local port convention and migration guidance;
4. audit tracked text/configuration for stale active host references to `127.0.0.1:5432`, `127.0.0.1:5433`, `localhost:5432`, or `localhost:5433` and correct only unambiguously local-database references within the allowed areas;
5. prove the two PostgreSQL services can start, become healthy, accept host connections on the new ports, and support the repository's database-dependent test/migration path.

No business/runtime feature work is authorized.

## Allowed Files / Areas

Primary tracked files:

- `docker-compose.yml`
- `.env.example`
- `02-项目开发规范.md`

Narrow stale-reference cleanup is additionally allowed only when an exact old local host-port literal is found and the edit changes only that literal or its immediately related local-development instruction:

- root `*.md`
- `docs/**/*.md`
- `scripts/**/*.mjs`
- root `*.config.ts`
- root `*.config.mjs`
- root `package.json`
- `apps/*/package.json`

Do not modify application source under `apps/*/src/**`, Prisma schema/migrations, contracts, accepted machine/module contracts, dispatcher governance files, this Task Card, or the Development Pack. Anything else requires external correction or a new Task Card.

## Inputs

- Product Owner authorization in `docs/agent/tasks/LOCAL-DB-PORT-MAINTENANCE-PACK.md`.
- `REAL-RUNTIME-02` is already DONE after external Architect PASS, merge and main verification.
- Planning baseline: `main@bf76fce0a64689adaeb1f46fbd01575bc8c3802e`.
- Current `docker-compose.yml` publishes development PostgreSQL on `127.0.0.1:5432:5432` and test PostgreSQL on `127.0.0.1:5433:5432`.
- Current `.env.example` points `DATABASE_URL` to host port `5432` and `TEST_DATABASE_URL` to host port `5433`.
- Current architecture runs API/Prisma/test processes on the host and therefore still requires host publication of both PostgreSQL services.

## Accepted Contracts — exact identities

No new Accepted Contract is created or modified by this task.

Preserve all existing Accepted Machine/Module Contracts and the stable engineering/data-access invariants present on planning baseline `main@bf76fce0a64689adaeb1f46fbd01575bc8c3802e`.

This task may not reinterpret product behavior, application data semantics, auth, interview flow, ASR, memory/evidence, Director behavior, privacy policy or deployment policy. If completing the port move would require any such change, stop with `PRODUCT_AMBIGUITY`.

## Reference Implementations

Read-only current baselines:

- `docker-compose.yml` on planning baseline `main@bf76fce0a64689adaeb1f46fbd01575bc8c3802e`;
- `.env.example` on the same baseline;
- `02-项目开发规范.md` on the same baseline.

The current service topology is authoritative for this task: Docker Compose provides only the local development/test PostgreSQL infrastructure; application and test processes remain host-side.

## Required Behavior

1. `postgres` publishes exactly `127.0.0.1:15432:5432`.
2. `postgres-test` publishes exactly `127.0.0.1:15433:5432`.
3. PostgreSQL remains on container port `5432` for both services.
4. Existing database names, users, passwords, healthchecks, `postgres-dev-data` persistent volume and `postgres-test` tmpfs behavior remain unchanged.
5. `.env.example` uses:
   - `postgresql://elder_interview_local:local_dev_only@127.0.0.1:15432/elder_interview_local`
   - `postgresql://elder_interview_test:local_test_only@127.0.0.1:15433/elder_interview_test`
6. `02-项目开发规范.md` explicitly records the repository-standard local database host ports:
   - development: `127.0.0.1:15432 -> container:5432`
   - test: `127.0.0.1:15433 -> container:5432`
7. Documentation states that existing untracked `.env.local` files must be updated once after pulling the change; no `.env.local` credential or file is committed.
8. Normal startup instructions do not require process-scoped port overrides, a normal-path Compose override file, or modification of Windows excluded/reserved port ranges.
9. No new `POSTGRES_HOST_PORT`, `TEST_POSTGRES_HOST_PORT`, or equivalent port-parameterization layer is introduced by this task.
10. No active tracked local-development instruction/configuration within the allowed areas continues to direct host processes to development port `5432` or test port `5433`. Historical prose that is clearly evidence rather than an executable/current instruction must not be rewritten merely for cosmetic consistency.
11. The Worker must not run `docker compose down -v`; the named development database volume must not be deleted as part of this migration.
12. After a normal `docker compose down` followed by `docker compose up -d`, both database services reach healthy/running state without temporary port overrides.
13. Host-side connectivity works through `15432` and `15433`, and the repository's database migration/status and database-dependent test paths can use the new connection strings.

## Explicit Non-Goals

- changing Windows networking, excluded port ranges, Hyper-V, WSL or Docker Desktop system configuration;
- dynamically selecting a free host port;
- adding new Compose profiles or override files as the normal startup path;
- removing PostgreSQL host publication;
- changing PostgreSQL image/version or container port;
- changing database schema, migrations, seed semantics, test identities or application configuration semantics beyond the two host ports;
- changing any application source code;
- changing production/staging deployment topology;
- changing auth, audio, ASR, transcript, memory, Question Presentation, Director, OpenRouter/Ox or privacy behavior;
- adding Redis, Nginx, Kubernetes or other infrastructure;
- cleaning unrelated documentation or refactoring configuration;
- inventing any successor task.

## Tests

Run at minimum from the repository root.

Static/configuration gates:

```text
docker compose config
pnpm format:check
```

Audit active tracked host-port references:

```text
git grep -n -E '127\.0\.0\.1:(5432|5433)|localhost:(5432|5433)' -- .
```

Classify every hit. Any active local-development/database connection reference in an allowed area must be corrected. Do not rewrite historical evidence solely because it contains an old literal.

Runtime database gates:

```text
docker compose down
docker compose up -d postgres postgres-test
docker compose ps
docker compose exec -T postgres pg_isready -U elder_interview_local -d elder_interview_local
docker compose exec -T postgres-test pg_isready -U elder_interview_test -d elder_interview_test
```

Host-side database/migration gates using the new development connection string:

```text
DATABASE_URL='postgresql://elder_interview_local:local_dev_only@127.0.0.1:15432/elder_interview_local' pnpm db:migrate:status
```

Database-dependent test gates using the new test connection string:

```text
TEST_DATABASE_URL='postgresql://elder_interview_test:local_test_only@127.0.0.1:15433/elder_interview_test' pnpm test:integration --run
TEST_DATABASE_URL='postgresql://elder_interview_test:local_test_only@127.0.0.1:15433/elder_interview_test' pnpm test:auth --run
```

Cold-restart gate:

```text
docker compose down
docker compose up -d postgres postgres-test
docker compose ps
```

The second startup must work without temporary environment variables that alter Compose port publication, without an override file, and without OS-level port changes.

If Docker is genuinely unavailable in the Worker environment, do not fabricate runtime success. Report the exact unavailable gate in the PR and stop `BLOCKED` unless an existing repository-authorized equivalent CI gate proves the same behavior.

Never run:

```text
docker compose down -v
```

Real-provider ASR/LLM tests and full browser E2E are intentionally excluded because this task changes local PostgreSQL host publication only.

## Completion Criteria

- tracked Compose host mappings are `15432:5432` and `15433:5432` on loopback only;
- `.env.example` matches those host ports;
- stable engineering documentation records the convention and one-time `.env.local` migration guidance;
- the stale-reference audit is completed and active allowed-area host references are aligned;
- container-internal port, healthchecks, database identities and storage semantics are unchanged;
- no dynamic host-port parameterization or normal override-file dependency is introduced;
- required static, Docker runtime, migration/status, integration and auth gates pass, or the task is explicitly blocked rather than claiming completion;
- a normal cold restart succeeds without temporary port overrides;
- Worker opens/reuses exactly one PR and reports the PR number and exact head SHA;
- PR description explicitly states that `docker compose down -v` was not used and that no persistent development volume was intentionally removed;
- task stops at `REVIEW` and does not claim Architect PASS, merge or DONE.

## Review Gate

External Architect exact-head PR review. The Worker and Dispatcher stop at `REVIEW`; only an external Architect `PASS` may authorize merge. Ordinary-task review rules apply; do not add an iteration-coach or internal Reviewer unless explicitly requested.

## Next Task

`null`
