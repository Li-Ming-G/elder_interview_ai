# Memory Maintainer V1 正式契约

状态：`ACCEPTED-HISTORY / PRE-RUNTIME-SUPERSEDED`。PR #66 accepted head `224445064613cb2abd24a7c761052b7679bbcbd6` / CI `31994482841` / PASS comment `5312635580` 已接收并合入 `main@27e8d8d6aaa523b3298b5d64f6f27240696c542c`（main CI `32001983350`）。该历史永久保留，但独立 Correction 在任何 runtime 开工前发现 revision、semantic/lifecycle、failed retry、consumption ownership 和 producer cutover 缺口，因此 runtime 不得加载本 v1；后续唯一可加载候选为经 exact-head `PASS` 且 merge 后的 [`memory-maintainer-v1.1`](memory-maintainer-v1.1.md)。本文件以及已接收的 v1 Schema/fixtures 不原地改写其历史语义。

## 1. 架构映射

| T 任务 | P 层 | 本契约冻结的职责 |
|---|---|---|
| T2 | Foundation / Memory Contract | Episode/Fact、Working/Mid/Long、Thread、Boundary、Evidence、revision 与 snapshot authority |
| T4 | P1 | finalized transcript batch 到 Working Memory candidate operations |
| T18-T19 | P6 | Hybrid Trigger、持久 batch、freeze/call/writeback、重启恢复和 late-result fence |
| T0 | Foundation / Observability | 只保存 typed IDs/revisions/digests/membership，不复制完整 prompt、Context、转录或 provider 原文 |

本契约不实现 T5-T8/P2、T9-T10/P3、T11-T12/P4、正式 Context V2、真实 provider、真实数据或 UI。

## 2. 唯一权威

`memory_claim + memory_claim_evidence + memory_resolution + memory_resolution_member` 继续是记忆 value、claim、resolution 和 evidence 的唯一业务权威。runtime 不得新增另一张保存 Working value 的表。

正式实现使用 forward-only migration 扩展现有 claim/resolution：

- `semantic_kind=episode|fact`；
- `layer=working|mid|long`；
- `source_session_id`；
- `thread_id`。

新增实体只保存现有权威缺失的身份、版本和 membership：

- `memory_thread`：稳定 thread 身份、project 和 origin session；
- `memory_thread_revision`：append-only `active|parked` revision、topic key、supersedes；同一 session 至多一个 current active thread revision；
- `memory_boundary`：稳定 boundary 身份；
- `memory_boundary_revision`：append-only `active|revoked|superseded` revision、最小 abstract scope，不复制原始受限正文；
- `memory_boundary_evidence`：只引用冻结的 `ai_job_input_segment` 和 transcript segment；
- `memory_working_snapshot`：一次成功 P1 写回的 immutable root，保存 job、session、policy revision、trigger identity 和 manifest digest；
- snapshot membership：冻结 resolution/thread/boundary 的 ID、revision、order 和 membership digest；
- `memory_maintenance_input_segment`：把 job input segment 标为 `new|overlap`；
- `memory_working_consumption`：只在成功写回事务中把 `new` segment 绑定到 snapshot，证明其已被 P1 消费。

P3/P4 后续只能读取最新动态 eligible 且完整 committed 的 Working snapshot。running/failed job、半完成 membership 或单独 materialized row 均不可见。

Legacy claim/resolution 的新字段允许为空；为空表示 `layer/semantic/thread authority unavailable`，不得回填伪造的 `working`、revision `0` 或 local-test provenance。只有新 runtime producer 写出的记录才必须完整非空。

## 3. Hybrid Trigger

自动 P1 调用必须同时满足：

```text
(new eligible count >= batch threshold OR oldest unconsumed age >= time threshold)
AND minimum useful content = true
```

- `minimum useful content` 由确定性程序判断至少存在一个尚未消费的 trusted elder、`content_kind=conversation`、final segment，且规范化正文达到配置的最小有效长度；它不是独立 trigger。
- batch 与 time 均未达到时不得调用 provider。
- batch/time 达到但无 minimum useful content 时不得调用 provider，segment 保持未消费，等待后续有效内容或 session final flush。
- 通知只负责唤醒。startup 与 periodic scanner 必须从持久未消费 segment 重建 time trigger；不得依赖进程内 finalized notification 作为 authority。
- 默认阈值属于 runtime 配置，不写死在 Schema；任何一次 job 必须持久记录实际 trigger kind 与稳定 trigger identity。

## 4. 冻结输入

正式 provider 输入只遵循 [`memory-maintainer-context-v1.schema.json`](memory-maintainer-context-v1.schema.json)，并通过同一契约包的 semantic validator 做跨文档校验。

