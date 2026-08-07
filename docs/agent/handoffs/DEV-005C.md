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

## REV-019 第二轮定向复审

- 审查 head：`33c9a33cc1b7ff54af30ac8eb205ad0e20ddc063`；CI `31172641955` PASS；旧四项 P1 4/4 关闭。
- 唯一新增 P1：`transcript_status=draining` 期间的并发 recover/reconcile/stop 仍可重复调用外部 `drainAndClose()`；数据库终态保护不能替代供应商 runner single-flight。
- 只允许新增按 `finalizationId` 的进程内 single-flight Promise 和对应阻塞 fake/barrier 测试；崩溃后依赖持久 `draining` 重新驱动，不新增持久队列或 migration。
- 三个 P2 继续延期；修复后提交新 final head 与完整 CI，供项目负责人再次定向复审。
