# 当前任务索引

本文件是供人快速查看的机械索引；canonical queue topology 来自本文件与正式 Task Card，`dispatcher/dispatcher-state.json` 是可重建的 last-known projection，不是唯一运行真相。GitHub durable PR/head/verdict/merge/CI facts 可以纠正 stale projection。治理模型是单 Dispatcher 顺序队列，外部 Architect 负责 PR Review。旧大看板的全部条目保存在 [`archive-task-board-snapshot-2026-08-22.md`](archive-task-board-snapshot-2026-08-22.md)，历史 task、handoff 与 review 保持原路径。

状态只允许：`READY`、`IN_PROGRESS`、`REVIEW`、`BLOCKED`、`DEFERRED`、`DONE`。

| id | status | depends_on | task_card | worker_profile | pr | next_task |
| --- | --- | --- | --- | --- | --- | --- |
| `P2C-01-DATABASE` | `DONE` | A1 `dbb0cc76f582997a6a647781007648c6937a8992`; P2-B `717c5ca39e678c6f953d0430768ae715ef0feef2` | [`tasks/P2C-01-DATABASE.md`](tasks/P2C-01-DATABASE.md) | `luna-high` | `#76` | `P2C-02-PERSISTENCE` |
| `P2C-02-PERSISTENCE` | `DONE` | P2C-01 external `PASS` | [`tasks/P2C-02-PERSISTENCE.md`](tasks/P2C-02-PERSISTENCE.md) | `luna-high` | `#77` | `P2C-03-ORCHESTRATION` |
| `P2C-03-ORCHESTRATION` | `DONE` | P2C-02 external `PASS` | [`tasks/P2C-03-ORCHESTRATION.md`](tasks/P2C-03-ORCHESTRATION.md) | `luna-high` | `#78` | `P2C-04-TRACE-RECOVERY` |
| `P2C-04-TRACE-RECOVERY` | `DONE` | P2C-03 external `PASS` | [`tasks/P2C-04-TRACE-RECOVERY.md`](tasks/P2C-04-TRACE-RECOVERY.md) | `luna-high` | `#79` | `P2C-05-INTEGRATION` |
| `P2C-05A-RUNTIME-BINDING` | `DONE` | P2C-04 external `PASS` | [`tasks/P2C-05A-RUNTIME-BINDING.md`](tasks/P2C-05A-RUNTIME-BINDING.md) | `luna-high` | `#81` | `P2C-05-INTEGRATION` |
| `P2C-05-INTEGRATION` | `DONE` | P2C-04 external `PASS`; P2C-05A external `PASS` | [`tasks/P2C-05-INTEGRATION.md`](tasks/P2C-05-INTEGRATION.md) | `luna-high` | `#80` | `null` |
| `MEMORY-T5-T8-P2-D-PROVIDER-001` | `DEFERRED` | P2-C external `PASS` plus owner provider/data decisions | not issued | `luna-high` | `null` | `null` |
| `P3R-01-CONTRACT` | `DONE` | P2C-05 external `PASS` | [`tasks/P3R-01-CONTRACT.md`](tasks/P3R-01-CONTRACT.md) | `luna-high` | `#82` | `P3R-02-SUBSTRATE` |
| `P3R-02-SUBSTRATE` | `DONE` | P3R-01 external `PASS`; main includes `ac81278bb2b81f8fa56d94b2ed25d7dd34fbc4a1` | [`tasks/P3R-02-SUBSTRATE.md`](tasks/P3R-02-SUBSTRATE.md) | `luna-high` | `#83` | `P3R-03-INDEXING` |
| `P3R-03-INDEXING` | `DONE` | P2C-02 external `PASS`; main includes `d59d360e239550890e388d28874a2d6874e261a8` | [`tasks/P3R-03-INDEXING.md`](tasks/P3R-03-INDEXING.md) | `luna-high` | `#84` | `P3R-04-RETRIEVAL` |
| `P3R-04-RETRIEVAL` | `DONE` | P3R-03 external `PASS`; main includes `79312701319f60ecea8dd563049be5f561bbcd85` | [`tasks/P3R-04-RETRIEVAL.md`](tasks/P3R-04-RETRIEVAL.md) | `luna-high` | `#85` | `P3R-05-INTEGRATION` |
| `P3R-05-INTEGRATION` | `DONE` | P3R-04 external `PASS`; main includes `8c6fd0183d497f9ebd853acb7e233ea99a994591` | [`tasks/P3R-05-INTEGRATION.md`](tasks/P3R-05-INTEGRATION.md) | `luna-high` | `#86` | `null` |
| `P4G-00-STATE-SYNC` | `DONE` | P3R-05 merged; main includes `63f6dfe6a4a5290f0a1a5d89484594a0cbc5d0fa` | [`tasks/P4G-00-STATE-SYNC.md`](tasks/P4G-00-STATE-SYNC.md) | `luna-high` | `#87` | `P4C-01-CONTRACT` |
| `P4C-01-CONTRACT` | `DONE` | P4G-00 merged and verified on refreshed main | [`tasks/P4C-01-CONTRACT.md`](tasks/P4C-01-CONTRACT.md) | `luna-high` | `#88` | `P4C-02` |
| `P4C-02` | `DONE` | P4C-01 | [`tasks/P4C-02.md`](tasks/P4C-02.md) | `luna-high` | `#89` | `DISPATCHER-RECOVERY-001` |
| `DISPATCHER-RECOVERY-001` | `REVIEW` | P4C-02 | [`tasks/DISPATCHER-RECOVERY-001.md`](tasks/DISPATCHER-RECOVERY-001.md) | `luna-high` | `#90` | `P4C-03` |
| `P4C-03` | `DEFERRED` | DISPATCHER-RECOVERY-001 | [`tasks/P4C-03-BUDGET-FREEZE.md`](tasks/P4C-03-BUDGET-FREEZE.md) | `luna-high` | `null` | `P4C-04-INTEGRATION` |
| `P4C-04-INTEGRATION` | `DEFERRED` | P4C-03 | [`tasks/P4C-04-INTEGRATION.md`](tasks/P4C-04-INTEGRATION.md) | `luna-high` | `null` | `null` |
| `P5E-01-CONTRACT` | `DEFERRED` | P4C-04-INTEGRATION | [`tasks/P5E-01-CONTRACT.md`](tasks/P5E-01-CONTRACT.md) | `luna-high` | `null` | `P5E-02-EVIDENCE-READERS` |
| `P5E-02-EVIDENCE-READERS` | `DEFERRED` | P5E-01-CONTRACT | [`tasks/P5E-02-EVIDENCE-READERS.md`](tasks/P5E-02-EVIDENCE-READERS.md) | `luna-high` | `null` | `P5E-03-GATE-CORRECTION` |
| `P5E-03-GATE-CORRECTION` | `DEFERRED` | P5E-02-EVIDENCE-READERS | [`tasks/P5E-03-GATE-CORRECTION.md`](tasks/P5E-03-GATE-CORRECTION.md) | `luna-high` | `null` | `P5E-04-INTEGRATION` |
| `P5E-04-INTEGRATION` | `DEFERRED` | P5E-03-GATE-CORRECTION | [`tasks/P5E-04-INTEGRATION.md`](tasks/P5E-04-INTEGRATION.md) | `luna-high` | `null` | `DIRECTOR-V2-01-CONTRACT` |
| `DIRECTOR-V2-01-CONTRACT` | `DEFERRED` | P4C-04 + P5E-04 | [`tasks/DIRECTOR-V2-01-CONTRACT.md`](tasks/DIRECTOR-V2-01-CONTRACT.md) | `luna-high` | `null` | `DIRECTOR-V2-02-ENGINE` |
| `DIRECTOR-V2-02-ENGINE` | `DEFERRED` | DIRECTOR-V2-01 | [`tasks/DIRECTOR-V2-02-ENGINE.md`](tasks/DIRECTOR-V2-02-ENGINE.md) | `luna-high` | `null` | `DIRECTOR-V2-03-INTEGRATION` |
| `DIRECTOR-V2-03-INTEGRATION` | `DEFERRED` | DIRECTOR-V2-02 | [`tasks/DIRECTOR-V2-03-INTEGRATION.md`](tasks/DIRECTOR-V2-03-INTEGRATION.md) | `luna-high` | `null` | `P6R-01-CONTRACT` |
| `P6R-01-CONTRACT` | `DEFERRED` | P4 + P5 + Director V2 | [`tasks/P6R-01-CONTRACT.md`](tasks/P6R-01-CONTRACT.md) | `luna-high` | `null` | `P6R-02-TRIGGER-GATE` |
| `P6R-02-TRIGGER-GATE` | `DEFERRED` | P6R-01 | [`tasks/P6R-02-TRIGGER-GATE.md`](tasks/P6R-02-TRIGGER-GATE.md) | `luna-high` | `null` | `P6R-03-ORCHESTRATION` |
| `P6R-03-ORCHESTRATION` | `DEFERRED` | P6R-02 | [`tasks/P6R-03-ORCHESTRATION.md`](tasks/P6R-03-ORCHESTRATION.md) | `luna-high` | `null` | `P6R-04-FENCE-ERRORS` |
| `P6R-04-FENCE-ERRORS` | `DEFERRED` | P6R-03 | [`tasks/P6R-04-FENCE-ERRORS.md`](tasks/P6R-04-FENCE-ERRORS.md) | `luna-high` | `null` | `P6R-05-INTEGRATION` |
| `P6R-05-INTEGRATION` | `DEFERRED` | P6R-04 | [`tasks/P6R-05-INTEGRATION.md`](tasks/P6R-05-INTEGRATION.md) | `luna-high` | `null` | `null` |