- `transcript_membership` 明确区分 `new|overlap`；每次调用至少有一个 `new` trusted elder conversation final。
- Schema 机械要求至少一个 `new` trusted elder conversation final；semantic validator 还要求 segment ID、operation ID、boundary candidate ID 唯一，且 output evidence 只能引用本次 `new` trusted elder membership。overlap 只提供相邻语境，不能再次成为新 claim 的唯一证据。
- 输入 Working、Mid index、active thread 和 active boundary 均保存 ID 与真实 revision；不存在时使用空集合或 `null`，不得伪造。
- freeze 在 session advisory lock 内选择未消费 batch，创建 AiJob、session scope、input segment/memory 和 `new|overlap` membership 后提交；provider 调用不持数据库锁。
- trigger identity 由 session、new membership manifest 和契约版本确定；重复通知/ACK 丢失/并发 worker 必须落到同一 job。

## 5. 候选输出

正式 provider 输出只遵循 [`memory-maintainer-output-v1.schema.json`](memory-maintainer-output-v1.schema.json)。Maintainer 只提出候选，不能直连数据库、直接写记忆、决定下一问、解除 boundary 或删除历史。

- operation kind 仅允许 `CONTINUE|BRANCH|RESUME|NEW|DUPLICATE|SUPPLEMENT|RELATED|UNCERTAIN`。
- 除 `DUPLICATE` 外，operation 必须给出完整 `proposed_state`，不是增量 patch；`CONTINUE/SUPPLEMENT` 不得用新片段直接覆盖旧完整 value。
- 更新/重复/恢复必须返回 target resolution/thread 和 expected revision；程序 CAS 不匹配即整次写回失败。
- `BRANCH/RELATED` 必须引用 anchor thread 及 expected revision；新 thread ID 由服务端生成，provider 不生成业务 UUID。
- canonical key/prefix 只可用于服务端廉价候选召回，不能代替模型作 semantic thread relation 判断。
- `UNCERTAIN` 的 proposed status 必须为 `uncertain`；程序不得把 unknown 自动改成精确事实。
- boundary candidate 只允许 trusted elder 的明确拒绝表达，必须有 `new` evidence；它先进入候选 authority，不得自动冒充人工 marker/deletion request。
- output 不保存或返回 chain-of-thought、完整 prompt、完整 Context 或自由形式 provider 原文。

## 6. 程序验证与原子写回

写回前必须逐项验证：

1. Output Schema 与 contract version；
2. project/session/assignment/consent/project status/policy/deletion/retention；
3. evidence 属于本 job 的 `new` membership，且 trusted elder、conversation、text/role revision 与 digest 未漂移；
4. target resolution/thread/boundary 属于同 project，revision、layer、semantic kind、canonical key 和 ownership 未漂移；
5. operation 的 target/anchor/proposed-state 组合合法，同批 duplicate 不产生第二个 semantic slot；
6. 人工 authority 不被 automatic operation 覆盖或解除；
7. dependency count/manifest 与实际 rows 完整一致。

成功时一个事务内完成：claim/resolution、thread/boundary revision、derived output/dependencies、Working snapshot/memberships、new segment consumption，以及 `job.status=running -> succeeded` CAS。任一步失败全部回滚。

`DUPLICATE` 不创建新的 resolution/value，但仍可在成功 snapshot 中记录本批已消费及其 typed evidence/proposal outcome。历史 claim/resolution/revision 不覆盖、不删除。

## 7. Crash / Replay

- crash before freeze commit：没有 job/membership/consumption，scanner 可重新选 batch；
- crash after freeze but before provider/writeback：stale running job 经 grace terminalize 为 failed，segment 未消费，可形成新 retry job；
- crash during writeback：业务事务全部回滚，segment 未消费；
- crash after writeback commit：snapshot 和 consumption 已原子存在，重复通知只 replay winner；
- scanner 胜出终结 stale job 后，late callback 必须因 `job.status=running` CAS 失败，不能创建或复活任何业务 row；
- P1 失败不影响录音、ASR final 或 transcript ingestion。P3/P4 在新 snapshot 未成功前继续读取上一个 eligible committed snapshot。

## 8. Runtime 接收矩阵

后续 runtime PR 必须至少证明：

- Hybrid Trigger 全真值表；
- missing/extra/非法 operation、target revision mismatch、evidence outside `new` batch；
- fresh migration、从本契约 merge/main 升级、repeat deploy/status；
- supplement、duplicate、branch/resume、uncertain、boundary evidence；
- 并发通知、通知丢失、startup/periodic recovery、provider timeout、crash-before-writeback、late callback；
- 任一写入失败时 claim/resolution/thread/boundary/snapshot/consumption 全为零；
- evidence/policy/deletion drift 失败关闭；
- running/failed 时 consumer 只见上一个完整 snapshot；
- 所有 P1 失败路径下录音与 transcript ingestion 仍成功。

## 9. 明确后置

- P2 Mid/Long 演化、checkpoint、park/resume 的跨 batch 策略；
- embedding/graph retrieval 和正式 P3；
-正式 Context V2/P4 runtime switch；
- Evidence drill-down/P5；
-真实 provider/endpoint/secret、真实长者/PII、生产 staging 和 UI。
