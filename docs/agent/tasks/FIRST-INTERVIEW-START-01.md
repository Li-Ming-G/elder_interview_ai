# FIRST-INTERVIEW-START-01

Status: `READY`

## Architecture Mapping (P1-P6/T0-T27)

Foundation / Project + Consent + Interview start path: `AFFECTED`.

P1-P6 and T0-T27 semantics: `UNCHANGED`.

Repeat-interview continuation policy: `UNCHANGED`.

ASR, audio capture semantics after successful start, Director/OpenRouter/Ox, memory/evidence, privacy, evaluation/scoring, provider/model/data/deployment decisions: `UNCHANGED`.

## Goal

Fix the first real interview start path so a newly created project's first session can become startable after a current valid formal `recording_transcription_ai` consent is recorded, without treating that first-session consent as authorization for later repeat sessions.

The accepted product rule is:

- first session (`sequence_no === 1`): current valid formal consent authorizes the current interview start;
- later sessions (`sequence_no > 1`): existing `ConsentContinuationPolicyReader` semantics remain authoritative and unchanged.

## Scope

Repair only the Foundation start/readiness gate that currently conflates current first-interview consent validity with future consent-continuation coverage.

Required implementation shape:

1. `refreshReady()` must be able to promote a newly created project from `draft` to `ready` for the first session when the project's current formal consent is valid and not revoked.
2. `startSession()` must use the same current-formal-consent authority for session `sequence_no === 1` rather than requiring `consentContinuation.status === covered`.
3. Session `sequence_no > 1` must continue to use the existing repeat-interview / consent-continuation authority.
4. Prefer one small shared helper/pure policy for current first-interview consent validity so readiness and start cannot drift into two different definitions.
5. Do not redesign the broader consent subsystem.

## Allowed Files / Areas

Primary production file:

- `apps/api/src/project-foundation/project-foundation.service.ts`

Optional narrow helper, only if needed to avoid duplicate first-session consent logic:

- `apps/api/src/project-foundation/first-interview-consent.policy.ts`
- `apps/api/src/project-foundation/first-interview-consent.policy.spec.ts`

Focused tests only:

- `apps/api/src/project-foundation/*.spec.ts` where directly relevant to this repair;
- one narrowly scoped PostgreSQL integration test under `tests/integration/` proving the real first-interview lifecycle.

Do not modify web/UI code in this task unless the external Architect explicitly returns a same-PR finding requiring a narrow error mapping. The current task is the backend authority bug, not a general error-message redesign.

Anything outside these areas requires external Architect correction before editing.

## Inputs

Planning baseline:

`main@7475b5144c816f9e383551bb5948c7a7f71d79cd`

Observed failing real-flow symptom:

`create project -> create first session -> device check -> record/register formal mvp-v1 consent -> start interview`

currently fails before formal recording begins because the production default continuation policy is unavailable and the first-session path incorrectly depends on continuation coverage.

## Accepted Contracts — exact identities

No new Accepted Machine/Module Contract is introduced by this maintenance task.

Preserve these accepted product/runtime boundaries:

- Owner Checkpoint A accepted through PR #111, implementation head `24f741ba0cf0652db677f355d7e081cb4a41e366`;
- Real-Flow Cleanup accepted through PR #113, Architect-reviewed head `c57d1172e65d7944137dd83be330e49eb68ceaf5`;
- current repository behavior baseline `main@7475b5144c816f9e383551bb5948c7a7f71d79cd`.

Existing `ConsentContinuationPolicyReader` production behavior remains intentionally unavailable until a future owner-authorized continuation-policy decision. This task must not convert that policy to `covered` and must not define `mvp-v1` as cross-session continuing consent.

Existing `interview-start-policy.ts` start-gate semantics remain authoritative; repair the source of `allRequiredConsentsValid` / first-session authority rather than redesigning that policy unless a mechanically unavoidable contradiction is found. Any such contradiction is `PRODUCT_AMBIGUITY`.

## Required Behavior

### First session

For the canonical first session (`sequence_no === 1`), starting is allowed only when all existing non-consent gates remain satisfied and there is a current formal consent that is:

- `consent_type === recording_transcription_ai`;
- `status === valid`;
- `revoked_at === null`;
- bound to the same project;
- otherwise valid under existing Foundation invariants.

A valid current first-interview consent must be sufficient for `draft -> ready` and for the first session start gate. The first-session path must not require `ConsentContinuationPolicyReader` to return `covered`.

