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
| `P5E-01` | `DONE` | P4C-04 accepted/merged/main-verified | [`tasks/P5E-01.md`](tasks/P5E-01.md) | `luna-high` | `93` | `P5E-02` |
| `P5E-02` | `DONE` | P5E-01 accepted/merged/main-verified | [`tasks/P5E-02.md`](tasks/P5E-02.md) | `luna-high` | `94` | `P5E-03` |
| `P5E-03` | `DONE` | P5E-02 accepted/merged/main-verified | [`tasks/P5E-03.md`](tasks/P5E-03.md) | `luna-high` | `95` | `P5C-01` |
| `P5C-01` | `DONE` | P5E-03 accepted/merged/main-verified | [`tasks/P5C-01.md`](tasks/P5C-01.md) | `luna-high` | `96` | `P5C-02` |
| `P5C-02` | `DONE` | P5C-01 accepted/merged/main-verified | [`tasks/P5C-02.md`](tasks/P5C-02.md) | `luna-high` | `97` | `P6R-01` |
| `P6R-01` | `DONE` | P5 complete through P5C-02; Owner-issued P6 Development Pack | [`tasks/P6R-01.md`](tasks/P6R-01.md) | `luna-high` | `99` | `P6R-02` |
| `P6R-02` | `READY` | P6R-01 external PASS + merge + main verification | [`tasks/P6R-02.md`](tasks/P6R-02.md) | `luna-high` | `null` | `P6R-03` |
| `P6R-03` | `DEFERRED` | P6R-02 external PASS + merge + main verification | [`tasks/P6R-03.md`](tasks/P6R-03.md) | `luna-high` | `null` | `P6R-04` |
| `P6R-04` | `DEFERRED` | P6R-03 external PASS + merge + main verification | [`tasks/P6R-04.md`](tasks/P6R-04.md) | `luna-high` | `null` | `P6R-05` |
| `P6R-05` | `DEFERRED` | P6R-04 external PASS + merge + main verification | [`tasks/P6R-05.md`](tasks/P6R-05.md) | `luna-high` | `null` | `null` |

## Current phase

P5 / T13–T17 is closed through PR #97. P5C-02 accepted head is `888d029b08e5330f4c68dc484cf42d487e16ecd6`, merge/main is `7cbd5d077352ed9b6c313207788c4d1ec6e8ac36`, and main CI run `32677630940` succeeded.

The active development stage is now P6 Runtime / T18–T24:

`P6R-01 → P6R-02 → P6R-03 → P6R-04 → P6R-05`.

Only `P6R-02` is READY. Dispatcher may unlock exactly one predefined successor only after current external Architect `PASS`, merge, successful main verification and refreshed-main reconciliation.

## P6 stage intent

- P6R-01: freeze provider-neutral Runtime Orchestration V1 contract for trigger/manual-next/fence/deadline/error/background isolation.
- P6R-02: implement finalized transcript buffering and automatic/manual generation gate.
- P6R-03: enforce generation/publication authority so stale/late work cannot overwrite newer state.
- P6R-04: enforce deadline/error semantics and isolate P2/background work from the live interview lane.
- P6R-05: end-to-end synthetic integration and Decision Trace closeout for T18–T24.

T25 Prompt, T26–T27 Evaluation, real provider/model/tokenizer/embedding choices, P4 production numeric budget, P2-D, real data and public deployment remain deferred.

## Maintenance

- GitHub durable facts override stale projection/status fields.
- Dispatcher must fresh-read GitHub/main or refreshed `origin/main`; an unpushed local worktree is never canonical state.
- Stage-end sync is complete only after commit/push and a fresh durable reread verifies the three current-state files.
- A normal Worker hands off through Task Card + PR and stops at REVIEW.
- Ordinary Implementation Tasks use external Architect review by default; no internal Reviewer/iteration-coach unless explicitly escalated.
- Dispatcher never creates Task Cards or invents next tasks.
