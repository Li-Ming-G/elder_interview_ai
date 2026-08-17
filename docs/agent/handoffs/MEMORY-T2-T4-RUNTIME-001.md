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

## 验证

- targeted unit：3 files / 61 tests PASS。
- runtime/recovery PostgreSQL integration：20/20 PASS。
- 相关既有 PostgreSQL integration：3 files / 27 tests PASS。
- fresh 23 migrations、21→23 current-main legacy sentinel upgrade、repeat deploy/status：PASS；legacy query 保持 semantic/layer/session/thread/status 全 NULL，lifecycle `current` 不被误作 semantic。
- workspace format/lint/typecheck/build、Prisma validate、`git diff --check`：PASS；unit 73 files / 502 tests PASS。
- 两次非最终 unit 失败历史保留：第一次并行门禁负载下既有 80ms retry 时序 501/502，目标文件复跑 2/2 PASS；第二次既有前端 focus 时序 501/502，目标文件复跑 39/39 PASS；随后完整 unit 两次 502/502 PASS。未修改测试阈值或目标。
- exact-head CI 在最终提交后只运行一次并回填。

## 未完成与边界

- 未接真实 provider/secret/data、Context V2、P2/P3/P4/UI/生产试点。
- 当前不是独立审查 PASS；不得标记 DONE 或 merge。
- PR、exact head、CI run 与最终测试总数在形成审查 head 后回填。

## 必须保留的历史

- PR #65 accepted `7d0a0460` / CI `31941029795` / merge-main `081b404e` / CI `31989367027`；
- PR #66 accepted `2244450` / CI `31994482841` / PASS `5312635580` / merge-main `27e8d8d` / CI `32001983350`；
- PR #67 old `fdd309a` / CI `32004656762` / REQUEST_CHANGES `5313116887`；accepted `02706534` / CI `32006749030` / PASS `5313281208` / merge-main `d48e022a` / CI `32007442074`。
