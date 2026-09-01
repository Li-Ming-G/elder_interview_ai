# 当前任务索引

本文件是供人快速查看的机械索引；canonical queue topology 来自本文件与正式 Task Card，`dispatcher/dispatcher-state.json` 是可重建的 last-known projection，不是唯一运行真相。GitHub durable PR/head/verdict/merge/CI facts 可以纠正 stale projection。治理模型是单 Dispatcher 顺序队列，外部 Architect 负责 PR Review。

状态只允许：`READY`、`IN_PROGRESS`、`REVIEW`、`BLOCKED`、`DEFERRED`、`DONE`。

| id | status | depends_on | task_card | worker_profile | pr | next_task |
| --- | --- | --- | --- | --- | --- | --- |
| `MEMORY-T5-T8-P2-C-RUNTIME-001` | `DONE` | A1 `dbb0cc76f582997a6a647781007648c6937a8992`; P2-B `717c5ca39e678c6f953d0430768ae715ef0feef2` | [`tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md`](tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md) | `luna-high` | `80` | `null` |
| `MEMORY-T5-T8-P2-D-PROVIDER-001` | `DEFERRED` | P2-C complete plus owner provider/data decisions | not issued | `luna-high` | `null` | `null` |
| `P3-RETRIEVAL-V1` | `DONE` | accepted P3 sequence | [`tasks/SPEC-MEMORY-SYSTEM-V1.md`](tasks/SPEC-MEMORY-SYSTEM-V1.md) | `luna-high` | `86` | `P4G-00-STATE-SYNC` |
| `P4G-00-STATE-SYNC` | `DONE` | P3 accepted and merged | [`tasks/P4G-00-STATE-SYNC.md`](tasks/P4G-00-STATE-SYNC.md) | `luna-high` | `87` | `P4C-01` |
| `P4C-01` | `DONE` | P4G-00 merged and verified | [`tasks/P4C-01.md`](tasks/P4C-01.md) | `luna-high` | `88` | `P4C-02` |
| `P4C-02` | `DONE` | P4C-01 merged and verified | [`tasks/P4C-02.md`](tasks/P4C-02.md) | `luna-high` | `89` | `DISPATCHER-RECOVERY-001` |
| `DISPATCHER-RECOVERY-001` | `DONE` | P4C-02 merged and verified | [`tasks/DISPATCHER-RECOVERY-001.md`](tasks/DISPATCHER-RECOVERY-001.md) | `luna-high` | `90` | `P4C-03` |
| `P4C-03` | `DONE` | Dispatcher Recovery accepted/merged/main-verified | [`tasks/P4C-03.md`](tasks/P4C-03.md) | `luna-high` | `91` | `P4C-04` |
| `P4C-04` | `DONE` | P4C-03 accepted/merged/main-verified | [`tasks/P4C-04.md`](tasks/P4C-04.md) | `luna-high` | `92` | `P5E-01` |
| `P5E-01` | `DONE` | P4C-04 merged and verified | [`tasks/P5E-01.md`](tasks/P5E-01.md) | `luna-high` | `93` | `P5E-02` |
| `P5E-02` | `DONE` | P5E-01 merged and verified | [`tasks/P5E-02.md`](tasks/P5E-02.md) | `luna-high` | `94` | `P5E-03` |
| `P5E-03` | `DONE` | P5E-02 merged and verified | [`tasks/P5E-03.md`](tasks/P5E-03.md) | `luna-high` | `95` | `P5C-01` |
| `P5C-01` | `DONE` | P5E-03 merged and verified | [`tasks/P5C-01.md`](tasks/P5C-01.md) | `luna-high` | `96` | `P5C-02` |
| `P5C-02` | `DONE` | P5C-01 merged and verified | [`tasks/P5C-02.md`](tasks/P5C-02.md) | `luna-high` | `97` | `P6R-01` |
| `P6R-01` | `DONE` | P5 complete through P5C-02; Owner-issued P6 Development Pack | [`tasks/P6R-01.md`](tasks/P6R-01.md) | `luna-high` | `99` | `P6R-02` |
| `P6R-02` | `DONE` | P6R-01 external PASS + merge + main verification | [`tasks/P6R-02.md`](tasks/P6R-02.md) | `luna-high` | `100` | `P6R-03` |
| `P6R-03` | `DONE` | P6R-02 external PASS + merge + main verification | [`tasks/P6R-03.md`](tasks/P6R-03.md) | `luna-high` | `101` | `P6R-04` |
| `P6R-04` | `DONE` | P6R-03 external PASS + merge + main verification | [`tasks/P6R-04.md`](tasks/P6R-04.md) | `luna-high` | `102` | `P6R-05` |
| `P6R-05` | `DONE` | P6R-04 merged and verified | [`tasks/P6R-05.md`](tasks/P6R-05.md) | `luna-high` | `103` | `null` |
| `CPA-01` | `DONE` | P6R-05 DONE; Owner-issued Checkpoint A pack; accepted Checkpoint A contract | [`tasks/CPA-01.md`](tasks/CPA-01.md) | `luna-high` | `105` | `CPA-02` |
| `CPA-02` | `DONE` | CPA-01 external PASS + merge + main verification | [`tasks/CPA-02.md`](tasks/CPA-02.md) | `luna-high` | `106` | `CPA-03` |
| `CPA-03` | `DONE` | CPA-02 merged and verified | [`tasks/CPA-03.md`](tasks/CPA-03.md) | `luna-high` | `107` | `CPA-04` |
| `CPA-04` | `DONE` | Architect PASS; merged PR #109 | [`tasks/CPA-04.md`](tasks/CPA-04.md) | `luna-high` | `109` | `CPA-05` |
| `CPA-05` | `DONE` | Architect PASS; merged PR #111; main verified | [`tasks/CPA-05.md`](tasks/CPA-05.md) | `luna-high` | `111` | `null` |
| `REAL-IDENTITY-01` | `DONE` | CPA-05 DONE; Owner-issued Real Flow Cleanup Pack | [`tasks/REAL-IDENTITY-01.md`](tasks/REAL-IDENTITY-01.md) | `luna-high` | `112` | `REAL-RUNTIME-02` |
| `REAL-RUNTIME-02` | `DONE` | REAL-IDENTITY-01 DONE | [`tasks/REAL-RUNTIME-02.md`](tasks/REAL-RUNTIME-02.md) | `luna-high` | `113` | `null` |
| `LOCAL-DB-PORT-01` | `DONE` | REAL-RUNTIME-02; local DB maintenance pack | [`tasks/LOCAL-DB-PORT-01.md`](tasks/LOCAL-DB-PORT-01.md) | `luna-high` | `115` | `null` |
| `FIRST-INTERVIEW-START-01` | `DONE` | LOCAL-DB-PORT-01 | [`tasks/FIRST-INTERVIEW-START-01.md`](tasks/FIRST-INTERVIEW-START-01.md) | `luna-high` | `116` | `DISPATCHER-SAME-TASK-REPAIR-01` |
| `DISPATCHER-SAME-TASK-REPAIR-01` | `DONE` | FIRST-INTERVIEW-START-01 | [`tasks/DISPATCHER-SAME-TASK-REPAIR-01.md`](tasks/DISPATCHER-SAME-TASK-REPAIR-01.md) | `luna-high` | `117` | `CKPT-A-LOCAL-START-01` |
| `CKPT-A-LOCAL-START-01` | `DONE` | DISPATCHER-SAME-TASK-REPAIR-01 | [`tasks/CKPT-A-LOCAL-START-01.md`](tasks/CKPT-A-LOCAL-START-01.md) | `luna-high` | `118` | `DISPATCHER-STALE-DONE-RECONCILIATION-01` |
| `DISPATCHER-STALE-DONE-RECONCILIATION-01` | `DONE` | CKPT-A-LOCAL-START-01 | [`tasks/DISPATCHER-STALE-DONE-RECONCILIATION-01.md`](tasks/DISPATCHER-STALE-DONE-RECONCILIATION-01.md) | `luna-high` | `121` | `FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01` |
| `FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01` | `DONE` | DISPATCHER-STALE-DONE-RECONCILIATION-01 | [`tasks/FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01.md`](tasks/FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01.md) | `luna-high` | `122` | `CKPT-A-LEGACY-PREPARE-BRIDGE-01` |
| `CKPT-A-LEGACY-PREPARE-BRIDGE-01` | `DONE` | FIRST-INTERVIEW-LEGACY-DRAFT-RECOVERY-01 | [`tasks/CKPT-A-LEGACY-PREPARE-BRIDGE-01.md`](tasks/CKPT-A-LEGACY-PREPARE-BRIDGE-01.md) | `luna-high` | `123` | `null` |
| `CKPT-A-WEB-CWD-01` | `DONE` | CKPT-A-LEGACY-PREPARE-BRIDGE-01 | [`tasks/CKPT-A-WEB-CWD-01.md`](tasks/CKPT-A-WEB-CWD-01.md) | `luna-high` | `125` | `null` |
| `CKPT-A-FIRST-CAPTURE-GATE-01` | `DONE` | CKPT-A-WEB-CWD-01; PR #126 merged/main verified | [`tasks/CKPT-A-FIRST-CAPTURE-GATE-01.md`](tasks/CKPT-A-FIRST-CAPTURE-GATE-01.md) | `luna-high` | `126` | `null` |
| `PFC-01-NEW-INTENT-TRUTH` | `IN_PROGRESS` | PR #127 at exact head `6b38d1272f46ef565f3317943455c28926fd164b`; current-head Architect REQUEST_CHANGES P1 requires same-task/same-PR repair so Home exposes only truthful non-destructive actions while recovery exists or authority is unavailable | [`tasks/PFC-01-NEW-INTENT-TRUTH.md`](tasks/PFC-01-NEW-INTENT-TRUTH.md) | `luna-high` | `127` | `PFC-02-PRESTART-DISCARD` |
| `PFC-02-PRESTART-DISCARD` | `DEFERRED` | `PFC-01-NEW-INTENT-TRUTH` | [`tasks/PFC-02-PRESTART-DISCARD.md`](tasks/PFC-02-PRESTART-DISCARD.md) | `luna-high` | `null` | `PFC-03-RECORDING-NAV-SAFETY` |
| `PFC-03-RECORDING-NAV-SAFETY` | `DEFERRED` | `PFC-02-PRESTART-DISCARD` | [`tasks/PFC-03-RECORDING-NAV-SAFETY.md`](tasks/PFC-03-RECORDING-NAV-SAFETY.md) | `luna-high` | `null` | `PFC-04-SUGGESTION-RECOVERY` |
| `PFC-04-SUGGESTION-RECOVERY` | `DEFERRED` | `PFC-03-RECORDING-NAV-SAFETY` | [`tasks/PFC-04-SUGGESTION-RECOVERY.md`](tasks/PFC-04-SUGGESTION-RECOVERY.md) | `luna-high` | `null` | `PFC-05-ROUTE-ACTION-CLOSURE` |
| `PFC-05-ROUTE-ACTION-CLOSURE` | `DEFERRED` | `PFC-04-SUGGESTION-RECOVERY` | [`tasks/PFC-05-ROUTE-ACTION-CLOSURE.md`](tasks/PFC-05-ROUTE-ACTION-CLOSURE.md) | `luna-high` | `null` | `PFC-06-ERROR-AUTH-RESILIENCE` |
| `PFC-06-ERROR-AUTH-RESILIENCE` | `DEFERRED` | `PFC-05-ROUTE-ACTION-CLOSURE` | [`tasks/PFC-06-ERROR-AUTH-RESILIENCE.md`](tasks/PFC-06-ERROR-AUTH-RESILIENCE.md) | `luna-high` | `null` | `PFC-07-FULL-FLOW-E2E` |
| `PFC-07-FULL-FLOW-E2E` | `DEFERRED` | `PFC-06-ERROR-AUTH-RESILIENCE` | [`tasks/PFC-07-FULL-FLOW-E2E.md`](tasks/PFC-07-FULL-FLOW-E2E.md) | `luna-high` | `null` | `null` |

