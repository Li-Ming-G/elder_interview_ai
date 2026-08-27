# FIRST-INTERVIEW-START-01

Status: `REVIEW`

## Architecture Mapping (P1-P6/T0-T27)

Foundation / Project + Consent + Interview start path: `AFFECTED`.

P1-P6 and T0-T27 semantics: `UNCHANGED`.

Repeat-interview continuation policy: `UNCHANGED`.

ASR, audio capture semantics after successful start, Director/OpenRouter/Ox, memory/evidence, privacy, evaluation/scoring, provider/model/data/deployment decisions: `UNCHANGED`.

## Goal

Fix the first real interview start path so a newly created project's first session can become startable after a current valid formal `recording_transcription_ai` consent is recorded, without treating that first-session consent as authorization for later repeat sessions.

Accepted product rule:

- first session (`sequence_no === 1`): current valid formal consent authorizes the current interview start;
- later sessions (`sequence_no > 1`): existing `ConsentContinuationPolicyReader` semantics remain authoritative and unchanged.

## Scope

Repair only the Foundation start/readiness gate that conflates current first-interview consent validity with future consent-continuation coverage.

Required implementation shape:

1. `refreshReady()` may promote a newly created project from `draft` to `ready` for the first session when the project's current formal consent is valid and not revoked.
2. `startSession()` uses the same current-formal-consent authority for `sequence_no === 1` rather than requiring `consentContinuation.status === covered`.
3. `sequence_no > 1` continues to use existing repeat-interview / consent-continuation authority.
4. Readiness and first-session start share one small consistent consent-validity implementation.
5. Do not redesign the broader consent subsystem.

## Allowed Files / Areas

Primary production file:

- `apps/api/src/project-foundation/project-foundation.service.ts`

Optional narrow helper:

- `apps/api/src/project-foundation/first-interview-consent.policy.ts`
- `apps/api/src/project-foundation/first-interview-consent.policy.spec.ts`

Focused tests:

- directly relevant `apps/api/src/project-foundation/*.spec.ts`;
- one narrowly scoped PostgreSQL integration test under `tests/integration/` proving the real first-interview lifecycle.

Do not modify web/UI code unless the external Architect explicitly returns a same-PR finding requiring a narrow error mapping.

## Inputs

Planning baseline: `main@7475b5144c816f9e383551bb5948c7a7f71d79cd`.

Canonical implementation PR: `#116`.

Observed failing real-flow symptom:

`create project -> create first session -> device check -> record/register formal mvp-v1 consent -> start interview`

failed before formal recording began because production continuation policy was unavailable and the first-session path incorrectly depended on continuation coverage.

## Accepted Contracts — exact identities

No new Accepted Machine/Module Contract is introduced.

Preserve:

- Owner Checkpoint A through PR #111, implementation head `24f741ba0cf0652db677f355d7e081cb4a41e366`;
- Real-Flow Cleanup through PR #113, Architect-reviewed head `c57d1172e65d7944137dd83be330e49eb68ceaf5`;
- repository behavior baseline `main@7475b5144c816f9e383551bb5948c7a7f71d79cd`.

Existing `ConsentContinuationPolicyReader` production behavior remains intentionally unavailable until a future Owner-authorized continuation-policy decision. This task must not convert that policy to `covered` and must not define `mvp-v1` as cross-session continuing consent.

Existing `interview-start-policy.ts` start-gate semantics remain authoritative; repair the source of first-session consent authority rather than redesigning that policy. Any unavoidable contradiction is `PRODUCT_AMBIGUITY`.

## Required Behavior

### First session

For `sequence_no === 1`, starting is allowed only when existing non-consent gates remain satisfied and there is a current formal consent that is:

- `consent_type === recording_transcription_ai`;
- `status === valid`;
- `revoked_at === null`;
- bound to the same project;
- otherwise valid under existing Foundation invariants.

A valid current first-interview consent is sufficient for `draft -> ready` and the first-session start gate. The first-session path must not require `ConsentContinuationPolicyReader` to return `covered`.

### Later sessions

For `sequence_no > 1`, preserve current repeat-interview behavior:

- `ConsentContinuationPolicyReader` remains authoritative;
- `unavailable` remains blocking;
- reauthorization semantics remain unchanged;
- no implicit cross-session consent broadening.

### Stable identity

Use existing `sequence_no`; add no database flag or workflow type.

### Shared authority

`refreshReady()` and first-session `startSession()` must derive validity from one consistent implementation/policy source.

## Explicit Non-Goals

Do NOT:

- implement deletion/abandonment of half-created interviews;
- change browser IndexedDB new-interview recovery;
- fix the separate stale `device_check` workflow snapshot issue;
- implement/redesign continuing-consent policy;
- modify `consent-continuation.policy.ts` to return `covered` in production;
- treat `mvp-v1` as future-session authorization;
- change `RepeatInterviewDecisionService` semantics;
- change Prisma schema/migrations;
- change P1-P6/T0-T27, OpenRouter/Ox, Tencent ASR, Director, memory/evidence, audio-finalization, scoring/evaluation, provider/model/data/deployment semantics;
- invent any successor beyond the Architect-predefined `DISPATCHER-SAME-TASK-REPAIR-01`.

## Tests

Automated coverage must prove at least:

A. real first-interview happy path under production/default continuation binding;
B. no consent remains blocked;
C. revoked/invalid consent remains blocked;
D. later session with production/default continuation `unavailable` remains blocked;
E. no `mvp-v1` cross-session shortcut.

Required validation:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `git diff --check`
- PostgreSQL integration tests when local `TEST_DATABASE_URL` is available.

Exact-head repository CI must pass required PostgreSQL integration and all required PR checks before Architect PASS.

## Completion Criteria

- root cause repaired without changing repeat-interview continuation semantics;
- A-E regression coverage passes;
- no schema/migration or unrelated UI/product cleanup;
- exactly one implementation PR remains canonical;
- current PR is #116;
- external Architect exact-head PASS is required before merge.

## Review Gate

External Architect exact-head PR review is required. Worker and Dispatcher cannot self-declare PASS.

A current-head `REQUEST_CHANGES` returns the same Task and same PR to implementation. Dispatcher may merge only after valid current-head `PASS`, required exact-head PR CI success, exact-head recheck, then refreshed-main CI verification and normal stage-end synchronization.

## Next Task

`DISPATCHER-SAME-TASK-REPAIR-01`

This successor is Architect/Owner-predefined and remains `DEFERRED` until this task is truly `DONE`. It exists only to harden Dispatcher same-task repair behavior exposed by this incident; the implementation worker must not create or replace successors.