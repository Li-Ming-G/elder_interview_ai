# HO-034｜DEV-005C 实现候选与 REV-019 定向修复交接

## 实现候选

- 分支：`codex/dev-005c-session-finalization`
- PR：[#10](https://github.com/Li-Ming-G/elder_interview_ai/pull/10)（非 Draft）
- 首轮审查 head：`738898a9d18dbb77d5fefec78d5daef90fcd5a48`
- CI：`31167044756`，全部门禁 PASS
- Migration：`20260807190000_session_finalization`
- 已实现候选：stop/recover、公共 snapshot、持久 finalization/commitments、单 session 唯一 interview object、受限补传、manifest/ASR 状态门禁。

## REV-019 结论

- 项目负责人结论：`REQUEST_CHANGES`，P0=0、P1=4；CI 全绿不替代状态机审查。
- P1-1：stop/`finalize_interrupted`、撤权、upload/complete 未共享同一资源锁；统一固定锁序、锁内重读，并以 barrier 测试覆盖撤权和上传竞态。
- P1-2：补最小 ASR final drain/close seam；成功为 `drained`，不可用/超时为 `degraded`，最后 final 必须先落库。
- P1-3：runtime 丢失时读取持久 `asr_last_audio_sequence_accepted`；曾接收过 PCM 但不能证明 drain 时不得报 `not_started`，应为 `degraded`。
- P1-4：`completed|failed` 终态和时间必须稳定；每个新 stop request ID 都持久首次响应并在相同 ID 重试时原样重放。

## 边界与下一步

- 本轮只修四项 P1并补对应自动化，不接真实 ASR、云存储、队列或前端，不处理 REV-019 的三个非阻塞 P2。
- 修复后推送新的 final head，等待 GitHub 完整 CI，再由项目负责人定向复审。
- DEV-005C 保持 `REVIEW`；DEV-005D 和父 DEV-005 保持 `BLOCKED`。

## REV-019 定向修复候选

- 合并基线：普通 merge `origin/main@3eb375b`，保留 DEV-005B DONE、REV-019 与 HO-034；未改动 DEV-005B 业务代码。
- P1 修复：统一 `project → session → audio` 锁序与锁内重读；complete 全量核对 manifest/commitments；新增 ASR `drainAndClose`、final-first ingestion、不可用/超时降级；runtime 丢失读取持久接收序号；终态与逐 request 首次响应稳定。
- 自动化：真实 PostgreSQL barrier 覆盖 stop/revoke 两种排队次序和 stop/upload 扩集竞态；覆盖 ASR drained/unavailable/timeout/final-first/runtime-loss，以及 completed/failed/stop request replay。
- 本地门禁：`git diff --check`、format、lint、typecheck、unit 127/127、migration deploy/status、PostgreSQL integration 29/29、auth 13/13、build、smoke 全部通过；未新增 migration 或依赖。
- 保留风险：最小 ending seam 仍是进程内 adapter、1 秒 drain 上限，不含真实 ASR/持久队列；REV-019 三项 P2 本轮未修。等待新 final head 的 GitHub CI 与项目负责人定向复审，不宣告 PASS/DONE。

## REV-019 第二轮定向复审

- 审查 head：`33c9a33cc1b7ff54af30ac8eb205ad0e20ddc063`；CI `31172641955` PASS；旧四项 P1 4/4 关闭。
- 唯一新增 P1：`transcript_status=draining` 期间的并发 recover/reconcile/stop 仍可重复调用外部 `drainAndClose()`；数据库终态保护不能替代供应商 runner single-flight。
- 只允许新增按 `finalizationId` 的进程内 single-flight Promise 和对应阻塞 fake/barrier 测试；崩溃后依赖持久 `draining` 重新驱动，不新增持久队列或 migration。
- 三个 P2 继续延期；修复后提交新 final head 与完整 CI，供项目负责人再次定向复审。

## 第二轮修复候选证据

- 仅修改 `SessionFinalizationService` single-flight 与 PostgreSQL 定向测试；没有数据库、migration、依赖、队列、真实 ASR 或 P2 变更。
- 阻塞 adapter 证明并发同 ID recover、不同 ID reconcile 与匹配 stop 共用一个 runner；失败清理后相同 finalization ID 可重驱。
- 本地门禁：format、lint、typecheck、unit 127/127、migration deploy/status、integration 30/30、auth 13/13、build、smoke、diff check 全部通过。
- DEV-005C 保持 `REVIEW`，DEV-005D 保持 `BLOCKED`；等待 PR #10 新 final head CI 与第三次定向复审。
