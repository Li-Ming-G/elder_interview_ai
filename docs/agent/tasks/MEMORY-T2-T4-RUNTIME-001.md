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
