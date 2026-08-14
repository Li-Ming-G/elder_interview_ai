# DEV-STAGING-DEPLOY-001｜Named synthetic staging 实现与运行验收

## 基本信息

- 状态：`BLOCKED`
- 前置契约：SPEC-STAGING-DEPLOY-001 尚在 `REVIEW`
- 输入：`docs/contracts/staging-deployment-v1.md`、`02` §20、`03` §23、`05` §14、`06` §18、`08` §22、`09` §20、`10` §17、ADR-041
- 负责人：未分配

## 目标

在 SPEC exact-head PASS/merge 后，以独立非 Draft PR 实现并验收固定 hostname 的 Named Cloudflare Tunnel + Access + 单台 Windows synthetic staging。实现结果只证明 `named-synthetic`，不证明真实数据或生产可用。

## 合同派生范围

- 部署单一同源 SPA/API/upload/WS 入口与 reverse proxy，阻断 origin/LAN 直连并机械验证受信 proxy/client IP；
- 配置 Access deny-by-default + connector/origin JWT validation/JWKS rotation，保留应用 session/role/assignment/consent 双门禁；以有界 WS 最大连接年龄重新执行 Access upgrade，不宣称即时 Access 撤权；
- 以 Windows Service/受管服务实现无需交互登录的冷启动、依赖顺序、sleep/hibernate off、重启/崩溃恢复；
- 实现配置/secret 启动验证、固定数据卷、磁盘水位、外部探针、本机指标、脱敏日志；
- 实现加密异机备份并完成一次空环境恢复、manifest/checksum 与 RPO/RTO 实测；
- 完成 Quick/Named、HTTPS、same-origin、WS、Cookie/CSRF/Origin、Access/app identity、proxy/IP、failure/rollback 的正反矩阵；
- 产出不可变 deployment manifest、运行手册、故障/回滚记录和 exact-head CI/环境证据。
- 以正式 [`staging-deployment-manifest-v1.schema.json`](../../contracts/staging-deployment-manifest-v1.schema.json) 和 [正反 fixtures](../../contracts/fixtures/staging-deployment-manifest-v1.fixtures.json) 实现唯一服务端 admission function；readiness、connect、upload、persist 必须调用同一事实源与判定。

## 硬边界

- `data_mode=synthetic_only` 是唯一 machine authority；只准从源头为测试创作并可证明 `fictional_created_for_test` 的虚构账号、虚构正文和合成/完全虚构音频；
- 真实长者、真实访谈、真实 PII、真实录音/转录、真实业务数据库或真实备份，即使去标识/匿名化/脱敏也不可用；provenance 不明同样拒绝；
- manifest/schema/data_mode missing、unknown、invalid、非 `synthetic_only`、digest/profile 漂移或存在 `real_data_allowed` 等平行许可字段时 readiness=false；在 connect/upload/persist 前拒绝并机械断言零业务副作用；
- 不用 Quick Tunnel 作为稳定入口、回滚方案或 Named 验收证据；
- 不把 Access 接成应用 SSO，不自动创建/映射本地用户；
- 不安装真实 ASR/LLM secret，不发送真实访谈内容；
- 不关闭 DEV-001B、SPEC-CONSENT-TEXT-POLICY-001、DEV-008D/CON-023、DEV-ASR-PROVIDER-001/CON-027、DEV-LLM-PROVIDER-001 或 QA-001；
- 若 Windows/容器运行时无法在无人登录后自动恢复，任务失败关闭，不得降级为人工启动后宣称通过。
- 本 DEV 无权把字段改为 real/true、扩展真实数据模式或自行接收真实来源脱敏数据。未来解锁必须新任务、数据治理决定、新版 machine contract 与项目负责人正式接收。

## 验收与状态

按 `09` §20 全矩阵与仓库完整 CI 执行，环境证据绑定精确 deployment manifest 和 commit。项目负责人/被明确改派的独立审查者给出 exact-head 结论前保持 `REVIEW`；即便 DONE，也只表示 Named synthetic staging 范围完成。真实数据必须另立新任务并逐项满足 `docs/contracts/staging-deployment-v1.md` §11、形成数据治理决定与新版 machine contract，再由项目负责人正式接收。
