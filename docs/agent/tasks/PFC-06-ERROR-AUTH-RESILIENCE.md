# PFC-06-ERROR-AUTH-RESILIENCE

Status: `DEFERRED`

## Goal

Make ordinary failure states truthful and recoverable: generic 403 errors must stop claiming assignment loss without evidence, explicit 401 auth loss must have one consistent recovery path, and one project/session load failure must not collapse the entire Home workspace.

Covers audited defects: **F16, F17, F18**.

## Entry / dependencies

- `PFC-05-ROUTE-ACTION-CLOSURE` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Required behavior

1. **Truthful 403 copy (F16):**
   - generic `FORBIDDEN` mapping must be neutral, e.g. “当前操作没有权限或当前状态不允许，请重新核对”; it must not assert that assignment was lost unless a specific error code/details prove that fact;
   - page-specific code may add a more precise next action only when it has concrete state/error evidence.
2. **Consistent 401 recovery (F17):**
   - Home, New Interview, Preparation, Workbench and Review must treat explicit auth loss as authentication loss, not as generic project inaccessibility;
   - user gets one clear `重新登录/返回登录` path;
   - after successful login, preserve/retry the original route when it is safe and still authorized; otherwise return to Home without fabricating access;
   - auth recovery must not automatically start/resume recording or request a microphone.
3. **Home partial failure (F18):**
   - failure to load one ordinary project’s session list must not hide other successfully loaded projects;
   - the affected project renders a local recoverable state with `重新加载`/refresh action;
   - failure of the root project list itself may still render a page-level error, but it must include a real retry action;
   - restricted/hidden project privacy projection remains unchanged and must not leak details while retrying.
4. Retry actions must be bounded UI retries, not unbounded polling loops.
5. Preserve existing CSRF/session-cookie security and fail-closed authorization semantics.
6. Do not rewrite server errors to expose secret/internal messages or untrusted details.

## Allowed files

- `apps/web/src/app.tsx`
- `apps/web/src/app.spec.tsx`
- `apps/web/src/home/home-shell.tsx`
- `apps/web/src/home/home-shell.spec.tsx`
- `apps/web/src/home/session-review-route.tsx`
- `apps/web/src/home/session-review-route.spec.tsx`
- `apps/web/src/interview/interview-api.ts`
- `apps/web/src/interview/interview-api.spec.ts`
- `apps/web/src/interview/new-interview-page.tsx`
- `apps/web/src/interview/new-interview-page.spec.tsx`
- `apps/web/src/interview/preparation-page.tsx`
- `apps/web/src/interview/preparation-page.spec.tsx`
- `apps/web/src/interview/workbench-shell.tsx`
- `apps/web/src/interview/workbench-shell.spec.tsx`
- minimal `apps/web/src/styles.css` only for local error/retry presentation

Backend auth/authorization semantics are out of scope. If the frontend cannot distinguish an explicit auth loss because the backend collapses it into another code, Worker must stop with concrete evidence rather than broaden authorization behavior silently.

## Regression / acceptance

Tests must prove at minimum:

- generic 403 no longer tells the user assignment was lost without evidence;
- 401 on Preparation/Review/New/Workbench leads to the same login recovery contract;
- auth recovery does not request microphone or start capture;
- one project session-list failure leaves other Home projects usable;
- affected Home project can retry independently;
- root Home list failure has a functional retry;
- restricted project information remains non-leaking under partial failure;
- server/internal error detail is not rendered verbatim.

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

- No OAuth/signup/auth redesign.
- No server authorization policy changes.
- No broad offline mode.
- No P1-P6 changes.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews exact head before Dispatcher merge/main verification.

Next Task: `PFC-07-FULL-FLOW-E2E`
