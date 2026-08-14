# Staging Deployment V1 契约

状态：`CANDIDATE / REVIEW`。本文件由 `SPEC-STAGING-DEPLOY-001` 冻结；在项目负责人对非 Draft PR exact head 给出正式结论前，不得视为已接收，不得据此部署真实数据。

## 1. 目标与非目标

本契约只定义 Cloudflare + 单台持续开机 Windows 主机的早期 staging 边界与后续实现验收，不执行部署、不安装 `cloudflared`、不创建 Tunnel/Access/DNS、不索取 token 或 secret。

既定方向为：响应式网页优先；Quick Tunnel 仅远程虚构排练；正式早期试用使用 Named Cloudflare Tunnel、固定域名和 Cloudflare Access；后端暂驻一台持续开机 Windows 电脑；验证盈利后再迁云。

单台 Windows 主机、单 ISP、单磁盘是明确的单点故障（SPOF）。Cloudflare edge 的多连接不构成源站高可用，本阶段不宣称生产级可用性。

## 2. 双轴环境边界

网络可达性与数据许可互不推导：Tunnel 可用、HTTPS 正常、Access 登录或 CI 通过，都不能改变服务端唯一 machine authority `data_mode=synthetic_only`。

| profile | 网络入口 | 身份外层 | 数据许可 | 稳定性声明 | 允许用途 |
|---|---|---|---|---|---|
| `local` | localhost | 无 | synthetic/fictional only | 无公网承诺 | 本地开发与自动化 |
| `quick-synthetic` | 每次启动随机 `*.trycloudflare.com` HTTPS | 不依赖 Access | synthetic/fictional only | 无 SLA；临时 | 受控远程虚构排练、浏览器兼容性 |
| `named-synthetic` | 固定 HTTPS hostname | Access deny-by-default | synthetic/fictional only | 早期 staging；接受单机 SPOF | DEV-STAGING-DEPLOY-001 唯一可实现/验收范围 |
| future real-data task | 与 named 相同或后续受审入口 | Access + 应用身份 | 当前不存在可选 data mode | 不由本 SPEC/DEV 解锁 | 只可由新任务、数据治理决定和项目负责人正式接收后另立新版契约 |

Cloudflare 官方把 Quick Tunnel 定位为 testing/development only：每次生成随机 `trycloudflare.com` 子域名，无 SLA/uptime 保证，当前最多 200 个并发 in-flight requests，超过返回 429，且不支持 SSE。每次启动必须登记当次 URL 与精确 Origin，旧 URL/旧 Origin/旧 Cookie 随进程终止作废；不得复用为固定链接、监控目标、真实试点入口或 Named 验收证据。Quick 仅允许虚构账号、合成音频、虚构正文；不得连接真实 ASR/LLM 或加载真实备份。

### 2.1 唯一 machine authority 与入站失败关闭

1. `docs/contracts/staging-deployment-manifest-v1.schema.json` 是 DEV-STAGING-DEPLOY-001 的正式服务端 manifest Schema。唯一数据许可字段为 `data_mode`，当前唯一合法值为 `synthetic_only`；不得同时保存、读取或推导 `real_data_allowed`、`allow_real`、环境名、Access claim、hostname 等平行许可事实。
2. manifest missing、Schema unknown、`data_mode` missing/unknown/invalid/非 `synthetic_only`、digest/commit/profile 不匹配或含平行许可字段时，readiness 必须机械为 false。readiness 不能由 Dashboard、Tunnel healthy、Access 登录或人工说明覆盖。
3. 本阶段 synthetic/fictional only 表示数据从源头就是为测试创作的虚构账号、虚构正文和合成/完全虚构音频。任何来自真实长者、真实访谈、真实 PII、真实录音/转录、真实业务数据库或真实备份的数据，即使已去标识、匿名化、脱敏、截断、改名或重编码，仍是 `real-source`，不得使用；provenance 未知同样拒绝。
4. 每个 connect、upload-init/append/complete 和 persist 入口必须先读取并验证当前服务端 manifest，再机械验证输入 provenance 为 `fictional_created_for_test`。任一验证失败时，在建立 ASR/LLM/WS 业务连接、创建 upload/object/session/row/transaction、写本地 archive 或业务存储之前拒绝，`business_side_effect_count=0`；只允许内容无关的拒绝计数，不记录 payload。
5. `docs/contracts/fixtures/staging-deployment-manifest-v1.fixtures.json` 是正反例集合。DEV 必须以同一个生产 admission function 跑 manifest 与 provenance 反例，不得在测试里复制较宽松判断。

