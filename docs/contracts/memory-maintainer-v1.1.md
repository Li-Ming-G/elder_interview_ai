# Memory Maintainer V1.1 前向正式契约

状态：`REVIEW / FORWARD RUNTIME CANDIDATE`。本契约修正已接收但尚未进入 runtime 的 v1；只有本任务 non-Draft PR 的 exact head 经独立审查 `PASS` 并 merge 后，runtime 才能只加载 v1.1。v1 是 `ACCEPTED-HISTORY / PRE-RUNTIME-SUPERSEDED`，不得回退加载，也不得原地改写其 Schema/fixtures 字节。

## 1. 架构与范围

| T 任务 | P 层 | v1.1 冻结内容 |
|---|---|---|
| T2 | Foundation / Memory Contract | revision 真值、semantic/lifecycle 分离、claim/resolution authority、transcript-owned consumption |
| T4 | P1 | v1.1 Context/Output、disputed conflict set、唯一 Working producer |
| T18-T19 | P6 | `working_memory_maintain` durable retry/dedupe、final flush、scanner/recovery/cutover |
| T0 | Foundation / Observability | Context/Trace/CAS 逐值引用 DB revision，不复制完整正文或 provider payload |

本任务只交付 docs、machine Schema/fixtures、纯 semantic validator 和 contract tests；不修改 Prisma、migration、repository、scanner、post-session runtime、provider 或 UI。

## 2. `text_revision` 唯一语义

`transcript_segment.text_revision` 是从 `0` 开始的非负整数：`0` 表示从未发生正式文字修订，`N` 表示已完成 `N` 次正式文字修订。Context v1.1 明确允许 `0`、拒绝 `-1`。

freeze、`memory_maintenance_input_segment`、`ai_job_input_segment`、Decision Trace transcript membership、claim evidence 和 writeback CAS 必须逐值复制当时数据库的 `text_revision`。DB、Context membership、Decision Trace membership 与 writeback CAS 四层必须拥有完全相同的 segment key set、unique count 和逐 key revision；任一层缺失、额外、重复或 revision 不同都使整批失败。任何 reader、mapper 或 validator 都不得执行 `+1`、`-1`、truthy fallback 或“0 表示缺失”的转换。writeback 重查使用 `database.text_revision = frozen.text_revision`；不相等则整批失败关闭。`speaker_role_revision` 和 digest 同样逐值比较，但本修订不改变其既有含义。

纯函数 `validateMemoryMaintainerRevisionParity` 同时比较 DB、Context membership、Decision Trace membership 和 CAS observations；fixtures 机械证明 DB `0` 的四处 `0` 可通过，而 `0 -> 1` 偏移、负数、四层分别遗漏、额外 key 和四层分别重复均被拒绝。

## 3. Semantic 与 lifecycle 分离

新增数据库枚举 `MemorySemanticStatus = current | uncertain | disputed`，只给 `memory_resolution` 增加 legacy-nullable `semantic_status`。Legacy `NULL` 精确表示 `unavailable`：不得根据 `resolution_kind`、member 数量、value、旧 `status` 或当前代码猜回。`semantic_status IS NULL` 的旧 resolution 不得进入 v1.1 authoritative Working/Mid membership；reader 必须如实降级或排除。

既有 `MemoryResolutionStatus = current | pending_review | superseded` 只表达 resolution lifecycle，字段仍为 `status`；它不表达语义置信度。Provider output 只能提出 `semantic_status`，不得设置 lifecycle status。服务端根据事务/CAS 和现有 authority 规则决定 lifecycle。

非 disputed 的映射固定为：

| `MemoryClaim.value_kind` / proposed `value_kind` | `MemoryResolution.resolution_kind` |
|---|---|
| `exact` | `single` |
| `range` | `range` |
| `unknown` | `unknown` |

`semantic_status=disputed` 时必须满足全部条件：

1. `resolution_kind=conflict_set`，top-level `value_kind/value` 为 `null`；
2. 完整 proposed state 至少含两个不同的、eligible `claim_id`；每个 ID 必须是 target resolution 在当前同 project Context 中冻结的 claim member，不能用不同 `claim_key` 重复同一 claim 凑数；
3. operation 的 `target_resolution_id` 必须存在于同 project `current_working_memory`，且 `expected_resolution_revision` 与该 Context revision 精确相等；随机 UUID、历史/superseded target 或任意正整数 revision 均不可接受；
4. operation kind 不得为 `NEW|BRANCH|RELATED`；
5. 每个 claim 的 evidence 都属于该 operation 且属于本 job 的 `new + trusted elder + conversation` membership。

Schema 机械约束 conflict set 和 claim count；纯 semantic validator 机械拒绝 `NEW|BRANCH|RELATED + disputed`、target 不在 current Context、revision 不精确、重复/非 eligible claim identity、value-kind 映射漂移和 evidence 越界。Context 是 freeze 后的单 project authority，因此“存在于 current Context”同时是 project scope 和 current lifecycle 的机械证明。

