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
| DEC-001 | 确认工程技术基线与跨规范冲突 | 总控 Agent | DONE | BASE-001 | `02` 至 `10`、ADR、冲突日志 | REV-003 PASS；P0/P1 为 0 |
| MVP-V01 | 最小纵向核心假设链路 | 总控 Agent | IN_PROGRESS | DEV-001A、DEV-001B 内部候选 seam | [里程碑卡](tasks/MVP-V01.md) | 仅限虚构/脱敏数据和非公网内部验证；逐段集成 |
| DEV-001 | 初始化工程与环境（父任务） | 总控 Agent | IN_PROGRESS | DEV-001A、DEV-001B | [父任务卡](tasks/DEV-001.md) | DEV-001B 最终加固/复审未完成，但不阻塞内部原型 |
| DEV-001A | 工程骨架与可重复工具链 | 工程基础实现 Agent（Archimedes） | DONE | DEC-001 | [任务卡](tasks/DEV-001A.md)、`fb99560`、REV-006 | REV-006 PASS；P0/P1/P2 均为 0 |
| DEV-001B | 身份、会话与权限基础 | 身份安全实现 Agent（dev001b_identity_security） | REVIEW | DEV-001A | [任务卡](tasks/DEV-001B.md)、`ab9628b`、HO-006 | CON-008、增强 Chromium 与独立复审阻塞最终 DONE/真实部署；不阻塞虚构身份内部原型 |
| DEV-002 | 最小项目、服务信息、授权与会话 | 后端业务 Agent（dev002_min_project_consent） | DONE | DEV-001A、DEV-001B 内部候选 seam | [任务卡](tasks/DEV-002.md)、`f16b82a`、ADR-014/015、REV-009 | 内部虚构数据范围验收通过；CON-010 仅阻塞口头授权音频集成和真实试点 |
| DEV-003 | 原始录音与分片上传（父任务） | 总控 Agent | DONE | DEV-003A、DEV-003B、DEV-003C | `06`、`09`、REV-010/011、PR #2 merge `bdf2910` | 内部虚构/合成音频原型完成；真实麦克风、长时、进程崩溃、多标签、真实配额、云存储和真实试点不在通过范围 |
| DEV-003A | 浏览器采集与本地可靠分片暂存 | 音频前端 Agent（dev003a_browser_audio_buffer） | DONE | DEV-001A | [任务卡](tasks/DEV-003A.md)、`41d6104`、`134be76`、真实 Chromium E2E 2/2、REV-010 PASS | 内部虚构数据原型完成；真实麦克风、崩溃、多标签、配额、长时录音和服务端上传编排不在本任务验收范围 |
| DEV-003B | 服务端原始分片、幂等与 manifest | 后端音频实现 Agent（dev003b_audio_backend） | DONE | DEV-002 会话 seam、DEV-003A 上传队列 seam | [任务卡](tasks/DEV-003B.md)、ADR-016、`134be76`、CI run `30872251081` PASS、REV-010 PASS | 内部虚构数据原型完成；REV-010 两项存储 P2 已由 DEV-003C 修复并经 REV-011 通过 |
| DEV-003C | 浏览器可靠上传编排与存储恢复加固 | 总控 Agent（协调前后端实现） | DONE | DEV-003A、DEV-003B、REV-010 | [任务卡](tasks/DEV-003C.md)、ADR-017、PR #2、head `1aa643a`、CI `30875834803` PASS、REV-011 PASS | 仅限虚构/合成音频内部链路；CON-013 在生产或真实试点前处理 |
| DEV-004 | 实时 ASR 与说话人映射（父任务） | 总控 Agent | IN_PROGRESS | DEV-003 | [父任务卡](tasks/DEV-004.md)、ADR-018/019 | DEV-004A 已通过，B1 候选进入 REVIEW、B2 待 B1 共享契约审查；父任务不提前关闭 |
| DEV-004A | 确定态转录证据核心与供应商中立适配器 | 后端转录实现 Agent（`dev004a_backend_impl`） | DONE | DEV-003、ADR-018、CON-015/016 | [任务卡](tasks/DEV-004A.md)、PR #3、head `917f888`、CI `30887031030` PASS、REV-012 | 仅覆盖内部虚构数据证据核心；两项非阻塞 P2 随后续转录加固处理 |
| DEV-004B1 | 业务 WebSocket 服务端协议核心 | 后端实时转录实现 Agent（`dev004b1_backend_impl`） | REVIEW | DEV-004A、ADR-019 | [任务卡](tasks/DEV-004B1.md)、`05` §5、`06` §4/§9/§11、实现 `293070e`、REV-013 | 本地非数据库门禁通过；真实 WS/PostgreSQL、smoke 与完整 CI 待 GitHub，项目负责人 PASS 前不得 DONE |
| DEV-004B2 | 浏览器合成 PCM 实时纵向链路 | 待分配 | TODO | DEV-004B1 共享契约提交 | DEV-004 父任务卡、ADR-019 | B1 contracts 提交前不得并行；开工前补完整任务卡 |
| DEV-005 | 访谈工作台 | 待分配 | BLOCKED | DEV-002、DEV-004 | `01`、`03`、`05`、`09` | 等待业务与转录链路 |
| DEV-006 | 结构化长期记忆 | 待分配 | BLOCKED | DEV-004 | `04`、`07`、`09` | 等待确定态转录与已批准边界过滤契约 |
| DEV-007 | AI 追问引擎 | 待分配 | BLOCKED | DEV-006 | `05`、`07`、`09` | 等待长期记忆 |
| DEV-008 | 回顾、导出与删除 | 待分配 | BLOCKED | DEV-002、DEV-003、DEV-004、DEV-005、DEV-006、DEV-007、CON-006、CON-007 | `03`、`05`、`08`、`09` | 未拆分任务包含回顾 UI；开工前拆分并解决备份清理状态、删除摘要密钥轮换 |
| QA-001 | MVP 集成与真实访谈验收 | 独立测试/审查 Agent | BLOCKED | DEV-001 至 DEV-008 | `09` | 等待全部研发任务 |

## 维护要求

- 任务开始、阻塞、提交审查和完成时必须更新。
- 只有完成 `09` 和 `10` 所规定的适用验证后才能标记为 `DONE`；高风险任务和 MVP 发布必须独立验收。
- 不得在根目录其他文件维护第二份详细任务状态。
- 表格中的未启动下游任务是路线级工作包；任何任务进入 `READY` 前必须补齐 `10` 要求的正式任务字段。`READY` 只表示其明确子集可执行，不等于父任务或真实试点门禁通过。
