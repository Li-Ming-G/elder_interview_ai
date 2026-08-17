# MEMORY-T2-T4-RUNTIME-001｜Memory Maintainer V1.1 Durable Runtime

状态：`REVIEW`

## 基线与映射

- base：`main@d48e022a5e3a6ed7fde5beb11b9c214f2509c9ae`，main CI `32007442074` SUCCESS；
- contract：PR #67 accepted `02706534` / CI `32006749030` / PASS comment `5313281208`；old `fdd309a` / CI `32004656762` / REQUEST_CHANGES `5313116887` 永久保留；
- mapping：T2/Foundation、T4/P1、T18-T19/P6、T0/Observability；
- branch：`codex/memory-t2-t4-runtime-001`。

## 目标

按正式 `memory-maintainer-v1.1` 实现 forward-only Prisma migration、唯一 MemoryClaim/Resolution value authority、durable new/overlap batch、freeze/call/writeback CAS、startup/periodic scanner、session final flush、failed retry、transcript-owned consumption、immutable snapshot reader 和 post-session single-producer cutover。

## 边界

- 只接 provider-neutral local/test fixture 与 unavailable port，不接真实 provider/secret/data；
- 不实现 Context V2、P2/P3/P4/UI/生产试点；
- P1 失败不得影响录音、ASR 或 transcript；
- 不修改 `.codex/iteration-learning.md`；
- 状态保持 REVIEW，等待项目负责人 exact-head 独立审查。

## 验收

- fresh、current-main legacy sentinel upgrade、repeat migration；
- partial unique/retry predecessor、consumption CASCADE/SET NULL；
- trigger truth、new/overlap、operation matrix、并发/丢通知、startup/periodic、crash/transaction rollback、stale/late fence；
- policy/deletion/transcript/evidence/target/boundary drift；
- old snapshot visibility、zero-delta、transcript isolation；
- format、lint、typecheck、unit、相关 PostgreSQL integration、build、diff check 与一次 exact-head CI。

## PR #68 正式审查与集中修复

- 首个实现 head `4bda58c22cc99cd2339767d2ceccfddc45176256` / exact-head CI `32017818045` SUCCESS 永久保留；项目负责人独立审查在 comments `5314799838`、`5314826620` 给出 `REQUEST_CHANGES`，正式合计 P0=0/P1=4/P2=0。
- P1-1：不改写已评审 migration；新增 forward migration，把 v1.1 authority provenance 冻结为 `active|detached_session|detached_thread|detached_session_thread`，只确定性移除 official exact old-head 的两个旧 CHECK，并以 parent-delete trigger 在 FK 动作前原子 detach。
- P1-2：formal semantic validator 与 runtime writeback CAS 同时冻结 target canonical key、memory type、semantic kind、resolution/thread identity；normal/disputed 恶意漂移均失败关闭且零业务写。
- P1-3：仅 `AI_MEMORY_INPUT_DRIFT` cancelled terminal 可从稳定 base trigger 派生 deterministic rebase identity；failed 仍按原 identity/retry predecessor，其他 cancelled terminal 不被伪装为 retry。
- P1-4：legacy profile 仍只接受旧 `memory_extract` lane identity；P1 profile 只接受同 project/basis session、合法 `memory-p1-v1.1:*` terminal job，并按 succeeded snapshot 或 `MEMORY_UNJUDGED` authority 验证。
- 当前仍为 `REVIEW`。本次集中修复的新 exact head/CI 由提交后的 PR #68 review package 绑定；不自宣 PASS/DONE/merge。

## `7f5a413` re-review 邻接修复

- `7f5a4134af3154ce9f04088142df1a62e817523f` / CI `32021995353` 的正式 re-review comment `5315170627` 为 `REQUEST_CHANGES`，P0=0/P1=1/P2=0；原四项 finding 均 CLOSED，只剩 detached current-reader 邻接 P1。
- profile authority：legacy reader 只接受 `provenanceState=NULL`；P1 reader 只接受 `active`。底层 eligibility 对各自合法 legacy/active 保持支持，但一律拒绝 detached_thread/detached_session/detached_session_thread；`NULL` 不被猜成 P1 authority。
- 全库 `status=current` memory consumer 已扫描；coordinator freeze/CAS、AI output dependency、DecisionTrace eligibility、v1.1 snapshot reader 和 legacy predecessor 均无 detached 绕过。retention 状态更新不是 reader，未扩 scope；P2 未实现。