## 4. Failed retry 与 trigger dedupe

后续 migration 新增 `AiJobType.working_memory_maintain` 与 `ai_job.attempt_no`。同一稳定 trigger identity 在 failed 后必须允许新 job retry：新 `request_id`、相同 `trigger_dedupe_key`、`attempt_no = failed.attempt_no + 1`、`retry_of_job_id` 指向直接 failed predecessor。失败 job 永久保留，不复活、不覆盖；pending/running/succeeded winner 存在时不得创建并行 retry。

正式 PostgreSQL 方案必须使用互斥 identity namespace，并用以下 partial unique indexes 取代现有全局 `ai_job_trigger_dedupe_key_key`；除 Maintainer 外的 job 保持原来“任何状态都唯一”的字节级 identity 语义：

```sql
ALTER TYPE "AiJobType" ADD VALUE 'working_memory_maintain';

ALTER TABLE "ai_job"
  ADD COLUMN "attempt_no" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ai_job_attempt_no_positive" CHECK ("attempt_no" >= 1),
  ADD CONSTRAINT "ai_job_maintainer_trigger_namespace" CHECK (
    (
      "job_type" = 'working_memory_maintain'::"AiJobType"
      AND "trigger_dedupe_key" IS NOT NULL
      AND "trigger_dedupe_key" LIKE 'memory-p1-v1.1:%'
    ) OR (
      "job_type" <> 'working_memory_maintain'::"AiJobType"
      AND (
        "trigger_dedupe_key" IS NULL
        OR "trigger_dedupe_key" NOT LIKE 'memory-p1-v1.1:%'
      )
    )
  );

DROP INDEX "ai_job_trigger_dedupe_key_key";

CREATE UNIQUE INDEX "ai_job_non_maintainer_trigger_dedupe_key"
ON "ai_job" ("trigger_dedupe_key")
WHERE "trigger_dedupe_key" IS NOT NULL
  AND "job_type" <> 'working_memory_maintain'::"AiJobType";

CREATE UNIQUE INDEX "ai_job_working_memory_live_trigger_dedupe_key"
ON "ai_job" ("trigger_dedupe_key")
WHERE "trigger_dedupe_key" IS NOT NULL
  AND "job_type" = 'working_memory_maintain'::"AiJobType"
  AND "status" IN (
    'pending'::"AiJobStatus",
    'running'::"AiJobStatus",
    'succeeded'::"AiJobStatus"
  );

CREATE UNIQUE INDEX "ai_job_working_memory_trigger_attempt_key"
ON "ai_job" ("trigger_dedupe_key", "attempt_no")
WHERE "trigger_dedupe_key" IS NOT NULL
  AND "job_type" = 'working_memory_maintain'::"AiJobType";
```

若目标 PostgreSQL/迁移器不允许在同一 transaction 中立即引用新 enum value，`ALTER TYPE ... ADD VALUE` 必须先作为独立 committed forward step，后续 DDL 才可执行；不得用 text cast 或临时第二枚举绕过。namespace check 保证 Maintainer key 非空且与旧 job key 不会跨 partial-index predicate 相撞；它不重写任何 legacy key。Migration 还必须在事务内验证 predecessor；partial index 只解决并发 winner，不替代 `retry_of_job_id`、同 scope/manifest、attempt 连续性验证。`failed`（以及不在 protected set 的 terminal row）不占 live unique slot；正式 retry policy 只允许明确 failed predecessor。

## 5. Consumption 属于 transcript 生命周期

`memory_working_consumption` 是 transcript 的不可逆“已被成功 P1 消费”子事实，而不是 AiJob/snapshot retention child。正式表约束必须满足：

- `transcript_segment_id NOT NULL UNIQUE`，FK 到 `transcript_segment(id) ON DELETE CASCADE`；
- `memory_working_snapshot_id NULL`，FK `ON DELETE SET NULL`；
- `ai_job_input_segment_id NULL`，FK `ON DELETE SET NULL`；
- project/session scope、consumed revision/digest、created_at 保留为非正文 typed facts；
- AI retention cleanup 只可把 snapshot/job-input pointer 置空，不能删除 consumption，也不能让对应 segment 再次 pending；
- transcript 正式删除时由 CASCADE 删除 consumption，因为 source segment 已不存在，不会重新被 scanner 选择；
- pending 查询只以“该 `transcript_segment_id` 是否存在 consumption”判断，不以两个 nullable AI pointer 判断。

关键 FK/唯一性必须等价于：

```sql
CREATE TABLE "memory_working_consumption" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "transcript_segment_id" uuid NOT NULL UNIQUE
    REFERENCES "transcript_segment"("id") ON DELETE CASCADE,
  "text_revision" integer NOT NULL CHECK ("text_revision" >= 0),
  "effective_text_digest" char(64) NOT NULL,
  "memory_working_snapshot_id" uuid NULL
    REFERENCES "memory_working_snapshot"("id") ON DELETE SET NULL,
  "ai_job_input_segment_id" uuid NULL
    REFERENCES "ai_job_input_segment"("id") ON DELETE SET NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
```

