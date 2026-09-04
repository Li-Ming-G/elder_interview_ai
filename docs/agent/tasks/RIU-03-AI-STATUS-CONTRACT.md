# RIU-03-AI-STATUS-CONTRACT

Status: `DEFERRED`

## Goal

Expose the outcome of automatic AI question generation, and the honest reason the next attempt has not
yet happened, as sanitized server-authoritative state the Workbench can read.

Covers the server half of defects **G3** and **G4**. `RIU-04` consumes this contract; this task ships
no user-visible change.

## Entry / dependencies

- `RIU-02-CALIBRATION-USABLE` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Root cause

Automatic attempt outcomes are already persisted to `question_generation_attempt` with `attempt_kind`,
`status`, `publication_outcome`, and `failure_code`, and the runtime already computes the remaining
minimum-interval wait
(`apps/api/src/question-orchestration/question-orchestration.service.ts:1148`). None of it is readable
by the browser. The Suggestion Panel's `error` state is written only inside user-initiated fetch
handlers, so a background failure cannot reach the UI through any existing path.

Automatic generation is gated on **two** independent conditions: at least `AUTO_MIN_INTERVAL_MS`
(20s) since the last attempt started, **and** new finalized transcript arriving to schedule a
debounced run (`DEBOUNCE_MS`, 1.5s). A surface that reports only elapsed time would imply a question
is due when none is scheduled, which invariant 13 forbids.

## Required behavior

1. Server-authoritative AI assistance status is readable by the Workbench for the current session as
   an additive field on a read the Workbench already performs. Do not introduce a new transport or a
   new polling loop.
2. The status reports the most recent automatic generation attempt's terminal outcome: whether it
   succeeded, is in flight, or failed, its sanitized failure code, and when it completed.
3. The status distinguishes the two waiting reasons explicitly:
   - the minimum interval has not elapsed — report the earliest time the next automatic attempt may
     start;
   - the interval is open but no new finalized transcript is pending — report that the system is
     waiting for new conversation, with no promised attempt time.
4. Timing is expressed as a server-authoritative absolute instant, not a client-computed countdown, so
   the browser cannot drift into promising an attempt the server has not scheduled.
5. Only sanitized identifiers and codes are exposed. Director prompts, assembled context, provider
   request or response payloads, credentials, endpoint credential material, model identity beyond what
   is already exposed, and raw provider error bodies must never appear in the response. This extends
   the existing decision-trace discipline to the read surface.
6. The failure code set exposed to the browser is the existing accepted sanitized set. No new
   provider-specific or free-text error string is introduced.
7. The change is strictly additive. Existing response shapes, field semantics, and consumers keep
   working unchanged, and the field is safe to ignore.
8. Reading status never triggers a generation attempt, never mutates generation state, never resets the
   minimum-interval gate, and never affects the debounce schedule.
9. Status availability is bounded by the existing authorization and session-access rules for the
   session. It must not become a new way to read a session the actor cannot already read.
10. Status reads never stop, pause, or interfere with recording, capture, or transcription.

## Allowed files

- `apps/api/src/question-orchestration/question-orchestration.service.ts`
- `apps/api/src/question-orchestration/question-orchestration.spec.ts`
- `apps/api/src/question-orchestration/question.controller.ts`
- `apps/api/src/question-orchestration/question.validation.ts`
- `apps/api/src/question-orchestration/question.validation.spec.ts`
- `packages/contracts/src/index.ts`
- the existing contract spec file covering the response shape being extended
- `docs/contracts/openapi.yaml`
- `docs/contracts/question-runtime-orchestration-v1.md`
- minimal adjacent tests strictly required by the additive field

No Director prompt change. No context/output schema change. No change to generation triggering,
debounce, or interval policy. No new endpoint if an existing read can carry the field.

## Regression / acceptance

Tests must prove at minimum:

- a failed automatic attempt is reported with its sanitized failure code and completion time;
- a successful automatic attempt is reported as succeeded;
- an in-flight attempt is reported as in flight;
- with the interval gate closed, the response reports the earliest next attempt instant;
- with the interval gate open and no pending finalized transcript, the response reports waiting for new
  conversation and reports no promised attempt instant;
- no prompt, context, provider payload, raw provider error body, or credential material appears in any
  response, including on the failure path;
- only accepted sanitized failure codes are emitted;
- reading status does not create a generation attempt, does not reset the interval gate, and does not
  alter the debounce schedule;
- an actor without session access cannot read status;
- existing consumers of the extended response are unaffected.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

## Non-goals

- No UI change; `RIU-04`.
- No change to the automatic generation cadence, debounce, deadline, or interval constants.
- No retry, backoff, or fallback-model behavior.
- No new decision-trace fields and no expansion of what traces retain.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews the exact PR head
before Dispatcher merge/main verification.

Next Task: `RIU-04-AI-STATUS-UI`
