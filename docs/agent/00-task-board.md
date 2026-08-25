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
| `CPA-05` | `READY` | CPA-04 external PASS + merge + main verification | [`tasks/CPA-05.md`](tasks/CPA-05.md) | `luna-high` | `null` | `null` |

## Current phase

P5 / T13–T17 is closed through PR #97. P5C-02 accepted head is `888d029b08e5330f4c68dc484cf42d487e16ecd6`, merge/main is `7cbd5d077352ed9b6c313207788c4d1ec6e8ac36`, and main CI run `32677630940` succeeded.

P6 Runtime / T18–T24 is closed:

`P6R-01 → P6R-02 → P6R-03 → P6R-04 → P6R-05`.

No task in the P6 runtime pack is READY. The active stage is now the Owner Checkpoint A pack.
`CPA-04` is DONE after Architect PASS, merge, and successful main verification. `CPA-05` is the sole eligible READY successor.

## P6 stage intent

- P6R-01: freeze provider-neutral Runtime Orchestration V1 contract for trigger/manual-next/fence/deadline/error/background isolation.
- P6R-02: implement finalized transcript buffering and automatic/manual generation gate.
- P6R-03: enforce generation/publication authority so stale/late work cannot overwrite newer state.
- P6R-04: enforce deadline/error semantics and isolate P2/background work from the live interview lane.
- P6R-05: end-to-end synthetic integration and Decision Trace closeout for T18–T24.

P6R-03 is accepted through PR #101, merge/main `35c8b869f819ea3bc6a0f1e1d89cbadd1fa88c70`, with main CI run `32695474272` SUCCESS.
P6R-04 is accepted through PR #102, merge/main `272bc89782b38f356082fb0c21a30646b6c302bf`, with main CI run `32701819747` SUCCESS.
P6R-05 is accepted through PR #103, merge/main `045b041445eec2e73060afa5bbbe0e15c82cc51e`, with main CI run `32711482477` SUCCESS.

CPA-02 is accepted through PR #106, accepted head `bde59361ff4ce4ed76e72164597df324d7caf2a5`, merge/main `74882ef57fb932f673ccbc5890a08b97bf2de6fe`, with main CI run `32729016596` SUCCESS.

CPA-03 is accepted through PR #107, accepted head `72338b8c7acab11b714bdc92bd11f60d568c7dd6`, merge/main `8a531f527bc90770ee2ead622a48983498d2fbfe`, with main CI run `32746977248` SUCCESS.

P6R-02 is accepted through PR #100, merge/main `8c103ef631851b833a57efebe3c1b3ddc8dcadd8`, with main CI run `32691042422` SUCCESS.

The original P6 pack did not activate T25 or provider work. The separate Owner Checkpoint A pack
now authorizes only its bounded local Prompt and OpenRouter/Ox seams. T26–T27, production provider
and model choice, tokenizer/embedding choices, P4 production numeric budget, P2-D, ordinary real
interview data and public deployment remain deferred.

## Owner Checkpoint A pack

The active pack is:

`CPA-01 → CPA-02 → CPA-03 → CPA-04 → CPA-05`.

`CPA-04` is DONE on merged PR #109. The Owner Prompt artifact is durably recorded at
`docs/prompts/interview-director/owner-inputs/Interview_Director_System_v2.md@22760af1adc5d08f51f5dd3ed0aebca5f3c7d984`.
This pack authorizes local OpenRouter `stealth/ox-alpha` only for deliberately selected public,
non-sensitive material and binds only `QuestionDirector`. `StructuredAiProvider`, P2-D, real
embeddings, production provider choice and T26-T27 remain deferred.

CPA-05 ends with `next_task = null` and the mandatory `OWNER_CHECKPOINT_A_READY: YES` STOP gate.
No scoring popup, evaluation dashboard, model-comparison page or new test UI may be started without
the Owner's explicit post-checkpoint instruction.

## Maintenance

- GitHub durable facts override stale projection/status fields.
- Dispatcher must fresh-read GitHub/main or refreshed `origin/main`; an unpushed local worktree is never canonical state.
- Stage-end sync is complete only after commit/push and a fresh durable reread verifies the three current-state files.
- A normal Worker hands off through Task Card + PR and stops at REVIEW.
- Ordinary Implementation Tasks use external Architect review by default; no internal Reviewer/iteration-coach unless explicitly escalated.
- Dispatcher never creates Task Cards or invents next tasks.
