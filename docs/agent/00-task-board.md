# 当前任务索引

本文件是供人快速查看的机械索引；canonical queue topology 来自本文件与正式 Task Card，`dispatcher/dispatcher-state.json` 是可重建的 last-known projection，不是唯一运行真相。GitHub durable PR/head/Directive ACK/verdict/merge/CI facts 可以纠正 stale projection。治理模型是单 Dispatcher 顺序队列：Product Owner 保留产品与架构决策权，External/Web Architect 通过 issue #135 上的 `ARCHITECT_DIRECTIVE_V1` 获得受限 implementation execution authority，并继续负责 PR Review。

Task Card 顶部 `Status:` 是 issuance/planning snapshot，不是 runtime state；本表与 freshly reconciled canonical state 的运行状态优先。Worker 的有效执行范围是 base Task Card 加当前任务所有已成功 ACK 的 Directive additive overlays。

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
| `P6R-04` | `DONE` | P6R-03 accepted/merged/main-verified | [`tasks/P6R-04.md`](tasks/P6R-04.md) | `luna-high` | `102` | `P6R-05` |
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
| `PFC-01-NEW-INTENT-TRUTH` | `DONE` | Architect PASS; PR #127 merged as `f0fe36a141b3d3ab56cdf44ac1a3b3974d964ca6`; exact-current-main CI run `33491698862` succeeded | [`tasks/PFC-01-NEW-INTENT-TRUTH.md`](tasks/PFC-01-NEW-INTENT-TRUTH.md) | `luna-high` | `127` | `PFC-02-PRESTART-DISCARD` |
| `PFC-02-PRESTART-DISCARD` | `DONE` | Architect PASS; PR #128 merged as `c5c7141f13def9f0f37b4bf269f0e49dfc35fdbf`; exact-current-main CI run `33519802779` succeeded | [`tasks/PFC-02-PRESTART-DISCARD.md`](tasks/PFC-02-PRESTART-DISCARD.md) | `luna-high` | `128` | `PFC-03-RECORDING-NAV-SAFETY` |
| `PFC-03-RECORDING-NAV-SAFETY` | `DONE` | Architect PASS; PR #129 merged as `ee01cf0c42d7041bc7d4524c21a874eb51245787`; exact-current-main CI run `33534495664` succeeded and cleared `MAIN_VERIFY_FAILED` | [`tasks/PFC-03-RECORDING-NAV-SAFETY.md`](tasks/PFC-03-RECORDING-NAV-SAFETY.md) | `luna-high` | `129` | `PFC-04-SUGGESTION-RECOVERY` |
| `PFC-04-SUGGESTION-RECOVERY` | `DONE` | Architect PASS; PR #130 merged as `7c62e4a2d39af462a8c6c2d5d5da6d2bcb800132`; exact-current-main CI run `33545438599` succeeded | [`tasks/PFC-04-SUGGESTION-RECOVERY.md`](tasks/PFC-04-SUGGESTION-RECOVERY.md) | `luna-high` | `130` | `PFC-05-ROUTE-ACTION-CLOSURE` |
| `PFC-05-ROUTE-ACTION-CLOSURE` | `DONE` | Architect PASS; PR #131 exact head `7d3ac2471a766a8eead29ee53aa8a2e4c740852c` merged as `ec1ca9a9a752a2049e1b70bb8f716eb920ac3e1a`; exact-current-main CI run `33580001375` succeeded | [`tasks/PFC-05-ROUTE-ACTION-CLOSURE.md`](tasks/PFC-05-ROUTE-ACTION-CLOSURE.md) | `luna-high` | `131` | `PFC-06-ERROR-AUTH-RESILIENCE` |
| `PFC-06-ERROR-AUTH-RESILIENCE` | `DONE` | PR #132 exact Architect-reviewed PASS head `899b112bdde58a872c2537a132264170a7884f95` merged as `48f5130a097c7aebbfe46d15ace36b41fd1fe272`; exact-current-main CI run `33595083657` succeeded | [`tasks/PFC-06-ERROR-AUTH-RESILIENCE.md`](tasks/PFC-06-ERROR-AUTH-RESILIENCE.md) | `luna-high` | `132` | `PFC-07A-QUERY-MODE-NAV-STATE` |
| `PFC-07A-QUERY-MODE-NAV-STATE` | `DONE` | PFC-06 DONE; canonical PR #134 exact Architect-reviewed PASS head `e2549929f4d1d0ccdc2996a2390c5159ebb342e9` merged as `6b0dbd8f73c6bca44cf55f68a7ebd3f324eb20f2`; exact-current-main CI run `33654978336` succeeded | [`tasks/PFC-07A-QUERY-MODE-NAV-STATE.md`](tasks/PFC-07A-QUERY-MODE-NAV-STATE.md) | `luna-high` | `134` | `PFC-07-FULL-FLOW-E2E` |
| `PFC-07-FULL-FLOW-E2E` | `DONE` | PR #133 exact Architect-reviewed PASS head `3aeb06975a60c8987200b7eaf03b9cce6fd1ad6c` merged as `a7a49e69dd15d6e4fb3f41b4e0f5f531c3f388ed`; exact-current-main CI run `33794204208` succeeded | [`tasks/PFC-07-FULL-FLOW-E2E.md`](tasks/PFC-07-FULL-FLOW-E2E.md) | `luna-high` | `133` | `null` |
| `RIU-01-DIRECTOR-LANDING` | `IN_PROGRESS` | Product Flow Closure pack closed; deterministic Directive Worker launched from durable seed | [`tasks/RIU-01-DIRECTOR-LANDING.md`](tasks/RIU-01-DIRECTOR-LANDING.md) | `luna-high` | `null` | `RIU-02-CALIBRATION-USABLE` |
| `RIU-02-CALIBRATION-USABLE` | `DEFERRED` | `RIU-01-DIRECTOR-LANDING` DONE | [`tasks/RIU-02-CALIBRATION-USABLE.md`](tasks/RIU-02-CALIBRATION-USABLE.md) | `luna-high` | `null` | `RIU-03-AI-STATUS-CONTRACT` |
| `RIU-03-AI-STATUS-CONTRACT` | `DEFERRED` | `RIU-02-CALIBRATION-USABLE` DONE | [`tasks/RIU-03-AI-STATUS-CONTRACT.md`](tasks/RIU-03-AI-STATUS-CONTRACT.md) | `luna-high` | `null` | `RIU-04-AI-STATUS-UI` |
| `RIU-04-AI-STATUS-UI` | `DEFERRED` | `RIU-03-AI-STATUS-CONTRACT` DONE | [`tasks/RIU-04-AI-STATUS-UI.md`](tasks/RIU-04-AI-STATUS-UI.md) | `luna-high` | `null` | `RIU-05-REPO-HEALTH` |
| `RIU-05-REPO-HEALTH` | `DEFERRED` | `RIU-04-AI-STATUS-UI` DONE | [`tasks/RIU-05-REPO-HEALTH.md`](tasks/RIU-05-REPO-HEALTH.md) | `luna-high` | `null` | `null` |