Named 使用 remotely-managed Tunnel 和一个固定 hostname，同时承载 SPA、`/api/v1/*`、上传和 `/ws/interviews`，禁止拆成跨源 Web/API/WS。Access application 覆盖整个 hostname，deny-by-default，只允许显式 Allow；不得配置 Bypass、公共 path 或更具体的 Access application/path 造成覆盖旁路。

## 3. 请求链、HTTPS 与同源

唯一公开请求链：

`browser -> Cloudflare HTTPS edge + Access -> Named Tunnel -> loopback reverse proxy -> web/api/ws`

- 公网只接受 HTTPS/WSS；HTTP 在 Cloudflare edge 统一跳转 HTTPS。页面资源只用相对路径或 HTTPS，禁止 mixed content。
- HSTS 只在固定 hostname 的 HTTPS、DNS、回滚演练稳定后单独启用；首次 DEV 不启用 preload 或 `includeSubDomains`，避免不可逆扩大故障面。
- `cloudflared` 到本机反向代理首版允许 loopback HTTP，因为该跳不离开主机；若改 HTTPS，必须验证证书链与 `originServerName`，禁止 `noTLSVerify=true`。
- 反向代理必须保留固定外部 `Host` 和 `https` scheme，向应用重建受信 proxy facts；应用生成 URL、Cookie、Origin 和 WS 判断均以固定外部 Origin 为准。
- SPA fallback 只适用于页面路由；`/api/v1/*`、`/ws/interviews`、上传、health/ready 和未知 API 路径不得回退 HTML。API/WS/上传响应禁止缓存。
- Cloudflare 支持代理 WebSocket，但只在 HTTP upgrade 阶段应用 HTTP 层规则。客户端必须保留既有 heartbeat、generation/reconnect/replay、首帧 join 和失败降级；edge 发布、idle timeout、反向代理或 `cloudflared` 重启都按可恢复断线处理，AI/ASR 故障不得影响原始录音保存。Named 必须设置可测试的 WS 最大连接年龄，不长于 Access application session duration；到期由服务端可恢复关闭并强制重新 upgrade，使 Access 至少在该上界内重评。该机制不得中断浏览器原始录音或制造第二 generation/final。

## 4. Access 与应用身份的双门禁

Cloudflare Access 只回答“请求能否抵达 origin”；应用会话继续回答“谁能访问哪个业务资源”。两层都通过才允许业务访问。

- Access 使用 self-hosted application、deny-by-default policy；无有效 Access application token 的请求在 edge/connector 前被拒绝。
- Named 的 `cloudflared` 必须启用 Protect with Access。origin/reverse proxy 还要对 `Cf-Access-Jwt-Assertion` 复验签名、issuer/team、audience 与 expiry，公钥只从 team JWKS/certs 取得并支持轮换；校验服务/JWKS 不可用且无仍有效缓存时失败关闭。不得只凭头存在放行，也不得把 JWT claims 用作应用登录或业务授权。
- 首版禁止用 Access email/subject 自动创建、启用、映射或登录应用用户；禁止用 Access group 代替应用 role、assignment、project visibility、consent、restriction/deletion。
- 应用仍要求 `__Host-elder_interview_session`：`Secure; HttpOnly; SameSite=Strict; Path=/` 且无 `Domain`；不把 Access cookie 当应用 session 或 CSRF token。
- 所有浏览器写请求继续校验精确 Origin 与会话绑定 CSRF；安全 GET 在带 Origin 时继续校验。WS upgrade 校验精确 Origin + 应用 session cookie，首个 `session.join` 继续携带内存 CSRF。
- Access session 到期、policy 移除不等价于应用 logout。Cloudflare 对已建立 WS 不持续检查，Access 变化只保证在下一次 HTTP 请求/WS upgrade 重评；因此以最大连接年龄强制周期重连，但不宣称即时 Access 撤权。紧急外层撤权若不能等待该上界，运行手册必须停止 Tunnel/origin 或主动关闭连接。应用账号停用、assignment/consent/restriction 变化不等待 Access，活动 WS 继续由应用既有当前事实/消息/重连门禁失败关闭。

