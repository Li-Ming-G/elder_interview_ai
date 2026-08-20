# Memory Persistence P2-C Compatibility V1

状态：`PROPOSED / REVIEW`。本文件是 P2-C 在不改写已接收 `memory-persistence-v1` Schema、fixture 或 pure validator 字节前提下的 forward-only compatibility artifact；它不是 P2-C runtime 或 Prisma implementation 的接收结论。

## 1. 不可变前置

`memory-persistence-v1.md`、`memory-persistence-v1.schema.json`、fixtures 与 validator 继续代表已接收的 database-agnostic P2-B view。P2-C durable implementation 不得把该 view 逐字段反向生成当前数据库，也不得修改已经接收的 P2-B 文件。发生差异时，以本 compatibility artifact 明确的 durable mapping 为准，并为每一项保留 upgrade fixture。

## 2. Stable resolution authority

P2-C 新增一个可被真实 FK 引用的 `memory_resolution_authority` registry。它是 semantic slot 的稳定身份，不复制正文或 semantic value：

| 字段 | 约束 |
|---|---|
| `authority_id` | UUID primary key，immutable |
| `project_id` | NOT NULL，FK `elder_project(id)`，`RESTRICT` |
| `semantic_kind` | `episode|fact`，NOT NULL |
| `canonical_key` | canonicalized、有限长度、同 project+kind 唯一 |
| `origin_session_id` | NOT NULL，FK `interview_session(id)`，`RESTRICT` |
| `origin_thread_id` | NOT NULL，FK `memory_thread(id)`，`RESTRICT` |
| `created_at` | immutable timestamp |

`memory_resolution.authority_id` 的物理 FK 列保持 `nullable=true` 以容纳旧历史；P2 新写入必须由专用 CHECK/trigger/reader gate 强制非空，不能把新 NULL 当作合法 P2 revision。`memory_resolution.id` 仍是 append-only revision-row ID；`UNIQUE(authority_id, resolution_revision)` 保持 revision chain。Legacy row 只有在单链、同 project、同 slot、连续 revision 可证明时才可 forward backfill；其他 row 保持 NULL/unavailable，不得猜测或被 P2 reader 选中。

机器门禁固定为：`p2_write=true => authority_id IS NOT NULL`；legacy `authority_id IS NULL` 只能映射为 `unavailable`，reader/checkpoint/Long selector 必须 fail closed，不得从当前 slot、revision 或文本反推 authority。

`origin_thread_id` 不得 nullable。Long 沿用其 source Mid identity 的稳定 origin thread；没有可证明 thread 时 Long 只能 terminal `unavailable`，不得用 NULL 或伪造 thread。

## 3. Evidence authority 与 claim bridge

`MemoryClaimEvidence.id` 是 claim-scoped link/pair ID，不是可跨 claim 复用的 evidence authority。P2-C 新增独立 `memory_evidence_authority`，且 `memory_evidence_authority.authority_revision` 是唯一 authority revision owner：

- `evidence_id`、`source_kind`、`source_id`、`authority_revision`、`membership_digest`、project/session scope 为 immutable typed reference；
- 首版只接受 `source_kind=transcript_segment`，实际 segment revision/digest 必须来自冻结的 `AiJobInputSegment`；
- P2-B `source_revision` 固定映射 `authority_revision`，不映射 transcript 的正文修订；`transcript_text_revision`、`speaker_role_revision`、`effective_text_digest` 是独立 source facts，必须逐字段从 typed `AiJobInputSegment`/`TranscriptSegment` FK 校验；
- `memory_claim_evidence` 或独立 bridge 只镜像 `(claim_id, evidence_id, authority_revision)` pair/parity，并对 pair 唯一；其 revision 必须回指并等于 `memory_evidence_authority.authority_revision`，不得被称为 authority、不得自行推进 revision；同一 evidence authority 可以支持多个不同 claims；
- bridge 与 authority 的 source/scope/revision/digest 必须逐字段相等；不得复制正文、Prompt、Context 或 provider payload。

## 4. P1/P2 job 与 target 生命周期

Checkpoint 永不保存含义不清的 `source_p1_final_job_id`。durable fields 必须拆成：

- `source_p1_terminal_job_id`：只指真实 P1 `working_memory_maintain` final lane terminal；
- `p2_producer_job_id`：只指 `mid_online|mid_final` P2 producer；
- `source_final_mid_checkpoint_id`：Long producer 只指已成功提交的 final Mid checkpoint。

