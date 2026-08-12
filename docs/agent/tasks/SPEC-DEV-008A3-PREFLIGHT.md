# SPEC-DEV-008A3-PREFLIGHT｜删除预检 total bytes 公共接缝

## 基本信息

- 状态：`REVIEW`
- 负责人：独立 docs/contract 执行窗口
- base：`origin/main@51e2337ea86739e209ad696804de7decbcf7a9df`；main CI `31594298585` SUCCESS
- 分支：`codex/spec-dev-008a3-finalization-size`
- PR：[PR #37](https://github.com/Li-Ming-G/elder_interview_ai/pull/37)，非 Draft；exact final head/CI 由最终审查包绑定
- 前置：SPEC-DEV-008A、SPEC-DEV-008A1-ACCESS、DEV-008A1 均已 exact-head PASS/merge；DEV-008A3 开工前唯一 Correction 已在零改动阶段确认缺口；总控已冻结方案 A
- 输入：`00/01/02/03/04/05/08/09/10`、SPEC-DEV-008A/A3 task/handoff、formal `local-audio-archive-v1`、ADR-034/035、REV-041/043、A3 暂停窗口 `019ff5db-a0dd-7060-875f-8ee454a84469` 与只读复核 `019ff5e0-47d2-7d92-8148-7eff63ec61a9`
- 风险：contract optional 被 runtime 永久漏发、unsafe BigInt 静默舍入、terminal null 被当 0、首页/evidence 最小 DTO 被无意扩宽、本机删除在事实不一致时错误放行

## 用户结果

让 DEV-008A3 能从普通 canonical session GET 机械取得服务端权威总字节，并与 fresh manifest 和本机完整 archive 一致性核验；任何缺失、legacy、null、unsafe 或 mismatch 都零写入失败关闭，同时不改变本机删除不等于服务器隐私删除的既有边界。

## 正式决定

1. `SessionFinalizationSnapshot` additive 增加 `total_size_bytes?: number | null`；contract 阶段 optional 只用于兼容尚未更新的 typed producer，不表示 A3 runtime 可以漏发。
2. 值只来自同一 finalization 关联的既有 `AudioObject.totalSizeBytes`；不新增 Prisma 字段/migration，不复制到 `session_finalization`，不从 commitment、uploaded count、本机 archive 或客户端输入反推。
3. `awaiting_upload|verifying|unrecoverable` 或无法证明关联 complete audio object 的安全整数值时为 null；正常 `upload_status=complete` 必须返回精确非负 safe integer。正常 `processing|completed` 与 `failed + complete manifest` 因此必须非空。
4. A3 runtime 后，ordinary `GET /sessions/:id` 的 finalization 对象必须始终显式返回该 key；缺键/null/unsafe/不一致仍允许已有只读转录，但播放和本机删除投影 `blocked_server_unverified`，不得解释为 0。
5. `ProjectSessionListItem.finalization` 的首页 Pick 不增加该字段；`EvidenceFinalizationResponse` 也不增加。A3 只能使用当前 assignment + ordinary visibility 下的 canonical session GET。

## 修改范围

- 正式 `04/05/08/09/10` 的直接相关段落；
- `packages/contracts` 的 additive shared TypeScript contract；
- 本 SPEC、任务板、需求追踪、CON-029、ADR-036、REV-044、交接与 iteration journal。

## 明确不做

- 不修改业务 service/controller/mapper、Prisma schema/migration、IndexedDB、页面、WebSocket 或测试实现；
- 不实现 DEV-008A3，不修改 DEV-008A2、ASR、DEV-007、DEV-008D 或 CON-023 语义；
- 不增加服务端音频下载、服务器删除、deletion request、导出或跨设备事实；
- 不扩大首页 list、restricted project 或 evidence-finalization 字段白名单。

## A3 实现门禁

- mapper/API：finalization 四种 upload status、session stopping/processing/completed/failed、safe BigInt、显式 key、同一 audio object 来源；
- 白名单：ordinary session 含字段，ProjectSessionListItem 与 EvidenceFinalizationResponse 精确不含；
- 权限：未认证、跨 actor、assignment 撤销、restricted、deleted、软删除、created_by 和本机 archive 绕权全部失败关闭；
- fresh preflight：identity、count、total bytes、manifest checksum、manifest chunks sum 与本机逐片元数据全部一致；
- legacy/null：缺键、null、unsafe、terminal complete mismatch 均 server-unverified、零回执、零部分删除，同时不影响合法只读转录。

## iteration-coach

本契约任务恰好一次独立只读复核由 `/root/spec_a3_size_review` 完成，主模式 `Learning mode`，结论 `NO-PAUSE`。复核确认 optional+nullable 是 contract-first CI 兼容而非长期遗漏许可，并确认 ordinary/list/evidence 三个 response 白名单与 lifecycle fail-closed 规则可以机械闭合。

## 验收与状态纪律

- 运行 format/lint/typecheck/build/unit、formal Schema fixtures 与 docs/链接/状态检查；完整 GitHub CI 必须绑定 exact final head 并 SUCCESS；
- 候选以非 Draft PR 保持 `REVIEW`；项目负责人已授权总控承担本阶段 exact-head 手动审查，但本执行窗口不得自行 PASS/DONE/merge；
- DEV-008A3 在本 SPEC exact-head PASS/merge 前保持 `BLOCKED`。PASS/merge 只解锁 A3 runtime，不代表回顾、播放、IndexedDB 删除或服务器隐私删除已实现。
