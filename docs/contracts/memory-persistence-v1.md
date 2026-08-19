# Memory Persistence V1

状态：`FORMAL CONTRACT / ACCEPTED CONTRACT ONLY`。这是 `MEMORY-T5-T8-P2-B-PERSISTENCE-CONTRACT-001` 的数据库无关 machine contract；PR #72 accepted exact head `717c5ca` / CI `32245656541`，independent `PASS / P0=0/P1=0/P2=0`，merge/main `8bbb2cc` / main CI `32254759316`。PR #73 governance closeout merge/main `7e183217` / main CI `32256919620` 不扩大接收范围。本契约不实现 Prisma、migration、repository、runtime、provider 或 UI。

## Ownership and scope

`MemoryClaim` 与 `MemoryResolution` 是唯一 value、semantic-status、correction、supersede、dispute authority。Persistence rows may store only their IDs and the resolution revision/status observed at commit time; they never copy or mutate value. `MemoryLayerIdentity` owns stable identity only. `MemoryLayerRevision` owns append-only membership and lifecycle only. `Checkpoint` owns the immutable source manifest. `RevisionMember` owns claim/evidence references only. `LongJobProjection` is terminal, reference-only, and must not contain body keys.

Every object is scoped by `project_id`. Mid rows additionally require the same `source_session_id`; Long rows may reference multiple sessions, but `source_session_ids` must equal the exact set in the Mid manifest and never cross projects. A layer identity is the tuple `project_id + origin_session_id + origin_thread_id + origin_resolution_id`; A -> B -> A resumes the original identity and predecessor chain.

## Persistence invariants

- Checkpoint, identity, revision and member IDs are unique. Checkpoint/member and revision/member counts, input order and canonical SHA-256 manifests must match exactly. A checkpoint member's membership digest is derived from the referenced Resolution's ordered Claim/evidence authorities; recomputing only the outer manifest is invalid.
- Every Claim declares its evidence authority IDs. The declared IDs must exist in the same project/session scope, and the Claim evidence manifest digest is recomputed from the typed authority references; a copied or drifted A1 bridge is unavailable.
- A checkpoint source job must exist and be terminal `succeeded` with the final P1 job type; every layer revision must point to that checkpoint and a known terminal job whose source/target digests match the checkpoint/revision manifests. A Long projection must name its target Long revision and point to a terminal `long_session_end` job. One layer identity cannot have two revisions with the same revision number.
- All immutable fields are append-only. A new revision increments `revision_no`, references the previous revision, and never edits the predecessor. CAS rechecks source snapshot/thread/resolution revision, target predecessor, deletion scope digest, policy revision and retention version.
- A trigger/request identity has one pending/running/succeeded winner. Failed/cancelled retries and late callbacks cannot write against drifted source, target or policy. A stale callback writes zero rows; rejection is fail closed.
- `active` Boundary cannot be promoted. Boundary mutation is outside this contract. `semantic_status` is read from MemoryResolution and is not a layer lifecycle.
- Durable commit is one transaction: terminal job, checkpoint root, checkpoint members, identity, revision and revision members are all-or-nothing. This contract records the atomicity requirement; runtime evidence is a later gate.
- Retention is root/child. Every root names a typed target (checkpoint, layer revision, job or Decision Trace authority); unknown targets fail closed. Expiry transitions `active -> hidden -> detached/purged`; `cleanup_failed` is retryable and never readable. Root deletion uses RESTRICT for live references; child cleanup may SET NULL only for nullable audit/reference fields. No cascade may erase MemoryClaim/Resolution authority.
- Deletion scope or policy revision drift, stale source revision, missing evidence or expired retention makes read/write unavailable. A1 evidence uses typed references (`source_kind`, `source_id`, `source_revision`, `membership_digest`, project/session scope), never copied transcript text.

## Migration contract

Fresh install starts at `memory-persistence-v1`. Upgrade manifests are explicit and resumable, but old data is never guessed to be Mid or Long. While `upgrading`, `interrupted` or `unavailable`, readers fail closed. Repeating a completed manifest is a no-op; interruption preserves the last durable step and retry is idempotent. No provider payload, prompt, context, transcript or full model output is durable.

## Review boundary

The JSON schema and pure validator establish shape and cross-object semantics only. Prisma FKs, RESTRICT/SET NULL DDL, transaction/CAS behavior, retry/late callback integration and migration execution remain P2-B implementation work and require separate review. P2-B contract tests must cover fresh, upgrade, repeat and interruption fixtures before any runtime work starts.

## P2-C durable compatibility mapping

P2-B accepted Schema/validator字节与历史保持不变；其对象是succeeded persistence contract view，不可逐字段直接生成current Prisma schema：

- `checkpoint.source_p1_final_job_id`在durable层拆为真实P1 `source_p1_terminal_job_id`与独立`p2_producer_job_id`。validator当前把前者要求为`mid_final`是P2-C必须关闭的命名/ownership冲突，不是落库规则。
- job `target_layer_revision_id/target_revision_digest`只在succeeded committed view必填；durable pending/running/failed/cancelled/unavailable P2 job projection必须为NULL，成功事务才分配和补齐。
- 现有`AiJob.policyRevision/retentionPolicyVersion`继续是Int；contract string revision/version进入P2专用projection/checkpoint列，不改旧列类型且两套值同时CAS。
- P2-B `claim_revision`映射immutable claim revision 1；evidence `source_revision`映射evidence-link authority revision 1，实际transcript text/speaker revisions从冻结input segment校验。
- retention不新建第二root表：自动P2对象继承AiJob root并用无状态typed target child投影；`MemoryRetentionRoot` ownership与`RetentionState`枚举保持不变。完整typed FK inventory和fresh/upgrade/interrupted/repeat语义以`04` §17为准。
