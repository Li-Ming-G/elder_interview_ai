# DEV-001A｜工程骨架与可重复工具链

## 基本信息

- 状态：`DONE`
- 负责人：工程基础实现 Agent（Archimedes）
- 前置依赖：`DEC-001`
- 分支：`feature/DEV-001A-engineering-foundation`
- 提交：`fb99560d56988500c39ac996189e80313c173d9e`
- 交接对象：总控 Agent

## 目标

建立可从干净检出重复安装、构建、测试和迁移的 pnpm workspace、Web/API 最小入口与 PostgreSQL 工具链，不实现账号、会话或业务功能。

## 输入依据

- `AGENTS.md`、`00`、`01`、`02`、`04`、`05`、`08`、`09`、`10`
- `docs/agent/03-architecture-decisions.md` 的 `ADR-007`、`ADR-008`、`ADR-010`
- `docs/agent/05-handoff-log.md` 最新交接

## 允许修改范围

- `apps/web/`、`apps/api/`；
- `packages/contracts/`、`packages/config/`、`packages/eslint-config/`、`packages/shared/`；
- `infra/`、`scripts/`、`tests/`；
- 根工程配置、依赖、锁文件、CI、`.env.example`；
- 本任务对应的 `docs/agent/` 记录。

## 明确不做

- 不建立 `user`、`auth_session` 或业务数据表；
- 不实现登录、会话、RBAC、项目、音频、ASR、AI、导出或删除；
- 不启用 Redis、BullMQ、Nginx；
- 不把占位机器契约标记为正式；
- 不接入真实外部供应商或提交真实密钥。

## 交付物

- Node/pnpm 版本约束、workspace 和锁文件；
- React/Vite Web 与 NestJS API 健康入口；
- ESM strict TypeScript、format、lint、typecheck、unit、build 根脚本；
- 配置校验、统一错误外壳和 JSON 日志基础；
- Prisma 7、PostgreSQL dev/test Compose、空迁移基线；
- Web/API/DB 烟雾测试；
- GitHub Actions 默认 CI 外壳；
- 更新后的追踪、任务与交接记录。

## 验证命令

```powershell
node --version
pnpm.cmd --version
pnpm.cmd install --frozen-lockfile
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test:unit --run
docker compose config
docker compose up -d postgres postgres-test
pnpm.cmd db:migrate:deploy
pnpm.cmd db:migrate:status
pnpm.cmd test:integration --run
pnpm.cmd build
pnpm.cmd test:smoke
pnpm.cmd test:e2e:install
pnpm.cmd test:e2e
git diff --check
git status --short --branch
```

## 验收标准

1. 干净检出可重复安装和执行全部根门禁；
2. 空 PostgreSQL 测试库可从零执行迁移，重复 deploy 无漂移；
3. 缺失关键配置时 API 明确失败且不输出配置值；
4. Compose 不包含真实密钥，仅有 PostgreSQL 开发/测试服务；
5. 没有账号、会话或后续业务实现；
6. 实际命令和结果写入交接日志并提交 Git。

## 风险与审查

- 首次依赖安装和 Playwright 安装可能需要网络批准；
- Prisma 7 的 ESM/驱动适配器必须在本任务最早验证；
- REV-004 的 E2E、静态资产 smoke 与日志问题已关闭；REV-005 为 `PARTIAL`（P0/P1 为 0），尚需候选提交后的干净检出复跑；
- 本任务不替父任务解锁业务开发，完成后只允许启动 `DEV-001B`。
