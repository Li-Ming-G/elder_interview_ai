# PFC-03-RECORDING-NAV-SAFETY

Status: `DEFERRED`

## Goal

Make formal recording impossible to silently strand off-screen. Once recording has started, the listener must always have a safe End Interview action, including during speaker calibration, and ordinary navigation must respect the active capture boundary.

Covers audited defects: **F12, F13, F14, F20**. Also freezes the v1 product decision: **no deliberate pause-then-resume feature.**

## Entry / dependencies

- `PFC-02-PRESTART-DISCARD` is `DONE` through Architect PASS + merge + refreshed-main CI.
- Existing capture/audio integrity/recovery semantics remain authoritative.

## Required behavior

1. While a session is in a formal capture state that still requires safe handling (`recording`, reconnecting/active capture, unresolved interruption with local evidence, stopping/frozen-save states as applicable), SPA navigation cannot silently move to another route and leave capture running/stranded.
2. User attempts to leave the active Workbench through app navigation/history back must receive one clear choice:
   - stay in the interview; or
   - safely end/resolve the current interview through the existing stop/freeze/save path, then navigate only after the safe transition reaches the appropriate boundary.
3. Browser refresh/close while an active/unresolved formal capture exists must install an appropriate unload warning. Do not depend on asynchronous network work during unload and do not claim a guaranteed server stop if the browser is forcibly closed; durable local archive/recovery truth remains authoritative on return.
4. The capture controller must not remain actively recording solely because its Workbench React route disappeared. Route lifecycle and controller ownership must have an explicit safe contract.
5. Speaker Calibration is already inside formal recording. It must therefore expose the same safe `结束访谈` capability as the ordinary recording Workbench.
6. Calibration must not hard-lock completion of the interview:
   - successful calibration preserves confirmed mapping;
   - explicit skip/degrade continues with speaker roles unknown/unconfirmed as the existing evidence model allows;
   - calibration provider/init failure must present an explicit safe `跳过说话人确认并继续访谈` path rather than trapping the user after formal recording has started;
   - raw audio and calibration evidence remain preserved; do not fabricate speaker identity.
7. Home must not offer an ordinary “新建访谈” action that can start a second formal interview while any accessible session still has active/unresolved formal capture requiring the listener’s attention. Home should instead surface/priority-link the existing session handling path.
8. Do not add a deliberate `暂停访谈` / pause-later-resume feature. Existing interruption recovery is a safety/recovery mechanism, not a user-facing pause product.
9. Existing stop confirmation, audio freeze, chunk delivery, manifest completion, server reconciliation, consent withdrawal and authority-loss behavior remain fail-closed.

## Allowed files

Primary scope:

- `apps/web/src/app.tsx`
- `apps/web/src/app.spec.tsx`
- `apps/web/src/home/home-shell.tsx`
- `apps/web/src/home/home-shell.spec.tsx`
- `apps/web/src/interview/workbench-shell.tsx`
- `apps/web/src/interview/workbench-shell.spec.tsx`
- `apps/web/src/interview/interview-capture-controller.ts`
- `apps/web/src/interview/interview-capture-controller.spec.ts`
- `apps/web/src/interview/browser-interview-capture-controller.ts`
- existing route/navigation helper under `apps/web/src/interview/` if strictly required
- minimal `apps/web/src/styles.css` changes only for the required leave/end confirmation UI

Backend/API/schema changes are out of scope unless a concrete existing endpoint omission blocks the already-supported safe stop/recovery path; Worker must stop and report before broadening.

## Regression / acceptance

Tests must prove at minimum:

- SPA back/navigation during recording does not silently leave the Workbench;
- choose “stay” preserves the active interview;
- choose “end and leave” invokes the same safe end/save flow before navigation;
- hard refresh/close risk installs and removes unload protection according to capture state;
- calibration surface always offers End Interview once formal recording is active;
- calibration failure can explicitly continue with unconfirmed/unknown speaker mapping without inventing identity;
- Home suppresses/blocks New Interview when an active/unresolved formal interview must be handled;
- protection disappears after the session reaches a safe terminal/read-only state;
- no `暂停访谈` product action is introduced.

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

- No new audio persistence model.
- No deliberate pause/resume state machine.
- No changes to ASR provider, Director, P1-P6, or consent authority.
- No broad visual redesign.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`. Architect exact-head review is required before Dispatcher merge/main verification.

Next Task: `PFC-04-SUGGESTION-RECOVERY`
