# CKPT-A-LEGACY-PREPARE-BRIDGE-01

Status: `READY`

## Goal

Close the final Owner Checkpoint A legacy-recovery UI gap: when a recoverable first-session legacy project is still `draft` but the backend is already authorized to self-heal it at formal start, the `/prepare` page must not permanently disable the Start action solely because `project.status === 'draft'`.

## Owner evidence / incident shape

Owner retest on native Windows reached:

`/projects/<project>/interview/<session>/prepare`

The legacy record is still unable to enter the interview because the Start button remains disabled. Backend legacy recovery from PR #122 already accepts the bounded first-session `draft + device_check + valid current formal consent` shape and promotes it to `ready` under locks before the start gate. The frontend preparation page still computes `canResume` using only `project.status === 'ready' || project.status === 'active'`, so the request never reaches the repaired backend.

This Task is explicitly Owner-authorized as the final Checkpoint A blocker repair.

## Scope

Primary:
- `apps/web/src/interview/preparation-page.tsx`
- `apps/web/src/interview/preparation-page.spec.tsx`

Optional only if narrowly required:
- existing shared consent/session predicate helper under `apps/web/src/interview/**`

Do not modify backend start authority, P1-P6 semantics, consent policy, repeat-session continuation policy, schema/migrations, ASR/Director/OpenRouter/Tencent behavior, Dispatcher governance, or deployment/provider decisions.

## Required behavior

1. Preserve current fail-closed requirements for the prepare page:
   - current valid non-revoked formal consent;
   - session must be `device_check` before Start;
   - current-page microphone check must pass;
   - recording start reminder must be present;
   - no duplicate Start while submitting.
2. Preserve current behavior for normal `ready` and `active` projects.
3. Add exactly one bounded compatibility allowance for a first-session legacy `draft` project that can be safely handed to the backend recovery path.
4. Do not allow arbitrary draft projects to start. The frontend allowance must be constrained by server-returned session evidence available on the page, at minimum `session.sequence_no === 1`, current valid formal consent, and `session.status === 'device_check'`.
5. The frontend must not duplicate backend authority logic or mutate project state locally. It only permits the explicit Start request to reach the backend; backend remains final authority and may still reject.
6. Repeat sessions and invalid/revoked/pending consent must remain blocked exactly as before.

## Required tests

Add deterministic frontend regression coverage proving:

A. legacy first-session `project=draft`, `sequence_no=1`, valid current consent, `device_check`, reminder present, and successful current-page microphone check enables Start;
B. the Start action calls the existing capture/start path and navigates to workbench on accepted backend response;
C. `project=draft` with `sequence_no>1` remains disabled;
D. `project=draft` with invalid consent remains disabled;
E. `project=draft` without current-page microphone pass remains disabled;
F. normal `ready`/`active` behavior is unchanged.

Run at minimum:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit --run
pnpm build
git diff --check
```

If repository-wide lint has a pre-existing unrelated failure outside changed scope, report it with changed-file lint evidence; do not expand scope merely to clean unrelated files.

## Completion criteria

- one canonical implementation PR;
- exact-head CI succeeds;
- external Architect exact-head `ARCHITECT_VERDICT_V1: PASS`;
- Dispatcher merges, refreshes main, verifies exact current-main CI SUCCESS, then marks this task `DONE`;
- `next_task: null`.

## Non-goals

- no database wipe or browser IndexedDB clearing;
- no unfinished-workflow delete/abandon UX;
- no repeat-consent policy change;
- no backend authority broadening;
- no new product semantics beyond bridging the already accepted legacy first-session backend recovery to the UI Start action.

## Next Task

`null`
