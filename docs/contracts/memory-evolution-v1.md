# Memory Evolution V1 正式契约

状态：`FORMAL CONTRACT / REVIEW CANDIDATE`。本契约属于 `MEMORY-T5-T8-P2-A-CONTRACT-001`，只冻结 P2-A；它不是 P2 runtime、数据库 migration、provider 或 P3/P4 完成证明。

## 1. 映射与所有权

| 任务/层 | 唯一所有权 |
|---|---|
| T5-T8 / P2 | Working -> Mid、checkpoint、promotion revision、Mid/Long membership，以及消费 P1 thread revision 后产生的 Park/Resume 层级后果 |
| T2-T4 / P1 | finalized transcript consumption、Working snapshot、active-thread seam、session final-flush completeness；P2 不创建第二套 thread focus 状态机 |
| MemoryModule | Claim、Resolution、value、semantic status、correction/supersede/disputed authority；P2 只引用 revision |
| T18-T19 / P6 | job、attempt、retry、stale recovery；P6 不拥有 memory value 或 layer membership |
| T0 / Observability | reference-only Decision Trace；不复制 value、正文、prompt、Context 或 provider payload |
| P3/P4 | 后续 retrieval / Context V2；P2-A 不实现 |

P2 terminal 顺序固定为：`P1 final terminal -> P2 final Mid terminal -> P2 Long terminal`。本契约不修改 PR #68 已接收的 P1 opening、Working snapshot 或 final-flush 行为。

## 2. 正式数据对象

- `MemoryEvolutionCheckpoint`：`root_identity`、`expected_member_count`、`member_manifest_hash`、`ai_job_id`、`policy_revision`、`retention_policy_version`、P1 `source_working_snapshot_*`、`source_thread_*` 与 final terminal references。append-only。
- `CheckpointMember`：`memory_resolution_id`、`resolution_revision`、`semantic_status`、`claim_count`、`boundary_status`、`membership_digest`、`input_order`。只允许同 project/session 的 P1 snapshot member；缺失、重复、乱序、count/hash、claim-count 或 Boundary 状态不一致整 checkpoint fail closed。`disputed` 至少需要两个权威 claim，`active` Boundary 永不 promotion。
- `MemoryLayerIdentity`：稳定 `project_id + origin_session_id + origin_thread_id + origin_resolution_id` identity。T6 `A -> B -> A` 必须复用 A 的 identity，不得创建 M17 类重复 identity。
- `MemoryLayerRevision`：`mid|long` append-only revision，含独立 `lifecycle_status`、source/checkpoint/job/resolution/predecessor references、count/hash。semantic status 只引用 `MemoryResolution.semantic_status`，不得复用 layer lifecycle 表达语义。
- `RevisionMember`：`memory_claim_id`、`role`、`input_order`、`evidence_membership_digest`；不得包含 claim value 或 evidence 正文。任一 member 失效时整个 revision count/hash 失败关闭。
- `LongJobProjection`：reference-only terminal projection；只含 job identity/status/attempt/retry、source final checkpoint、Mid manifest algorithm/hash 和 manifest references。Long validator 必须逐项校验 source Mid revision 的 identity、resolution revision/status、scope 与 manifest parity。

Layer revision 不拥有 Claim/Resolution value。自动 P2 不得覆盖 human authority；correction/supersede/disputed 只能引用 MemoryModule 已产生的 Resolution revision。Boundary 永不 promotion；只有既有 authority 的明确撤回可将 Boundary 改为 `revoked`，P2 output 中不存在 Boundary mutation。

## 3. Trigger identity

使用 PR #68 已接收字段名，按长度前缀编码或等价无歧义 canonical encoding 计算 SHA-256：

- online：`project_id + source_session_id + source_thread_id + source_thread_revision_id + source_working_snapshot_id + source_resolution_manifest_hash`
- final：`project_id + source_session_id + source_p1_final_job_id + source_working_snapshot_id + source_resolution_manifest_hash`
- long：`project_id + source_session_id + sorted(source_session_ids) + session_completed_at + p2_final_checkpoint_id + mid_revision_manifest_hash`