## Current phase

`REAL-INTERVIEW-USABILITY-01` is Product Owner-authorized and is now the canonical next Development Pack after the closed Product Flow Closure sequence.

Canonical queue:

```text
RIU-01-DIRECTOR-LANDING          [IN_PROGRESS]
  -> RIU-02-CALIBRATION-USABLE   [DEFERRED]
  -> RIU-03-AI-STATUS-CONTRACT   [DEFERRED]
  -> RIU-04-AI-STATUS-UI         [DEFERRED]
  -> RIU-05-REPO-HEALTH          [DEFERRED]
  -> null
```

`RIU-01-DIRECTOR-LANDING` is formally issued but blocked because its declared Accepted Contract, `docs/contracts/checkpoint-a-configurable-director-v2.md`, is not yet durable in GitHub. The Product Owner reported that this contract and the already-implemented Configurable Director V2 change set currently exist only in a local working tree. The blocker must not be cleared by inventing or reconstructing Accepted Contract text. Once the exact accepted artifact is durably available, the same task may resume under the existing Task Card and no new task is required.

## Frozen product-flow boundaries

- server facts outrank IndexedDB recovery state;
- visible action label must match actual behavior;
- formal recording cannot be silently left behind by route/history navigation;
- safe End Interview is always available after formal recording starts, including calibration;
- calibration failure cannot fabricate speaker identity or hard-lock the session;
- AI suggestion failure never stops recording and gets a visible retry path;
- no known placeholder/dead route may remain behind an ordinary visible action in the audited lifecycle;
- no deliberate pause/resume product feature;
- P1-P6 semantics, evidence authority and consent/capture safety remain unchanged.

## Maintenance / governance

- historical `MEMORY-T5-T8-P2-C-RUNTIME-001` remains `DONE` and must not become active from stale projection;
- GitHub durable PR/head/verdict/merge/CI facts override stale local projections;
- Dispatcher must scan the full freshly fetched canonical queue after reconciliation;
- Dispatcher never invents tasks, product behavior, Accepted Contract contents, or missing local implementation artifacts;
- External Architect owns bounded implementation commands, effective-envelope exact-head review, and verdict;
- Worker implements only the base Task Card plus all applied Directive overlays on the canonical task/PR;
- no Directive may bypass CI/review/PASS/merge/exact-main verification or change Owner-frozen decisions, Accepted Contracts, architecture boundaries, task identity, or queue topology.
