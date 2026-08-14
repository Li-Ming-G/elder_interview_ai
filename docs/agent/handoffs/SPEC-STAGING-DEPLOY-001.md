# SPEC-STAGING-DEPLOY-001 交接

## 基本信息

- 状态：`REVIEW`；不得自行 PASS/DONE/merge
- base：`origin/main@1eb26b2f0f6f56d72b9646f3c5e876ad4cbb4228`
- branch：`codex/spec-staging-deploy-001`
- PR/exact head/CI：提交后补入；以 GitHub 当前 head 为唯一审查对象

## 已冻结

1. Quick 只作随机 URL 的 synthetic/deidentified 远程排练；Named 才是固定域名 staging；两者都不自动允许真实数据。
2. Named 单一 hostname 同源承载 Web、`/api/v1`、upload 与 `/ws/interviews`；HTTPS/WSS，HTTP 仅 edge redirect。
3. Access 是外层可达性门禁，应用 session/role/assignment/consent/restriction 是独立业务门禁；首版无 SSO/自动账号映射。
4. production Cookie、Origin、CSRF、WS join 不因 Access 降级；origin/LAN 直连与伪造 proxy headers 必须失败。
5. Windows 无人登录冷启动、禁止睡眠/休眠、磁盘水位、异机加密备份、空环境恢复、外部断电监控和逐层回滚是 DEV 硬验收。
6. 单机为 SPOF，不宣称 HA；`real_data_allowed=false`，所有身份/授权/删除/provider/QA 门禁独立保留。

## iteration-coach

唯一独立只读复核为 `Mode: Correction`，发生在任何编辑之前。修正已全部进入正式候选：网络/数据双轴、双身份、WS 动态失效、受信代理、无人值守、恢复验证、外部告警与回滚单位。

## 修改边界

只改文档和治理记录；未安装 Cloudflare 插件或软件，未请求 token/域名/账号权限，未改代码、Prisma、migration、依赖、CI、runtime、基础设施或 secret。

## 本地验证

- `pnpm format:check`、lint、typecheck、build、`git diff --check`：PASS；
- unit：61 files / 372 tests PASS；
- 独立 PostgreSQL `elder_interview_spec_staging_001_local`：14 migrations deploy/status PASS，integration 14 files / 84 tests、auth 4 files / 23 tests PASS；
- 隔离端口 smoke PASS；ordinary Chromium 27/27 PASS；real Web/API synthetic auth Chromium 5/5 PASS；
- 19 个精确变更 Markdown 的相对链接与忽略 inline-code pipe 的表格列扫描 PASS；docs-only scope PASS；package manifest、lockfile、CI、代码和 migration 无改动。

## 失败与重跑历史

1. 第一版只读 Markdown 检查命令因 PowerShell `"$file:"` 变量边界语法错误，在读取/断言前退出；改为 `${file}` 后执行。随后全文件表扫描又把 inline code 中的 `|` 误判为分隔符，并对根目录文件使用空 parent；改为忽略 code span pipe、根目录 parent=`.` 后，19 文件全通过。未修改文档目标来迎合检查。
2. 一次只读 Compose 路径查询误用不存在的 `compose.yaml`；实际文件为 `docker-compose.yml`。该组合命令中的 diff/format 仍通过，但错误永久保留；随后只读确认 `postgres-test` healthy。
3. 首次 smoke 使用默认 4173，在测试启动前因 `EADDRINUSE` 退出；未终止未知/并行进程。改用 3111/4181 后 smoke PASS，ordinary E2E 使用 4182 为 27/27。
4. 首次 auth Chromium 隔离配置把 API 设为 3112，但现有 Vite proxy 固定指向 3101，五条均因 `ECONNREFUSED 127.0.0.1:3101` 失败；未改代码/测试。保持隔离 Web 4183、恢复正式 API 3101 后 5/5 PASS。旧 5 failures 不被绿灯覆盖。

## 审查重点

- Quick 是否绝无真实数据、固定入口、Access/稳定性暗示；
- Named 是否整站 Access 覆盖且无 path/Bypass 旁路；
- Access/app session、Cookie/CSRF/Origin/WS 权限是否完全独立；
- origin JWT 复验、JWKS rotation、WS 最大连接年龄与紧急撤权是否避免把 Access upgrade 误写成持续授权；
- direct origin、非受信 peer/客户端 IP 伪造、Windows 重启/睡眠、磁盘满、备份不可恢复、主机断电不可见是否都有负例；
- 回滚是否禁止切 Quick/公开 origin/降级真实数据门禁；
- DEV 卡是否只解锁 synthetic staging，所有既有真实试点门禁是否保持。

## 下一步

项目负责人对本任务 non-Draft PR exact head + 完整 CI 手动审查。若 PASS/merge，再把 SPEC 转 DONE、ADR-041 转 Accepted，并将 DEV-STAGING-DEPLOY-001 转 READY；此前 DEV 保持 BLOCKED。
