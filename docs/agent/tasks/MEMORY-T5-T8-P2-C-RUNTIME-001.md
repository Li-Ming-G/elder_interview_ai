# MEMORY-T5-T8-P2-C-RUNTIME-001

## 当前状态

- 状态：`REVIEW / CONTRACT-FIRST / IMPLEMENTATION NOT STARTED`。
- 分支：`codex/memory-p2-c-runtime-001`；起点 `3369869`，包含侧栏可见任务窗口规则。
- 映射：`T5-T8/P2`、`T18-T19/P6`、`T0/Foundation-Observability`；同时登记 `T0/Foundation-Observability` 对 typed trace、retention 与 evidence references 的要求。
- 前置：A1 PR #71 accepted `dbb0cc76` / CI `32210618025` / owner PASS `P0=P1=P2=0`，merge/main `7d02fa65` / CI `32211560361`；P2-B PR #72 accepted `717c5ca` / CI `32245656541` / independent PASS，merge/main `8bbb2cc` / CI `32254759316`；PR #73 governance closeout merge/main `7e183217` / CI `32256919620`。
- 当前交付仅为治理与正式契约前置；没有 Prisma、migration、repository、runtime 或 provider 实现，不宣称 PASS/DONE。

## 目标

在已接收 P2-A/A1/P2-B contract-only 基线上，后续以一个 forward-only 实现切片交付：

```text
durable P1 source/checkpoint trigger
  -> freeze reference-only source rows + running job/trace
  -> provider-neutral SemanticProposal
  -> Schema + pure semantic validation
  -> in-memory ValidatedMemoryMutationPlan
  -> MemoryModule authority re-read + CAS
  -> atomic Claim/Resolution/Evidence + Mid/Long layer commit
  -> terminal job + readable reference-only trace
```

LLM 只能提出 `SemanticProposal`。程序唯一拥有 Context 冻结、validation、plan、ID/revision 分配、CAS、source disposition、retention/deletion 判定、transaction 和 committed projection。`MemoryClaim/MemoryResolution` 继续是唯一 semantic authority；Proposal、Plan、checkpoint、layer、Long projection、Trace、log 和 provider receipt 不得成为第二语义事实源。

## 实现范围

1. forward-only Prisma/SQL migration：扩展现有AiJob/AiJobCoordinator、MemoryClaim/Resolution/Evidence，新增P2 checkpoint、layer identity/revision/member、Long projection/source、AiJob一对一P2 projection、AiJob-owned typed retention target与semantic trace refs；旧migration字节、MemoryRetentionRoot ownership和RetentionState枚举不改，不建第二coordinator或retention root状态机。
2. repository/readers：只读取完整 committed checkpoint/layer revision；count/order/manifest、authority revision、Boundary、policy、deletion、retention 或 evidence 任一不可证明时失败关闭。
3. orchestration：现有AiJobCoordinator承接`semantic_park|capacity_checkpoint|session_final_flush` Mid路径，以及真实P1 final terminal后P2 final Mid、再到Long的固定顺序；post-session保持P1 final lane，notification只唤醒，startup/periodic scanner以持久事实恢复，P2不阻塞completed/opening。
4. semantic bridge：临时构建 A1 Context，调用 provider-neutral proposal port，经正式 Schema/pure validator 生成非持久 plan；成功事务后才形成 committed projection。
5. P6：stable trigger/request identity、single winner、failed/cancelled/unavailable retry predecessor、source/target/policy 漂移 rebase、crash/restart recovery、late-result fence 和 final-tail exactly-once。
6. T0：running/terminal Decision Trace、typed checkpoint/layer/resolution/evidence refs、proposal/plan/commit digest；不保存 Context、Proposal/Plan payload、semantic value、Transcript、Prompt 或 provider payload。
7. provider seam：`local|test` deterministic proposal fixture 与所有环境可用的 unavailable adapter；两者都走相同 Schema/validator/plan/CAS gate。staging/production 不得绑定 deterministic fake，未配置真实 P2 provider 时诚实终结为 unavailable。

## 数据字段与不变量

正式字段、约束和状态以 `04` §17 为准；runtime 协议以 `07` §23 为准；安全/保留以 `08` §25 为准；验收矩阵以 `09` §24 为准；实施门禁以 `10` §23 为准。

关键不变量：

- `memory_resolution.authority_id + resolution_revision` 表达 A1 stable authority CAS；历史 row `id` 仍是不可变 revision-row identity，禁止原地覆盖旧 Resolution。
- checkpoint、member、layer identity、revision、revision member 和 Long source manifest 全部 append-only、count/order/hash 完整且同 scope。
- Mid 不跨 session；Long 可跨 session 但不得跨 project，并且 source session set 必须等于完整 final Mid manifest 的实际集合。
- active Boundary、human-confirmed target、非 active deletion/retention、source/target/policy/evidence drift 均产生零 semantic/layer committed 写入。
- duplicate/concurrent/replay 只有一个 winner；retry 不复活旧 job；rebase 不重放 stale proposal；crash/restart 不留下可读半提交；late callback 因 job CAS 失败而零写入。
- P1 final tail 只能进入一个 final Mid checkpoint；Long 只在 P1 final terminal 和 P2 final Mid succeeded 后触发一次。

## P2-A/B 到当前数据库的兼容冻结

