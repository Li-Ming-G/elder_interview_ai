# 任务看板

## 文件用途

本文件是项目任务状态的唯一动态来源，用于记录任务负责人、依赖、分支、阻塞原因、验收依据和当前状态。根目录 `00-项目说明与执行入口.md` 只提供入口，不重复维护详细状态。

## 状态枚举

`TODO`、`READY`、`IN_PROGRESS`、`BLOCKED`、`REVIEW`、`VERIFY`、`DONE`、`CANCELLED`。

## 当前任务

| 任务编号 | 任务 | 负责人 | 状态 | 前置任务 | 验收依据 | 阻塞原因 |
|---|---|---|---|---|---|---|
| BASE-001 | 首次总控基线审计与 Git 建立 | 总控 Agent | DONE | 无 | 本轮检查记录、Git 提交、交接日志 | 无；低风险基线整理已由总控自检 |
| DOC-001 | 建立项目文档基线 | 总控 Agent | DONE | 无 | 文档包完整性与一致性检查 | REV-003 PASS；文档和契约一致性门禁通过 |
| DOC-002 | 分离协作文档当前态与历史归档 | 总控 Agent | DONE | BASE-001 | `docs/agent/README.md`、当前审查/交接索引、归档卷、OPEN 冲突索引 | 文档结构整理、链接检查、Git diff check 通过；不改变产品或技术契约 |
| DEC-001 | 确认工程技术基线与跨规范冲突 | 总控 Agent | DONE | BASE-001 | `02` 至 `10`、ADR、冲突日志 | REV-003 PASS；P0/P1 为 0 |
| SPEC-FE-001 | 首次访谈页面与内容规划收敛 | 总控 Agent | DONE | 前端页面规划对话、ADR-020 | [任务卡](tasks/SPEC-FE-001.md)、PR #6 head `47f7b35`、CI `31153878655` PASS、REV-015 PASS、merge `474c647`、HO-030 | 页面规划和可执行任务拆分已通过；不代表 DEV-005 或安全结束能力已实现 |
| DISC-AI-QUESTION-001 | 单问题自动更新与展示历史体验收口 | 项目负责人 + 总控 Agent | DONE | SPEC-FE-001、DISC-006、SPEC-DEV-006 DONE | [任务卡](tasks/DISC-AI-QUESTION-001.md)、ADR-028、CON-018 | 项目负责人暂停原问题框架并直接定稿：更合适问题可自动替换；保留可浏览的展示历史；“换一个”改为“下一个问题”；旧一层撤销被历史浏览取代 |
| SPEC-AI-QUESTION-001 | 单问题自动更新、手动下一问与展示历史契约 | AI/后端契约 Agent | DONE | SPEC-FE-001 DONE、SPEC-DEV-006 DONE、DISC-AI-QUESTION-001 DONE | [任务卡](tasks/SPEC-AI-QUESTION-001.md)、[交接](handoffs/SPEC-AI-QUESTION-001.md)、[PR #21](https://github.com/Li-Ming-G/elder_interview_ai/pull/21)、ADR-027/028/029、REV-032 | 项目负责人对 final head `af088ed6`、CI `31352681061` attempt 2 手动审查 PASS，P0/P1=0；merge `10fcc5c`。CON-018 RESOLVED；DEV-007 技术前置已满足，但按 CON-025 暂停 |
| SPEC-SESSION-END-001 | 会话安全结束与恢复契约 | 会话编排契约 Agent | DONE | SPEC-FE-001 产品决定、DEV-003/004B2 seam | [任务卡](tasks/SPEC-SESSION-END-001.md)、ADR-022、CON-019、HO-032、PR #8 head `9c471d8`、CI `31163777417` PASS、REV-017 PASS、merge `9af96c1` | 契约范围已通过；不代表 stop/recover 已实现，后续由 DEV-005C 执行 |
| MVP-V01 | 最小纵向核心假设链路 | 总控 Agent | IN_PROGRESS | DEV-001A、DEV-001B 内部候选 seam | [里程碑卡](tasks/MVP-V01.md) | 仅限虚构/脱敏数据和非公网内部验证；逐段集成 |
| DEV-001 | 初始化工程与环境（父任务） | 总控 Agent | IN_PROGRESS | DEV-001A、DEV-001B | [父任务卡](tasks/DEV-001.md) | DEV-001B 最终加固/复审未完成，但不阻塞内部原型 |
| DEV-001A | 工程骨架与可重复工具链 | 工程基础实现 Agent（Archimedes） | DONE | DEC-001 | [任务卡](tasks/DEV-001A.md)、`fb99560`、REV-006 | REV-006 PASS；P0/P1/P2 均为 0 |
| DEV-001B | 身份、会话与权限基础 | 身份安全实现 Agent（dev001b_identity_security） | REVIEW | DEV-001A | [任务卡](tasks/DEV-001B.md)、`ab9628b`、HO-006 | CON-008、增强 Chromium 与独立复审阻塞最终 DONE/真实部署；不阻塞虚构身份内部原型 |
| DEV-002 | 最小项目、服务信息、授权与会话 | 后端业务 Agent（dev002_min_project_consent） | DONE | DEV-001A、DEV-001B 内部候选 seam | [任务卡](tasks/DEV-002.md)、`f16b82a`、ADR-014/015、REV-009 | 内部虚构数据范围验收通过；CON-010 仅阻塞口头授权音频集成和真实试点 |
| DEV-003 | 原始录音与分片上传（父任务） | 总控 Agent | DONE | DEV-003A、DEV-003B、DEV-003C | `06`、`09`、REV-010/011、PR #2 merge `bdf2910` | 内部虚构/合成音频原型完成；真实麦克风、长时、进程崩溃、多标签、真实配额、云存储和真实试点不在通过范围 |
| DEV-003A | 浏览器采集与本地可靠分片暂存 | 音频前端 Agent（dev003a_browser_audio_buffer） | DONE | DEV-001A | [任务卡](tasks/DEV-003A.md)、`41d6104`、`134be76`、真实 Chromium E2E 2/2、REV-010 PASS | 内部虚构数据原型完成；真实麦克风、崩溃、多标签、配额、长时录音和服务端上传编排不在本任务验收范围 |
| DEV-003B | 服务端原始分片、幂等与 manifest | 后端音频实现 Agent（dev003b_audio_backend） | DONE | DEV-002 会话 seam、DEV-003A 上传队列 seam | [任务卡](tasks/DEV-003B.md)、ADR-016、`134be76`、CI run `30872251081` PASS、REV-010 PASS | 内部虚构数据原型完成；REV-010 两项存储 P2 已由 DEV-003C 修复并经 REV-011 通过 |
| DEV-003C | 浏览器可靠上传编排与存储恢复加固 | 总控 Agent（协调前后端实现） | DONE | DEV-003A、DEV-003B、REV-010 | [任务卡](tasks/DEV-003C.md)、ADR-017、PR #2、head `1aa643a`、CI `30875834803` PASS、REV-011 PASS | 仅限虚构/合成音频内部链路；CON-013 在生产或真实试点前处理 |
| DEV-004 | 实时 ASR 与说话人映射（父任务） | 总控 Agent | DONE | DEV-003 | [父任务卡](tasks/DEV-004.md)、ADR-018/019/025、REV-012/013/014/027/028/029/030 | 内部 MVP 的实时转录、确定态证据、可信说话人和修正链路已通过；补转录按项目负责人范围决定后置到 HARDEN-ASR-001，不代表真实供应商或完整试点通过 |
| DEV-004A | 确定态转录证据核心与供应商中立适配器 | 后端转录实现 Agent（`dev004a_backend_impl`） | DONE | DEV-003、ADR-018、CON-015/016 | [任务卡](tasks/DEV-004A.md)、PR #3、head `917f888`、CI `30887031030` PASS、REV-012 | 仅覆盖内部虚构数据证据核心；两项非阻塞 P2 随后续转录加固处理 |
| DEV-004B1 | 业务 WebSocket 服务端协议核心 | 后端实时转录实现 Agent（`dev004b1_backend_impl`） | DONE | DEV-004A、ADR-019 | [任务卡](tasks/DEV-004B1.md)、PR #4、head `80ff1c7`、merge `13350a4`、CI `30969408276` PASS、REV-013 PASS | 仅覆盖服务端内部合成 PCM 协议核心；三项 P2 转后续加固，B2/真实 ASR/长时性能不在本任务 |
| DEV-004B2 | 浏览器合成 PCM 实时纵向链路 | 浏览器实时转录实现 Agent（`dev004b2_browser_realtime_impl`） | DONE | DEV-004B1、ADR-019、REV-013 | [任务卡](tasks/DEV-004B2.md)、PR #5 head `73a07cb`、CI `31143035668` PASS、REV-014 PASS、merge `49949fc`、HO-031 | 内部虚构/合成 PCM 浏览器链路完成；真实麦克风/ASR、长时和正式工作台未覆盖 |
| DISC-004C | 说话人校准、修正与下游消费边界讨论 | 独立产品讨论任务 `019fe4e1-8537-7a13-9831-8ef10df1e7df` | DONE | DEV-004A/B1/B2、DEV-005 DONE | [讨论任务卡](tasks/DISC-004C.md)、[讨论提示词](prompts/DISC-004C.md)、CON-014 | 项目负责人已定稿候选决定包并由总控完成正式写回；讨论完成不代表契约审查或实现完成 |
| SPEC-DEV-004C | 正式流说话人校准、修正与下游可信角色契约 | 总控 Agent | DONE | DISC-004C DONE | [任务卡](tasks/SPEC-DEV-004C.md)、ADR-025、CON-014、REV-027、PR #17 head `2a65b1f`、CI `31298277051` PASS、merge `0b6c357` | 定向复审 PASS，三项 P1 全部关闭；ADR-025 Accepted、CON-014 RESOLVED；仅解锁 C1，不代表 C1/C2 或父 DEV-004 完成 |
| DEV-004C1 | 正式流说话人确认与可信角色门禁 | Codex DEV-004C1 实现任务 | DONE | SPEC-DEV-004C PASS | [任务卡](tasks/DEV-004C1.md)、[交接](handoffs/DEV-004C1.md)、PR #18、REV-028 | 用户明确委派总控代行定向复审；final head `a984587e86ba7824c789dad2fe0e2fa847abbd3d`、CI `31305357363` PASS、P0/P1=0、merge `99b090d`；仅完成 C1 范围 |
| DEV-004C2 | 单段/受控批量角色修正与派生失效 seam | 独立实现任务 `019fe614-9503-7891-a1d3-8708c60166e0` | DONE | SPEC-DEV-004C PASS、DEV-004C1 PASS | [任务卡](tasks/DEV-004C2.md)、[交接](handoffs/DEV-004C2.md)、PR #19 head `757bf52`、CI `31310993567` PASS、REV-029、merge `83cdfef` | 定向 P1 已关闭，P0/P1=0；仅覆盖当前无 deletion producer 的内部 MVP 修正核心。deletion scope `NOT IMPLEMENTED / NOT VERIFIED`、CON-023 OPEN；复杂批量 UI 与 DEV-006 consumer 未实现 |
| DISC-ASR-PROVIDER-001 | 真实流式 ASR 首版范围与供应商选择 | 项目负责人 + 独立可见讨论任务 | DONE | DEV-004/005 内部 seam DONE；真实 LLM 接入前置 | 项目负责人定稿：标准普通话、腾讯实时 ASR V2 单一候选、双人 label 硬门槛、中国大陆授权边界、真实 LLM 后置 | 讨论决定已移交 SPEC-ASR-PROVIDER-001；DONE 不代表契约审查或 provider 实现通过 |
| SPEC-ASR-PROVIDER-001 | 腾讯实时 ASR V2 供应商接入契约冻结 | 正式契约 Agent | DONE | DISC-ASR-PROVIDER-001 DONE；DEV-004/005 seam DONE | [任务卡](tasks/SPEC-ASR-PROVIDER-001.md)、[交接](handoffs/SPEC-ASR-PROVIDER-001.md)、[PR #28](https://github.com/Li-Ming-G/elder_interview_ai/pull/28)、ADR-032、REV-039、CON-027、正式 v2 machine contract | 项目负责人对 final head `84a2173c`、CI `31484868105` 定向复审 PASS（P0/P1=0）；merge `d7b318f`、main CI `31494227785` SUCCESS。old head `8d9922b` REQUEST_CHANGES/P1=1 永久保留；CON-027 继续阻塞真实长者/PII 试点 |
| SPEC-ASR-WIRE-PARAM-001 | 腾讯 V2 话者分离 wire 参数正式修正 | 腾讯 wire 契约修正 Agent | DONE | SPEC-ASR-PROVIDER-001 DONE；官方一手证据纠正 ADR-032 的窄供应商事实 | [任务卡](tasks/SPEC-ASR-WIRE-PARAM-001.md)、[交接](handoffs/SPEC-ASR-WIRE-PARAM-001.md)、[PR #29](https://github.com/Li-Ming-G/elder_interview_ai/pull/29)、ADR-033、REV-040、正式腾讯 profile | exact head `650f856c`、CI `31556525476` 获项目负责人手动 PASS（P0/P1/P2=0）；merge `1e18ea83`、main CI `31560488220` SUCCESS。只接受 docs-only wire 契约，不证明 close 1005 根因或 DEV provider PASS |
| DEV-ASR-PROVIDER-001 | 腾讯实时 ASR V2 adapter v2 实现与真实验收 | 待分配 | READY | SPEC-ASR-PROVIDER-001、SPEC-ASR-WIRE-PARAM-001 均已 exact-head PASS/merge | [任务卡](tasks/DEV-ASR-PROVIDER-001.md)、`09` §15、v2 machine contract | 可按正式 wire 契约使用同一虚构 TTS PCM、`reconnect=0` 做一次受控诊断；不含第二 provider、gap/backfill、Prisma migration、真实 LLM、真实长者或部署；完整验收仍未通过 |
| HARDEN-ASR-001 | ASR 故障区间与离线补转录可靠性加固 | 待分配 | TODO | 真实 ASR 供应商与重连语义确定 | [任务卡](tasks/HARDEN-ASR-001.md)、`06` §9、`09` §6/场景 C | 项目负责人决定后置；不阻塞内部 MVP、DISC-006、SPEC-DEV-006、DEV-006/007。完整 MVP/真实试点前再冻结契约并验收 |
| DISC-006 | 结构化长期记忆产品行为讨论 | 项目负责人 + 独立产品讨论任务 | DONE | DEV-004C1/C2 DONE | [任务卡](tasks/DISC-006.md)、[讨论提示词](prompts/DISC-006.md)、ADR-026、CON-024 | questions-only 后台记忆、冲突/更正、跨会话、会后实际问题、失败降级、过程记录与安全快照拆分已定稿并写回；不代表 SPEC/实现完成 |
| SPEC-DEV-006 | 后台当前记忆、问题证据与跨会话消费契约 | 独立契约任务 `019fe70b-103e-7ff2-b916-9a9bcb0ea1c0` | DONE | DEV-004C1/C2 DONE、DISC-006 DONE、CON-024 RESOLVED | [任务卡](tasks/SPEC-DEV-006.md)、[交接](handoffs/SPEC-DEV-006.md)、[PR #20](https://github.com/Li-Ming-G/elder_interview_ai/pull/20)、ADR-027、REV-031 | 项目负责人对 final head `4759633`、CI `31326717132` 定向复审 PASS，P0/P1=0；merge `6289c87`。旧 head REQUEST_CHANGES 永久保留；CON-023 继续 OPEN，CON-018 后续由 REV-032 解决 |
| DEV-005 | 首次访谈页面闭环（父任务） | 总控 Agent | DONE | DEV-002、DEV-003、DEV-004B2、SPEC-FE-001、SPEC-SESSION-END-001 | [父任务卡](tasks/DEV-005.md)、[重构契约](tasks/SPEC-DEV-005R.md)、REV-026 | R1–R4 已全部通过；桌面与目标 Android Chrome 的准备、采集、刷新恢复、安全结束和终态纵向闭环完成。真实供应商、云存储、iPhone 与生产部署不在本结论范围 |
| DEV-005A | 首次访谈准备页与正式路由外壳 | 前端实现任务对话 | DONE | DEV-002、DEV-003、SPEC-FE-001 | [任务卡](tasks/DEV-005A.md)、PR #7 head `ea6c20f`、CI `31161076538` PASS、REV-016 PASS、merge `066c424`、HO-033 | 内部虚构数据准备页和路由外壳完成；两个 P2 转 DEV-005B，不代表完整工作台或安全结束完成 |
| DEV-005B | 转录优先访谈工作台 | 前端工作台实现任务对话 | DONE | DEV-004B2、DEV-005A 页面外壳 | [任务卡](tasks/DEV-005B.md)、PR #9 head `c73e7ad`、CI `31166457093` PASS、REV-018 PASS、merge `647a6b4`、HO-035 | 工作台范围已通过；不含 stop/recover、真实 AI、真实麦克风或父 DEV-005 完成 |
| DEV-005C | 服务端会话安全结束编排 | 后端会话编排实现任务对话 | DONE | SPEC-SESSION-END-001 PASS、DEV-003C、DEV-004B2 | [任务卡](tasks/DEV-005C.md)、PR #10 head `36f534a`、CI `31174226564` PASS、REV-019 PASS、merge `9691dad`、HO-034 | 三轮审查后 P0/P1=0；三个已登记 P2 不阻塞当前内部 MVP 范围 |
| DISC-005-R0 | 首次访谈纵向链路重构总纲讨论 | 项目负责人 + 总控 Agent | DONE | DEV-005A/B/C 历史证据、DISC-005D 候选包 | [讨论任务卡](tasks/DISC-005-R0.md)、CON-020、HO-037 | R0 与 A-R/B-R/C-R/D-R 已批准并由 SPEC-DEV-005R 正式承接；讨论完成不代表实现完成 |
| DISC-005D | 安全结束页产品体验讨论 | 项目负责人 + 总控 Agent | DONE | DEV-005A、DEV-005B、DEV-005C PASS | [历史讨论卡](tasks/DISC-005D.md) | 旧候选已在 D-R 中复核、修订并写入 SPEC-DEV-005R；保留历史输入 |
| DEV-005D | 安全结束页薄集成（旧任务） | 无 | CANCELLED | 已由 DEV-005R3 取代 | [历史任务卡](tasks/DEV-005D.md)、HO-037 | 未实施；不撤销旧 A/B/C，结束与中断体验由新纵向任务承接 |
| SPEC-DEV-005R | 首次访谈真实采集纵向链路重构契约 | 总控 Agent | DONE | A-R/B-R/C-R/D-R 已批准 | [任务卡](tasks/SPEC-DEV-005R.md)、ADR-023/024、CON-020/021、PR #11 head `80ab84f`、CI `31244954185` PASS、REV-021 PASS、merge `c572490` | 四个 P1 定向关闭，stacked 契约基线已解除；不代表 DEV-005R 实现完成 |
| DEV-005R1 | 服务端采集生命周期与原子开始 | 独立任务 `019fdce6-9745-7aa0-b430-8dd0f7fcf27a` | DONE | SPEC-DEV-005R PASS | [任务卡](tasks/DEV-005R1.md)、PR #13 head `c19a295`、CI `31245403822` PASS、REV-020 定向复审 PASS、merge `656db20` | 全 generation PCM P1 已关闭；R1 前置完成 |
| DISC-005R-UI | 页面内容占比与注意力层级 | 独立任务 `019fdee4-c4b0-7073-b652-0f0caea99cdc` | DONE | SPEC-DEV-005R、DEV-005R3 | [任务卡](tasks/DISC-005R-UI.md)、[HO-040](handoffs/DISC-005R-UI.md) | 用户逐项确认并由总控写回；Android Chrome 为完整主设备，R2 生命周期证据登记 CON-021 |
| DEV-005R2C | 浏览器采集与归档核心（并行基础） | 独立任务 `019fdce6-9746-7e63-8776-03f4264bb1d9` | DONE | SPEC-DEV-005R PASS | [任务卡](tasks/DEV-005R2C.md)、PR #12 head `ae07747`、CI `31246011913` PASS、REV-022 PASS、merge `e455c13` | 四项定向修复 4/4 关闭；浏览器核心积木完成，Android Chrome 生命周期语义仍由 R2 真机证据冻结 |
| DEV-005R2 | 浏览器单流采集、归档与交付控制器 | 独立任务 `019fe054-0dcf-7c40-b4fa-121863a9d69c` | DONE | DEV-005R1、DEV-005R2C PASS | [任务卡](tasks/DEV-005R2.md)、[任务交接](handoffs/DEV-005R2.md)、PR #14 head `829adf8`、CI `31251923003` PASS、REV-023/024、merge `5527af2`、CON-021 | 代码 P0/P1=0；OnePlus GM1900 / Android 12 / Chrome 150 已验证 6分20秒、旋转/后台/锁屏继续、刷新与麦克风撤权显式中断。CON-021 留待 R4 完整恢复/结束复验 |
| DEV-005R3 | 正式工作台采集、恢复与安全结束体验 | 前端产品实现 Agent（任务 `019fe145-f4dd-74c3-8f7a-ffffbc21dc48`） | DONE | DEV-005R1、DEV-005R2 PASS、DISC-005R-UI DONE | [任务卡](tasks/DEV-005R3.md)、[实现交接](handoffs/DEV-005R3.md)、[PR #15](https://github.com/Li-Ming-G/elder_interview_ai/pull/15) final head `481ee25`、CI `31289795181` PASS、REV-025 PASS、merge `8d5c4c5` | 项目负责人手动 GitHub 复核 P0/P1=0；六项定向修复全部关闭。仅代表 R3 页面与安全结束实现通过，CON-020/021/022 继续由 R4 真机纵向验收收口 |
| DEV-005R4 | 首次访谈真实采集纵向验收与收口 | 独立任务 `019fe468-6cb3-7cf0-b327-4a46e2d7aae9` | DONE | DEV-005R1、DEV-005R2、DEV-005R3 PASS | [任务卡](tasks/DEV-005R4.md)、[最终交接](handoffs/DEV-005R4.md)、[PR #16](https://github.com/Li-Ming-G/elder_interview_ai/pull/16) final head `2fab0ea`、CI `31294084873` PASS、REV-026 PASS、merge `7477dca` | 项目负责人手动 GitHub 复核 P0/P1=0；桌面 5 分钟与 OnePlus/Android 约 8分21秒正式链路通过，CON-020/021/022 RESOLVED，父 DEV-005 DONE |
| DEV-006 | 后台结构化长期记忆最小纵向链路 | 独立实现任务 `019fe9e5-2a04-79e0-9e49-5f99ca21f648` | DONE | DISC-006 DONE、DEV-004C1/C2 DONE、SPEC-DEV-006 PASS/merge | [任务卡](tasks/DEV-006.md)、[交接](handoffs/DEV-006.md)、[PR #22](https://github.com/Li-Ming-G/elder_interview_ai/pull/22)、ADR-026/027、REV-033 | 项目负责人对 final head `07d5ce1c`、CI `31363920049` 定向复审 PASS，P0/P1=0；merge `28fb22d`。旧 head REQUEST_CHANGES/P1=8 永久保留；CON-023 继续 OPEN / NOT IMPLEMENTED / NOT VERIFIED，生产 boundary/deletion reader 均 fail-closed |
| SPEC-QUESTION-JOURNEY-001 | 陌生访谈旅程、双题库与有据轻调契约 | 专项契约 Agent | DONE | DEV-006 DONE、SPEC-AI-QUESTION-001 DONE、项目负责人确认产品方向 | [任务卡](tasks/SPEC-QUESTION-JOURNEY-001.md)、[PR #23](https://github.com/Li-Ming-G/elder_interview_ai/pull/23)、`01/03/04/05/07/08/09/10`、ADR-030、CON-025、REV-034 | 项目负责人对 final head `5963af98`、CI `31380903831` 定向复审 PASS，P0/P1=0；merge `f0bff3f`。old head `0f3034d` REQUEST_CHANGES/P1=3 永久保留；ADR-030 Accepted，CON-025 RESOLVED |
| SPEC-QUESTION-DIRECTOR-001 | 自由生成下一问、模型 Context 与 Prompt 契约纠偏 | 总控 Agent | DONE | DEV-006/007A DONE、项目负责人授权纠偏 | [任务卡](tasks/SPEC-QUESTION-DIRECTOR-001.md)、[交接](handoffs/SPEC-QUESTION-DIRECTOR-001.md)、[PR #26](https://github.com/Li-Ming-G/elder_interview_ai/pull/26)、ADR-031、CON-026、REV-037 | final head `8938d525`、CI `31454260127` 项目负责人定向复审 PASS，P0/P1=0、P2 动态状态残留已治理清理；merge `d320f642`。old head REQUEST_CHANGES/P1=4 永久保留 |
| DEV-007 | 结构化访谈导演与 AI 下一问（父任务） | 项目负责人（聚合验收） | VERIFY | SPEC-QUESTION-DIRECTOR-001、DEV-007A、DEV-007B 均 PASS/merge | [父任务卡](tasks/DEV-007.md)、[聚合交接](handoffs/DEV-007.md)、ADR-027-031、REV-032/033/034/035/037/038、main merge `3bb80df` / CI `31468031796` PASS | A/B 子任务均已完成；父任务等待项目负责人对 main 集成点的聚合验收，不由子任务 PASS 自动推导为 DONE |
| DEV-007A | 题库基础设施、旅程阶段与确定性选择 seam | Codex DEV-007A Agent | DONE | SPEC-QUESTION-JOURNEY-001 项目负责人 GitHub PASS | [任务卡](tasks/DEV-007A.md)、[最终交接](handoffs/DEV-007A.md)、[PR #24](https://github.com/Li-Ming-G/elder_interview_ai/pull/24)、[提示词](prompts/DEV-007A.md)、`04` §4.35A-4.35B、`05` §3.9.0、`09` §7.7、REV-035 | 项目负责人对 final head `6b8e69e1`、CI `31395799408` 定向复审 PASS，P0/P1=0；merge `7f9a173`。old head `5cea972` REQUEST_CHANGES/P1=2 永久保留；仅证明 synthetic fixture internal demo，正式题库仍缺失 |
| DEV-007B | 结构化访谈导演与工作台集成 | Codex DEV-007B v2 Agent | DONE | SPEC-QUESTION-DIRECTOR-001 PASS/merge、DEV-007A PASS、DEV-006 DONE | [任务卡](tasks/DEV-007B.md)、[最终交接](handoffs/DEV-007B.md)、[PR #27](https://github.com/Li-Ming-G/elder_interview_ai/pull/27)、REV-038、[提示词](prompts/DEV-007B.md)、QuestionEvidence/current-memory seam、`09` §7.6-7.7 | 项目负责人对 final head `0f03c270`、CI `31465809589` 手动定向复审 PASS，P0/P1/P2=0；merge `3bb80df`。old head `5429172` REQUEST_CHANGES（P1=4/P2=1）永久保留；旧 PR #25 继续 REQUEST_CHANGES、不得合并 |
| DEV-008 | 回顾、导出与删除 | 待分配 | BLOCKED | DEV-002、DEV-003、DEV-004、DEV-005、DEV-006、DEV-007、CON-006、CON-007 | `03`、`05`、`08`、`09` | 未拆分任务包含回顾 UI；开工前拆分并解决备份清理状态、删除摘要密钥轮换 |
| QA-001 | MVP 集成与真实访谈验收 | 独立测试/审查 Agent | BLOCKED | DEV-001 至 DEV-008 | `09` | 等待全部研发任务 |

## 维护要求

- 任务开始、阻塞、提交审查和完成时必须更新。
- 只有完成 `09` 和 `10` 所规定的适用验证后才能标记为 `DONE`；高风险任务和 MVP 发布必须独立验收。
- 不得在根目录其他文件维护第二份详细任务状态。
- 表格中的未启动下游任务是路线级工作包；任何任务进入 `READY` 前必须补齐 `10` 要求的正式任务字段。`READY` 只表示其明确子集可执行，不等于父任务或真实试点门禁通过。
