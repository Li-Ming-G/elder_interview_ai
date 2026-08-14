# 当前交接索引

本文件只记录当前仍有后续价值的交接入口。完整历史交接保存在 [`handoffs/05-handoff-log-history.md`](handoffs/05-handoff-log-history.md)，不作为动态状态源。

## 当前接收对象

| 任务 | 最新交接 | 当前接收对象 | 关键未完成事项 |
|---|---|---|---|
| SPEC-LLM-PROVIDER-001 | [PR #52](https://github.com/Li-Ming-G/elder_interview_ai/pull/52)、REV-050、[任务卡](tasks/SPEC-LLM-PROVIDER-001.md)、[交接](handoffs/SPEC-LLM-PROVIDER-001.md)、ADR-040、CON-031、REQ-019 | 项目负责人 exact-head GitHub 定向复审 | REVIEW / REQUEST_CHANGES pending re-review；old `b7ae9a4` / CI `31769677989` / P1=3 永久保留。三项定向修复候选与本地全门禁已完成：semantic membership、四类 provenance、canonical config/warnings/equal-effective-config；等待新 exact-head CI SUCCESS，不得自 PASS/DONE/merge。真实 provider/model/region/密钥/境外处理未选择，DEV-ASR-PROVIDER-001 未 PASS |
| DEV-001B | HO-006 补充 | 总控 / 独立安全审查 | CON-008、增强 Chromium、独立复审；保持 REVIEW |
| DEV-004 / DEV-004C / DISC-006 | [SPEC 交接](handoffs/SPEC-DEV-004C.md)、[C1](handoffs/DEV-004C1.md)、[C2](handoffs/DEV-004C2.md)、ADR-026、REV-027-030 | SPEC-DEV-006 | DEV-004/C1/C2 与 DISC-006 DONE；CON-024 RESOLVED。下一步只冻结 current memory、快照/未来资格、actual asked、过程记录和模块所有权；DEV-006 仍等 SPEC PASS。补转录后置；CON-023 deletion runtime 缺口继续 OPEN |
| SPEC-DEV-006 | [最终交接](handoffs/SPEC-DEV-006.md)、[PR #20](https://github.com/Li-Ming-G/elder_interview_ai/pull/20)、ADR-027、REV-031 | DEV-006、SPEC-AI-QUESTION-001/DEV-007 | DONE；final head `4759633`、CI `31326717132`、项目负责人定向复审 PASS、merge `6289c87`。逐业务输出 derived、retention root/child 与共享 QuestionEvidenceModule 已冻结；CON-018/023 继续 OPEN |
| DEV-006 | [实现交接](handoffs/DEV-006.md)、[PR #22](https://github.com/Li-Ming-G/elder_interview_ai/pull/22)、ADR-026/027、REV-033 | DEV-007（暂停） | DONE；final head `07d5ce1c`、CI `31363920049`、项目负责人定向复审 PASS、merge `28fb22d`。旧 head REQUEST_CHANGES/P1=8 永久保留；QuestionEvidence/current-memory/actual-asked seam 已交付，CON-023 继续 OPEN；DEV-007 等 CON-025 产品对齐 |
| DISC-AI-QUESTION-001 | [任务卡](tasks/DISC-AI-QUESTION-001.md)、ADR-028、CON-018 | SPEC-AI-QUESTION-001、DEV-007 | DONE；项目负责人直接纠正旧框架：更合适问题可自动替换；所有展示快照可只读回看；“下一个问题”替代“换一个”；一层撤销不再实现。展示历史不改变 canonical current，也不冒充 actual-question |
| SPEC-AI-QUESTION-001 | [任务卡](tasks/SPEC-AI-QUESTION-001.md)、[交接](handoffs/SPEC-AI-QUESTION-001.md)、[PR #21](https://github.com/Li-Ming-G/elder_interview_ai/pull/21)、ADR-029、REV-032 | DEV-007（暂停） | DONE；final head `af088ed6`、CI `31352681061` attempt 2、项目负责人手动审查 PASS、merge `10fcc5c`。CON-018 RESOLVED；DEV-006 seam 已交付，DEV-007 因 CON-025 暂不启动 |
| SPEC-QUESTION-JOURNEY-001 | [任务卡](tasks/SPEC-QUESTION-JOURNEY-001.md)、[最终交接](handoffs/SPEC-QUESTION-JOURNEY-001.md)、[PR #23](https://github.com/Li-Ming-G/elder_interview_ai/pull/23)、ADR-030、CON-025、REV-034 | DEV-007A、后续 DEV-007B | DONE；final head `5963af98`、CI `31380903831`、项目负责人定向复审 PASS、merge `f0bff3f`。old head REQUEST_CHANGES/P1=3 永久保留；条件 v1、journey policy、14 列 purpose/adaptation reason 已冻结，DEV-007A READY，B 仍等待 A |
| DEV-007A | [最终交接](handoffs/DEV-007A.md)、[PR #24](https://github.com/Li-Ming-G/elder_interview_ai/pull/24)、ADR-030、REV-035 | DEV-007B | DONE；final head `6b8e69e1`、CI `31395799408`、项目负责人定向复审 PASS、merge `7f9a173`。old head REQUEST_CHANGES/P1=2 永久保留；membership seal 与可信 APP_ENV 已关闭，只证明 synthetic fixture internal demo，正式题库缺失，B READY |
| DEV-007B | [最终交接](handoffs/DEV-007B.md)、[PR #27](https://github.com/Li-Ming-G/elder_interview_ai/pull/27)、ADR-031、REV-038 | DEV-007 父任务聚合验收 | DONE；final head `0f03c270`、CI `31465809589`、项目负责人手动定向复审 PASS（P0/P1/P2=0）、merge `3bb80df`。old head `5429172` REQUEST_CHANGES（P1=4/P2=1）永久保留；旧 PR #25 继续 REQUEST_CHANGES、不得合并 |
| DEV-007 | [父任务卡](tasks/DEV-007.md)、[聚合交接](handoffs/DEV-007.md)、REV-032/033/034/035/037/038 | 项目负责人聚合验收 | VERIFY；A/B 及全部专项前置均已 PASS/merge，main 集成点 `3bb80df` 的 CI `31468031796` PASS。等待父任务聚合结论；不得用子任务 PASS 自动宣布父任务 DONE；按后续产品决定不作为 008A 前置 |
| SPEC-DEV-008A | [最终交接](handoffs/SPEC-DEV-008A.md)、[任务卡](tasks/SPEC-DEV-008A.md)、[PR #31](https://github.com/Li-Ming-G/elder_interview_ai/pull/31)、ADR-034、`local-audio-archive-v1`、REV-041 | DEV-008A1；后续 A2/A3/008D | DONE；final head `0308aa9e` / CI `31573583324` 经项目负责人授权总控定向复审 PASS，P0/P1=0；merge `91e5e7ed` / main CI `31573985661` SUCCESS。old head REQUEST_CHANGES/P1=3 永久保留；仅 A1 READY，父 A/A2/A3/008D 保持 BLOCKED；CON-023 继续 OPEN |
| SPEC-DEV-008A1-ACCESS | [最终交接](handoffs/SPEC-DEV-008A1-ACCESS.md)、[任务卡](tasks/SPEC-DEV-008A1-ACCESS.md)、[PR #33](https://github.com/Li-Ming-G/elder_interview_ai/pull/33)、ADR-035、CON-028、REV-042 | DEV-008A1 实现任务 | DONE；exact head `81f0bba3` / CI `31586889712` 获项目负责人 PASS（P0/P1/P2=0）；merge `18ba7381` / main CI `31587442461` SUCCESS。ADR-035 Accepted、CON-028 RESOLVED、A1 READY；无业务实现，父 A/A2/A3/008D 仍 BLOCKED |
| DEV-008A1 | [最终交接](handoffs/DEV-008A1.md)、[任务卡](tasks/DEV-008A1.md)、[PR #35](https://github.com/Li-Ming-G/elder_interview_ai/pull/35)、REV-043 | DEV-008A2 与 DEV-008A3 独立实现任务 | DONE；exact head `4bc1c005` / CI `31592543835` 获项目负责人 PASS（P0/P1/P2=0）；merge `29e3f993` / main CI `31593387265` SUCCESS。A2/A3 READY 并必须复用 A1 shell/routes/read model；父 A IN_PROGRESS，008D BLOCKED、CON-023 OPEN |
| SPEC-DEV-008A3-PREFLIGHT | [最终交接](handoffs/SPEC-DEV-008A3-PREFLIGHT.md)、[任务卡](tasks/SPEC-DEV-008A3-PREFLIGHT.md)、[PR #37](https://github.com/Li-Ming-G/elder_interview_ai/pull/37)、ADR-036、CON-029、REV-044 | DEV-008A3 独立实现任务 | DONE；exact head `70167688` / CI `31597563095` 获项目负责人手动独立审查 PASS（P0/P1/P2=0）；merge `60f60cb6` / main CI `31598183784` SUCCESS。ADR-036 Accepted、CON-029 RESOLVED、A3 READY；只接收 docs/shared-contract 接缝，无 runtime/Prisma/IndexedDB/UI 改动；008D/CON-023 不变 |
| DEV-008A2 | [最终交接](handoffs/DEV-008A2.md)、[任务卡](tasks/DEV-008A2.md)、[PR #39](https://github.com/Li-Ming-G/elder_interview_ai/pull/39)、REV-045 | DEV-008A 父任务与 A3 整合 | DONE；accepted head `1ad334de` / CI `31608031668` 获授权总控 PASS（P0/P1/P2=0）；merge `7c32760f` / main CI `31609156286` SUCCESS。`d240afd3` REQUEST_CHANGES、`cce98c8f` StrictMode P1、`ef85c3b` CI flake 永久保留。父 A IN_PROGRESS、A3 REVIEW、008D BLOCKED、CON-023 不变 |
| DEV-008A3 / DEV-008A | [最终交接](handoffs/DEV-008A3.md)、[A3 任务卡](tasks/DEV-008A3.md)、[父任务卡](tasks/DEV-008A.md)、[PR #40](https://github.com/Li-Ming-G/elder_interview_ai/pull/40)、REV-046 | 后续独立 DEV-008D / 项目级未完成任务 | DONE；A3 accepted head `93be9a27b93e763e56457668c78b5ac2a332bab4` / CI `31612276827` 获授权总控 PASS（P0/P1/P2=0）；merge `d2a911d3fd4362a84653c1401c4c23b8c5b4aafe` / main CI `31613083916` SUCCESS。旧 `70b8fe8` REQUEST_CHANGES P1=1/P2=1 与 `f491d99` 中间修复永久保留。父 A 仅在响应式网页 A 范围 DONE；008D BLOCKED、CON-023 OPEN，server deletion/导出/PWA/App/ASR/LLM/007 未完成 |
| DEV-008A4 | [最终交接](handoffs/DEV-008A4.md)、[任务卡](tasks/DEV-008A4.md)、[PR #44](https://github.com/Li-Ming-G/elder_interview_ai/pull/44)、[PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/44#issuecomment-5281992260)、ADR-037、REV-047 | 后续独立真实 ASR/provider、DEV-008D 与项目级未完成任务 | DONE；accepted head `3824da7c48f9f63b4ca71b0fb56f459d8c24fa7d` / CI `31711325876` 获项目负责人 PASS（P0/P1/P2=0）；merge `175e92e3bda76f4b180e85519e3bf8e62c356311` / main CI `31712044809` SUCCESS。旧 `f1eea3c` 全绿但用户发现缺口、`1f3e7c4` ordinary Chromium 22/27 与更早失败历史永久保留；真实 ASR/provider、server deletion、DEV-008D/CON-023 不变 |
| SPEC-REPEAT-INTERVIEW-001 | [最终交接](handoffs/SPEC-REPEAT-INTERVIEW-001.md)、[任务卡](tasks/SPEC-REPEAT-INTERVIEW-001.md)、[PR #46](https://github.com/Li-Ming-G/elder_interview_ai/pull/46)、[PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/46#issuecomment-5287945749)、ADR-038、CON-030、REV-048 | DEV-008B1/B2 实现任务与项目级未完成门禁 | DONE；accepted head `8d4a26263db7b75dd22469f767240d705d3ce5fe` / CI `31715348528` 获项目负责人 PASS（P0/P1=0）；merge `54fb814e44ab2a405f78133e480d467577dbc7b8` / main CI `31757442056` SUCCESS。old `99e5d317` REQUEST_CHANGES P1=1 与 fix `0623b5f` 历史永久保留；B1/B2 READY 但 runtime/Prisma/UI/provider 未实现 |
| SPEC-CONTINUING-CONSENT-001 | [最终交接](handoffs/SPEC-CONTINUING-CONSENT-001.md)、[任务卡](tasks/SPEC-CONTINUING-CONSENT-001.md)、[PR #49](https://github.com/Li-Ming-G/elder_interview_ai/pull/49)、[PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/49#issuecomment-5288833214)、ADR-039、CON-012、REV-049、REQ-018 | DEV-008B1 受限实现；SPEC-CONSENT-TEXT-POLICY-001；B1 完成后重评 B2 | DONE；accepted head `1d241a4b` / CI `31764584701` 获 PASS（P0/P1/P2=0），merge `712b4ff` / main CI `31764903272` SUCCESS；old `4095e570` REQUEST_CHANGES P1=3 永久保留。B1 仅 implementation-ready，真实 covered 仍 BLOCKED，B2 等 B1 runtime；无 runtime/Prisma/UI/正式正文处理 |
| SPEC-DEV-005R | [HO-038](handoffs/SPEC-DEV-005R.md) / REV-021 | DEV-005R2/3/4 | 契约、R1、R2C 已 DONE；当前进入 R2，CON-020/021 仍开放 |
| DISC-005R-UI | [HO-040](handoffs/DISC-005R-UI.md) | DEV-005R2/3/4、SPEC-AI-QUESTION-001 | 比例与 Android Chrome 主设备已确认；CON-021 等 R2 真机证据，iPhone Safari 延期 |
| DEV-005R4 / DEV-005 | [最终交接](handoffs/DEV-005R4.md)、[PR #16](https://github.com/Li-Ming-G/elder_interview_ai/pull/16)、REV-026 | DEV-006/007 后续任务、总控 | R4 与父 DEV-005 DONE；final head `2fab0ea`、CI `31294084873`、merge `7477dca`，CON-020/021/022 RESOLVED。真实供应商、云存储、iPhone 与生产范围后置 |

| SPEC-ASR-PROVIDER-001 | [契约交接](handoffs/SPEC-ASR-PROVIDER-001.md)、[任务卡](tasks/SPEC-ASR-PROVIDER-001.md)、[PR #28](https://github.com/Li-Ming-G/elder_interview_ai/pull/28)、ADR-032、REV-039、CON-027 | DEV-ASR-PROVIDER-001 | DONE；final head `84a2173c`、CI `31484868105`、项目负责人定向复审 PASS、merge `d7b318f`、main CI `31494227785` SUCCESS。old head REQUEST_CHANGES/P1=1 永久保留；CON-027 继续阻塞真实长者/PII，真实 provider 验收移交 DEV |
| SPEC-ASR-WIRE-PARAM-001 | [最终交接](handoffs/SPEC-ASR-WIRE-PARAM-001.md)、[任务卡](tasks/SPEC-ASR-WIRE-PARAM-001.md)、[PR #29](https://github.com/Li-Ming-G/elder_interview_ai/pull/29)、ADR-033、REV-040 | DEV-ASR-PROVIDER-001 | DONE；final head `650f856c`、CI `31556525476`、项目负责人手动 PASS（P0/P1/P2=0）、merge `1e18ea83`、main CI `31560488220` SUCCESS。旧 ADR-032、SPEC/REV-039/PASS 与 REVIEW 候选历史不改；一次受控诊断已解锁但尚未执行，完整 provider 验收仍待 DEV |

## 最近已完成交接

| 任务 | 最新交接 | 结果 |
|---|---|---|
| DEV-003 | HO-016 | PR #2 合并，父任务 DONE，内部合成音频范围关闭 |
| DEV-004A | HO-020 | PR #3 合并，确定态证据核心 DONE |
| DEV-004B1 | HO-024 | PR #4 合并，服务端合成 PCM 协议核心 DONE |
| DEV-004B2 | HO-031 | PR #5 合并，浏览器合成 PCM 实时纵向链路 DONE |
| SPEC-FE-001 | [HO-030](handoffs/HO-030.md) | PR #6 合并，REV-015 PASS，页面规划与可执行拆分 DONE |
| DEV-005A | [HO-033](handoffs/DEV-005A.md) | PR #7 合并，REV-016 PASS，准备页与正式路由外壳 DONE；DEV-005B READY |
| SPEC-SESSION-END-001 | [HO-032](handoffs/SPEC-SESSION-END-001.md) | PR #8 合并，REV-017 最终 PASS，契约 DONE；CON-019 RESOLVED，DEV-005C READY |
| DEV-005B | [HO-035](handoffs/DEV-005B.md) | PR #9 合并，REV-018 PASS，转录优先工作台 DONE；父 DEV-005 继续 BLOCKED |
| DEV-005C | [HO-034](handoffs/DEV-005C.md) | PR #10 合并，REV-019 第三次定向复审 PASS，服务端安全结束 DONE；实现前新增 DISC-005D 产品讨论门槛 |
| DEV-005R1 | [HO-039](handoffs/DEV-005R1.md) | PR #13 head `c19a295`、CI `31245403822`、REV-020 定向复审 PASS、merge `656db20`；R1 DONE，前置已交给 READY 的 R2 |
| DEV-005R2C | [任务交接](handoffs/DEV-005R2C.md) | PR #12 head `ae07747`、CI `31246011913`、REV-022 PASS、merge `e455c13`；R2C DONE，DEV-005R2 READY |
| DEV-005R2 | [任务交接](handoffs/DEV-005R2.md) | PR #14 已合并；REV-024 在 OnePlus/Android 12/Chrome 150 完成控制器真机生命周期验收，R2 DONE、R3 READY；完整 resume/安全结束留 R4 |
| DOC-002 | HO-025 | 协作文档当前态与历史归档分离完成 |
| SPEC-QUESTION-DIRECTOR-001 | [交接](handoffs/SPEC-QUESTION-DIRECTOR-001.md)、[PR #26](https://github.com/Li-Ming-G/elder_interview_ai/pull/26)、ADR-031、CON-026、REV-037 | DONE；final head `8938d525`、CI `31454260127`、项目负责人定向复审 PASS、merge `d320f642`。两份 Schema 正式，题库为可选参考，seen/declared 分离，同输入 retry 冻结；DEV-007B READY，PR #25 不得合并 |

## 使用规则

- 新 Agent 先读任务板、当前任务卡和本表对应的最新交接，再按历史卷中的 `HO-ID` 精确查阅背景。
- 任务状态以 `00-task-board.md` 为准；审查结论以 `04-review-report.md` 为准。
- 新交接写入历史卷后，只在本表更新对应任务的最新入口。

## 历史索引

完整 `HO-001` 至 `HO-024` 及补充记录见 [`handoffs/05-handoff-log-history.md`](handoffs/05-handoff-log-history.md)；HO-025 见 `handoffs/DOC-002.md`，HO-026 起按任务文件归档。
