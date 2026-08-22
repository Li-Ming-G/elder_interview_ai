# 当前任务索引

本文件是供人快速查看的机械索引；机器状态唯一来源是 [`dispatcher/dispatcher-state.json`](dispatcher/dispatcher-state.json)。旧大看板的全部条目保存在 [`archive-task-board-snapshot-2026-08-22.md`](archive-task-board-snapshot-2026-08-22.md)，历史 task、handoff 与 review 保持原路径。

状态只允许：`READY`、`IN_PROGRESS`、`REVIEW`、`BLOCKED`、`DEFERRED`、`DONE`。

| task_id | status | depends_on | task_card | worker_profile | review_required | next_task |
| --- | --- | --- | --- | --- | --- | --- |
| `MEMORY-T5-T8-P2-C-RUNTIME-001` | `BLOCKED` | A1 `dbb0cc76f582997a6a647781007648c6937a8992`; P2-B `717c5ca39e678c6f953d0430768ae715ef0feef2` | [`tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md`](tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md) | `luna-high` | `true` | `null` |
| `MEMORY-T5-T8-P2-D-PROVIDER-001` | `DEFERRED` | P2-C external `PASS` plus owner provider/data decisions | not issued | `luna-high` | `true` | `null` |
| `MEMORY-T9-T12-P3-P4-001` | `DEFERRED` | separate accepted Development Pack | not issued | `luna-high` | `true` | `null` |

## Current stop

`MEMORY-T5-T8-P2-C-RUNTIME-001` is `BLOCKED / GOVERNANCE_HANDOFF_RECONCILIATION_REQUIRED`. Four implementation/documentation candidate heads exist and must not be integrated: database `87ee56c6ceb1aee7897d1d62a2b18703c304c2e3`, orchestration `97f647d607b020ef524014cfdab3e7b13eccd098`, trace `5ada42209e5ab245e1b799456694a1cac9ca7ab9`, integration docs `419f7bfc447b4b605c87e6c173b09c304cba5a41`. The formal old combination verdict is `FAIL P0=0/P1=6/P2=1`.

There is no `READY` task. Dispatcher must stop.

## Recently accepted dependencies

- P2-A1 semantic envelope: `DONE / PASS / CONTRACT ONLY`, exact head `dbb0cc76f582997a6a647781007648c6937a8992`.
- P2-B persistence contract: `DONE / PASS / CONTRACT ONLY`, exact head `717c5ca39e678c6f953d0430768ae715ef0feef2`.

## Maintenance

- Update this index only when machine state changes.
- A normal worker hands off through its Task Card and GitHub PR; it does not create duplicate REV or handoff files.
- Requirement traceability, conflict history and other stage records are synchronized in one batch at stage end.
