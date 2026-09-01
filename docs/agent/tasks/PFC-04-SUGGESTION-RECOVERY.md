# PFC-04-SUGGESTION-RECOVERY

Status: `DEFERRED`

## Goal

Ensure the core AI-assistance surface remains usable when the first/current suggestion load fails, while keeping recording independent from AI availability. Align ordinary recording/consent/reminder copy with the v1 decision that the product does not provide deliberate pause-then-resume.

Covers audited defect **F15** plus the Owner-frozen v1 no-pause product wording decision.

## Entry / dependencies

- `PFC-03-RECORDING-NAV-SAFETY` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Required behavior

1. If `getCurrentSuggestion()` fails on initial Workbench load, the Suggestion Panel must render a clear, user-invokable `重新加载问题建议` (or equivalent) action.
2. Retrying current suggestion must not require a non-null prior `current` presentation and must not restart/interrupt recording.
3. A successful retry restores the current server-authoritative suggestion/continue-listening/unavailable presentation.
4. Manual `下一个问题` remains generation/presentation fenced by the existing API contract; do not create a new request identity merely because UI rendering failed.
5. Network/provider/Director failure continues to show that recording/transcription can continue. AI failure must never become a capture stop gate.
6. Keep history navigation semantics intact. A retry of current suggestion must not silently overwrite a user’s historical snapshot view; returning to current remains explicit.
7. Audit ordinary user-facing first-session recording/consent/reminder copy in the files touched by this task. Remove any wording that promises a deliberate “pause now, resume later” product feature. Supported language may promise `停止/结束` and existing consent withdrawal rights.
8. Do not remove interruption recovery behavior or describe it as a deliberate pause feature.

## Allowed files

- `apps/web/src/interview/suggestion-panel.tsx`
- `apps/web/src/interview/suggestion-panel.spec.tsx`
- `apps/web/src/interview/new-interview-page.tsx`
- `apps/web/src/interview/new-interview-page.spec.tsx`
- `apps/web/src/interview/preparation-page.tsx`
- `apps/web/src/interview/preparation-page.spec.tsx`
- the existing backend/project-foundation file and existing contract/test file that define `recording-reminder-v1` text, only if the reminder text is server-owned
- minimal adjacent copy snapshots/tests strictly required by that reminder source

No API shape, Director behavior, P1-P6 semantics, or provider binding changes.

## Regression / acceptance

Tests must prove at minimum:

- initial suggestion read failure renders retry while recording UI remains usable;
- retry succeeds from `current === null` and displays the returned current presentation;
- repeated retry does not create manual-next requests;
- manual next semantics remain unchanged after recovery;
- history view is not silently replaced by background/retry current state;
- ordinary product copy does not promise pause-then-resume;
- stop/end/withdrawal wording remains truthful.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Non-goals

- No new AI fallback model.
- No broader Director prompt change.
- No pause/resume implementation.
- No route/placeholder cleanup; PFC-05.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews the exact PR head before Dispatcher merge/main verification.

Next Task: `PFC-05-ROUTE-ACTION-CLOSURE`
