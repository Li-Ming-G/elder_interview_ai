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
| `P6R-02` | `DONE` | P6R-01 external PASS + merge + main verification | [`tasks/P6R-02.md`](tasks/P6R-02.md) | `luna-high` | `100` | `P6R-03` |
| `P6R-03` | `DONE` | P6R-02 external PASS + merge + main verification | [`tasks/P6R-03.md`](tasks/P6R-03.md) | `luna-high` | `101` | `P6R-04` |
| `P6R-04` | `DONE` | P6R-03 external PASS + merge + main verification | [`tasks/P6R-04.md`](tasks/P6R-04.md) | `luna-high` | `102` | `P6R-05` |
| `P6R-05` | `DONE` | P6R-04 external PASS + merge + main verification | [`tasks/P6R-05.md`](tasks/P6R-05.md) | `luna-high` | `103` | `null` |
| `CPA-01` | `DONE` | P6R-05 DONE; Owner-issued Checkpoint A pack; accepted Checkpoint A contract | [`tasks/CPA-01.md`](tasks/CPA-01.md) | `luna-high` | `105` | `CPA-02` |
| `CPA-02` | `DONE` | CPA-01 external PASS + merge + main verification | [`tasks/CPA-02.md`](tasks/CPA-02.md) | `luna-high` | `106` | `CPA-03` |
| `CPA-03` | `DONE` | CPA-02 external PASS + merge + main verification | [`tasks/CPA-03.md`](tasks/CPA-03.md) | `luna-high` | `107` | `CPA-04` |
| `CPA-04` | `DONE` | Architect PASS; merged PR #109 at `db7d6f713dba6fb6d2e73483df7279e043061865`; main `28e3f89c3fa4995dd875ed1d915075e4a19efccd`; main CI SUCCESS | [`tasks/CPA-04.md`](tasks/CPA-04.md) | `luna-high` | `109` | `CPA-05` |
| `CPA-05` | `DONE` | Architect PASS; merged PR #111 at `24f741ba0cf0652db677f355d7e081cb4a41e366`; main `fc7bb87271da2c12b971cbefc1b8e78c66ef84d1`; main CI run `32850288156` SUCCESS | [`tasks/CPA-05.md`](tasks/CPA-05.md) | `luna-high` | `111` | `null` |
| `REAL-IDENTITY-01` | `DONE` | Architect PASS; merged PR #112 at `7ababe69121d060904e6b0f9e87770181a3be81b`; main `1b0529af47bb9e5f437ff9041b465daad1c30c7a`; main CI run `32871264794` SUCCESS | [`tasks/REAL-IDENTITY-01.md`](tasks/REAL-IDENTITY-01.md) | `luna-high` | `112` | `REAL-RUNTIME-02` |
| `REAL-RUNTIME-02` | `REVIEW` | Worker handoff on PR #113 at `c57d1172e65d7944137dd83be330e49eb68ceaf5`; exact-head CI verify SUCCESS | [`tasks/REAL-RUNTIME-02.md`](tasks/REAL-RUNTIME-02.md) | `luna-high` | `113` | `null` |

## Current phase

Owner Checkpoint A is complete through `CPA-05` / PR #111. The active stage is now the Product Owner-authorized Real-Flow Cleanup pack:

`REAL-IDENTITY-01 → REAL-RUNTIME-02 → null`.

`REAL-IDENTITY-01` is DONE after Architect PASS, merge, and successful main verification. `REAL-RUNTIME-02` is now in REVIEW on PR #113 for external Architect exact-head review.

## Real-Flow Cleanup intent

- `REAL-IDENTITY-01`: stop requiring the Owner to use a synthetic `.test` account for normal local login; use the existing operator-managed persisted application-user path without introducing a new auth system.
- `REAL-RUNTIME-02`: remove query-parameter harness switching from the ordinary web entry while preserving explicit automated/local engineering harness access.

P1-P6 semantics, Owner Prompt, OpenRouter/Ox, Tencent ASR, memory/evidence rules, scoring/evaluation boundaries and production provider/model/data decisions are unchanged.

Open PRs #25, #43, #45, #62 and #110 are outside this pack and must not be acted on by either task.

## Maintenance

- GitHub durable facts override stale projection/status fields.
- Dispatcher must fresh-read GitHub/main or refreshed `origin/main`; an unpushed local worktree is never canonical state.
- Stage-end sync is complete only after commit/push and a fresh durable reread verifies the three current-state files.
- A normal Worker hands off through Task Card + PR and stops at REVIEW.
- Ordinary Implementation Tasks use external Architect review by default; no internal Reviewer/iteration-coach unless explicitly escalated.
- Dispatcher never creates Task Cards or invents next tasks.
