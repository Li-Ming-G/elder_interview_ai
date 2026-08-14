# SEC-AUTH-PUBLIC-001｜公共网络身份、会话与代理边界加固

## 基本信息

- 状态：`DONE`（REV-053；应用身份/会话与 direct-peer fail-closed seam 范围）
- 分支：`codex/sec-auth-public-001`
- 原 content 基线：`origin/main@1eb26b2f0f6f56d72b9646f3c5e876ad4cbb4228`
- latest-main integration 基线：`origin/main@751a32e1ffbae12ec639230cd3bf8482d1ff2820`
- PR：[非 Draft PR #55](https://github.com/Li-Ming-G/elder_interview_ai/pull/55)
- 候选提交：contract `84b009e23ce26cbdc45ff1c3d414d5a2cf961647`；runtime `02dc367`；content review head `01018376002b475fd7715ca9b3cb8ee6333a3a72`
- 负责人：独立 SEC-AUTH-PUBLIC-001 执行任务
- 审查：项目负责人已对 content head `01018376002b475fd7715ca9b3cb8ee6333a3a72` / CI `31798421917` 与 latest-main integration exact head `d67dd12de5010f49e5ad97733a9c33aecea0c5c5` / CI `31816652463` 分别手动 PASS（P0/P1/P2=0）；merge/main `8bcf65b2575841277ca7f885cdb783d57494b01e` / main CI `31817732960` SUCCESS
- iteration-coach：恰好一次独立只读复核，结论 `Clear / NO-PAUSE`

## 当前证据

- 本地 format/lint/typecheck、unit 382/382、build、生产依赖审计、diff check 通过；
- 空 PostgreSQL 从零应用 16 个迁移、status、重复 deploy/status 通过；integration 84/84、auth 26/26；
- smoke、普通 Chromium 27/27、auth Chromium 5/5 通过；auth Chromium 首次启动曾因前序门禁短暂占用本地 3101 端口失败，端口自动释放后 clean rerun 通过，旧失败永久保留；
- content head `0101837` / CI `31798421917` 已获项目负责人正式手动 PASS（P0/P1/P2=0）；GitHub APPROVE 因 integration 403 未写入但不改变审查事实；
- latest-main integration 已获 exact-head PASS 并合入；branch-local ADR-041 仅机械映射为 canonical ADR-042，旧提交与历史不改写。DONE 不允许外推为启用公网或 trusted ingress 已实现。

## 目标

把 DEV-001B 内部身份 seam 迁移为可进入“响应式网页 + Cloudflare”部署审查的应用身份边界，同时保持当前不启用公网、不读取真实凭据、不处理真实身份/访谈数据。

## 输入依据

- `AGENTS.md`、`00` 至 `10` 适用章节；
- ADR-009/010、CON-008、DEV-001B、REV-007、HO-006；
- latest-main 当前代码、测试和治理事实；
- 用户已选网页 + Cloudflare 方向，以及并行 SPEC-STAGING-DEPLOY-001 不得被本任务预定义的限制。

## 允许范围

- contract-first 修订 `02/04/05/08/09/10`、ADR、冲突/任务/追踪/交接；
- AuthModule 的密码、登录限流、匿名失败审计、Cookie/Origin/CSRF、session rotation/revocation、错误最小化；
- 窄 `ClientIpResolver` 接口与默认直接对端实现；
- Access/转发 header 不授予身份或影响客户端 IP 的自动反例；
- additive Prisma enum migration、相关配置和测试。

## 明确不做

- 不启用公网，不读取或请求真实凭据，不创建 Cloudflare/Nginx/Tunnel/Access policy；
- 不选择 Cloudflare 客户端 IP header、可信 CIDR、代理跳数、TLS 回源或 origin 直连策略；
- 不用 Access identity 替代应用账号，不新增 JWT/OIDC/MFA/自助注册找回；
- 实现/审查阶段不自行标记 PASS/DONE、不自行合并 PR；最终治理收口只登记项目负责人既有 PASS/merge 事实，且不清除旧失败/审查历史。

## 实施顺序

1. 单独 contract/governance commit 冻结匿名 actor、外部 HTTPS Cookie、应用身份/Access 分责、session 原子条件与部署 resolver 接缝；
2. 实现不依赖 Cloudflare部署语义的 runtime 与反例；
3. 完整本地门禁、非 Draft PR、exact head CI 和 REVIEW 审查包；
4. Cloudflare header/hop/origin 直连实现等待 DEV-STAGING-DEPLOY-001 exact-head 实现与审查；SPEC-STAGING-DEPLOY-001 的契约 PASS/merge 不等于部署完成。

## 验收标准

- `09` §8.1A 全部适用反例自动化通过；
- 空 PostgreSQL 全迁移与重复 deploy 通过；
- format/lint/typecheck/unit/auth/integration/build/smoke/普通 Chromium/auth Chromium/依赖审计/diff check 全部通过；
- 审计/日志/错误无邮箱、IP、密码、Cookie、CSRF、Access header、SQL、堆栈或配置值原文；
- accepted integration exact head CI 成功且项目负责人明确 PASS；DONE 仅限本任务卡声明范围。

## 风险与门禁

- 若部署 SPEC 最终选择跨源、允许绕过 Cloudflare 直连 origin，或用 Access identity 替代应用账号，必须重开 ADR-009 和身份/CSRF/审计契约；
- CON-008 已随 REV-053 的 exact-head 数据迁移与安全证据接收而 RESOLVED；旧无证据误关与 REVIEW 历史永久保留；
- CI/PASS/DONE 不代表 trusted ingress、origin 防直连、公网、真实身份运营或真实试点可用。
