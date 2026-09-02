# PFC-07A-QUERY-MODE-NAV-STATE

Status: `READY`

## Goal

Repair the single production route-state defect exposed by PFC-07 browser acceptance: same-path SPA navigation that changes only query/search state must re-render the New Interview route with the new intent.

This is a bounded follow-up under the already Owner-authorized `PRODUCT-FLOW-CLOSURE-01` pack. It does not add a new product behavior; it makes the existing explicit New-vs-Resume contract actually work.

## Entry / dependencies

- `PFC-06-ERROR-AUTH-RESILIENCE` is `DONE` through Architect PASS + merge + refreshed-main CI.
- PFC-07 PR #133 exact head `2749ffd719b4c9544caa97acaee5337072280202` and verify CI run `33607067676` exposed the defect.
- The Product Owner authorized this bounded follow-up after the defect was reported.

## Defect to repair

The ordinary transition from `/interviews/new?mode=new` to the visible `继续未完成访谈` action can update the browser URL to `?mode=resume` without re-rendering the route because App navigation state is pathname-only while New Interview intent reads `location.search` during render.

The expected behavior is already frozen by PFC-01/PFC-07: explicit continue must actually resume the same unfinished workflow rather than leave the UI in the previous query-mode state.

## Required behavior

1. Same-path navigation that changes `search` and/or `hash` must update the App's route/render state.
2. `/interviews/new?mode=new` -> `/interviews/new?mode=resume` must re-render `NewInterviewPage` with `intent="resume"`.
3. Existing pathname navigation must remain unchanged.
4. Preserve PFC-03 navigation/history guard behavior for active formal recording.
5. Preserve auth return-path behavior and same-origin safety.
6. Do not introduce a new router library or broad routing refactor.
7. Do not change New Interview business semantics, IndexedDB authority, server authority, consent, capture, P1-P6, or pause/resume product behavior.

## Allowed files

- `apps/web/src/app.tsx`
- `apps/web/src/app.spec.tsx`

No other production or test files are authorized. If the minimal fix requires another file, stop and report concrete evidence.

## Regression / acceptance

Tests must prove at minimum:

- query-only navigation on `/interviews/new` causes the intended render update;
- `mode=new` -> `mode=resume` is observable without a full page reload;
- ordinary pathname navigation still works;
- the existing guarded Back/navigation behavior is not weakened;
- auth return-path handling remains safe and functional.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit --run
pnpm build
git diff --check
```

## Non-goals

- No PFC-07 E2E rewrite in this task.
- No broad router abstraction.
- No UI redesign.
- No backend change.
- No new product decision.

## Completion

Exactly one implementation PR for this production fix. Worker stops at `REVIEW`; external Architect reviews exact head before Dispatcher merge/main verification.

After this task is `DONE`, unlock `PFC-07-FULL-FLOW-E2E`. Its existing PR #133 must be resumed rather than replaced.

Next Task: `PFC-07-FULL-FLOW-E2E`
