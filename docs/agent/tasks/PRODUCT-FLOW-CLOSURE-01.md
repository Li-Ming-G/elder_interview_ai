# Product Flow Closure 01

Status: `ACTIVE`

## Owner authorization

The Product Owner authorizes a bounded product-flow closure sequence focused on making the current web product behave like a complete interview application rather than an engineering/test surface.

Primary goal: **a listener can start from the ordinary home page, complete one real consented interview, safely finish/save/review it, and return to the workspace without dead routes, misleading buttons, stale local workflow hijacking, or silent recording navigation hazards.**

The Owner approved all audited defects F1-F20. The Owner also froze one product decision for v1: **no pause-then-resume feature is required.** User-facing consent/reminder copy must not promise a resumable pause. Existing stop/end and consent-withdrawal safety remain intact.

PFC-07 browser acceptance later exposed one remaining production route-state defect: query-only navigation on `/interviews/new` can change `mode` without causing the App to re-render. The Product Owner authorized one bounded follow-up, `PFC-07A-QUERY-MODE-NAV-STATE`, under this existing pack. This does not reopen product scope or add a new feature; it repairs behavior already required by the approved New-vs-Resume contract.

Predefined sequence:

```text
PFC-01-NEW-INTENT-TRUTH
  -> PFC-02-PRESTART-DISCARD
  -> PFC-03-RECORDING-NAV-SAFETY
  -> PFC-04-SUGGESTION-RECOVERY
  -> PFC-05-ROUTE-ACTION-CLOSURE
  -> PFC-06-ERROR-AUTH-RESILIENCE
  -> PFC-07A-QUERY-MODE-NAV-STATE
  -> PFC-07-FULL-FLOW-E2E
  -> null
```

Only the first eligible task may run. Every successor remains locked until the predecessor receives exact-head external Architect PASS, merges, and refreshed-main CI succeeds.

## Product invariants

1. **Server truth outranks stale browser workflow state.** IndexedDB may preserve a recovery handle, but it must never resurrect a flow that server facts prove has already advanced, ended, become inaccessible, or completed.
2. **A button must do what its label promises.** “新建访谈” cannot silently mean “resume old workflow”; placeholder/unavailable destinations cannot masquerade as working actions.
3. **Every visible action has a valid destination or an honest disabled/in-place state.** No user should discover that an action is fake only after navigating into a placeholder/dead page.
4. **Formal recording cannot be silently left behind.** While a session is recording, unresolved-interrupted, stopping, or otherwise needs safe user action, back/refresh/close/navigation cannot quietly strand the capture controller or leave recording active off-screen.
5. **Once formal recording starts, a safe End Interview action is always available**, including during speaker calibration.
6. **Speaker calibration is not a hard lock on completing an interview.** Provider/unrecoverable calibration failure may degrade/skip according to existing evidence safety, while raw recording remains authoritative.
7. **AI suggestion failure never blocks recording.** The listener gets a clear retry path for suggestion loading/manual next.
8. **No v1 pause/resume promise.** The product supports continuing the currently open interview, ending it, and recovering from interruption where already supported, but does not advertise a deliberate pause-later-resume product feature.
9. **One unresolved formal interview takes precedence over creating another.** The ordinary home surface must direct the listener back to the active/unresolved session before allowing a second formal interview path that would conflict with safe capture handling.
10. **Happy-path completion is the priority over cosmetic polish.** Visual redesign is out of scope except minimal UI required to make actions/state understandable.

## Audited defects covered

- F1: “新建访谈” silently resumes old active workflow.
- F2/F11: no explicit safe pre-start discard; clearing local state alone would leave server draft/session debris.
- F3: no explicit home entry for unfinished creation.
- F4: “重新准备一次访谈” can navigate to preparation without a usable session.
- F5: preparation load failure lacks a workspace escape.
- F6: reauthorization action can lead to a page that admits reauthorization is unavailable.
- F7: save-facts action can lead to placeholder behavior.
- F8: stale “新建功能即将可用” product copy.
- F9: no one-browser-contract proving the complete visible interview chain.
- F10: local New Interview workflow can remain `active` after server/session facts have already advanced via another route.
- F12: formal capture controller can outlive Workbench route visibility; navigation safety is incomplete.
- F13: calibration surface lacks a universal End Interview action after formal recording has started.
- F14: calibration initialization/failure can become a completion deadlock.
- F15: initial suggestion load failure has no explicit recovery action.
- F16: generic `FORBIDDEN` copy falsely claims assignment loss for unrelated 403 causes.
- F17: auth-loss recovery is inconsistent across Home/New/Preparation/Review/Workbench.
- F18: one project/session load failure can collapse the whole Home workspace.
- F19: “已恢复旧流程” may be shown from ordinary in-page updates rather than true remount/recovery.
- F20: Home can expose New Interview while another formal/unresolved interview still requires handling.

## Architecture boundaries

- P1-P6 responsibilities and T0-T27 semantics remain unchanged.
- No P2-D activation, real embedding activation, production model/provider/region/budget decisions, evaluation T26-T27, or deployment work.
- No Director prompt semantics change except that UI/error-flow wiring must correctly expose existing Director outcomes.
- No weakening of consent, assignment, evidence, audio integrity, capture generation, or idempotency rules.
- No private elder data or secrets in tests/evidence.
- Do not solve these defects by wiping the Owner database/IndexedDB, hiding server inconsistencies, or adding broad retry/timeouts.
- No full UI redesign.

## Completion definition

This pack is complete only when:

- the seven original PFC tasks plus the bounded `PFC-07A-QUERY-MODE-NAV-STATE` follow-up are `DONE` through exact-head Architect review + merge + refreshed-main CI;
- the ordinary browser flow has a deterministic route/action contract for the primary lifecycle;
- a browser E2E covers the visible chain `Home -> New/Resume -> Consent/Prepare -> Formal Recording -> Calibration/degrade -> Workbench -> End -> Save/Processing -> Review -> Home`;
- recovery checks cover refresh/back/return at the critical pre-start and active-recording boundaries;
- no current ordinary user-facing action in the audited lifecycle intentionally routes into a known placeholder/dead end;
- v1 product copy does not promise pause-then-resume.

## Governance

External/Web Architect owns this pack, Task Cards, bounded implementation
commands, effective-envelope exact-head review, and `ARCHITECT_VERDICT_V1`.
Dispatcher remains mechanical: reconcile -> execute one eligible READY transition
or valid current-task Directive -> bind canonical PR -> require exact-head CI and
effective Review Context -> wait for exact-head review -> merge only after PASS
-> verify refreshed main -> synchronize -> unlock the predefined successor.

If PFC-07 browser acceptance reveals an implementation-only production defect
inside these already Owner-authorized Product Flow Closure invariants, keep the
same canonical task and, when safe, the same PR. Architect may issue an
`ARCHITECT_DIRECTIVE_V1` that adds the necessary implementation files/tests to
the effective envelope and instructs the Worker to repair it. No follow-up task
is required. Only a real product, architecture, Accepted Contract, provider,
data-policy, cost, or other Owner-reserved ambiguity escalates to the Product
Owner. A Directive cannot change this pack's frozen product invariants or queue
topology.

Task Card `Status:` is an issuance/planning snapshot. Fresh canonical queue/state
is runtime authority. Workers implement only the base Task Card plus all applied
Directive overlays, and every Directive remains subject to exact-head CI, review,
PASS, merge, exact-main verification, and `DONE` gates.

Planning baseline: `main@39fb739a6bdc0f42406e4191c5f885b63ece69ab`.
