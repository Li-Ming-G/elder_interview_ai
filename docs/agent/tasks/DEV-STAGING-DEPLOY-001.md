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

## 硬边界

- `real_data_allowed=false`；只准虚构账号、合成音频和虚构/脱敏正文；
- 不用 Quick Tunnel 作为稳定入口、回滚方案或 Named 验收证据；
- 不把 Access 接成应用 SSO，不自动创建/映射本地用户；
- 不安装真实 ASR/LLM secret，不发送真实访谈内容；
- 不关闭 DEV-001B、SPEC-CONSENT-TEXT-POLICY-001、DEV-008D/CON-023、DEV-ASR-PROVIDER-001/CON-027、DEV-LLM-PROVIDER-001 或 QA-001；
- 若 Windows/容器运行时无法在无人登录后自动恢复，任务失败关闭，不得降级为人工启动后宣称通过。

## 验收与状态

按 `09` §20 全矩阵与仓库完整 CI 执行，环境证据绑定精确 deployment manifest 和 commit。项目负责人/被明确改派的独立审查者给出 exact-head 结论前保持 `REVIEW`；即便 DONE，也只表示 Named synthetic staging 范围完成。真实数据必须另立解锁任务并逐项满足 `docs/contracts/staging-deployment-v1.md` §11。
