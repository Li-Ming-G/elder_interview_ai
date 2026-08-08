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
| SPEC-AI-QUESTION-001 | 单问题建议与替换契约 | 待分配 | READY | SPEC-FE-001 产品决定 | [任务卡](tasks/SPEC-AI-QUESTION-001.md) | DEV-007A 开工硬前置；只冻结契约，不实现代码 |
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
| DEV-004 | 实时 ASR 与说话人映射（父任务） | 总控 Agent | IN_PROGRESS | DEV-003 | [父任务卡](tasks/DEV-004.md)、ADR-018/019 | DEV-004A/B1/B2 已通过；DEV-004C 仍受 CON-014；父任务不提前关闭 |
| DEV-004A | 确定态转录证据核心与供应商中立适配器 | 后端转录实现 Agent（`dev004a_backend_impl`） | DONE | DEV-003、ADR-018、CON-015/016 | [任务卡](tasks/DEV-004A.md)、PR #3、head `917f888`、CI `30887031030` PASS、REV-012 | 仅覆盖内部虚构数据证据核心；两项非阻塞 P2 随后续转录加固处理 |
| DEV-004B1 | 业务 WebSocket 服务端协议核心 | 后端实时转录实现 Agent（`dev004b1_backend_impl`） | DONE | DEV-004A、ADR-019 | [任务卡](tasks/DEV-004B1.md)、PR #4、head `80ff1c7`、merge `13350a4`、CI `30969408276` PASS、REV-013 PASS | 仅覆盖服务端内部合成 PCM 协议核心；三项 P2 转后续加固，B2/真实 ASR/长时性能不在本任务 |
| DEV-004B2 | 浏览器合成 PCM 实时纵向链路 | 浏览器实时转录实现 Agent（`dev004b2_browser_realtime_impl`） | DONE | DEV-004B1、ADR-019、REV-013 | [任务卡](tasks/DEV-004B2.md)、PR #5 head `73a07cb`、CI `31143035668` PASS、REV-014 PASS、merge `49949fc`、HO-031 | 内部虚构/合成 PCM 浏览器链路完成；真实麦克风/ASR、长时和正式工作台未覆盖 |
| DEV-005 | 首次访谈页面闭环（父任务） | 总控 Agent | IN_PROGRESS | DEV-002、DEV-003、DEV-004B2、SPEC-FE-001、SPEC-SESSION-END-001 | [父任务卡](tasks/DEV-005.md)、[重构契约](tasks/SPEC-DEV-005R.md) | A-R/B-R/C-R/D-R 已获项目负责人批准；进入正式契约与 DEV-005R1-4 实现，旧 A/B/C 历史不改写 |
| DEV-005A | 首次访谈准备页与正式路由外壳 | 前端实现任务对话 | DONE | DEV-002、DEV-003、SPEC-FE-001 | [任务卡](tasks/DEV-005A.md)、PR #7 head `ea6c20f`、CI `31161076538` PASS、REV-016 PASS、merge `066c424`、HO-033 | 内部虚构数据准备页和路由外壳完成；两个 P2 转 DEV-005B，不代表完整工作台或安全结束完成 |
| DEV-005B | 转录优先访谈工作台 | 前端工作台实现任务对话 | DONE | DEV-004B2、DEV-005A 页面外壳 | [任务卡](tasks/DEV-005B.md)、PR #9 head `c73e7ad`、CI `31166457093` PASS、REV-018 PASS、merge `647a6b4`、HO-035 | 工作台范围已通过；不含 stop/recover、真实 AI、真实麦克风或父 DEV-005 完成 |
| DEV-005C | 服务端会话安全结束编排 | 后端会话编排实现任务对话 | DONE | SPEC-SESSION-END-001 PASS、DEV-003C、DEV-004B2 | [任务卡](tasks/DEV-005C.md)、PR #10 head `36f534a`、CI `31174226564` PASS、REV-019 PASS、merge `9691dad`、HO-034 | 三轮审查后 P0/P1=0；三个已登记 P2 不阻塞当前内部 MVP 范围 |
| DISC-005-R0 | 首次访谈纵向链路重构总纲讨论 | 项目负责人 + 总控 Agent | DONE | DEV-005A/B/C 历史证据、DISC-005D 候选包 | [讨论任务卡](tasks/DISC-005-R0.md)、CON-020、HO-037 | R0 与 A-R/B-R/C-R/D-R 已批准并由 SPEC-DEV-005R 正式承接；讨论完成不代表实现完成 |
| DISC-005D | 安全结束页产品体验讨论 | 项目负责人 + 总控 Agent | DONE | DEV-005A、DEV-005B、DEV-005C PASS | [历史讨论卡](tasks/DISC-005D.md) | 旧候选已在 D-R 中复核、修订并写入 SPEC-DEV-005R；保留历史输入 |
| DEV-005D | 安全结束页薄集成（旧任务） | 无 | CANCELLED | 已由 DEV-005R3 取代 | [历史任务卡](tasks/DEV-005D.md)、HO-037 | 未实施；不撤销旧 A/B/C，结束与中断体验由新纵向任务承接 |
| SPEC-DEV-005R | 首次访谈真实采集纵向链路重构契约 | 总控 Agent | DONE | A-R/B-R/C-R/D-R 已批准 | [任务卡](tasks/SPEC-DEV-005R.md)、ADR-023/024、CON-020/021、PR #11 head `80ab84f`、CI `31244954185` PASS、REV-021 PASS、merge `c572490` | 四个 P1 定向关闭，stacked 契约基线已解除；不代表 DEV-005R 实现完成 |
| DEV-005R1 | 服务端采集生命周期与原子开始 | 独立任务 `019fdce6-9745-7aa0-b430-8dd0f7fcf27a` | DONE | SPEC-DEV-005R PASS | [任务卡](tasks/DEV-005R1.md)、PR #13 head `c19a295`、CI `31245403822` PASS、REV-020 定向复审 PASS、merge `656db20` | 全 generation PCM P1 已关闭；R1 前置完成，R2 仍等待 R2C PASS |
| DISC-005R-UI | 页面内容占比与注意力层级 | 独立任务 `019fdee4-c4b0-7073-b652-0f0caea99cdc` | DONE | SPEC-DEV-005R、DEV-005R3 | [任务卡](tasks/DISC-005R-UI.md)、[HO-040](handoffs/DISC-005R-UI.md) | 用户逐项确认并由总控写回；Android Chrome 为完整主设备，R2 生命周期证据登记 CON-021 |
| DEV-005R2C | 浏览器采集与归档核心（并行基础） | 独立任务 `019fdce6-9746-7e63-8776-03f4264bb1d9` | IN_PROGRESS | SPEC-DEV-005R 候选基线 | [任务卡](tasks/DEV-005R2C.md) | 禁止改共享 DTO、正式路由、工作台和中央治理文档；完成后主动通知总控 |
| DEV-005R2 | 浏览器单流采集、归档与交付控制器 | 待创建的前端音频实现任务 | BLOCKED | DEV-005R1、DEV-005R2C PASS | [任务卡](tasks/DEV-005R2.md)、CON-021 | 集成 R1/R2C，并以 Android Chrome 真机冻结后台/锁屏/旋转/设备中断行为 |
| DEV-005R3 | 正式工作台采集、恢复与安全结束体验 | 待创建的前端产品实现任务 | BLOCKED | DEV-005R1、DEV-005R2 PASS、DISC-005R-UI DONE | [任务卡](tasks/DEV-005R3.md) | UI 必须使用 impeccable；五视口、分状态比例、高密度转录，不伪造服务端事实 |
| DEV-005R4 | 首次访谈真实采集纵向验收与收口 | 待创建的集成验收任务 | BLOCKED | DEV-005R1、DEV-005R2、DEV-005R3 PASS | [任务卡](tasks/DEV-005R4.md)、CON-020、CON-021 | 桌面+Android Chrome 真机故障矩阵 PASS 后才可关闭父任务与冲突 |
| DEV-006 | 结构化长期记忆 | 待分配 | BLOCKED | DEV-004 | `04`、`07`、`09` | 等待确定态转录与已批准边界过滤契约 |
| DEV-007 | AI 追问引擎 | 待分配 | BLOCKED | DEV-006、SPEC-AI-QUESTION-001 | `05`、`07`、`09` | 等待长期记忆及单问题替换契约；旧采用/已问/忽略生命周期不得实现 |
| DEV-008 | 回顾、导出与删除 | 待分配 | BLOCKED | DEV-002、DEV-003、DEV-004、DEV-005、DEV-006、DEV-007、CON-006、CON-007 | `03`、`05`、`08`、`09` | 未拆分任务包含回顾 UI；开工前拆分并解决备份清理状态、删除摘要密钥轮换 |
| QA-001 | MVP 集成与真实访谈验收 | 独立测试/审查 Agent | BLOCKED | DEV-001 至 DEV-008 | `09` | 等待全部研发任务 |

## 维护要求

- 任务开始、阻塞、提交审查和完成时必须更新。
- 只有完成 `09` 和 `10` 所规定的适用验证后才能标记为 `DONE`；高风险任务和 MVP 发布必须独立验收。
- 不得在根目录其他文件维护第二份详细任务状态。
- 表格中的未启动下游任务是路线级工作包；任何任务进入 `READY` 前必须补齐 `10` 要求的正式任务字段。`READY` 只表示其明确子集可执行，不等于父任务或真实试点门禁通过。
