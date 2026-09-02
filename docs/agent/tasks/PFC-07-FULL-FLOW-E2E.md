# PFC-07-FULL-FLOW-E2E

Status: `DEFERRED`

## Goal

Lock the repaired product surface with a browser-level contract that proves an ordinary listener can complete the visible first-interview lifecycle from Home through Review and back to Home, and that critical recovery/navigation boundaries do not regress.

Covers audited defect **F9** and is the acceptance gate for `PRODUCT-FLOW-CLOSURE-01`.

## Entry / dependencies

- `PFC-06-ERROR-AUTH-RESILIENCE` is `DONE` through Architect PASS + merge + refreshed-main CI.
- `PFC-07A-QUERY-MODE-NAV-STATE` must be `DONE` through Architect PASS + merge + refreshed-main CI.
- All prior PFC behavior is expected to be present on main before this task resumes.

## Existing PR resume contract

PFC-07 already has canonical implementation PR #133 on branch `codex/pfc-07-full-flow-e2e`.

When this task is unlocked after PFC-07A:

- reuse PR #133; do not create a replacement PR;
- update the existing PR branch with the refreshed main that contains the accepted PFC-07A production fix;
- preserve the existing PFC-07 browser coverage and product-flow matrix unless a test-only adjustment is required by the accepted production behavior;
- rerun the required exact-head CI on the resulting new PR head;
- any new production defect found by the resumed browser suite must again stop with exact first-failing-transition evidence rather than silently widening scope.

Historical blocked head `2749ffd719b4c9544caa97acaee5337072280202` and CI run `33607067676` remain evidence only; they are not the resumed review head.

## Required browser contract

Create/extend Playwright coverage using the real ordinary web application and real API/database test stack, with deterministic test-only audio/realtime/AI fixtures already allowed by repository test infrastructure. Do not require Tencent/OpenRouter/external network in CI.

Primary visible journey must drive ordinary UI actions rather than creating the interview lifecycle directly through API calls:

```text
Login
-> Home
-> New Interview
-> project info
-> create session
-> current-page microphone check
-> recorded verbal consent flow
-> explicit recording reminder/start
-> formal recording
-> speaker calibration confirm/skip/degrade path
-> Workbench realtime transcript/suggestion surface
-> manual Next Question at least once
-> End Interview confirmation
-> safe save/finalization/processing
-> Review
-> Return to workspace
```

The test must assert that each transition reaches the intended ordinary route/state and that no placeholder/dead page is entered.

## Critical secondary scenarios

At minimum add browser-level coverage for:

1. unfinished local New Interview + click “新建访谈” => no silent auto-resume; explicit continue/new intent UI;
2. explicit continue resumes the same workflow identity;
3. pre-start safe discard/new path, once server-backed, leaves no active browser recovery pointer to the discarded flow;
4. refresh/reopen before formal start requires fresh current-page microphone check but preserves durable workflow identity;
5. attempt to navigate/back during formal recording is guarded; choosing stay keeps Workbench active;
6. calibration surface can safely End Interview and can explicitly skip/degrade to the Workbench without inventing speaker identity;
7. initial suggestion load failure exposes retry and recording remains usable;
8. completed Review returns to Home and the completed session is projected as history/read-only rather than a resumable New Interview;
9. ordinary visible actions covered by F4-F8 do not route to known placeholders.

## Product-flow matrix

Add a concise durable matrix at:

`docs/agent/product-flow-closure-matrix.md`

For each audited ordinary action/state, record:

- source route/state;
- visible action label;
- authoritative prerequisite;
- expected destination/result;
- failure/recovery behavior;
- automated coverage reference.

This is a product contract/index, not a new architecture spec.

## Allowed files

- `tests/e2e-auth/auth.spec.ts` and/or a new narrowly named Playwright spec under the existing `tests/e2e-auth/` suite;
- existing Playwright config/test support required to reuse deterministic browser audio/realtime fixtures;
- `docs/agent/product-flow-closure-matrix.md`;
- minimal production test selectors/accessibility labels only if strictly necessary and behavior-neutral.

Do not change product behavior in this task merely to make the test pass. If the browser test reveals a remaining product defect, stop and report the exact first failing user transition so Architect can issue a bounded follow-up under the same Owner-authorized pack.

## Acceptance

- Primary journey passes in Chromium without API shortcuts for lifecycle transitions.
- Secondary scenarios above pass.
- Tests use only synthetic/public non-sensitive data.
- No flaky “just retry until green” pattern, arbitrary sleeps, or oversized timeout masking.
- Product-flow matrix matches the shipped route/action behavior.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:auth
git diff --check
```

Use the repository’s actual E2E command if named differently; report the exact command/run.

## Non-goals

- No production provider availability test.
- No performance/load testing.
- No visual polish redesign.
- No P1-P6/T26-T27 changes.
- No deliberate pause/resume feature.

## Completion

Canonical implementation PR remains **#133**. Worker stops at `REVIEW`; Architect exact-head review includes verifying the browser contract is behaviorally meaningful rather than a mocked DOM-only path. Dispatcher merges/verifies main only after PASS.

Next Task: `null`