### Later sessions

For `sequence_no > 1`, keep the current repeat-interview behavior unchanged:

- `ConsentContinuationPolicyReader` remains authoritative;
- `unavailable` must remain blocking;
- reauthorization requirements remain unchanged;
- this task must not silently broaden consent scope across sessions.

### Stable identity

Use existing session `sequence_no` as the first-vs-repeat identity. Do not add a new database flag, workflow type, or schema field merely to identify the first interview.

### Shared authority

`refreshReady()` and first-session `startSession()` must derive first-session consent validity from one consistent implementation/policy source. Do not create subtly different validity checks in the two paths.

## Explicit Non-Goals

Do NOT:

- implement deletion/abandonment of half-created interviews;
- change the browser IndexedDB new-interview recovery behavior;
- fix the separate stale `device_check` workflow snapshot issue;
- implement or redesign continuing-consent policy;
- modify `apps/api/src/project-foundation/consent-continuation.policy.ts` to return `covered` in production;
- treat `mvp-v1` as authorization for future sessions;
- change `RepeatInterviewDecisionService` semantics;
- change Prisma schema/migrations;
- change P1-P6/T0-T27 behavior;
- change OpenRouter/Ox, Tencent ASR, Director, memory/evidence, audio-finalization, scoring/evaluation, provider/model/data/deployment semantics;
- create a successor task.

## Tests

The repair is not accepted merely because a mocked frontend start succeeds.

Add automated coverage that proves at least:

A. **Real first-interview happy path**

`create project -> create session(sequence_no=1) -> device check -> create current valid formal mvp-v1 recorded-verbal consent -> project becomes ready -> start session succeeds -> session becomes recording`.

This must exercise production/default consent-continuation binding, not `SyntheticConsentContinuationPolicyReader`.

B. **No consent remains blocked**

First session without a current valid formal consent must not become startable.

C. **Revoked/invalid consent remains blocked**

A revoked or non-valid current consent must not authorize the first session.

D. **Repeat interview remains fail-closed**

For a later session (`sequence_no > 1`), production/default continuation policy `unavailable` must still block automatic start/continuation. The first-session repair must not make repeat interviews implicitly covered.

E. **No cross-session mvp-v1 shortcut**

No test or production code may special-case `mvp-v1` as continuing consent.

Required validation before Worker handoff:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `git diff --check`
- PostgreSQL integration tests when local `TEST_DATABASE_URL` is available.

If local PostgreSQL integration cannot run only because `TEST_DATABASE_URL` is unavailable, report that fact accurately; do not claim it passed. Exact-head CI must pass the repository's required PostgreSQL integration pipeline before Architect PASS.

## Completion Criteria

- Root cause is repaired without changing repeat-interview continuation semantics.
- Mandatory A-E coverage exists and passes in the appropriate unit/integration suites.
- No schema/migration is introduced.
- No unrelated product/UI cleanup is included.
- Worker creates exactly one PR and publishes durable review context.

PR body or top-level PR comment must contain:

```text
<!-- ARCHITECT_REVIEW_CONTEXT_V1 -->
TASK: FIRST-INTERVIEW-START-01
PR: <pr_number>
CURRENT_HEAD: <full_sha>
BASE_MAIN_SHA: <full_sha>
TASK_CARD: docs/agent/tasks/FIRST-INTERVIEW-START-01.md
ALLOWED_SCOPE: first-interview readiness/start consent authority repair only
ACCEPTED_CONTRACTS:
- Checkpoint A through PR #111 / 24f741ba0cf0652db677f355d7e081cb4a41e366
- Real-Flow Cleanup through PR #113 / c57d1172e65d7944137dd83be330e49eb68ceaf5
- planning baseline main@7475b5144c816f9e383551bb5948c7a7f71d79cd
REQUIRED_TESTS:
- mandatory A-E regression coverage
- format/lint/typecheck/unit/build/diff-check
- exact-head CI PostgreSQL integration
NEXT_TASK: null
```

Then return `REVIEW` and STOP.

## Review Gate

External Architect exact-head PR review is required. Worker and Dispatcher must not self-declare PASS.

Dispatcher may merge only after a valid current-head `ARCHITECT_VERDICT_V1: PASS`, then must verify refreshed-main CI and perform the normal three-file state synchronization.

## Next Task

`null`
