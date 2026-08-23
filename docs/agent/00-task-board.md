# 当前任务索引

本文件是供人快速查看的机械索引；canonical queue topology 来自本文件与正式 Task Card，`dispatcher/dispatcher-state.json` 是可重建的 last-known projection，不是唯一运行真相。GitHub durable PR/head/verdict/merge/CI facts 可以纠正 stale projection。治理模型是单 Dispatcher 顺序队列，外部 Architect 负责 PR Review。

状态只允许：`READY`、`IN_PROGRESS`、`REVIEW`、`BLOCKED`、`DEFERRED`、`DONE`。

| id | status | depends_on | task_card | worker_profile | pr | next_task |
| --- | --- | --- | --- | --- | --- | --- |
| `MEMORY-T5-T8-P2-C-RUNTIME-001` | `DONE` | A1 `dbb0cc76f582997a6a647781007648c6937a8992`; P2-B `717c5ca39e678c6f953d0430768ae715ef0feef2` | [`tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md`](tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md) | `luna-high` | `80` | `null` |
| `MEMORY-T5-T8-P2-D-PROVIDER-001` | `DEFERRED` | P2-C complete plus owner provider/data decisions | not issued | `luna-high` | `null` | `null` |
| `P3-RETRIEVAL-V1` | `DONE` | P3 accepted sequence; final main `18c4320f417fbfa90e41924ac7b049ea72b82379` | accepted P3R-01 → P3R-05 sequence | `luna-high` | `86` | `P4G-00-STATE-SYNC` |
| `P4G-00-STATE-SYNC` | `DONE` | P3 accepted and merged | [`tasks/P4G-00-STATE-SYNC.md`](tasks/P4G-00-STATE-SYNC.md) | `luna-high` | `87` | `P4C-01` |
| `P4C-01` | `DONE` | P4G-00 merged and verified | [`tasks/P4C-01.md`](tasks/P4C-01.md) | `luna-high` | `88` | `P4C-02` |
| `P4C-02` | `DONE` | P4C-01 merged and verified | [`tasks/P4C-02.md`](tasks/P4C-02.md) | `luna-high` | `89` | `DISPATCHER-RECOVERY-001` |
| `DISPATCHER-RECOVERY-001` | `DONE` | P4C-02 merged and verified | [`tasks/DISPATCHER-RECOVERY-001.md`](tasks/DISPATCHER-RECOVERY-001.md) | `luna-high` | `90` | `P4C-03` |
| `P4C-03` | `DONE` | Dispatcher Recovery accepted/merged/main-verified | [`tasks/P4C-03.md`](tasks/P4C-03.md) | `luna-high` | `91` | `P4C-04` |
| `P4C-04` | `DONE` | P4C-03 accepted/merged/main-verified | [`tasks/P4C-04.md`](tasks/P4C-04.md) | `luna-high` | `92` | `P5E-01` |
| `P5E-01` | `READY` | P4C-04 accepted/merged/main-verified | [`tasks/P5E-01.md`](tasks/P5E-01.md) | `luna-high` | `null` | `P5E-02` |
| `P5E-02` | `DEFERRED` | P5E-01 external PASS + merge + main verification | [`tasks/P5E-02.md`](tasks/P5E-02.md) | `luna-high` | `null` | `P5E-03` |
| `P5E-03` | `DEFERRED` | P5E-02 external PASS + merge + main verification | [`tasks/P5E-03.md`](tasks/P5E-03.md) | `luna-high` | `null` | `P5C-01` |
| `P5C-01` | `DEFERRED` | P5E-03 external PASS + merge + main verification | [`tasks/P5C-01.md`](tasks/P5C-01.md) | `luna-high` | `null` | `P5C-02` |
| `P5C-02` | `DEFERRED` | P5C-01 external PASS + merge + main verification | [`tasks/P5C-02.md`](tasks/P5C-02.md) | `luna-high` | `null` | `null` |

## Current phase

P4 / T11–T12 is closed. Durable GitHub facts record PR #87–#92 merged; P4C-03 final accepted head was `655f08cb72561ad6930b7acb662a12deaac6e87f` and P4C-04 final accepted head was `ec7660e05690618780ac00af053a6610666d02d7`, with final P4 consumer merge `8b1195d185bc07622c446bdd9023ab1cf6a6fcb0`.

The active development stage is P5 / T13–T17:

`P5E-01 → P5E-02 → P5E-03 → P5C-01 → P5C-02`.

Only `P5E-01` is READY. Dispatcher may unlock exactly one predefined successor only after current external Architect PASS, merge, successful main verification and refreshed-main reconciliation.

## P5 stage intent

- P5E-01: freeze provider-neutral Evidence Drill-down V1 contract.
- P5E-02: implement bounded read-only `get_memory_evidence` and limited `search_transcript` tools.
- P5E-03: integrate zero-or-one evidence round at the Director boundary; tool failure is SYSTEM_ERROR and no loop is permitted.
- P5C-01: freeze Episode/Fact/Boundary gate and non-destructive correction contract.
- P5C-02: implement the accepted gate/correction behavior on existing MemoryClaim/MemoryResolution authority.

Real provider/model/tokenizer/embedding choices, P4 production numeric budget, P2-D, T25 prompt activation, real data and public deployment remain deferred.

## Maintenance

- GitHub durable facts override stale projection/status fields.
- Update current-state files mechanically after accepted stage transitions; do not rewrite archives.
- A normal Worker hands off through Task Card + PR and stops at REVIEW.
- Ordinary Implementation Tasks use external Architect review by default; no internal Reviewer/iteration-coach unless explicitly escalated.
- Dispatcher never creates Task Cards or invents next tasks.