成功 writeback 在同一事务、同一 `job.status=running -> succeeded` CAS 中创建 snapshot、business rows 和每个 `new` segment 的唯一 consumption。任一 unique/FK/CAS/authority 检查失败则全部回滚。纯 helper 机械证明两个 AI pointer 都为 `NULL` 时 segment 仍非 pending，并拒绝同 segment 双 consumption。

## 6. 唯一 producer 与 post-session cutover

v1.1 通过且 merge 前，P1 runtime 必须保持 disabled，v1 不得加载。正式 P1 启用的同一 release/migration transaction 必须形成互斥 cutover：

- 禁止旧 post-session `MemoryService.extract` / `memory_extract` producer 与新 P1 scanner 同时写同一 `MemoryClaim/MemoryResolution` authority；
- post-session memory lane 只能调用同一 P1 `session_final_flush`，或只投影同一 P1 job 的 terminal outcome；不得再创建第二个 memory job、第二套 Context/Output Schema 或第二组 claim/resolution；
- session completion 时尚未消费的 eligible final segments 由同一 P1 authority 处理；startup/periodic scanner、finalized notification 和 final flush 只是在同一 durable trigger/consumption truth 上竞争，不是多个 producer；
- stable identity 由 session、new segment manifest 和 v1.1 contract version决定；final flush 不绕过 minimum useful、evidence、revision、policy、retention、deletion 或 CAS；
- historical `memory_extract` jobs/results 保留并受原 retention 治理，但 cutover 后不再产生新写入；actual-question lane 不受本修订影响。

受审 runtime configuration 必须显式记录 `loaded_contract_version=memory-maintainer-v1.1`、P1 enable、legacy producer disable、post-session delegation mode 和 unconsumed-final authority。纯 validator 机械拒绝未 PASS/merge 启用、加载 v1、双 producer、legacy post-session lane 或第二 final authority。

## 7. Freeze / call / writeback 与恢复

Hybrid Trigger 继续为 `(batch OR time) AND minimumUseful`，并新增同一 authority 的 `session_final_flush` trigger kind。freeze 在 session advisory lock 内选择 transcript-owned pending rows，创建 `working_memory_maintain` job、scope/input/new-overlap membership 后提交；provider 调用不持锁。

writeback 重查 Context v1.1 的 project/session/policy/deletion/retention、exact text/role revision/digest、target resolution/thread revision、semantic/lifecycle、claim/evidence 和 membership manifest。成功事务原子提交 claim/resolution/thread/boundary、snapshot/membership、transcript-owned consumption 与 succeeded CAS。

stale running terminalize 为 failed 后，同 identity 可按 §4 创建新 attempt；late callback 因旧 job 非 running 而零业务写入。crash before freeze 或 during writeback 不产生 consumption；crash after commit 已有 consumption，scanner 不会因 AI cleanup 或 pointer detach 重选。

## 8. Machine artifacts 与接收门禁

- [`memory-maintainer-context-v1.1.schema.json`](memory-maintainer-context-v1.1.schema.json)
- [`memory-maintainer-output-v1.1.schema.json`](memory-maintainer-output-v1.1.schema.json)
- [`fixtures/memory-maintainer-v1.1.fixtures.json`](fixtures/memory-maintainer-v1.1.fixtures.json)
- `apps/api/src/memory/memory-maintainer-contract-v1-1.ts` pure validators
- `apps/api/src/memory/memory-maintainer-contract-v1-1.spec.ts` contract tests

接收必须机械覆盖：v1 三文件 SHA-256 不变；revision `0/-1/+1` 与 DB/Context/Trace/CAS 完整 key-set/count/revision parity；semantic/lifecycle 分离；disputed conflict set、current Context exact target/revision、两个 distinct eligible claim IDs；failed retry/live dedupe/non-maintainer uniqueness与双向 namespace；cleanup pointer detach 后仍 consumed；同 segment consumption 唯一；PASS/merge gate 与 producer cutover。当前任务状态保持 `REVIEW`，执行 Agent 不宣布 PASS、DONE 或 merge。

## 9. 明确后置

Prisma schema、forward migration、repository/scanner/final-flush、post-session cutover runtime、P2、正式 P3/P4/Context V2、真实 provider/secret/data、UI 和生产试点全部由后续独立任务实现并复审。

## 10. Review history

PR #67 old exact head `fdd309a97e5979b092f1ef094f62c1eaecf47071` / CI `32004656762` SUCCESS 获正式 `REQUEST_CHANGES`（comment `5313116887`，P0=0/P1=2/P2=1）：revision parity 缺完整集合相等、disputed 未绑定 current Context/eligible distinct claims、dedupe validator 未执行 SQL namespace。该 old head/CI/结论永久保留；本节记录定向修复目标，不表示新 head 已 PASS。
