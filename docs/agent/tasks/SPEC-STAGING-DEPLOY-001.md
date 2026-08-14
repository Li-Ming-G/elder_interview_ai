# SPEC-STAGING-DEPLOY-001｜Cloudflare + Windows staging 部署契约

## 基本信息

- 状态：`DONE`（REV-052；仅 docs/machine contract 范围）
- 负责人：独立执行 Agent
- base：`origin/main@1eb26b2f0f6f56d72b9646f3c5e876ad4cbb4228`
- branch：`codex/spec-staging-deploy-001`
- PR：[PR #54](https://github.com/Li-Ming-G/elder_interview_ai/pull/54)（非 Draft、MERGED）
- 审查：old `195c4be2` / CI `31798730203` 的 REQUEST_CHANGES（P0=0/P1=1/P2=0）永久保留；accepted `64cf94f33c957dc1a1ff74cbf49e35bd1c44698b` / CI `31808762082` 获项目负责人 PASS（P0/P1/P2=0），merge/main `751a32e1ffbae12ec639230cd3bf8482d1ff2820` / main CI `31815415871` SUCCESS

## 目标

在不执行生产部署、不安装 Cloudflare 能力、不请求 token/secret 的前提下，冻结 Quick synthetic 与 Named synthetic staging 的环境边界、同源 HTTPS Web/API/WS、Access/应用双身份、proxy/IP、secret、Windows 无人值守、磁盘/备份恢复、监控、故障回滚、真实数据硬门禁与后续 DEV 验收矩阵。

## 已选方向

响应式网页优先；Quick Tunnel 仅远程虚构排练；正式早期试用为 Named Cloudflare Tunnel + 固定域名 + Cloudflare Access；后端暂驻一台持续开机 Windows 电脑；验证盈利后再迁云。单机明确为 SPOF，不宣称 HA。

## iteration-coach

已在零改动、最新 `origin/main` 基线上完成恰好一次独立只读复核，结果 `Mode: Correction`。已吸收：网络/数据双轴、Access 与应用身份分层、origin 旁路与头清洗、WS 生命周期、无人登录冷启动、异机加密备份/恢复演练、外部断电监控、逐层回滚和 Named synthetic-only DEV 边界。

## 交付

- [`docs/contracts/staging-deployment-v1.md`](../../contracts/staging-deployment-v1.md) 正式候选；
- `00/01/02/03/04/05/06/08/09/10` 的部署边界入口；
- ADR-041、REQ-020、任务板与交接；
- contract-derived `DEV-STAGING-DEPLOY-001` 任务卡。
- 正式 `staging-deployment-manifest-v1` Schema 与 machine 正反 fixtures；唯一服务端数据许可字段为 `data_mode=synthetic_only`。

## 明确不做

不安装/配置 `cloudflared`、Access、DNS、Nginx 或监控；不索取 token/域名/secret；不部署公网；不处理真实长者/PII；不实现 SSO、HA、云迁移、备份脚本或生产运维；不关闭任何身份、授权、删除、ASR/LLM、数据治理或 QA 门禁。

## 验收

changed docs 格式、链接、表格列数和 `git diff --check` 通过；完整仓库 CI 对 exact head SUCCESS；非 Draft PR 审查包列明 base/head/CI/scope/门禁。项目负责人明确 PASS 且 merge/main CI 成功前，状态保持 `REVIEW`、ADR-041 保持 `Proposed / REVIEW`、DEV 任务保持 `BLOCKED`。

本地候选已通过 format/lint/typecheck/build、372 unit、独立空库 14 migrations、84 integration、23 auth、smoke、ordinary Chromium 27/27、auth Chromium 5/5 和 19 文件链接/表格/diff/docs-only 检查。默认 4173 占用与一次 auth API 端口错配失败永久保留在交接；本地绿灯不能替代 exact-head GitHub CI 或项目负责人结论。

首个提交 head `235a3df6a5431b72d21dd13820628280067a4a61` 的完整 CI run [`31798290760`](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31798290760) SUCCESS。补写该证据会形成新的最终治理 head，必须取得自己的完整 CI SUCCESS 才能作为项目负责人审查对象；首轮绿灯不能替代最终 head。

项目负责人已正式审查仓库 `Li-Ming-G/elder_interview_ai`、分支 `codex/spec-staging-deploy-001`、[PR #54](https://github.com/Li-Ming-G/elder_interview_ai/pull/54) old exact head `195c4be2c4cd9277036e6a8759ab15e00e984a61` / exact-head CI [`31798730203`](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31798730203) SUCCESS，结论 `REQUEST_CHANGES`（P0=0/P1=1/P2=0）。唯一 P1 是数据分类仍允许把“去标识/脱敏”误读为可使用真实来源数据，且缺少唯一 machine authority、readiness 机械核对与入站零副作用拒绝。old head/CI/结论永久保留；本轮只做该 P1 定向修复，保持 REVIEW，不重做已通过的 Cloudflare/Access/WS/Windows/备份设计。

定向修复新增的正式 manifest Schema fixtures 5/5、admission provenance fixtures 6/6 已由仓库既有 Ajv 8.20.0 机械通过；未新增依赖。首次从 root 直接 import Ajv 的 `ERR_MODULE_NOT_FOUND` 失败永久保留在交接。

定向修复本地验证另有 23 文件 contract scope、21 Markdown 相对链接/表格、format/diff、lint、typecheck、build 与 372 unit PASS；所有失败/重跑历史均在交接保留。定向修复 exact head `64cf94f33c957dc1a1ff74cbf49e35bd1c44698b` 已取得完整 GitHub CI `31808762082` SUCCESS，并获项目负责人定向 PASS（P0/P1/P2=0）。任务 DONE 只表示部署契约与 machine contract 已接收；不表示安装、配置或运行 Cloudflare/Windows staging，也不许可真实数据。
