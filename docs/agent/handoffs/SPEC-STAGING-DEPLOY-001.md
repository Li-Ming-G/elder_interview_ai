# SPEC-STAGING-DEPLOY-001 交接

## 基本信息

- 状态：`DONE`（REV-052；仅 docs/machine contract 范围）
- base：`origin/main@1eb26b2f0f6f56d72b9646f3c5e876ad4cbb4228`
- branch：`codex/spec-staging-deploy-001`
- PR：[PR #54](https://github.com/Li-Ming-G/elder_interview_ai/pull/54)（非 Draft、MERGED）
- 首个提交 exact head / CI：`235a3df6a5431b72d21dd13820628280067a4a61` / [`31798290760`](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31798290760) SUCCESS
- old reviewed exact head / CI：`195c4be2c4cd9277036e6a8759ab15e00e984a61` / [`31798730203`](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31798730203) SUCCESS；项目负责人正式 `REQUEST_CHANGES`（P0=0/P1=1/P2=0），永久保留
- 定向修复 accepted head / CI：`64cf94f33c957dc1a1ff74cbf49e35bd1c44698b` / [`31808762082`](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31808762082) SUCCESS；项目负责人正式 PASS（P0/P1/P2=0）
- merge/main：`751a32e1ffbae12ec639230cd3bf8482d1ff2820` / [`31815415871`](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31815415871) SUCCESS

## 已冻结

1. Quick 只作随机 URL 的 synthetic/fictional 远程排练；Named 才是固定域名 staging；本阶段两者都只允许从源头为测试创作的虚构数据，真实来源即使去标识/脱敏也禁止。
2. Named 单一 hostname 同源承载 Web、`/api/v1`、upload 与 `/ws/interviews`；HTTPS/WSS，HTTP 仅 edge redirect。
3. Access 是外层可达性门禁，应用 session/role/assignment/consent/restriction 是独立业务门禁；首版无 SSO/自动账号映射。
4. production Cookie、Origin、CSRF、WS join 不因 Access 降级；origin/LAN 直连与伪造 proxy headers 必须失败。
5. Windows 无人登录冷启动、禁止睡眠/休眠、磁盘水位、异机加密备份、空环境恢复、外部断电监控和逐层回滚是 DEV 硬验收。
6. 单机为 SPOF，不宣称 HA；唯一服务端 machine authority 为 `data_mode=synthetic_only`，所有身份/授权/删除/provider/QA 门禁独立保留。

## 项目负责人 old-head 审查与唯一 P1

- 审查仓库/分支/PR：`Li-Ming-G/elder_interview_ai` / `codex/spec-staging-deploy-001` / [PR #54](https://github.com/Li-Ming-G/elder_interview_ai/pull/54)。
- 严格绑定 old head `195c4be2c4cd9277036e6a8759ab15e00e984a61`、CI `31798730203` SUCCESS；正式结论 `REQUEST_CHANGES`，P0=0/P1=1/P2=0。
- 唯一 P1：`synthetic/deidentified` 与 `real_data_allowed=false` 形成解释/机器双义，可能把真实来源数据经脱敏后错误升级；缺少唯一 machine authority、readiness 机械核对及 connect/upload/persist 前零副作用拒绝。
- 定向修复只把当前阶段统一为 synthetic/fictional only，新增正式 `staging-deployment-manifest-v1` Schema、唯一 `data_mode=synthetic_only` 和 manifest/provenance 正反 fixtures；不重写已通过的 Cloudflare/Access/WS/Windows/备份设计，不启动第二次 iteration-coach。
- old head、CI、REQUEST_CHANGES 与 P1 永久保留。新 head/CI 只形成定向复审候选，不能自行覆盖旧结论或宣布 PASS。

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
- P1 定向修复 machine contract：`staging-deployment-manifest-v1` Schema fixtures 5/5、admission provenance fixtures 6/6 PASS；使用仓库既有 `@elder-interview/api` 的 Ajv 8.20.0，未新增依赖。
- P1 定向修复回归：23 个 Markdown/JSON contract/governance 文件 scope、21 个 Markdown 相对链接/表格列数、format、diff、lint、typecheck、build 与 61 files / 372 unit 全部 PASS；完整 integration/auth/smoke/E2E 由 new exact-head GitHub CI 继续执行。

## 失败与重跑历史

1. 第一版只读 Markdown 检查命令因 PowerShell `"$file:"` 变量边界语法错误，在读取/断言前退出；改为 `${file}` 后执行。随后全文件表扫描又把 inline code 中的 `|` 误判为分隔符，并对根目录文件使用空 parent；改为忽略 code span pipe、根目录 parent=`.` 后，19 文件全通过。未修改文档目标来迎合检查。
2. 一次只读 Compose 路径查询误用不存在的 `compose.yaml`；实际文件为 `docker-compose.yml`。该组合命令中的 diff/format 仍通过，但错误永久保留；随后只读确认 `postgres-test` healthy。
3. 首次 smoke 使用默认 4173，在测试启动前因 `EADDRINUSE` 退出；未终止未知/并行进程。改用 3111/4181 后 smoke PASS，ordinary E2E 使用 4182 为 27/27。
4. 首次 auth Chromium 隔离配置把 API 设为 3112，但现有 Vite proxy 固定指向 3101，五条均因 `ECONNREFUSED 127.0.0.1:3101` 失败；未改代码/测试。保持隔离 Web 4183、恢复正式 API 3101 后 5/5 PASS。旧 5 failures 不被绿灯覆盖。
5. 补写首轮 PR/CI 证据后的首次组合门禁中，`format:check` 与 `git diff --check` 已通过，但 docs-only 检查直接读取 Git 默认 quoted path，中文文件名被转义并带引号，误报 10 个根目录 Markdown 为非文档后退出；这是检查器输入解析失败，不是范围污染。改用 `git -c core.quotepath=false diff --name-only` 后重跑，旧失败永久保留。
6. P1 修复后的首次 Schema fixture 命令从仓库根直接 `import 'ajv'`，因 root package 未直接暴露该传递依赖而以 `ERR_MODULE_NOT_FOUND` 退出；未安装依赖、未改 package/lockfile。随后通过已正式声明 Ajv 8.20.0 的 `@elder-interview/api` workspace 执行相同只读 validator，Schema 5/5、admission 6/6 PASS；旧失败永久保留。
7. P1 修复后的首次批量 Prettier 命令把 PowerShell 文件数组放在 `--` 后传递，数组被拼成一个长参数并报 `No files matching the pattern`；第一次 splatting 修正又把 tracked/untracked 两组输出保留为两个嵌套数组，因而收到两个长参数并再次同样失败。两次均未格式化或改写文件；首个组合命令的 `git diff --check` 已通过，且 code/dependency/CI diff 为空。随后把路径逐项追加为扁平数组再 splat，对同一精确文件集重跑；旧失败永久保留。
8. 并行本地回归中的首个 Markdown 范围检查又用字符串相加拼 tracked/untracked 路径，Node 收到一个长文件名并报 `OUT_OF_SCOPE`；后续 `git diff --check` 又覆盖了该子进程非零退出码，使 shell 表面为 0。该轮 lint/typecheck/build、372 unit、Schema 5/5 与 admission 6/6 仍各自真实通过，但链接/表格不据此记绿；改用扁平数组、逐项 path delimiter join 和显式 `$LASTEXITCODE` 检查后重跑，旧失败永久保留。

## 审查重点

- Quick 是否绝无真实数据、固定入口、Access/稳定性暗示；
- Named 是否整站 Access 覆盖且无 path/Bypass 旁路；
- Access/app session、Cookie/CSRF/Origin/WS 权限是否完全独立；
- origin JWT 复验、JWKS rotation、WS 最大连接年龄与紧急撤权是否避免把 Access upgrade 误写成持续授权；
- direct origin、非受信 peer/客户端 IP 伪造、Windows 重启/睡眠、磁盘满、备份不可恢复、主机断电不可见是否都有负例；
- 回滚是否禁止切 Quick/公开 origin/降级真实数据门禁；
- DEV 卡是否只解锁 synthetic staging，所有既有真实试点门禁是否保持。

## 下一步

本 SPEC、ADR-041 与 REQ-020 已在契约范围收口。DEV-STAGING-DEPLOY-001 继续 `BLOCKED`，等待独立实施授权、部署资源及 trusted ingress/proxy/header/origin 防直连、Tunnel/Access/Windows/备份恢复/监控的实现与 exact-head 验收；不得将契约 DONE 外推为已部署或真实数据获许可。
