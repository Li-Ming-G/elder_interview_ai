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
| `P5E-02` | `DONE` | P5E-01 merged and verified | [`tasks/P5E-02.md`](tasks/P5E-02.md) | `luna-high` | `94` | `P5E-03` |
| `P5E-03` | `DONE` | P5E-02 merged and verified | [`tasks/P5E-03.md`](tasks/P5E-03.md) | `luna-high` | `95` | `P5C-01` |
| `P5C-01` | `DONE` | P5E-03 merged and verified | [`tasks/P5C-01.md`](tasks/P5C-01.md) | `luna-high` | `96` | `P5C-02` |
| `P5C-02` | `DONE` | P5C-01 merged and verified | [`tasks/P5C-02.md`](tasks/P5C-02.md) | `luna-high` | `97` | `P6R-01` |
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
| `REAL-RUNTIME-02` | `DONE` | Architect PASS at `c57d1172e65d7944137dd83be330e49eb68ceaf5`; accepted merge `195a0b95a7972e9cc38b34adf3bb07520373ed45` is in refreshed main `684f32b558b00ef48d4785315e1d230bc1be1c40`; exact-main CI run `32914392387` attempt 2 SUCCESS | [`tasks/REAL-RUNTIME-02.md`](tasks/REAL-RUNTIME-02.md) | `luna-high` | `113` | `null` |
| `LOCAL-DB-PORT-01` | `DONE` | Architect PASS; merged PR #115 at `6b0756d1e2592224c45d9c7317e1bbf220dccde3`; accepted merge `c4109ac56a2e3d8a955111bc7952c681dba500de` is in refreshed main `f77a00da1bc39aba0473d48275e6b735fc6d914e`; exact-main CI run `33053415020` SUCCESS | [`tasks/LOCAL-DB-PORT-01.md`](tasks/LOCAL-DB-PORT-01.md) | `luna-high` | `115` | `null` |
| `FIRST-INTERVIEW-START-01` | `DONE` | `LOCAL-DB-PORT-01`; accepted head `c218087b8189e12b30a425011571edfcd74ad59e`; merged `2faf0179d97d1a40378e76f0488d2fe9c3db2f81`; exact-main CI `verify` SUCCESS | [`tasks/FIRST-INTERVIEW-START-01.md`](tasks/FIRST-INTERVIEW-START-01.md) | `luna-high` | `116` | `DISPATCHER-SAME-TASK-REPAIR-01` |
| `DISPATCHER-SAME-TASK-REPAIR-01` | `READY` | `FIRST-INTERVIEW-START-01`; Owner-authorized [`tasks/DISPATCHER-SAME-TASK-REPAIR-PACK.md`](tasks/DISPATCHER-SAME-TASK-REPAIR-PACK.md) | [`tasks/DISPATCHER-SAME-TASK-REPAIR-01.md`](tasks/DISPATCHER-SAME-TASK-REPAIR-01.md) | `luna-high` | `null` | `CKPT-A-LOCAL-START-01` |
| `CKPT-A-LOCAL-START-01` | `DEFERRED` | `DISPATCHER-SAME-TASK-REPAIR-01`; Owner-authorized [`tasks/CKPT-A-LOCAL-START-REPAIR-PACK.md`](tasks/CKPT-A-LOCAL-START-REPAIR-PACK.md); planning baseline `main@0cc2bf6e97da4c9e751d705da46d4ddb52ba8d7e` | [`tasks/CKPT-A-LOCAL-START-01.md`](tasks/CKPT-A-LOCAL-START-01.md) | `luna-high` | `null` | `null` |

## Current phase

Owner Checkpoint A, Real-Flow Cleanup and FIRST-INTERVIEW-START-01 are complete. Local DB Port Maintenance is complete through `LOCAL-DB-PORT-01` / PR #115.

Current active task:

`CKPT-A-LOCAL-START-01` / no PR yet.

`FIRST-INTERVIEW-START-01` is complete: Architect PASS was recorded for exact head `c218087b8189e12b30a425011571edfcd74ad59e`, PR #116 was merged at `2faf0179d97d1a40378e76f0488d2fe9c3db2f81`, and refreshed-main CI `verify` succeeded.

Preloaded successors:

1. `DISPATCHER-SAME-TASK-REPAIR-01` is `DONE` after its Architect PASS, merge, refreshed-main CI verification and completion.
2. `CKPT-A-LOCAL-START-01` is now `READY` after `DISPATCHER-SAME-TASK-REPAIR-01` was likewise fully `DONE`.

The first successor hardens same-task/same-PR repair liveness. The second removes the remaining Owner-side Checkpoint A Windows startup workaround by safely migrating legacy ignored `.env.local` DB ports and repairing the native Windows launcher, while preserving the standard `15432/15433` repository DB mapping.

## Frozen boundaries

- first-interview bugfix semantics remain exactly as defined by `FIRST-INTERVIEW-START-01`;
- `DISPATCHER-SAME-TASK-REPAIR-01` changes governance only and no product/runtime behavior;
- `CKPT-A-LOCAL-START-01` changes local startup tooling/runbook only and no P1-P6/T0-T27 or product semantics;
- P1-P6/T0-T27, OpenRouter/Ox, Tencent ASR, memory/evidence, scoring/evaluation and production provider/model/data decisions remain unchanged;
- `CKPT-A-LOCAL-START-01.next_task = null`.

Open PRs #25, #43, #45, #62 and #110 remain outside these tasks.

## Maintenance

- GitHub durable facts override stale projection/status fields.
- Dispatcher must fresh-read GitHub/main or refreshed `origin/main`; an unpushed local worktree is never canonical state.
- A normal Worker repairs/implements only its current Task Card and canonical PR.
- External Architect owns exact-head review and verdict.
- Dispatcher never creates Task Cards or invents next tasks.