## 5. Trusted proxy 与客户端 IP

- app、PostgreSQL、对象/音频目录和 metrics 只绑定 loopback 或私有 Docker 网络；Windows Firewall 拒绝 LAN/WAN 对 app、DB、reverse proxy 管理口与 metrics 的直连。
- 公网业务 listener 只接受经本机 `cloudflared` 转发且通过 origin Access JWT 复验的请求；`cloudflared` 是唯一允许提供 `CF-Connecting-IP`、`Cf-Ray` 与 Access assertion 的上游。其他 peer 携带这些头或任意 `X-Forwarded-*`/`Forwarded` 一律不进入业务链。内部 health 使用独立 loopback listener/route，只返回最小状态且没有业务 handler、Cookie 或数据访问能力。
- 只有经上述链到达且由受信 `cloudflared` 上游提供的单值 `CF-Connecting-IP` 可作为客户端 IP；反向代理忽略原始 `X-Forwarded-For` 链并从该单值重建给 app 的客户端 IP。缺失、重复、非法值或来源不是受信上游即失败关闭。本机健康检查使用单独内部身份，不伪装公网客户端。
- 应用的 proxy trust 只列出反向代理实际 peer 地址/网络，不信任任意 hop 数或全网段。origin/LAN 直连、伪造 `CF-Connecting-IP`/`X-Forwarded-For` 必须不能改变登录限流 key、审计 IP 或 scheme。
- 在 DEV 用反例证明前，登录限流继续使用直接 peer IP，不能因文档存在就提前信任转发头。

## 6. Secret 与配置注入

- Tunnel token/credentials、Access team/audience、数据库凭据、会话/CSRF/throttle pepper、provider secrets 均只能由 Windows 受限服务账户可读的 secret store/受限文件或进程环境注入；不得进仓库、Compose 文件、命令历史、日志、备份清单正文、PR 或截图。
- 配置分 `quick-synthetic` 与 `named-synthetic` 两套显式 profile；不得用自动环境探测或 fallback 把 Quick 配置带入 Named。
- 启动时验证 hostname/Origin、cookie mode、proxy trust、Access audience、正式 manifest Schema、`data_mode=synthetic_only`、路径和 secret presence；任一缺失或矛盾即 readiness=false、零公网业务流量。
- token/secret 轮换必须有撤销旧值、重启顺序、健康验证与回滚记录。疑似泄露先撤销/轮换，再调查；不得通过打印完整值诊断。

## 7. Windows 进程、睡眠、磁盘与冷启动

- `cloudflared` 必须作为 Windows Service 运行；reverse proxy、应用、PostgreSQL/容器运行时也必须由受管服务或等价守护启动，不依赖交互式用户登录、打开终端或手工点击 Docker Desktop。
- 冷启动顺序：host/network/storage -> DB -> migration status -> app -> reverse proxy -> cloudflared；只有 DB/app/storage ready 与 schema 状态通过后对外 ready。`cloudflared` 在线但 app 未 ready 不算可用。
- 禁用睡眠、休眠和会导致无人值守中断的电源策略；自动更新只在登记维护窗执行。重启、断电恢复和服务崩溃必须自动拉起且有限退避，禁止无限快速重启。
- 固定数据卷/目录并记录实际绝对路径、文件系统、总量/可用量、增长率；数据库、音频、临时上传、日志和备份 staging 分别设 warning/critical 水位。critical 或写入失败时禁止开始新访谈，进行中的录音按既有本机 archive/降级规则保全，禁止静默丢弃。
- Windows、Docker/WSL、数据库、反向代理、app、`cloudflared` 的精确版本和启动方式进入部署 manifest；升级必须先备份、维护窗验证和可回滚。
- 系统时间同步是 readiness 前置；明显时钟漂移会破坏 Access JWT expiry、Cookie、TLS 和审计时间，必须告警并失败关闭公网业务。