`capacity_checkpoint` 可对 P1 `MemoryThreadRevision.status=active` 建立 Mid checkpoint，但绝不把 thread 改为 parked。`semantic_park` 必须消费 `status=parked`；resume 只消费后续 P1 active revision并复用稳定 layer identity。`session_final_flush` 必须引用成功的 P1 final terminal，尾段只进入一次 final Mid checkpoint。`memory-evolution-canonical-v1` 使用显式 input-order tuple、UTF-8、无 trim/Unicode normalization、lowercase SHA-256；`[]` golden 为 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`，不改写 PR68 Working snapshot digest。

## 4. CAS、锁与原子提交

所有 writeback 重查 source Working snapshot、thread revision、resolution manifest、target layer predecessor、Resolution identity/revision、policy revision、deletion scope digest 和 retention policy version。固定锁顺序为：

`project/session advisory -> source snapshot -> source thread revision -> resolutions (id asc) -> target layer identities (id asc) -> target predecessor revisions (id asc) -> ai_job`。

同 trigger identity 只有一个 pending/running/succeeded winner。failed/cancelled attempt 若 source/target/policy 任一 drift，必须基于当前 authority rebase 成新 request identity；不得把 stale output重放到新 authority。late terminal 因 running CAS 失败必须零 checkpoint/layer/member 写入。成功时 `ai_job terminal + checkpoint root + checkpoint members + layer identity/revision + revision members` 同事务提交，任何 count/hash/member/CAS 错误全部回滚。

## 5. Mid 与 Long

Mid 只允许同 `project_id + source_session_id`。跨 session consolidation 只允许 Long，且始终禁止跨 project。Long context 的 `source_session_ids` 是 Mid manifest 实际来源 session 的唯一集合；每个 Mid row 必须属于该集合，集合不能遗漏或凭空增加。`source_session_id` 仍表示本次完成/触发 session。Long 只能在 session completed、P1 final succeeded、P2 final Mid succeeded 后运行，并从完整 Mid manifest 读取 reference-only input。非 succeeded Long job 不得携带 revision candidates。

Long context/output/trace 机械禁止任何键名包含 `value`、`text`、`transcript`、`prompt`、`context`、`summary`、`narrative`（版本字段 `context_schema_version` 除外）。Long 可以保留 claim/resolution/layer/job identity、revision、role、order、digest 与 lifecycle reference，不能生成新的事实正文。Decision Trace v1.1 的 checkpoint 必须携带完整 `membership_refs`；每个 trace membership 的 job/project/session/layer/resolution/revision/digest/order 必须与 root ref 逐字段相等，删除 scope 或 retention 非 active 直接不可读。

## 6. Machine artifacts

- [`memory-evolution-context-v1.schema.json`](memory-evolution-context-v1.schema.json)
- [`memory-evolution-output-v1.schema.json`](memory-evolution-output-v1.schema.json)
- [`fixtures/memory-evolution-v1.fixtures.json`](fixtures/memory-evolution-v1.fixtures.json)
- [`long-memory-consolidation-context-v1.schema.json`](long-memory-consolidation-context-v1.schema.json)
- [`long-memory-consolidation-output-v1.schema.json`](long-memory-consolidation-output-v1.schema.json)
- [`fixtures/long-memory-consolidation-v1.fixtures.json`](fixtures/long-memory-consolidation-v1.fixtures.json)
- [`decision-trace-v1.1.schema.json`](decision-trace-v1.1.schema.json) 与 reference-only fixtures；v1 文件字节不变。
- `apps/api/src/memory/memory-evolution-contract.ts` pure validators 与对应 spec。

## 7. 后续门禁

- P2-B（Prisma/migration）：P2-A exact-head 独立 `PASS` 且 merge；正式表、FK、CHECK、unique/CAS/retention design 经独立审查。
- P2-C（runtime）：P2-B accepted；必须通过 duplicate/concurrent/crash/late、source/target/policy/deletion/retention drift、final-tail exactly-once 和 rollback integration matrix。
- P2-D（provider/consolidation）：P2-C accepted；真实 provider/data/secret 与 production retention 单独审批。

P2-A contract tests 通过只说明机器契约候选自洽，不表示 P2-B/C/D、P3/P4、真实数据或生产 runtime 已完成。
