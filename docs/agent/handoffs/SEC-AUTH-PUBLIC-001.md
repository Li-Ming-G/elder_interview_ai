# SEC-AUTH-PUBLIC-001 实现交接｜公共网络身份、会话与代理边界加固

## 身份与状态

- base：`origin/main@1eb26b2f0f6f56d72b9646f3c5e876ad4cbb4228`。
- branch：`codex/sec-auth-public-001`。
- PR：[非 Draft PR #55](https://github.com/Li-Ming-G/elder_interview_ai/pull/55)。
- commits：contract-first `84b009e23ce26cbdc45ff1c3d414d5a2cf961647`；runtime/test `02dc367`；最终审查 exact head 以 PR 当前 head 为准。
- 状态：`REVIEW`。实现者没有也不得宣布 PASS/DONE、接受 ADR-041、解决 CON-008/DEV-001B 或合并 PR。
- iteration-coach：本任务恰好一次独立只读复核，结论 `Clear / NO-PAUSE`；未重复运行。

## 已交付

1. `staging|production` 统一使用 `__Host-elder_interview_session`，并设置 Secure、HttpOnly、SameSite=Strict、Path=/；local/test 保留非 Secure 本地 Cookie。所有 REST/WS Cookie consumer 复用同一环境映射。
2. 未知账号失败写入窄 `anonymous` audit actor：用途分隔 HMAC subject reference 与 client IP hash，不持久化邮箱/IP 原文；数据库 CHECK 约束 actor/entity 形状。已知账号失败继续归属 user actor，客户端统一 `INVALID_CREDENTIALS`。
3. 默认 `ClientIpResolver` 只认 TCP 直接对端，规范化 IPv4-mapped/IPv6 zone，忽略 `Forwarded`、`X-Forwarded-For`、`CF-Connecting-IP`。Cloudflare Access/header 不产生应用 principal、role、assignment、audit actor 或 session。
4. authenticate touch、CSRF rotate/verify 在数据库持久 session 仍未撤销、未到 absolute/idle expiry 且用户 active 时才成功；并发 revoke 先提交时后续动作失败关闭，撤销原因不被竞态覆盖。
5. malformed Cookie、伪造 Access/代理 header、REST/WS 无应用 Cookie、匿名审计原文泄露、匿名 DB shape、staging Cookie 与撤销竞态均有自动反例。

## 本地验证

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test:unit --run`（64 files / 382 tests）、`pnpm build`、`pnpm audit --prod`、`git diff --check`：PASS。
- 专用空 PostgreSQL：16/16 migrations deploy、status、第二次 deploy/status：PASS；临时库已删除。
- `pnpm test:integration --run`：14 files / 84 tests；`pnpm test:auth --run`：4 files / 26 tests。
- `pnpm test:smoke`：PASS；普通 Chromium：27/27；auth Chromium clean rerun：5/5。
- 旧失败永久保留：在同一串行命令中，smoke 和普通 Chromium 通过后，首次 auth Chromium 启动因本地 `127.0.0.1:3101` 短暂占用退出；只读复核时端口已自动释放，随后单独 clean rerun 5/5。该基础设施失败不改写为不存在。

## 明确边界与后续审查

- 本任务没有读取/请求真实凭据、没有启用公网、没有创建或修改 Cloudflare/Tunnel/Access/Nginx 配置。
- SPEC-STAGING-DEPLOY-001 仍独占受信入口、origin 直连阻断、可信代理集合、唯一客户端 IP header、hop、TLS 回源与异常规则。本任务只交付 resolver seam；在该 SPEC exact-head PASS/merge 前不得新增 header adapter。
- 默认直接对端策略在反向代理后可能把请求聚合到代理 IP，只证明安全失败关闭，不证明公网限流公平性或容量。
- 项目负责人须绑定 PR exact head 检查：匿名 migration/DB constraint 与摘要最小化；Access/应用账号职责分离；Cookie/Origin/CSRF；session 撤销竞态；proxy header 反例；错误/日志不泄露；完整 CI。
- CI 成功仍只到 REVIEW。项目负责人明确 PASS 前，ADR-041 保持 Proposed，CON-008/DEV-001B 保持 REVIEW，PR 不得合并，公网与真实身份/真实访谈继续禁止。
