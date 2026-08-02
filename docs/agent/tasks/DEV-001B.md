# DEV-001B｜身份、会话与权限基础

## 基本信息

- 状态：`READY`
- 负责人：待分配（工程基础实现 Agent）
- 前置依赖：`DEV-001A`
- 分支：`feature/DEV-001B-auth-session-rbac`
- 提交：待产生
- 交接对象：总控 Agent；完成后必须由独立安全/工程审查 Agent 验收。

## 目标

在已验证工程骨架上实现 MVP 最小本地身份、不透明会话、角色门禁和资源授权接口，为后续项目访问隔离提供安全基础。

## 输入依据

- `AGENTS.md`、`00`、`01`、`02`、`04`、`05`、`08`、`09`、`10`
- `ADR-009`
- `DEV-001A` 最新交接和提交

## 允许修改范围

- `apps/api/` 的 AuthModule、会话、Guard、授权接口和安全中间件；
- `apps/web/` 的最小登录与会话状态外壳；
- `packages/contracts/` 的正式认证 DTO/错误枚举；
- Prisma 中 `user`、`auth_session`、`auth_login_throttle`、身份/会话所需 `audit_log` 及其迁移；`boundary_candidate` 属后续边界任务，不在本任务实现；
- local/test 虚构身份 seed；
- production 用户创建、交互式密码重置、停用和启用的受控运维 CLI `user:create`、`user:set-password`、`user:disable`、`user:enable`；
- 相关测试、配置和 `docs/agent/` 记录。

## 明确不做

- 不实现项目、服务条款、授权、音频、ASR、AI、回顾、导出或删除业务；
- 不实现 OAuth/OIDC、短信、邮件找回、JWT access/refresh 体系或多因素认证；
- 不允许 production 测试 seed、默认账号或默认密码；
- 不使用 Redis 会话存储。

## 交付物

- Argon2id 本地账号密码；
- 登录、登出、当前身份 API；
- PostgreSQL 哈希不透明会话；
- HttpOnly/SameSite/Secure Cookie 与 CSRF/Origin 防护；
- 角色 Guard 和服务层资源授权接口；
- 虚构测试身份显式 seed；
- 未认证、越权、停用、撤销、会话隔离和授权接口自动测试；
- 独立审查所需交接和复现命令。

## 验证命令

除重复执行 DEV-001A 全部门禁外，至少执行：

```powershell
pnpm.cmd test:auth --run
pnpm.cmd test:integration --run
pnpm.cmd test:e2e -- --project=chromium
pnpm.cmd audit --prod
git diff --check
git status --short --branch
```

## 验收标准

1. 未登录 401、无角色或资源权限 403；
2. 使用不落业务表的合成 ownership/assignment 标识，验证服务层授权接口拒绝跨用户访问；真实项目级 A/B 隔离明确交由 `DEV-002`；
3. 登出、账号停用和权限撤回后旧会话失效；
4. Cookie、CSRF、Origin 和 production seed 防护符合 `02`、`05`、`08`；
5. 密码、会话原值、Cookie 和 CSRF token 不进入日志；
6. production 运维 CLI 安全创建、重置密码、停用和启用用户，不从参数或环境变量读取密码；CLI `--operator-ref` 映射审计 `actor_reference`，启用清空 `disabled_at` 但不恢复历史会话；
7. 独立安全/工程审查通过后，父任务 `DEV-001` 才能完成并解锁业务任务。

## 风险

- 若正式部署不是同源，必须重新审查 Cookie、CORS 和 CSRF；
- `pnpm audit` 结果需按可利用性判断，不能通过忽略脚本伪造通过；
- 资源授权接口只能建立模式，不能用虚构项目逻辑提前实现 `DEV-002`。
