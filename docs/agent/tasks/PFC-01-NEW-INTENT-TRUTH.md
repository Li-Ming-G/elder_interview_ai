# PFC-01-NEW-INTENT-TRUTH

Status: `READY`

## Goal

Stop stale/local New Interview state from hijacking the user’s explicit intent. Make “新建访谈” and “继续未完成访谈” two distinct product actions, with server facts authoritative over IndexedDB recovery state.

Covers audited defects: **F1, F3, F10, F19**. This task establishes the intent/truth model used by the later pre-start discard task.

## Entry / dependencies

- Product Owner authorized `PRODUCT-FLOW-CLOSURE-01` and all F1-F20 fixes.
- `CKPT-A-FIRST-CAPTURE-GATE-01` is `DONE` through PR #126.
- Planning baseline: `main@39fb739a6bdc0f42406e4191c5f885b63ece69ab`.

## Required behavior

1. Clicking Home “新建访谈” must never silently resume an older local workflow.
2. If an unfinished local workflow exists, the ordinary UI must explicitly distinguish at least:
   - `继续未完成访谈`;
   - the user’s intent to `开始新的访谈` (the durable discard/new transition is completed by PFC-02; this task must not fake or silently perform a destructive cleanup).
3. Home must expose an explicit, understandable entry for a genuinely unfinished creation instead of requiring the user to click “新建访谈” to discover recovery.
4. Before treating an IndexedDB workflow as resumable, reconcile it against available server authority using already-acknowledged project/session identities:
   - server `recording/reconnecting/stopping/processing/completed/failed` or an otherwise authoritative session state that proves creation has advanced beyond New Interview means the local creation workflow is no longer an active New Interview recovery target;
   - inaccessible/mismatched authoritative facts fail closed and do not manufacture a new identity;
   - local state is a recovery handle, never higher authority than server state.
5. A workflow resumed during the same continuous mounted page must not be labeled as “已恢复…” merely because `updatedAt` changed. Recovery copy is shown only when the page actually loaded an existing workflow from prior navigation/remount/recovery.
6. Do not clear server records or delete durable evidence in this task.
7. Existing idempotent create identities and unknown-response replay remain stable.

## Allowed files

Primary implementation scope:

- `apps/web/src/app.tsx`
- `apps/web/src/app.spec.tsx`
- `apps/web/src/home/home-shell.tsx`
- `apps/web/src/home/home-shell.spec.tsx`
- `apps/web/src/interview/new-interview-page.tsx`
- `apps/web/src/interview/new-interview-page.spec.tsx`
- `apps/web/src/interview/new-interview-workflow-store.ts`
- `apps/web/src/interview/new-interview-workflow-store.spec.ts`
- `apps/web/src/interview/interview-api.ts`
- `apps/web/src/interview/interview-api.spec.ts`

One small adjacent production helper under `apps/web/src/interview/` may be added if it is strictly needed to keep reconciliation deterministic. Any API/backend/schema change is out of scope for this task and must stop as a blocker rather than broaden silently.

## Regression / acceptance

Tests must prove at minimum:

- old local active workflow + Home “新建访谈” does not auto-resume;
- explicit “继续未完成访谈” resumes the same frozen workflow/request identities;
- a server session that has already advanced beyond New Interview causes stale local active creation to be retired from New Interview recovery;
- ordinary in-page progress does not falsely display recovery copy;
- malformed/mismatched server identity cannot silently bind to the workflow;
- existing unknown-response replay remains idempotent.

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

- No server-side draft discard/delete yet; PFC-02 owns that.
- No recording navigation guard/calibration change; PFC-03.
- No suggestion behavior; PFC-04.
- No placeholder route cleanup; PFC-05.
- No broad auth/error redesign; PFC-06.
- No P1-P6 semantic change or pause/resume feature.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW` with canonical PR + exact head. Architect reviews exact head. Dispatcher merges/verifies only after PASS.

Next Task: `PFC-02-PRESTART-DISCARD`