## 8. 备份与恢复

备份对象至少包含 PostgreSQL、服务器音频/对象数据、不可变部署 manifest、非敏感配置、受控 secret recovery reference；不把浏览器 IndexedDB 当服务器备份，也不把日志当转录备份。

- 默认目标：RPO <= 24 小时、RTO <= 8 小时；DEV 必须用实测修正，未证明时按未满足处理。
- 备份必须加密、异机/离线保存、最小权限访问，并分开保管恢复密钥；同一物理磁盘副本不算备份。
- DB 与音频需要同一登记恢复点或有可验证的关联顺序；恢复后核对 migration status、row counts、audio manifest/chunk count/bytes/checksum 和 application smoke。
- “备份作业成功”和“隔离恢复演练成功”是两项门禁。至少完成一次从空环境恢复、记录耗时和偏差，才可通过 Named synthetic 验收。
- deletion/retention 必须覆盖在线数据和备份：恢复旧备份后先重放 deletion tombstone/ledger，再允许普通读取。该能力在 DEV-008D/CON-023 关闭前未实现，所以真实数据始终禁止。

## 9. 监控、日志与告警

- 外部探针从主机外检查 HTTPS/Access 门禁与最小 synthetic readiness；本机同时采集 Windows 服务、DB、app health、reverse proxy、磁盘、备份和 `cloudflared` metrics。只在故障主机上的监控不能证明断电可发现。
- `cloudflared` metrics 固定绑定 loopback/管理私网，不公网暴露；至少观察 active connections/streams、request errors、retries、version。Tunnel/Access dashboard 日志用于可达性与认证审计，不能替代应用 audit log。
- 告警覆盖：主机离线、Tunnel down/degraded、Access 异常拒绝/放行、ready 失败、5xx、WS 重连激增、DB/storage failure、磁盘水位、备份/恢复失败、证书/DNS/secret 到期或变更。
- 日志只含最小 ID、时间、状态、route class、Ray ID/稳定错误码和脱敏 IP；禁止完整转录、音频、Cookie、JWT、CSRF、Tunnel token、Authorization header 或 secret。

## 10. 故障与回滚

| 故障 | 必须行为 | 禁止行为 |
|---|---|---|
| Access/IdP 不可用 | 新请求失败关闭；已打开页面不能据缓存扩大权限 | Bypass Access 或改公网直连 |
| Tunnel/edge/WS 断开 | 客户端按既有重连/generation 恢复；本地 raw archive 继续 | 丢录音、重复 final、把断线当完成 |
| app/DB/storage 未 ready | readiness 失败，禁止新访谈；保留可恢复证据 | 返回伪健康、自动清库 |
| Windows 睡眠/重启/断电 | 外部告警；冷启动依赖顺序与恢复检查 | 要求人工登录后才恢复 |
| 磁盘 critical/full | 阻止新会话，保护已采集本机副本并告警 | 静默覆盖/删除原始证据 |
| 配置/版本发布失败 | 回滚到上一不可变 manifest；验证 Access/Origin/WS/DB | 只回镜像却保留不兼容配置/migration |

回滚单位分别为 Access policy、DNS/hostname、Tunnel route/token、reverse proxy、app image/config、secrets 和 DB migration。数据库只允许经验证的前向修复或从登记恢复点恢复；除非 migration 明确提供并验证 down path，不宣称自动回滚 schema。回滚不得把 Named 切成 Quick、公开 origin、禁用 Access 或放宽真实数据门禁。

## 11. 真实数据门禁

`data_mode=synthetic_only` 是本 SPEC 与 DEV-STAGING-DEPLOY-001 唯一合法状态，DEV 没有修改、扩展或解释为真实数据模式的权限。未来即使以下门禁全部具备，也只能新建真实数据任务、数据治理决定与新版 machine contract，由项目负责人正式接收；不得在本任务或当前 manifest 上改成 real/true：

