# SEC-AUTH-PUBLIC-001 实现交接｜公共网络身份、会话与代理边界加固

## 身份与状态

- base：`origin/main@1eb26b2f0f6f56d72b9646f3c5e876ad4cbb4228`。
- branch：`codex/sec-auth-public-001`。
- PR：[非 Draft PR #55](https://github.com/Li-Ming-G/elder_interview_ai/pull/55)。
- commits：contract-first `84b009e23ce26cbdc45ff1c3d414d5a2cf961647`；runtime/test `02dc367`；content review head `01018376002b475fd7715ca9b3cb8ee6333a3a72`；latest-main integration exact head 形成后以 PR 当前 head 为准。
- 状态：`REVIEW`。项目负责人已对 content head 正式手动 PASS（P0/P1/P2=0）；实现者没有也不得宣布 integration PASS/DONE、接受 canonical ADR-042、解决 CON-008/DEV-001B 或合并 PR。
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
- SPEC-STAGING-DEPLOY-001 的 canonical ADR-041 已进入 `main@751a32e1`；其 merge 只接收部署契约，不代表受信入口已实现。DEV-STAGING-DEPLOY-001 仍拥有 origin 直连阻断、可信代理集合、唯一客户端 IP header、hop、TLS 回源与异常规则的实现/验收。本任务只交付 resolver seam，runtime 继续 direct peer，不新增 header adapter。
- 默认直接对端策略在反向代理后可能把请求聚合到代理 IP，只证明安全失败关闭，不证明公网限流公平性或容量。
- 项目负责人须绑定 PR exact head 检查：匿名 migration/DB constraint 与摘要最小化；Access/应用账号职责分离；Cookie/Origin/CSRF；session 撤销竞态；proxy header 反例；错误/日志不泄露；完整 CI。
- 编号保全：content head 中 branch-local ADR-041 的字节与审查历史不改写；latest-main 的 canonical ADR-041 属于 staging SPEC，本 integration 机械映射 SEC 决定为 canonical ADR-042。
- content PASS 不自动覆盖 integration。项目负责人明确接收 new integration exact head 前，ADR-042 保持 Proposed/REVIEW，CON-008/DEV-001B 保持 REVIEW，PR 不得合并，公网与真实身份/真实访谈继续禁止。

## Latest-main integration

- 输入 main：`751a32e1ffbae12ec639230cd3bf8482d1ff2820`；包含 PR #54 merge-only 结果。外部审查事实为 #54 accepted head `64cf94f33c957dc1a1ff74cbf49e35bd1c44698b`、merge/current main `751a32e1ffbae12ec639230cd3bf8482d1ff2820`、main CI `31815415871` SUCCESS；SPEC/ADR/DONE 联合治理 closeout 明确后置，本 integration 不代做。
- 合并策略：以非快进 merge 保留 main 与 #55 content 两条祖先；只人工保全 10 §17/§18、ADR-041/042 与 handoff index 冲突，不重写 content commit。
- 迁移：#54 为 docs/machine contract，无 Prisma migration；SEC 的 `20260814120000_public_auth_security` 与 `20260814121000_public_auth_audit_shape` 继续排在 latest main 既有 `20260812143000_dev008a2_create_idempotency` 之后。
- integration 本地旧失败：首轮完整 unit 中既有 `workbench-shell` 的“running verification 收到 401 后返回登录”异步断言在 1 秒内未出现按钮，381/382；没有代码字节漂移，也未修改实现或测试。随后该文件 clean rerun 39/39、完整 unit clean rerun 382/382。旧失败永久保留，不被绿灯覆盖。
- integration 数据库旧失败：首次复用共享 `elder_interview_test` 时，其他套件/任务残留的 `ai_job_input_segment` 外键、question-bank release 与 generation attempt 阻断清理并导致 integration 失败/跳过；未重置或删除共享库、未改代码/测试。改用从 16 migrations 创建的专用隔离库后 integration 84/84、auth 26/26，通过后专用库已删除。旧污染失败永久保留。
- integration 本地最终矩阵：format/lint/typecheck、build、生产依赖审计、diff check PASS；unit 64 files / 382 tests；专用空库 16 migrations + status + repeat deploy/status；专用 suite DB integration 14 files / 84 tests、auth 4 files / 26 tests；专用 E2E DB smoke、ordinary Chromium 27/27、auth Chromium 5/5 全部 PASS。所有专用数据库均在验证后删除。
- 新 integration exact head/CI、本地矩阵与窄复审结论形成后追加；此前 PR 保持 OPEN、非 Draft、REVIEW。
