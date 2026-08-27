# Local DB Port Maintenance Development Pack

Status: `ACTIVE`

## Owner authorization

The Product Owner authorizes one bounded local-infrastructure maintenance task to permanently remove the repository's normal local-development dependency on host PostgreSQL ports `5432` and `5433`, which can conflict with Windows/Docker/WSL/Hyper-V reserved or occupied port ranges.

Predefined sequence:

```text
LOCAL-DB-PORT-01 -> null
```

This is a one-task maintenance pack. The only task is eligible to be `READY` immediately. No successor may be inferred or created after it completes.

## Product outcome

A fresh local checkout uses repository-standard host database ports that do not depend on the common PostgreSQL defaults:

1. local development PostgreSQL is published on `127.0.0.1:15432`;
2. isolated test PostgreSQL is published on `127.0.0.1:15433`;
3. both containers continue to listen on PostgreSQL port `5432` internally;
4. tracked example connection strings match those host ports;
5. local engineering documentation makes the convention explicit;
6. normal startup no longer requires process-scoped Compose overrides, ad-hoc port remapping, or modification of Windows excluded/reserved port ranges.

## Architecture mapping

This pack affects Foundation / local development infrastructure only.

- Docker Compose local database host-port publication: `AFFECTED`.
- Tracked local environment examples: `AFFECTED`.
- Local engineering documentation: `AFFECTED`.
- P1-P6 responsibilities and runtime semantics: `UNCHANGED`.
- T0-T27 semantics: `UNCHANGED`.
- Authentication, interview, audio, ASR, transcript, memory, Director/OpenRouter/Ox and privacy behavior: `UNCHANGED`.
- Staging/production deployment topology and provider/model/data policy: `DEFERRED / OUT OF SCOPE`.

## Task — LOCAL-DB-PORT-01

Standardize tracked local PostgreSQL host ports to `15432` for development and `15433` for tests, while preserving container-internal PostgreSQL port `5432` and all existing database names, credentials, healthchecks, storage semantics and application behavior.

Key constraints:

- `docker-compose.yml` publishes `127.0.0.1:15432:5432` for `postgres`;
- `docker-compose.yml` publishes `127.0.0.1:15433:5432` for `postgres-test`;
- `.env.example` uses host ports `15432` and `15433` in `DATABASE_URL` and `TEST_DATABASE_URL`;
- do not parameterize the host ports with new Compose/environment variables in this task;
- do not remove host publication because API, Prisma migration and integration-test processes run on the host in the current architecture;
- do not modify Windows excluded/reserved port ranges as a project prerequisite;
- do not introduce a normal-path `docker-compose.override.yml` or process-scoped override convention;
- do not use or document `docker compose down -v` as part of normal migration/startup because the development database uses a persistent named volume;
- existing developer `.env.local` files remain untracked and are not committed; documentation may instruct developers to update them once after pulling this change.

## Hard boundaries

This pack must not:

- change PostgreSQL container-internal port `5432`;
- change database names, users, passwords, healthcheck semantics, persistent-volume semantics or test tmpfs semantics;
- change application/runtime code merely to accommodate the host-port move;
- change Prisma schema or migrations;
- alter P1-P6/T0-T27 responsibilities or any Accepted Contract;
- change auth, ASR, AI, memory/evidence, interview, audio or web product behavior;
- introduce Redis, Nginx, Kubernetes, a new database, a new deployment platform, or production infrastructure;
- modify OS-level networking/reserved-port configuration;
- invent a successor after `LOCAL-DB-PORT-01`.

## Governance

The external/web Architect owns this plan, Task Card, exact-head review and verdict. The Dispatcher mechanically launches the single `READY` task, binds the Worker PR, consumes the Architect verdict, merges only after PASS, verifies refreshed main CI, synchronizes the three current-state files, and unlocks nothing because `next_task` is `null`.

Accepted lifecycle:

```text
READY -> Worker -> PR REVIEW -> external Architect verdict -> merge -> main CI -> DONE -> null
```

## Baseline identity

Planning baseline: `main@bf76fce0a64689adaeb1f46fbd01575bc8c3802e`.

No new Accepted Machine/Module Contract is introduced by this pack. Existing stable local engineering, data-access, authentication, interview-runtime and privacy invariants remain authoritative and must not be weakened.