## Current stop

`P2C-05-INTEGRATION` is accepted as `DONE` on PR #80, exact head `1aa937ea3fc0656d38d53a525e87ce6dac57826e`, merge commit `b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`, PR CI `32568634088 SUCCESS`, post-merge main CI `32569056012 SUCCESS`. P2-C Runtime Implementation is complete. The four old candidate heads remain read-only historical references and must not be integrated: database `87ee56c6ceb1aee7897d1d62a2b18703c304c2e3`, orchestration `97f647d607b020ef524014cfdab3e7b13eccd098`, trace `5ada42209e5ab245e1b799456694a1cac9ca7ab9`, integration docs `419f7bfc447b4b605c87e6c173b09c304cba5a41`. The formal old combination verdict is historical `FAIL P0=0/P1=6/P2=1`.

P3 Retrieval Runtime is complete. P4G-00-STATE-SYNC is accepted as `DONE` on PR #87, exact head `b9053e9921bc8a51a9ed35579e5486ca9fad53b0`, merge commit `63f6dfe6a4a5290f0a1a5d89484594a0cbc5d0fa`, post-merge main CI `32609633392 SUCCESS`. P4C-01-CONTRACT is now the only READY task.

## Recently accepted dependencies

- P2-A1 semantic envelope: `DONE / PASS / CONTRACT ONLY`, exact head `dbb0cc76f582997a6a647781007648c6937a8992`.
- P2-B persistence contract: `DONE / PASS / CONTRACT ONLY`, exact head `717c5ca39e678c6f953d0430768ae715ef0feef2`.

## Maintenance

- Update this index only when machine state changes.
- A normal worker hands off through its Task Card and GitHub PR; it does not create duplicate REV or handoff files.
- An ordinary Implementation Task does not start iteration-coach or an additional internal Reviewer; external Architect PR review is the default unless the Product Owner or Architect explicitly escalates.
- Requirement traceability, conflict history and other stage records are synchronized in one batch at stage end.