P2 job 的 `target_layer_identity_id`、`target_layer_revision_id`、`target_revision_digest` 在 `pending|running|failed|cancelled|unavailable` 全部为 NULL；只有成功 commit 事务分配并补齐。P2-B 的 required target 只适用于 succeeded committed view。

现有 `AiJob.policyRevision` 与 `retentionPolicyVersion` 保持 Int，仅作为 legacy snapshot。P2-B retention root view 的字符串列必须且只能来自 `memory_p2_job_projection.p2_policy_revision` 与 `p2_retention_policy_version` 这两个 projection 专用 bounded VARCHAR 字段。Checkpoint 只保留 `ai_policy_revision INT`/`retention_policy_version INT` legacy snapshot，以及如需追溯时独立的 `p2_policy_contract_revision`/`p2_retention_contract_version` contract identity；Checkpoint 不得出现或提供 `p2_policy_revision`/`p2_retention_policy_version`，contract identity 也不得被称为或替代 policy source。测试必须分别验证 projection VARCHAR、checkpoint legacy Int、checkpoint contract identity 三个分域，并拒绝 cast、拼接和替代。

## 5. Retention 与 FK policy

P2 不新增第二个 retention root。自动 P2 对象继承现有 `AiJob` root；typed child 只允许投影 `checkpoint|layer_revision|job|trace` 四类目标，不能新增 `long_projection` root kind。

所有 live authority/reference FK 使用 `ON DELETE RESTRICT`。唯一允许 `SET NULL` 的关系是 nullable cleanup/audit pointer（例如 `cleanup_job_id`）；owned child 由 purge repository 按固定锁序显式删除，不使用数据库 `CASCADE`。任何允许语义级联删除 Claim/Resolution/Evidence 的方案均被拒绝。

`root_kind`、target discriminator、typed target exactly-one、project/session parity 和 target existence 必须同时由物理 FK、CHECK/unique constraint 与 transaction validator 证明；不得以裸 `target_id + root_kind` 伪装多态 FK。

Retention root view 的列映射固定为：`retention_root_id=ai_job.id`；`cleanup_job_id=memory_p2_retention_target.cleanup_job_id`；`deletion_scope_digest=memory_p2_job_projection.deletion_scope_digest`；P2-B 字符串 `policy_revision`/`retention_policy_version` 分别来自 `memory_p2_job_projection.p2_policy_revision`/`p2_retention_policy_version`；`legacy_policy_revision`/`legacy_retention_policy_version` 才来自 owning `ai_job` 的旧 Int 快照；`expires_at/retention_state` 仍来自 owning `ai_job`。不得从旧 Int 隐式 cast 成 P2 字符串。`cleanup_job_id -> ai_job.id` 是唯一 cleanup pointer FK，旧 `ai_job.retention_cleanup_request_id` 与 `decision_trace.retention_cleanup_request_id` 只是 legacy request/audit identifiers，永远不能冒充该 FK。

## 6. Deletion snapshot 与 Decision Trace mapping

每次 P2 freeze 必须冻结同一个 `deletion_scope_digest`（及其 policy/version snapshot），并将它写入 P2 job projection、checkpoint、Trace source reference 和 commit CAS。freeze、provider-call 前、writeback 前、read 时均重新读取权威 deletion scope；digest 漂移时零业务写入，旧 proposal/plan 失效。

现有 `decision_trace` parent 的 question/runtime columns 保持原物理落点，不迁入或复制到 `decision_trace_memory_semantic` child。P2 memory row 的 parent 映射固定为：

- `trace_kind=memory_layer_evolve`、`trigger_type=memory_layer_evolve`，`memory_outcome` 使用正式 memory enum；
- 非空 `decision_outcome='unavailable'` 是 question decision 的 neutral sentinel，`director_invoked=false`、`context_revision=0`、`stage_timings_json={}`；
- 非空 `status` 保存真实 `running|succeeded|failed|cancelled|unavailable` lifecycle；现有可空 parent `stage` 对 P2 memory row 由 CHECK/reader gate 要求写 `frozen|proposed|validated|planned|committed|recovered|terminal`；
- 现有可空 parent `error_code` 在无错误时为 NULL，在 failed/unavailable terminal 时只写稳定 P2 code；`gate_reason/publication_outcome/working_revision/context_digest` 等 question-only 可空列保持 NULL，不能搬到 child；
- parent 的 id/project/session/owner/request/generation、真实 `ai_job_id`、timestamps、`input_hash` 和 retention fields 保存真实 authority/lifecycle facts，不使用 sentinel。

