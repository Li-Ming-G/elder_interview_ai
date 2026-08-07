# HO-034｜DEV-005C 服务端会话安全结束实现候选

- 分支：`codex/dev-005c-session-finalization`
- 状态：`REVIEW`；项目负责人尚未给出 PASS
- 完成：stop/recover、统一 snapshot、持久 finalization/commitment、单 session 唯一 interview object、同锁最新授权门禁、受限补传、manifest/ASR 降级门禁。
- Migration：`20260807190000_session_finalization`，local/test deploy 通过，local status up-to-date。
- 验证：format/lint/typecheck、unit 123/123、integration、auth 13/13、build、smoke 均通过；最终数字以 PR head 复跑为准。
- 边界：未实现真实 ASR/云存储/队列/前端；runtime 无法证明 drain 时持久为 `degraded`，不伪造 `drained`；DEV-005D 继续 BLOCKED。
