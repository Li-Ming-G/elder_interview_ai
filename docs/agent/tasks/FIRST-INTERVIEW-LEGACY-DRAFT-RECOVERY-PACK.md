# FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY Development Pack

Owner authorization: current Checkpoint A retest is blocked by a restored pre-fix unfinished first-interview workflow that still cannot start even though FIRST-INTERVIEW-START-01 and CKPT-A-LOCAL-START-01 are merged.

## Frozen diagnosis

The repository-side merges are present. The remaining blocker is a legacy-state compatibility gap, not a missing merge.

A pre-fix first-interview record may already have:

- project status `draft`;
- first session `sequence_no = 1` in `device_check`;
- a current valid non-revoked `recording_transcription_ai` consent;
- browser workflow restored at the Start step.

`FIRST-INTERVIEW-START-01` fixed the fresh path by making current first-interview consent authoritative and by `refreshReady()` promoting `draft -> ready` when consent/service-term mutations run. It did not require start-time self-healing for a legacy record whose valid consent already existed before the fix and therefore never re-runs `refreshReady()`.

Current `startSession()` still performs project-state authority checks before first-session consent can authorize start. A legacy `draft` therefore remains blocked even though it is semantically equivalent to a fresh first interview that would now be `ready`.

## Product decision

A recoverable legacy first-interview draft must self-heal at formal start without requiring the Owner to delete the database, re-record consent, or create a duplicate project.

This exception is narrowly limited to the first session and only when all current first-interview authorization and safety conditions are satisfied.

## Frozen behavior

For `sequence_no === 1` only:

- ordinary/visible project;
- active interviewer assignment;
- project not deleted/restricted;
- current project status exactly `draft`;
- session status accepted by the existing start gate, normally `device_check`;
- latest current formal `recording_transcription_ai` consent is valid and non-revoked;

then start may atomically repair `project.status: draft -> ready` under the normal project/session transaction locks and continue through the existing start gate. Successful start should then produce the same durable result as the fresh path, including project becoming `active` where current behavior requires it.

All other cases remain fail-closed. In particular:

- no/invalid/revoked/pending current consent: blocked;
- later sessions (`sequence_no > 1`): existing continuation-policy behavior unchanged;
- hidden/restricted/deleted/inaccessible projects: blocked;
- no bypass of recording reminder, session-state, assignment, idempotency, audio, or other start gates.

## Non-goals

Do not implement unfinished-workflow delete/abandon UX in this task.
Do not change repeat-interview continuation policy.
Do not declare `mvp-v1` cross-session continuing consent.
Do not change P1-P6, ASR, Director/OpenRouter/Ox, memory/evidence, privacy, schema/migrations, or CI workflows.
Do not wipe or recreate the Owner database.

## Required proof

Add a real PostgreSQL integration regression that reproduces the pre-fix durable state without calling the new `refreshReady()` after consent exists:

1. create project;
2. create first session and complete device check;
3. establish any required service term while no consent exists, leaving project `draft`;
4. insert/establish a current valid first-interview formal consent in a way that intentionally leaves the project `draft`, representing pre-fix durable state;
5. call the real start endpoint;
6. assert start succeeds and session is `recording`;
7. assert the project is no longer stranded in `draft` and reaches the normal post-start state.

Also prove negative cases remain blocked and repeat-session behavior remains unchanged.

## Review gate

External Architect exact-head review is required before merge.
