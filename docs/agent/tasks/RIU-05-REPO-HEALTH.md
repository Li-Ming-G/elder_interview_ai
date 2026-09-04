# RIU-05-REPO-HEALTH

Status: `DEFERRED`

## Goal

Clear the three pieces of repository debt that make the local development loop unreliable or leave
misleading dead surface in the product tree. No product behavior changes.

Covers defect **G8**.

## Entry / dependencies

- `RIU-04-AI-STATUS-UI` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Required behavior

### 1. `pnpm lint` must pass on a working developer checkout

`tmp/` is git-ignored but not ESLint-ignored, so any leftover scratch tree fails the lint gate.
A checkout carrying `tmp/dev008a4-sandbox/` currently produces 233 errors, every one of them a
`parserOptions.project` parse failure for a file outside `tsconfig.lint.json`, and none of them from
tracked source. CI passes only because a fresh clone has no `tmp/`.

- Add the git-ignored scratch paths to the shared ESLint `ignores` list so the lint gate reflects
  tracked source only.
- `pnpm lint` exits zero on a checkout that contains `tmp/`.
- Coverage of `apps/`, `packages/`, and `tests/` is unchanged. Do not weaken any rule, do not relax
  `strictTypeChecked`, and do not add file-level disable comments.

### 2. De-flake the Workbench authority test

`apps/web/src/interview/workbench-shell.spec.tsx` — `fails closed and exposes login return when a
running verification receives 401` passes in isolation (43/43) but fails intermittently in the full
1088-test parallel run. The assertion is a `findByRole` on the post-`online` re-render whose default
1000ms window is not met under CPU contention; the component behavior is correct.

- The test asserts the same behavior deterministically under parallel load, without weakening what it
  proves: a 401 during a running verification still fails closed, still exposes `返回登录`, and still
  offers neither resume nor stop.
- Fix the test's timing dependence. Do not change `workbench-shell.tsx` behavior for this item, and do
  not delete or skip the test.
- The full `pnpm test:unit` suite passes across repeated consecutive runs.

### 3. Remove the unreachable placeholder routes

`apps/web/src/home/route-placeholder.tsx` still exports `ComingSoonRoute` (zero references anywhere,
including tests) and `SessionPlaceholderRoute` (referenced only by its own spec). Review is now served
by the real `SessionReviewRoute`. Both carry user-facing `即将可用` / `回顾页即将可用` copy that would
violate closure invariant 3 if either were ever wired back into routing.

- Delete `ComingSoonRoute` and `SessionPlaceholderRoute`, and the spec coverage that exists only for
  them.
- `SessionSaveFactsRoute` stays; it is live in `app.tsx`.
- No route table, navigation target, or reachable user-facing behavior changes. No remaining reference
  to either deleted symbol.

## Allowed files

- `packages/eslint-config/index.js`
- `apps/web/src/interview/workbench-shell.spec.tsx`
- `apps/web/src/home/route-placeholder.tsx`
- `apps/web/src/home/route-placeholder.spec.tsx`
- `apps/web/src/app.tsx`, only if an import needs removing
- `tsconfig.lint.json`, only if required by the ignore change

No product behavior change. No rule weakening. No unrelated refactor.

## Regression / acceptance

Tests must prove at minimum:

- `pnpm lint` exits zero with a `tmp/` tree present, and still reports violations in tracked
  `apps/`/`packages/`/`tests/` source;
- the Workbench 401 authority test still asserts fail-closed, `返回登录` availability, and the absence
  of resume/stop, and passes deterministically in the full parallel suite;
- no reference to `ComingSoonRoute` or `SessionPlaceholderRoute` remains;
- `SessionSaveFactsRoute` and `SessionReviewRoute` behavior is unchanged;
- no reachable route or navigation target changes.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
git diff --check
```

Run `pnpm test:unit` at least three consecutive times to demonstrate the de-flake.

## Non-goals

- No broader lint or tsconfig restructuring.
- No coverage-threshold change.
- No other test refactor, and no fixing of tests that are not flaky.
- No product copy change beyond deleting the dead placeholder components.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews the exact PR head
before Dispatcher merge/main verification.

Next Task: `null`
