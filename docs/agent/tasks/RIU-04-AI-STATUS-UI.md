# RIU-04-AI-STATUS-UI

Status: `DEFERRED`

## Goal

Make the AI assistant's state permanently visible to the listener during formal recording: what it is
doing, when it will next try, and — plainly — when it has failed.

Covers the user-facing half of defects **G3** and **G4**.

Owner product decision recorded in the pack: **this is an ordinary permanent product feature, always
visible. It is not a debug mode and is not gated behind a flag or environment setting.**

## Entry / dependencies

- `RIU-03-AI-STATUS-CONTRACT` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Required behavior

1. During formal recording the Suggestion Panel always shows the assistant's current state. There is
   no state in which the panel is silent about what the assistant is doing.
2. Failure is stated plainly in ordinary language a listener can act on, together with the existing
   user-invokable retry action. It uses the sanitized failure information from `RIU-03`; it never shows
   a raw provider error, a stack trace, an endpoint, a model identity beyond what is already displayed,
   or any credential material.
3. A failure disclosure persists until the state actually changes. It is never cleared by a timer, and
   it is never replaced by a plain `继续倾听` presentation that would misrepresent a broken assistant as
   a deliberate decision to keep listening.
4. `继续倾听` remains reserved for an actual server-authoritative `continue_listening` decision. A
   failed or unavailable attempt must never be rendered as `继续倾听`.
5. The waiting indicator expresses the two server-reported reasons distinctly and honestly:
   - interval gate closed — a countdown to the earliest next automatic attempt, worded so it promises
     only that an attempt may begin, never that a question will appear;
   - interval open, no new conversation pending — a statement that the assistant is waiting for new
     conversation, with no countdown.
6. The countdown is derived from the server-authoritative instant supplied by `RIU-03`. The browser
   never invents, extends, or extrapolates a schedule the server did not report, and a countdown that
   reaches zero without an attempt must not continue to claim one is imminent.
7. Manual `下一个问题` remains available and generation/presentation fenced exactly as today. The status
   surface adds no new request identity and does not change manual request semantics.
8. AI state never gates recording. No status, countdown, or failure disclosure may disable, block, or
   visually suggest stopping recording, capture, or transcription, and the panel must make clear that
   recording continues regardless.
9. History navigation semantics are unchanged. Status display must not silently replace a listener's
   historical snapshot view, and returning to current remains explicit.
10. Accessibility: the failure disclosure is announced assertively (`role="alert"`, consistent with the
    existing `suggestion-panel__error` element). The countdown is **not** announced on every tick — a
    per-second live region is unusable with a screen reader. Announce waiting-state transitions
    politely, and expose the countdown as non-announced text or a coarse polite update.
11. Copy is truthful under the frozen v1 decisions: no promise of pause-then-resume, and no promise of
    AI behavior the product does not deliver.

## Allowed files

- `apps/web/src/interview/suggestion-panel.tsx`
- `apps/web/src/interview/suggestion-panel.spec.tsx`
- `apps/web/src/interview/interview-api.ts`
- `apps/web/src/interview/interview-api.spec.ts`
- `apps/web/src/interview/workbench-shell.tsx`
- `apps/web/src/interview/workbench-shell.spec.tsx`
- the existing Workbench stylesheet, limited to styles for the new status elements
- minimal adjacent copy/snapshot tests strictly required by the above

No API shape change. No Director behavior change. No new polling loop beyond the read `RIU-03`
extended. No broader visual redesign.

## Regression / acceptance

Tests must prove at minimum:

- a reported automatic failure renders a persistent plain-language disclosure plus the retry action,
  and is not rendered as `继续倾听`;
- the disclosure is not cleared by elapsed time alone;
- a genuine `continue_listening` decision still renders `继续倾听`;
- interval-gate-closed state renders a countdown whose wording promises only an attempt;
- interval-open-with-no-pending-conversation state renders the waiting-for-conversation statement and
  no countdown;
- a countdown reaching zero without a new attempt does not claim a question is imminent;
- the browser does not extend or re-derive a schedule beyond the server-reported instant;
- recording, capture, and transcription controls stay enabled and unaffected across every AI status
  state, including sustained failure;
- manual next behavior and request identity are unchanged;
- a historical snapshot view is not silently replaced by status updates;
- the failure disclosure uses `role="alert"` and the countdown does not produce per-tick live-region
  announcements;
- no raw provider error, endpoint, or credential material is rendered;
- copy contains no pause-then-resume promise.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
git diff --check
```

## Non-goals

- No debug panel, developer overlay, verbose diagnostic view, or flag-gated variant. The Owner
  authorized a permanent ordinary feature.
- No change to generation cadence, retry, backoff, or fallback-model behavior.
- No decision-trace or evidence drill-down UI work.
- No broad Workbench redesign.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews the exact PR head
before Dispatcher merge/main verification.

Next Task: `RIU-05-REPO-HEALTH`
