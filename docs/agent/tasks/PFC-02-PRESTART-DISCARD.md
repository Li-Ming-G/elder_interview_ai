# PFC-02-PRESTART-DISCARD

Status: `DEFERRED`

## Goal

Complete the explicit “start a new interview instead” path by giving the product one safe, server-authoritative way to abandon an unfinished New Interview before formal recording evidence exists.

Covers audited defects: **F2, F11**, and completes the “开始新的访谈” branch established by PFC-01.

## Entry / dependencies

- `PFC-01-NEW-INTENT-TRUTH` must be `DONE` through Architect PASS + merge + refreshed-main CI.
- Product Owner approved pre-start discard as part of `PRODUCT-FLOW-CLOSURE-01`.

## Required behavior

1. The user may explicitly abandon an unfinished New Interview only while it is still safely pre-formal-recording.
2. The authoritative server transition must fail closed if any formal interview audio/evidence boundary exists or the session/project has advanced beyond the allowed pre-start states.
3. Discard must be idempotent and bound to the authenticated actor/current active assignment. Repeating the same discard cannot create divergent state.
4. If a server project/session exists, local IndexedDB state is cleared/retired only after the server acknowledges the discard result.
5. If the workflow never created any server project/session, local-only discard may clear the browser workflow without inventing server work.
6. The ordinary Home/New Interview UI must provide explicit choices:
   - `继续未完成访谈` preserves the same workflow;
   - `放弃未完成访谈并新建` (or equally clear wording) requires confirmation and then opens a genuinely fresh workflow only after safe discard succeeds.
7. Discard must not delete or rewrite any server recording/transcript/memory/audit evidence. If such evidence exists, the UI must direct the user to the existing session’s safe handling path instead of discarding it.
8. Prefer the existing project soft-delete/deleted-state primitives if they are already the accepted persistence semantics; do not add a new database schema merely to model this transition unless a concrete blocker proves the existing model cannot express it.
9. Existing project/session create idempotency and consent/audio integrity remain unchanged.

## Allowed files

Backend/contract scope is limited to the existing project/session lifecycle surface needed for one pre-start discard endpoint and its tests:

- `apps/api/src/project-foundation/**` only where directly needed for the new pre-start discard action;
- the existing contracts/DTO file(s) that define project/session lifecycle request/response types;
- existing API integration/spec files for project/session lifecycle.

Frontend scope:

- `apps/web/src/interview/new-interview-page.tsx`
- `apps/web/src/interview/new-interview-page.spec.tsx`
- `apps/web/src/interview/new-interview-workflow-store.ts`
- `apps/web/src/interview/new-interview-workflow-store.spec.ts`
- `apps/web/src/interview/interview-api.ts`
- `apps/web/src/interview/interview-api.spec.ts`
- `apps/web/src/home/home-shell.tsx`
- `apps/web/src/home/home-shell.spec.tsx`

No migration/schema file is allowed unless Worker stops and reports a concrete model impossibility before changing it.

## Regression / acceptance

Tests must prove at minimum:

- local-only unfinished flow can be discarded and a new workflow starts fresh;
- server-backed draft/created/device-check flow can be discarded only before formal capture evidence;
- recording/interrupted-with-evidence/processing/completed cannot be discarded through this endpoint;
- server failure leaves local recovery state intact;
- successful discard retires the old local recovery target and Home no longer offers it as unfinished;
- repeated identical discard is idempotent;
- old project/session does not silently become the new workflow identity.

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

- No general project deletion UI.
- No deletion of completed/interrupted evidence.
- No privacy erasure workflow.
- No active-recording navigation safety; PFC-03.
- No pause/resume product feature.
- No P1-P6 changes.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW` with exact PR head. Architect reviews exact head; Dispatcher merges/verifies only after PASS.

Next Task: `PFC-03-RECORDING-NAV-SAFETY`
