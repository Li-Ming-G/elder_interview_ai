# FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01

Status: `READY`

## Architecture Mapping (P1-P6/T0-T27)

Project-foundation first-session start compatibility: `AFFECTED`.

P1-P6 and T0-T27 semantics: `UNCHANGED`.

Repeat-interview continuation policy, auth/session identity, ASR, transcript, Director/OpenRouter/Ox, memory/evidence, evaluation/scoring, privacy, provider/model/data/deployment semantics: `UNCHANGED`.

## Goal

Make a restored pre-fix first-interview workflow startable when its durable server state is semantically valid but stranded as `project=draft + sequence_no=1 session=device_check + current valid formal consent`.

The repair must self-heal the stale first-session project state at start time without requiring database deletion, duplicate project creation, or re-recording consent.

## Inputs

- Owner-authorized pack: `docs/agent/tasks/FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-PACK.md`
- accepted FIRST-INTERVIEW-START-01 behavior through PR #116
- current `apps/api/src/project-foundation/project-foundation.service.ts`
- current `tests/integration/first-interview-start.test.ts`
- predecessor: `CKPT-A-LOCAL-START-01` is already `DONE`
- planning baseline: `main@0128e7d8f1b2c8c2f6a0cc6bf6c577cadb2a5b9e`

## Scope

Primary allowed files:

- `apps/api/src/project-foundation/project-foundation.service.ts`
- `apps/api/src/project-foundation/first-interview-consent.policy.ts` only if a tiny reusable predicate is directly needed
- `tests/integration/first-interview-start.test.ts`

Optional only if directly required by the same narrow regression:

- one existing project-foundation unit/spec file

Planning/state files may be touched only for normal task handoff and stage-end synchronization:

- `AI-DEVELOPMENT-CURRENT.md`
- `docs/agent/00-task-board.md`
- `docs/agent/dispatcher/dispatcher-state.json`

Do not modify frontend/workbench UX, schema/migrations, `.github/workflows/**`, repeat-interview continuation policy, or unrelated runtime code.

## Required Behavior

### A. Recover only a valid first-session stale draft

For `sequence_no === 1`, a project currently `draft` may be repaired to `ready` during formal start only when current durable authority proves all of the following:

- project is ordinary/visible and project state is available;
- interviewer still has the active authorized assignment required by the existing path;
- project is not deleted/restricted/hidden;
- latest current `recording_transcription_ai` consent is valid and non-revoked under the accepted first-interview consent rule;
- session is otherwise eligible under the existing start gate.

The repair must occur inside the existing transactional/locking discipline before the final start gate is evaluated.

### B. Pre-transaction authority must not reject the recoverable legacy state

The current initial authority check before the transaction must be adjusted narrowly so the exact recoverable first-session legacy draft can reach the locked transactional self-heal path.

Do not broadly allow `draft` starts.

### C. Preserve fail-closed behavior

The following must remain blocked:

- first session with no current formal consent;
- first session with revoked/pending/invalid consent;
- any later session that does not satisfy existing continuation-policy authority;
- hidden, restricted, deleted, inaccessible or assignment-invalid projects;
- invalid session transitions;
- stale recording reminder version;
- all other existing start-gate failures.

### D. Preserve normal fresh path

A normal fresh first interview where `appendConsent()` already promoted `draft -> ready` must continue to start exactly as before.

### E. No duplicate durable objects

The repair must not create a second project, second session, or replacement consent merely to escape the stale state. Existing request idempotency semantics remain unchanged.

## Required Tests

Extend `tests/integration/first-interview-start.test.ts` with a regression that intentionally models pre-fix durable state:

1. create a project;
2. create first session and complete device check;
3. create service term while no consent exists so project remains `draft`;
4. create/insert the current valid first-interview formal consent without invoking the new ready-refresh path, leaving project status `draft`;
5. prove project is still `draft` immediately before start;
6. call the real start endpoint;
7. expect `201`, session `recording`, sequence `1`;
8. expect project reaches the normal post-start state (`active` under current semantics);
9. prove no duplicate project/session/consent is created.

Keep/extend negative coverage for invalid first-session consent and repeat-session continuation-policy failure.

Run at minimum:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:integration --run
pnpm build
git diff --check
```

If the full integration command is not locally available, run the narrow integration target plus exact-head CI and report the limitation rather than fabricating success.

## Completion Criteria

- legacy `draft + seq1 device_check + valid current consent` starts without manual DB cleanup;
- fresh first-interview behavior remains green;
- invalid first-session and repeat-session cases remain fail-closed;
- no frontend/product redesign;
- exactly one implementation PR is created/reused;
- Worker publishes `ARCHITECT_REVIEW_CONTEXT_V1` with exact head and stops at REVIEW;
- external Architect exact-head PASS required before merge.

## Explicit Non-Goals

Do NOT:

- add delete/abandon unfinished interview UX;
- clear browser IndexedDB as a workaround;
- wipe the development database;
- change repeat-session consent continuation policy;
- change `mvp-v1` meaning across sessions;
- change P1-P6, ASR, Director, memory/evidence, privacy, provider decisions, schemas or CI workflow.

## Review Gate

External Architect exact-head review.

## Next Task

`DISPATCHER-STALE-DONE-RECONCILIATION-01`
