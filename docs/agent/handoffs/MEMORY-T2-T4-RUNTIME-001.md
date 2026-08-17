# MEMORY-T2-T4-RUNTIME-001 任务交接

## 基本信息

- 分支：`codex/memory-t2-t4-runtime-001`
- 基线：`main@d48e022a5e3a6ed7fde5beb11b9c214f2509c9ae` / CI `32007442074` SUCCESS
- 当前状态：`REVIEW`

## 已完成

- 两段 forward-only migration：独立 enum commit + v1.1 schema/index/FK/constraint trigger；legacy-null authority 原值保留。
- `working_memory_maintain` failed retry、双向 namespace、live partial unique、attempt/predecessor/scope 校验。
- session advisory-lock batch selection、new/overlap freeze、v1.1 Schema/semantic validator、DB/Context/Trace/CAS parity、provider-neutral local/test/unavailable port。
- 原子 claim/resolution/thread/boundary/snapshot/membership/consumption writeback；policy/deletion/transcript/target/thread/boundary stale fence；旧完整 snapshot reader。
- startup/periodic/finalized wake、stale terminalization、late callback fence、post-session final-flush delegation；旧 `memory_extract` 只在 P1 disabled profile 保留，P1 enabled profile机械禁止双 producer。
- AI cleanup 只 detach consumption pointer；transcript delete 才 CASCADE consumption；P1 failure 与 transcript ingestion 隔离。
- PR #68 old `4bda58c` / CI `32017818045` 的四项正式 P1 已集中修复：forward-only provenance detach lifecycle、target identity 双层 CAS、cancelled input-drift deterministic rebase、legacy/P1 opening provenance profile。
- system-rejection terminal 现在也持久化精确 session scope/final watermark，使 `MEMORY_UNJUDGED` 既可审计也能被 P1 opening reader 严格验证。
- `7f5a413` re-review 已确认原四项 CLOSED，但 comment `5315170627` 新增 detached current-reader P1=1；本轮候选以 profile-strict CurrentMemoryReader + shared eligibility/freeze/snapshot predicate 关闭，不改 migration、不扩 P2。

## old `4bda58c` 验证历史

- targeted unit：3 files / 61 tests PASS。
- runtime/recovery PostgreSQL integration：20/20 PASS。
- 相关既有 PostgreSQL integration：3 files / 27 tests PASS。
- fresh 23 migrations、21→23 current-main legacy sentinel upgrade、repeat deploy/status：PASS；legacy query 保持 semantic/layer/session/thread/status 全 NULL，lifecycle `current` 不被误作 semantic。
- 本轮 fresh 24 migrations与 repeat deploy/status PASS；exact `4bda58c` 旧 head→新 migration 在迁移前枚举到两个正式 old all-or-none CHECK，迁移后只剩 exactly-one-root + lifecycle CHECK，实际 thread/session delete PASS；current-main legacy sentinel 经 21→24 仍保持 semantic/layer/status/session/thread/provenance 全 NULL。
- 本轮定向 unit 2 files / 62 tests PASS；PostgreSQL runtime + post-session 2 files / 30 tests PASS。完整 workspace 门禁与新 exact-head CI 在提交前/后各按任务规则完成并由 PR review package 回填。
- workspace format/lint/typecheck/build、Prisma validate、`git diff --check`：PASS；unit 73 files / 502 tests PASS。
- 两次非最终 unit 失败历史保留：第一次并行门禁负载下既有 80ms retry 时序 501/502，目标文件复跑 2/2 PASS；第二次既有前端 focus 时序 501/502，目标文件复跑 39/39 PASS；随后完整 unit 两次 502/502 PASS。未修改测试阈值或目标。
- old exact-head CI `32017818045` SUCCESS；随后正式独立审查仍返回 P1=4，该 CI 不等于 PASS。

## 本轮四项 P1 修复验证

- fresh PostgreSQL 24 migrations、repeat deploy/status、Prisma validate：PASS。
- official exact `4bda58c` migration set 升级前实际枚举两个正式 all-or-none CHECK；应用唯一 forward migration 后只剩 exactly-one-root + provenance lifecycle CHECK，实际 thread/session delete 定向测试 PASS。
- current-main 21-migration legacy sentinel 经 22→24 migration 后，claim/resolution 的 semantic/layer/status/session/thread/provenance 继续全 NULL。
- formal/runtime targeted unit 2 files / 62 tests、完整 unit 73 files / 510 tests：PASS。
- runtime + post-session targeted PostgreSQL integration 2 files / 30 tests、完整 PostgreSQL integration 16 files / 128 tests：PASS。
- format、lint、typecheck、build、Prisma validate、`git diff --check`：PASS。新 exact-head CI 在本轮唯一提交/push 后只运行一次。
- detached-reader 定向验证：相关 unit 3 files / 67 tests PASS；PostgreSQL legacy + runtime + post-session 3 files / 38 tests PASS，覆盖 active、legacy profile、P1-profile legacy-null、三种 detached、resolution/claim eligibility 与 opening Context membership。

## 未完成与边界

- 未接真实 provider/secret/data、Context V2、P2/P3/P4/UI/生产试点。
- 当前不是独立审查 PASS；不得标记 DONE 或 merge。
- PR #68 已存在；新 exact head、CI run 与最终测试总数在本次集中提交后的 PR review package 绑定。当前不宣称独立复审通过。

## 必须保留的历史

- PR #65 accepted `7d0a0460` / CI `31941029795` / merge-main `081b404e` / CI `31989367027`；
- PR #66 accepted `2244450` / CI `31994482841` / PASS `5312635580` / merge-main `27e8d8d` / CI `32001983350`；
- PR #67 old `fdd309a` / CI `32004656762` / REQUEST_CHANGES `5313116887`；accepted `02706534` / CI `32006749030` / PASS `5313281208` / merge-main `d48e022a` / CI `32007442074`。
- PR #68 old `4bda58c` / CI `32017818045` / REQUEST_CHANGES comments `5314799838`、`5314826620`（P0=0/P1=4/P2=0）。
- PR #68 next `7f5a413` / CI `32021995353` / re-review REQUEST_CHANGES comment `5315170627`（P0=0/P1=1/P2=0；原四项 CLOSED，唯一新项为 detached current reader）。
