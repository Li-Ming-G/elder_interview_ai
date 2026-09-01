# CKPT-A-FIRST-CAPTURE-GATE-01

Status: `READY`
Worker profile: `luna-high`
Owner authorization: explicit, 2026-09-01
Depends on: `CKPT-A-WEB-CWD-01`; observed on `main@1805d63dbe63366a82692d81157dd4642b786216`
Next task: `null`

## Goal

Unblock the Owner's Checkpoint A live retest at the narrow first-session capture authority boundary. A first interview that already passed the formal start gate must be able to confirm or resume its capture using the same current valid first-interview consent authority, without requiring the deferred repeat/continuing-consent policy.

## Proven root cause

`ProjectFoundationService.startSession()` is already sequence-aware: sequence 1 accepts the latest current valid `recording_transcription_ai` consent, while later sessions use the continuation policy.

Immediately afterward, `SessionCaptureService.confirmActive()` calls a generic `assertCurrentGate()` that always requires `decision.consentContinuation.status === 'covered'`. The production/default continuation reader is intentionally unavailable until the future continuation-consent policy is accepted, so the first-session capture confirm returns `FORBIDDEN` even though formal start was valid. The same generic gate is used by interrupted capture recovery, so the already-interrupted first session can be blocked from resuming for the same reason.

## Frozen behavior

For capture lifecycle authority checks only:

- sequence 1: require the latest current valid formal `recording_transcription_ai` consent for the same project;
- sequence > 1: preserve the existing `consentContinuation.status === 'covered'` requirement unchanged;
- preserve active actor, ordinary visibility, active assignment/access, project-state availability, project status and all existing capture-generation/state checks;
- invalid, revoked, missing or wrong-project first-session consent must still fail closed;
- do not activate, synthesize or weaken the deferred continuing-consent policy;
- do not clear or recreate the Owner's existing interview/session/audio state.

The narrowest implementation should make the shared capture authority gate sequence-aware so both fresh confirm and interrupted first-session recovery use the same rule. Do not patch only the visible error message.

## Allowed implementation scope

- `apps/api/src/project-foundation/session-capture.service.ts`
- `tests/integration/session-capture.test.ts`
- `tests/integration/first-interview-start.test.ts` only if needed to extend the existing first-session regression fixture

No other implementation files unless the exact repair is impossible within this scope; in that case stop and report the blocker instead of widening scope.

## Required regression coverage

Deterministically prove at least:

1. sequence 1 + current valid formal consent + default/unavailable continuation policy can confirm capture active;
2. an interrupted sequence-1 capture under the same valid consent can enter the existing resume path without being rejected solely by continuation-policy unavailability;
3. sequence 1 with missing/revoked/invalid formal consent still fails closed;
4. sequence > 1 still requires covered continuation consent and existing behavior is unchanged.

Prefer extending existing integration fixtures rather than inventing a parallel test harness.

## Non-goals

- no UI changes;
- no database/schema/migration changes;
- no consent text/version policy changes;
- no auth/assignment redesign;
- no realtime ASR, Director, P1-P6, question orchestration or memory changes;
- no CI retry/timeout changes;
- no Dispatcher/governance changes in the implementation PR.

## Acceptance

- the bounded tests above pass;
- repository-required exact-head PR CI passes;
- external Architect reviews the exact PR head;
- after merge and exact-current-main CI success, Owner resumes the SAME existing Checkpoint A interview record and continues live testing.