memory reader 以 parent `trace_kind=memory_layer_evolve`、parent `memory_outcome/status/stage/error_code`、上述 neutral sentinel 与 typed memory child 联合校验；任何组合漂移都 fail closed。`decision_trace_memory_semantic` child 只保存非空 `trace_id/ai_job_id/deletion_scope_digest/source_manifest_hash/created_at` 和可空 `proposal_digest/plan_digest/commit_digest`，不得复制 parent 的 `trace_kind/memory_outcome/decision_outcome/director_invoked/status/stage/error_code/context_revision/stage_timings_json`。ordered `decision_trace_memory_source_reference` 保存 source checkpoint/job/input/evidence/authority IDs、revision、digest、scope、`deletion_scope_digest` 与 order。五个 typed source columns `source_checkpoint_id/source_job_id/ai_job_input_segment_id/evidence_id/resolution_authority_id` 的物理 FK 全部 `nullable=true`，不得进入 `source_reference_non_null_columns`；`source_kind` 还必须满足闭域 `IN ('checkpoint','job','input_segment','evidence','resolution')`，并与 `num_nonnulls(...)=1` 及对应 kind CHECK 联合决定有效性。`trace_id/source_kind/source_revision/membership_digest/deletion_scope_digest/input_order` 等真正 row authority 列仍物理非空。Trace 仍只保存 IDs/revisions/digests/status/error code，不保存正文。

## 7. Migration and error registry

P2-C migration 必须是 forward-only；完整机器清单（逐条 physical FK、retention view、26 条 predecessor migration ID/checksum、fingerprint、advisory lock、cursor、mode 与事务边界）见 `docs/contracts/memory-persistence-p2c-physical-fk-v1.json`：

1. predecessor fingerprint 精确绑定 review head `0ea5f47`、26 条 literal migration ID/SHA-256、Prisma schema SHA-256、P1 v1.2 migration checksum、DecisionTrace observation migration checksum和physical manifest version；当前 canonical-json-v1 SHA-256 为 `2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6`，且清单自校验要求 `migrations.length === 26`；
2. `fresh` 在单一 DDL transaction 中建立结构并写 `completed`；
3. `upgrade` 写 durable `upgrading` manifest，唯一键为 `(schema_version, source_version, target_version, mode, predecessor_fingerprint)`，要求 `expected_count=26` 且 26 条 literal checksum 全部匹配；在 `pg_advisory_xact_lock` 下按 `memory_resolution.id ASC` 回填可证明 authority，记录 `last_resolution_id`，完成约束验证后写 `completed`；
4. transaction 中断回滚未完成批次；重启从最后一个 durable cursor 幂等恢复，不能声称普通 DDL 自己持久化 `interrupted`；
5. unknown fingerprint、校验失败或 manifest conflict 写 `unavailable`，reader/scanner/provider 全部 fail closed；重复 completed manifest 为 no-op。

P2 使用稳定 error-code registry（machine-readable、不可复用为业务正文）：

| code | 语义 |
|---|---|
| `P2_PROVIDER_UNAVAILABLE` | deterministic/unavailable seam 无可用 provider |
| `P2_SOURCE_DRIFT` | source snapshot/thread/resolution/evidence 漂移 |
| `P2_TARGET_DRIFT` | target predecessor/authority/CAS 漂移 |
| `P2_POLICY_DRIFT` | policy/contract version 漂移 |
| `P2_DELETION_SCOPE_DRIFT` | deletion scope digest 漂移 |
| `P2_RETENTION_UNAVAILABLE` | root/child hidden/expired/deleted 或 target 不可证明 |
| `P2_CAS_LOST` | running-job 或 commit CAS loser |
| `P2_RESTART_RECOVERY` | crash/restart deterministic recovery |
| `P2_TRACE_UNAVAILABLE` | typed trace/source refs 不可重建 |
| `P2_MIGRATION_UNAVAILABLE` | predecessor fingerprint/manifest/upgrade 不可用 |
| `P2_TERMINAL_UNAVAILABLE` | P2/Long prerequisite 不可用的诚实终态 |

上述 code 只进入 job/trace/error projection，不进入 semantic value、日志正文或 provider payload。

## 8. Scope and acceptance

本 artifact 只修复 P2-C contract-first 的可实施性，不实现 Prisma、migration、repository、runtime、provider、P3/P4/UI。它必须在后续 implementation 前由项目负责人独立审查；当前 P2-C 任务继续 `REVIEW`，P2-D/真实 provider/data/公网继续阻塞。
