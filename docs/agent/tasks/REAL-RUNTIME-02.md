# REAL-RUNTIME-02

Status: `DEFERRED`

## Architecture Mapping (P1-P6/T0-T27)

- Foundation / web product entry: `AFFECTED`.
- P1-P6: `UNCHANGED`.
- T0-T27 runtime semantics: `UNCHANGED`.
- T26-T27 evaluation/scoring: `DEFERRED`.

## Goal

Ensure the ordinary web application entry always renders the real product application and cannot be replaced by engineering harnesses through URL query parameters, while preserving those harnesses for explicit automated/local engineering use.

## Scope

Isolate test/dev harness selection from `apps/web/src/main.tsx`. Preserve harness components and tests through an explicit engineering-only entry or test configuration. Audit only the owner-visible normal-route code touched by this work for unambiguously test-only fake/demo/harness artifacts.

## Allowed Files / Areas

- `apps/web/src/main.tsx`
- `apps/web/src/main*.spec.tsx`
- existing harness entry/component files under:
  - `apps/web/src/audio/*harness*`
  - `apps/web/src/realtime-transcription/*harness*`
  - `apps/web/src/interview/*harness*`
- `apps/web/index.html` and a narrowly scoped explicit test/dev-only HTML/entry file if needed
- `apps/web/package.json`
- root/browser test configuration that currently invokes these harness query switches
- only tests directly necessary to preserve harness coverage after isolation

Anything outside this scope requires external correction or a new Task Card.

## Inputs

- `REAL-IDENTITY-01` must be DONE after external Architect PASS, merge and successful main verification.
- Product Owner authorization in `docs/agent/tasks/REAL-FLOW-CLEANUP-DEVELOPMENT-PACK.md`.
- Current ordinary entry `apps/web/src/main.tsx@458d3c42b984e1fce6a8cb0453bc3ddeac6c7d30`.
- Planning baseline `main@055bb9b9a91ff9ae696495f9688da7d8d02d3552`.

## Accepted Contracts — exact identities

No new Accepted Contract is created or modified by this task.

Preserve accepted/stable interview, auth, audio, realtime transcription, privacy, Question Presentation and Checkpoint A invariants on `main@055bb9b9a91ff9ae696495f9688da7d8d02d3552`.

If isolating harnesses would require changing real product behavior, interview flow semantics, audio/ASR behavior, Director semantics or an Accepted Contract, stop with `PRODUCT_AMBIGUITY`.

## Reference Implementations

Read-only baseline:

- `apps/web/src/main.tsx@458d3c42b984e1fce6a8cb0453bc3ddeac6c7d30`

Current test-only switches to remove from the ordinary entry include:

- `audio_harness`
- `capture_core_harness`
- `realtime_harness`
- `interview_controller_harness`
- `suggestion_harness`

Current fake/default harness identifiers in the ordinary entry must not remain reachable through the normal application entry.

## Required Behavior

1. `apps/web/src/main.tsx` no longer selects any harness based on URL query parameters and renders the ordinary `App` path only.
2. The normal product URL cannot switch to `AudioBrowserHarness`, `BrowserCaptureCoreHarness`, `RealtimeTranscriptionHarness`, `InterviewCaptureControllerHarness` or `SuggestionPanelHarness`.
3. Harness components remain available for explicit automated/local engineering testing through a separate test/dev-only entry or equivalent explicit test configuration.
4. Existing browser/unit coverage that legitimately depends on harnesses is updated to use the isolated engineering entry and continues to pass.
5. Fake/default harness project/session identifiers are not part of the ordinary product entry.
6. Any owner-visible artifact encountered within the touched normal route that is clearly and solely a test/demo/harness artifact is isolated or removed.
7. Genuine unfinished product placeholders are not silently implemented, hidden or deleted. Record them in the PR as `OWNER_DECISION_FOLLOWUP` items without expanding scope.

## Explicit Non-Goals

- implementing unfinished product features;
- redesigning UI/visual language;
- changing auth/session behavior;
- changing audio capture, Tencent ASR, transcript, P1-P6, Director/OpenRouter/Ox, memory/evidence or Question Presentation semantics;
- deleting harness components or automated tests merely because they are test-only;
- scoring/evaluation/model-comparison work;
- acting on PRs #25, #43, #45, #62 or #110.

## Tests

Run at minimum:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit --run
pnpm test:e2e -- --project=chromium
```

Run any narrower harness/browser tests changed by this task. Tests remain synthetic/network-safe as already required by repository policy.

## Completion Criteria

- ordinary `main.tsx` has no harness query-switch authority;
- explicit engineering-only harness access still works for tests;
- required tests pass;
- no unrelated product behavior is changed;
- Worker opens/reuses one PR and reports its PR number;
- any genuine unfinished product placeholder found is reported, not implemented;
- task stops at `REVIEW` and does not claim PASS/DONE.

## Review Gate

External Architect exact-head PR review. The Worker and Dispatcher stop at `REVIEW`; only external Architect `PASS` can authorize merge.

## Next Task

`null`