1. checkpoint不落歧义`source_p1_final_job_id`：durable使用真实P1 `source_p1_terminal_job_id`与独立`p2_producer_job_id`；P2-B把该source当`mid_final` job的validator行为不得照搬。
2. online必须绑定Working snapshot+thread且P1 terminal为空；successful final必须绑定当前P1 v1.2 snapshot+thread+真实P1 terminal。历史v1.1 snapshot只读，新producer只允许v1.2。
3. existing `AiJob.policyRevision/retentionPolicyVersion`与checkpoint snapshot保持Int；P2 string policy revision/version只进入`memory_p2_job_projection.p2_policy_revision/p2_retention_policy_version` VARCHAR。checkpoint仅保留独立contract identity，不提供第二policy source；三类值分别CAS/验证，禁止cast或替代。
4. pending/running/failed/cancelled/unavailable不得预留final target revision/new identity ID；只有成功写回事务补齐nullable target provenance。final Mid prerequisite不可用时Long唯一terminal unavailable、零provider/target/projection。
5. `MemoryClaim.claim_revision=1`映射immutable claim；`memory_evidence_authority.authority_revision=1`是唯一evidence revision owner；`MemoryClaimEvidence`/bridge只承担`(claim_id,evidence_id,authority_revision)` pair/parity，不得称为authority，text/speaker revision从冻结input segment校验。
6. existing-slot新建Resolution row、复用stable authority ID、revision+1并`supersedes_resolution_id`指旧current row；禁止原地覆盖。
7. typed FK、旧root单一状态机与fresh/upgrade/interrupted/repeat migration语义以`04` §17为唯一实现依据。

## 明确排除

- P2-D 真实 provider/model/region/secret/真实数据、真实质量或费用验收；
- P3、PostgreSQL `pgvector`、embedding、Graph runtime；
- P4 Context budget、Director Context；
- UI、记忆管理页、API 产品面扩展；
- 修改 `apps/`、Prisma、migration、package 或 `.codex` 均不属于本次治理/契约前置提交。

## P2-C contract repair round

本回合只修复 `memory-persistence-p2c-compatibility-v1.md` 与 `04/07/08/09/10` 的正式兼容映射，不改已接收 P2-B Schema/fixture/validator 字节，不修改 Prisma、migration、repository、runtime、package 或 `.codex`。

- retention root_kind 固定为 `checkpoint|layer_revision|job|trace`；Long projection 不是 root；live reference 全部 `RESTRICT`，唯一 `SET NULL` 仅 cleanup/audit pointer，不使用数据库 `CASCADE`；
- stable resolution authority 使用可被 FK 引用的 registry，`origin_thread_id` 恢复 NOT NULL；Long 无法继承可证明 thread 时只能 unavailable；
- 独立 `MemoryEvidenceAuthority` 承担可跨 claim 复用的 evidence identity，`MemoryClaimEvidence` 只承担 claim/evidence pair link；
- durable checkpoint/job/Trace source refs 统一冻结 `deletion_scope_digest`；memory Trace 使用现有非空字段的 neutral sentinel；
- 拆分 P1 terminal 与 P2 producer、明确非 success target NULL、Int/string policy 分列、migration fingerprint/cursor/interruption 语义与稳定 P2 error-code registry。
- `memory-persistence-p2c-physical-fk-v1.json` 逐条冻结 physical FK、P2-B view boundary、retention root view 列映射以及当前 predecessor migration IDs/checksums、fingerprint、advisory lock、cursor 和 transaction/retry 规则。
- Trace source reference 使用 typed nullable `source_checkpoint_id/source_job_id/ai_job_input_segment_id/evidence_id/resolution_authority_id` 与 source-kind/ exactly-one CHECK；`deletion_scope_digest` 仅是 non-null SHA-256 scalar/CAS fact，不是 FK。
- 本轮 6de1d96 correction：`memory_resolution.authority_id` 物理 FK 对 legacy 保持 nullable，P2 新写入由 CHECK/trigger/reader gate 强制非空；P2-B string policy 只读取 projection 的 `p2_policy_revision`/`p2_retention_policy_version` VARCHAR，旧 AiJob Int 仅 legacy snapshot且禁止 cast；migration manifest 自校验恰好 26 条 checksum、upgrade expected_count=26，canonical predecessor fingerprint 固定为 `2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6`。
- integration correction：Trace 五个 typed source FK 列全部物理 nullable，且不进入 `source_reference_non_null_columns`；source-kind CHECK + `num_nonnulls(...)=1` 才决定每行唯一 target。`trace_id/source_kind/source_revision/membership_digest/deletion_scope_digest/input_order` 保持非空，并由 machine positive/negative cases 防止误放宽。
- pre-integration `c3eaa4ae…` REQUEST_CHANGES correction：source-kind 增加五值闭域 CHECK，Trace parent/child 逐列归位；Evidence revision owner 统一到 `memory_evidence_authority.authority_revision`；P2 string policy source 收敛为 projection-only，checkpoint只保留legacy Int snapshot与独立contract identity。该记录仅关闭三项P1候选修复，不构成PASS/DONE。

该回合完成后仍需新的独立审查；不得把 docs-only 修复宣布为 P2-C implementation PASS/DONE。

## 验收与审查

- 当前只执行 Markdown、链接、表格与 diff 检查；不运行远端 CI。
- 后续 implementation exact head 必须通过 `09` §24 的 fresh/upgrade/repeat migration、PostgreSQL repository/integration、duplicate/concurrent/retry/rebase/crash/restart/late/final-tail/rollback、retention/deletion/trace/evidence 及 deterministic/unavailable 矩阵。
- REV-065 是待审占位，不包含审查结论。执行窗口不得自行标记 PASS/DONE、merge 或启动 P2-D。
