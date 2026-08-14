# SPEC-CONTINUING-CONSENT-001｜同项目持续授权与每次录音前轻提醒契约

## 基本信息

- 状态：`REVIEW`
- 负责人：独立 docs/shared-contract 执行任务 `codex/spec-continuing-consent-001`
- 基线：`origin/main@2f7bb9632293694a0e22ed7e64adefff5fc5a57d`；main CI `31758380540` SUCCESS
- PR：[non-Draft PR #49](https://github.com/Li-Ming-G/elder_interview_ai/pull/49)；old head `4095e570d17d8ecae94d630d62bca9ab0205917d` / CI `31762375878` 已获项目负责人 [REQUEST_CHANGES](https://github.com/Li-Ming-G/elder_interview_ai/pull/49#issuecomment-5288715503)（P0=0/P1=3/P2=0），正在原分支定向修复
- 前置：SPEC-REPEAT-INTERVIEW-001、DEV-008A4 均已 exact-head PASS/merge；项目负责人已明确本任务产品决定
- iteration-coach：总控已在决定前恰好完成一次独立只读 `Correction / NO-PAUSE`；本任务复用其结论，不启动第二次复核，也不写 legacy learning log
- 输入：`00/01/02/03/04/05/08/09/10`、SPEC-REPEAT-INTERVIEW-001、DEV-008B1/B2、最新 handoff/ADR/CON、CON-012
- 审查门禁：non-Draft PR、exact-head 全量 CI、项目负责人 GitHub 手动审查；执行 Agent 不得自宣 `PASS/DONE` 或合并

## 用户结果

一位长者的同一 project 可以连续进行多次 session。第一次访谈在麦克风检查后录制与当时正式文本版本一致的完整口头授权；同 project 的普通后续访谈复用仍适用的正式授权，不重复授权录音、授权记录或完整授权页。每次正式录音前仍显示服务端版本化轻提醒，并由倾听员显式点击“开始访谈”；该动作只确认本次开始，不产生新授权。

## 正式决定

1. 首次 `recorded_verbal` 授权文本必须明确覆盖同 project 当前及未来计划内访谈，并说明可随时暂停、停止或撤回；授权音频、文本版本和 consent record 一一对应。
2. 普通后续 session 在同 project、原授权覆盖未来访谈且当前政策判定兼容时复用该 consent record；时间间隔、有效 assignment 内更换倾听员或更换设备都不单独触发重授权。
3. 每次正式 start 前必须展示版本化轻提醒“本次仍会录音、转录并由 AI 辅助分析；长者可随时要求暂停、停止或撤回。”，倾听员显式点击“开始访谈”。提醒回执不是 consent，不创建 consent record 或 consent audio。
4. next-session 与 start 均动态重查 active actor、assignment、project restriction/deletion、current applicable consent 和政策版本；设备变化只要求重做本页 mic/device。
5. `revoked|expired`、文本版本不兼容、处理目的扩大、访问主体扩大、供应商处理地区扩大、公开/训练用途扩大，或原文本未覆盖未来访谈时，必须录制与当前新文本版本一致的新正式授权；旧音频禁止跨版本复用。
6. ServiceTerm 继续 dormant。本任务不修改 runtime、Prisma/migration、页面、ASR/LLM、删除、部署或既有原始记录。
7. 仓库示例 `mvp-v1` 不被本 SPEC 猜成已覆盖未来访谈；真实正文和 scope metadata 经项目负责人/数据治理审查接收前，后续复用失败关闭。

## Shared contract 接缝

- additive `ConsentContinuationProjection`：表达 covered / reauthorization_required / unavailable、原因、basis consent 与 required text version；rollout 缺失失败关闭。
- additive `RecordingStartReminderProjection`：由服务端拥有版本、逐字文案、按钮标签和 `creates_consent_record=false` 语义；session snapshot 在正式 start 前返回。
- additive `StartSessionRequest.recording_reminder_version?`：contract-first 阶段 optional 只为兼容现有 producer；DEV-008B1 完成时 API/runtime 必须要求并校验该字段，版本漂移拒绝且零采集副作用。

## 修改范围

- 正式 `00/01/03/04/05/08/09/10` 的直接相关段落；
- `packages/contracts` additive TypeScript DTO/常量；
- 本任务、任务板、需求追踪、CON-012、ADR-039 与交接治理。

## 禁止

- 不写业务 runtime、Prisma/migration、页面、ASR/LLM、删除或部署；
- 不把提醒点击、start request、device check 或 assignment 变化记录成新 consent；
- 不跨 `consent_text_version` 复用授权音频，不自行恢复 ServiceTerm；
- 不在项目负责人 exact-head PASS/merge/治理收口前启动 DEV-008B1/B2。

## 验收

- `09` §18 覆盖首次授权、同 project 普通复用、刷新/幂等、不同设备、不同倾听员、跨 session、撤回/过期/版本漂移/用途扩大与提醒不是 consent；
- shared contracts typecheck/build、format/lint、文档链接/命名/diff 检查与完整 CI 全绿；
- PR 保持 `REVIEW`，由项目负责人给出 exact-head 结论。

## REV-049 定向修复

1. 冻结 repeat action 唯一优先级；非终态 session 与 reauthorization 同时存在时只能 `session_in_progress + primary_action=null`，所有 session basis/next 为 null。
2. 将 continuing consent 与 repeat action 改为 discriminated unions，并用编译期 contract test 拒绝 status/reason/basis/version/action 及两层投影的矛盾组合。
3. 新建独立 SPEC-CONSENT-TEXT-POLICY-001，作为真实 `covered` happy path 与 B1 端到端交付前置；执行 Agent 不代写/批准法律文本，任何 fixture 不解除真实路径失败关闭。

旧 exact head、CI 和 REQUEST_CHANGES 结论永久保留。修复后任务仍为 `REVIEW`，DEV-008B1/B2 仍为 `BLOCKED`，等待项目负责人绑定新 exact head 的下一轮手动复审。
