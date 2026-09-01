# PFC-05-ROUTE-ACTION-CLOSURE

Status: `DEFERRED`

## Goal

Remove ordinary user-facing dead routes and false promises from the interview lifecycle. Every visible action in the audited Home/New/Preparation/Workbench/Review surface must either reach a real supported behavior or remain honestly unavailable in place.

Covers audited defects: **F4, F5, F6, F7, F8**.

## Entry / dependencies

- `PFC-04-SUGGESTION-RECOVERY` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Required behavior

1. **No-audio “reprepare” path (F4):**
   - do not navigate to `/prepare` without a usable authoritative session;
   - for v1, prefer a simple truthful action such as `返回工作区重新准备`, then let Home/server projection establish the next valid session action;
   - if the existing server API already provides an unambiguous safe session creation pointer, the UI may use it, but it must arrive at Preparation with a concrete valid session id.
2. **Preparation load failure (F5):** render both `重新加载` and `返回工作区`; returning must not mutate the session.
3. **Reauthorization (F6):** ordinary UI must not offer a clickable `重新取得正式授权` route that only opens a page saying reauthorization is unavailable.
   - Do not invent a new reauthorization policy/workflow in this task.
   - If existing accepted APIs already fully support the same recorded-verbal authorization flow for this state, reuse it; otherwise keep the project visibly blocked in place with truthful copy and no fake navigation action.
4. **Save facts (F7):** `view_save_facts` must lead to a real existing save-state/read-only fact projection. Prefer reusing the existing Workbench `保存状态明细` / server-session projection rather than creating a duplicate fact model. The placeholder route must not be the ordinary destination.
5. **Stale empty-state copy (F8):** remove “新建访谈功能即将可用” or equivalent stale text now that New Interview exists; empty Home should tell the user how to start a real interview.
6. Audit the ordinary routes touched by this task for any other button/link whose sole destination is a known placeholder. Within the same lifecycle and same files, either wire it to an existing real behavior or make it honestly unavailable in place. Do not expand into unrelated future features.
7. Browser URL/back behavior for the repaired routes must remain deterministic and must not create duplicate server objects.

## Allowed files

- `apps/web/src/app.tsx`
- `apps/web/src/app.spec.tsx`
- `apps/web/src/home/home-shell.tsx`
- `apps/web/src/home/home-shell.spec.tsx`
- `apps/web/src/home/route-placeholder.tsx`
- `apps/web/src/home/route-placeholder.spec.tsx`
- `apps/web/src/home/session-review-route.tsx`
- `apps/web/src/home/session-review-route.spec.tsx`
- `apps/web/src/interview/preparation-page.tsx`
- `apps/web/src/interview/preparation-page.spec.tsx`
- `apps/web/src/interview/workbench-shell.tsx`
- `apps/web/src/interview/workbench-shell.spec.tsx`
- `apps/web/src/interview/reauthorization-route.tsx`
- `apps/web/src/interview/reauthorization-route.spec.tsx`
- `apps/web/src/interview/routes.ts`
- `apps/web/src/interview/routes.spec.ts`
- minimal `apps/web/src/styles.css` only if needed for honest disabled/in-place state

No backend/schema/consent-policy implementation is allowed merely to make a placeholder look real. If a visible action requires a genuinely new product policy, remove/disable the false action and report it rather than inventing policy.

## Regression / acceptance

Tests must prove at minimum:

- no-audio recovery never lands on Preparation with `session === null`;
- Preparation load failure has a functional workspace escape;
- Home no longer navigates ordinary users into the unavailable reauthorization placeholder;
- `view_save_facts` lands on a real supported fact/read-only surface;
- Home empty state no longer says New Interview is “coming soon”;
- audited ordinary visible buttons in these routes have a real route/action contract;
- no repaired action creates duplicate project/session identities on refresh/retry.

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

- No new reauthorization policy.
- No general settings/admin UI.
- No broad UI redesign.
- No P1-P6 change.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; exact-head Architect verdict is required before Dispatcher merge/main verification.

Next Task: `PFC-06-ERROR-AUTH-RESILIENCE`