## Current phase

`PRODUCT-FLOW-CLOSURE-01` is Owner-authorized and active. The first goal is a complete ordinary first-interview chain rather than deeper feature expansion or visual polish.

Current active task: `PFC-01-NEW-INTENT-TRUTH` (`IN_PROGRESS`, PR #127). Current-head Architect REQUEST_CHANGES requires bounded same-PR repair of Home action truth while preserving the recovery handle and PFC-02 boundary.

The Product Owner approved all audited F1-F20 fixes and froze v1 product behavior: **no deliberate pause-then-resume feature.** Existing interruption recovery remains a safety mechanism only.

Only `PFC-01-NEW-INTENT-TRUTH` is eligible now. `PFC-02` through `PFC-07` remain `DEFERRED` until mechanically unlocked by predecessor DONE.

## Frozen product-flow boundaries

- server facts outrank IndexedDB recovery state;
- visible action label must match actual behavior;
- formal recording cannot be silently left behind by route/history navigation;
- safe End Interview is always available after formal recording starts, including calibration;
- calibration failure cannot fabricate speaker identity or hard-lock the session;
- AI suggestion failure never stops recording and gets a visible retry path;
- no known placeholder/dead route may remain behind an ordinary visible action in the audited lifecycle;
- no deliberate pause/resume product feature;
- P1-P6 semantics, provider bindings, evidence authority and consent/capture safety remain unchanged.

## Maintenance / governance

- historical `MEMORY-T5-T8-P2-C-RUNTIME-001` remains `DONE` and must not become active from stale projection;
- GitHub durable PR/head/verdict/merge/CI facts override stale local projections;
- Dispatcher must scan the full freshly fetched canonical queue after reconciliation;
- Dispatcher never invents Product Flow tasks or product behavior;
- external Architect owns exact-head review and verdict;
- Worker implements only the current Task Card and canonical PR.