- `DEV-001B` 身份/会话最终安全验收完成；
- SPEC-CONSENT-TEXT-POLICY-001 正式正文与 machine policy 接收；
- DEV-008D/CON-023 服务器删除、备份删除传播和恢复前 tombstone replay 验收；
- DEV-ASR-PROVIDER-001 与 CON-027 数据治理证据关闭；
- DEV-LLM-PROVIDER-001 的 provider/model/region/DPA/secret/runtime 门禁关闭；
- 真实存储、备份恢复、Windows 无人值守、监控、故障/回滚和 `QA-001` 全矩阵通过；
- 零未关闭 P0/P1，且项目负责人/独立审查对目标 exact head、环境 manifest 与试点范围明确 PASS。

任一门禁未知、过期、被撤销或环境漂移，继续保持 `synthetic_only`。Named synthetic 的成功不能替代上述任一项；未来是否允许真实来源脱敏数据也必须由独立数据治理决定，不能由“脱敏”字样自行升级。

## 12. DEV-STAGING-DEPLOY-001 验收矩阵

| 领域 | Quick synthetic | Named synthetic | Named real-data-denied | 未来 real gate |
|---|---|---|---|---|
| URL/HTTPS | 随机 URL、当次 Origin、HTTPS/WSS | 固定 hostname、HTTP->HTTPS、单 Origin | 同 Named 且拒绝任何 real-source/unknown-provenance fixture | HSTS/证书/DNS 变更与回滚另验 |
| Web/API/WS | 同源 `/`、`/api/v1`、`/ws/interviews` | 同源、无 CORS 依赖、WS upgrade/heartbeat/reconnect/最大连接年龄 | 真实数据请求 0 side effect | 长时/edge restart/idle timeout 真机矩阵 |
| 身份 | 应用虚构账号 | Access connector + origin JWT 复验 + 应用 session 双门禁 | Access-only/app-only/bypass/path overlap/JWKS failure 全拒绝 | 真实账号启停/assignment/consent 动态撤权 |
| Cookie/CSRF/Origin | 当次精确 Origin | `__Host-*`、Secure/HttpOnly/Strict、写请求 CSRF | 伪 Origin/旧 Quick Origin/跨源全拒绝 | 安全复审通过 |
| Proxy/IP | 不信任转发头 | origin 直连阻断、只信受信 cloudflared 单值 client IP | 伪造 IP 不能绕过 throttle/audit | 目标网络/防火墙证据 |
| Secret | 无真实 secret | 服务账户注入、启动校验、轮换演练 | 仓库/日志/进程输出零泄露 | 数据治理接收实际 provider secrets |
| Process/host | 人工临时进程可接受 | 无登录冷启动、sleep/hibernate off、时间同步、重启/崩溃恢复 | app 未 ready 时 edge 不放业务 | 维护值守与容量 SLA 另定 |
| Disk/backup | 不作为证据 | 水位告警、加密异机备份、空环境恢复与 checksum | deletion 未闭环故真实数据拒绝 | deletion 传播、RPO/RTO 正式接收 |
| Monitor | 不承诺 SLA | 外部断电探针 + 本机分层指标/脱敏日志 | 主机/Access/Tunnel/app/DB 故障均可发现 | on-call/SLO 另定 |
| Failure/rollback | 进程退出即撤销 | Access/DNS/Tunnel/proxy/app/config/DB 逐层演练 | 禁止用 Quick/公开 origin 降级 | 目标数据恢复与试点停机程序 |
| Governance | 仅排练记录 | non-Draft PR、exact head、完整 CI、正式环境 manifest | Schema 机械要求唯一 `data_mode=synthetic_only`；真实来源/来源不明在 connect/upload/persist 前零业务副作用拒绝 | 新任务 + 数据治理决定 + 新版 machine contract + 项目负责人正式接收 |

## 13. Cloudflare 官方资料

仅以下 Cloudflare 官方一手资料用于冻结供应商事实；Windows/数据库/备份的项目要求是本项目风险控制，不声称来自 Cloudflare：

- [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Set up Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/setup/)
- [Run as a service on Windows](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/windows/)
- [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Access authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Tunnel origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
- [WebSockets](https://developers.cloudflare.com/network/websockets/)
- [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [Tunnel metrics](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/)
- [Access authentication logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/)
- [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)
- [HTTP Strict Transport Security](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)
