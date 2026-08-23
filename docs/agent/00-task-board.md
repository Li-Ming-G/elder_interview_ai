# 当前任务索引

本文件是供人快速查看的机械索引；机器状态唯一来源是 [`dispatcher/dispatcher-state.json`](dispatcher/dispatcher-state.json)。治理模型是单 Dispatcher 顺序队列，外部 Architect 负责 PR Review。旧大看板的全部条目保存在 [`archive-task-board-snapshot-2026-08-22.md`](archive-task-board-snapshot-2026-08-22.md)，历史 task、handoff 与 review 保持原路径。

状态只允许：`READY`、`IN_PROGRESS`、`REVIEW`、`BLOCKED`、`DEFERRED`、`DONE`。

| id | status | depends_on | task_card | worker_profile | pr | next_task |
| --- | --- | --- | --- | --- | --- | --- |
| `MEMORY-T5-T8-P2-C-RUNTIME-001` | `DONE` | A1 `dbb0cc76f582997a6a647781007648c6937a8992`; P2-B `717c5ca39e678c6f953d0430768ae715ef0feef2` | [`tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md`](tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md) | `luna-high` | `80` | `null` |
| `MEMORY-T5-T8-P2-D-PROVIDER-001` | `DEFERRED` | P2-C complete plus owner provider/data decisions | not issued | `luna-high` | `null` | `null` |
| `P3-RETRIEVAL-V1` | `DONE` | P3 contract/substrate/indexing/retrieval/integration; final main merge `18c4320f417fbfa90e41924ac7b049ea72b82379` | accepted P3R-01 → P3R-05 sequence | `luna-high` | `86` | `P4G-00-STATE-SYNC` |
| `P4G-00-STATE-SYNC` | `REVIEW` | P2-C and P3 accepted facts; baseline `18c4320f417fbfa90e41924ac7b049ea72b82379` | [`tasks/P4G-00-STATE-SYNC.md`](tasks/P4G-00-STATE-SYNC.md) | `luna-high` | `87` | `P4C-01` |
| `P4C-01` | `DEFERRED` | P4G-00 external `PASS`; P3 complete | [`tasks/P4C-01.md`](tasks/P4C-01.md) | `luna-high` | `null` | `P4C-02` |
| `P4C-02` | `DEFERRED` | P4C-01 external `PASS` | [`tasks/P4C-02.md`](tasks/P4C-02.md) | `luna-high` | `null` | `P4C-03` |
| `P4C-03` | `DEFERRED` | P4C-02 external `PASS` | [`tasks/P4C-03.md`](tasks/P4C-03.md) | `luna-high` | `null` | `P4C-04` |
| `P4C-04` | `DEFERRED` | P4C-03 external `PASS` | [`tasks/P4C-04.md`](tasks/P4C-04.md) | `luna-high` | `null` | `null` |

## Current stop

P2-C is complete on main through the accepted PR #76–#81 sequence, with completion merge `b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`. P3 is complete through PR #82–#86, with final merge `18c4320f417fbfa90e41924ac7b049ea72b82379`. The old combined `MEMORY-T9-T12-P3-P4-001` placeholder is retired and replaced by the P4 governance gate plus the four-card sequential P4C queue.

`P4G-00-STATE-SYNC` is the current `REVIEW` gate. No successor is `READY` until its external Architect `PASS`; then and only then Dispatcher marks `P4C-01` `READY` and leaves P4C-02 through P4C-04 deferred.

## Recently accepted dependencies

- P2-A1 semantic envelope: `DONE / PASS / CONTRACT ONLY`, exact head `dbb0cc76f582997a6a647781007648c6937a8992`.
- P2-B persistence contract: `DONE / PASS / CONTRACT ONLY`, exact head `717c5ca39e678c6f953d0430768ae715ef0feef2`.
- P2-C runtime: `DONE`, completion merge `b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`.
- P3 retrieval: `DONE`, final merge `18c4320f417fbfa90e41924ac7b049ea72b82379`.

## Maintenance

- Update this index only when machine state changes.
- A normal worker hands off through its Task Card and GitHub PR; it does not create duplicate REV or handoff files.
- An ordinary Implementation Task does not start iteration-coach or an additional internal Reviewer; external Architect PR review is the default unless the Product Owner or Architect explicitly escalates.
- Requirement traceability, conflict history and other stage records are synchronized in one batch at stage end.
