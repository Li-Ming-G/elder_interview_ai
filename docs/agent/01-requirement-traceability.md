# 需求追踪矩阵

## 文件用途

本文件用于把产品需求、业务规则、代码模块、接口、测试用例和审查结论连接起来，防止需求在开发过程中被遗漏。

以下条目把 MVP 需求组映射到路线任务和验收依据；代码路径、实现接口、测试结果和审查结论在对应任务推进时持续补齐。

| 追踪编号 | 需求或规则来源 | 需求摘要 | 代码模块 | 接口或事件 | 测试用例 | 审查结果 | 状态 |
|---|---|---|---|---|---|---|---|
| REQ-001 | `01` §6、§9；`03` §4-6；`04` §4.2-4.6、§4.23；`08` §4-5；ADR-014/015 | 项目、服务条款、捆绑授权与访问/start 门禁 | `apps/api/src/project-foundation`、Prisma migration `20260803153000_project_consent_session`、`f16b82a` | `05` §3.1-3.5、§4；snake_case contracts | project integration 5/5、根 integration 7/7、auth 13/13、unit 45/45；迁移 deploy/status 通过 | REV-009 PASS，P0/P1/P2=0；CON-010 只阻塞口头授权音频与真实试点 | DONE |
| REQ-002 | `01` §6；`04` §4.8/§4.24；`06` §2-3；ADR-016/017 | 原始录音、授权/访谈用途隔离、分片幂等、连续性与恢复 | `apps/web/src/audio`；`apps/api/src/audio`；Prisma migration `20260804120000_audio_objects`；持久化 `AudioUploadJob` | `05` §3.6、§4 的 audio object init/raw upload/complete/manifest | DEV-003C：unit 56/56、Chromium 3/3；响应丢失/刷新/ACK 严格匹配；最终 head CI `30875834803` migration/integration/auth/真实 API E2E 全通过 | REV-010 对 DEV-003A/B PASS；REV-011 对 PR #2 head `1aa643a` PASS；merge `bdf2910` | DONE |
| REQ-003 | `01` §5.7、§6；`03` §8、§12、§15；`04` §4.6A-4.9D；`05` §3.7、§5；`06` §4-10；ADR-006/018/019/025 | 实时 ASR、确定态转录、流级说话人确认、可信角色与人工修正 | DEV-004A/B1/B2 已合并；`SPEC-DEV-004C` DONE；`DEV-004C1` REVIEW、`DEV-004C2` BLOCKED | B1/B2 既有 `/ws/interviews`；C1 定向修复补齐 stable `(start_ms,id)` transcript API、GET/WS 共用 trusted-role projection、marker 后 canonical event 队列线性化与 membership 时间语义；单段与持久闭区间批量修正仍归 C2 | 旧 head `4d18bcf5826aacad97494342d965b9a28d538497` 被项目负责人正式 `REQUEST_CHANGES`（P0=0、P1=3）；修复 commit `87d725c` 覆盖真实 PostgreSQL/API/WS 与 390×844、320×568 实渲染面板，Android 真机不在本轮要求 | PR #18 定向修复仍为 REVIEW；本地 unit 219、integration 49、auth 13、Chromium 9、auth Chromium 4 通过，等待新 exact-head CI 与项目负责人手动复审 | IN_PROGRESS |
| REQ-004 | `01` §8；`03` §7-12、§17.2/§18；`04` §4.6/§4.25-4.27；`05` §3.5；`06` §3/§9-11；`08` §4.5；`09` §10.2/场景 A；ADR-020-024 | 首次访谈准备、真实单流录音与本浏览器 archive、实时转录、中断恢复、安全收束和事实展示；Android Chrome 为完整主设备，iPhone Safari 延期；项目管理/完整回顾后置 | `SPEC-DEV-005R`、`DEV-005R1`、`DEV-005R2C`、`DEV-005R2`、`DEV-005R3`、`DEV-005R4` 与父 `DEV-005` 均 DONE | 原子 start、capture generation、同一 audio object、archive/delivery 分离、controller 完整事实 projection、既有 stop/finalize/recover/abandon；R4 最小修复在服务端可信边界应用恢复代 ASR timeline offset，不改变 wire PCM 或公共契约 | PR #16 final head `2fab0ea`、CI `31294084873` 完整 verify PASS、REV-026 项目负责人手动 GitHub 复核 PASS、merge `7477dca`；桌面 Chromium 151 5 分钟与 OnePlus/Android 约 8分21秒正式路由，同 session/object/job、generation `0→1`、累计 archive、491/491 manifest、ASR drained、session completed；普通音量通过且安静失败 | 当前结论仅覆盖内部虚构内容、单台目标 Android、test ASR/no-cloud storage；iPhone、真实供应商、云存储、跨设备与生产部署另行验收 | DONE |
| REQ-005 | `01` §5.7、§6、§9；`07` §3-5 | 项目级结构化记忆、证据回链与冲突处理；只消费可信 elder/interviewer，排除 unknown 与校准控制内容 | `SPEC-DEV-006`、`DEV-006`（均未实现）；依赖 DEV-004C1 PASS | `05` §3.7、§3.10；C 生产 session revision/membership；SPEC-DEV-006 冻结逐 session watermark、跨 session provenance、输出 stale/查询过滤；DEV-006 负责重算 | `09` §4、§6.1、§7、场景 B | SPEC-DEV-006 保持 BLOCKED，项目负责人 PASS 前 DEV-006 不得开工 | 规划 |
| REQ-006 | `01` §6、§9；`03` §9.3；`07` §6-13；ADR-020/024 | 单个当前最佳追问、推荐原因、继续倾听、“没用，换一个”、只撤销最近一次更换、边界与降级 | `SPEC-AI-QUESTION-001`、`DEV-007A`（未实现）；R3 只留状态容器 | `05` §3.9、§5.10；replace/undo 幂等、竞态和排除集合恢复待冻结 | `09` §7、场景 A/B/C | DISC-005R-UI 已确认用户语义；旧采用/已问/忽略动作继续冻结 | 规划 |
| REQ-007 | `01` §6；`03` §13-17；`08` §11-14 | 回顾、普通/受限导出、撤回和删除 | `DEV-008`（未实现） | `05` §3.11-3.12、§7 | `09` §8、场景 D | REV-003 契约 PASS；CON-006/007 待 DEV-008 前解决 | 规划 |
| REQ-008 | `00` §11；`02` §6、§12-13；`08`；`09` §13 | 三链路降级、审计、安全和 MVP 发布门禁 | `DEV-001` 至 `QA-001`（未实现） | 全局 | `09` 发布门禁 | 待执行 | 规划 |
| REQ-009 | `02` §3；`ADR-007`、`ADR-008`、`ADR-010` | 可重复 workspace、PostgreSQL 迁移、统一测试和 CI 根门禁 | `package.json`、`apps/web`、`apps/api`、`packages/*`、`scripts`、`.github/workflows/ci.yml` | `GET /api/v1/health`、公共错误外壳 | 全新 clone：冻结安装、单元 6/6、集成 2/2、空迁移 deploy/status/重复 deploy、build、真实 dist 资产 smoke、Chromium E2E 1/1；Git 干净 | REV-006 PASS；P0/P1/P2 均为 0 | 已验收 |
| REQ-010 | `02` §3.5；`04` §4.1、§4.19-4.20；`05` §3.0；`08` §5.1 | 密码、production 身份启停、服务端会话、登录限流、CSRF、角色和逐资源授权基础 | `apps/api/src/auth`、`apps/api/src/cli`、`apps/web/src/app.tsx`、Prisma identity migration、`tests/auth`、`tests/e2e-auth` | `/api/v1/auth/login`、`logout`、`me`、`csrf`；`user:create/set-password/disable/enable` | auth 3 files/13 tests；unit 8/8；integration 2/2；build/smoke；迁移 status/重复 deploy；baseline Chromium 1 条、auth Chromium 2 条待外部执行 | REV-007 修复进入 REVIEW；CON-008 阻塞未知账号审计完整性与最终独立验收 | 待复审 |
| REQ-011 | `01` §9；`03` §10；`04` §4.13、§4.18、§4.21-4.22；`07` §5；`08` §11、§14 | 四类 marker 分义、候选载体、scope 删除状态机、AI 竞态/tombstone、最小控制信封和失败安全 | `DEV-005` 至 `DEV-008`（未实现） | markers、boundary-candidates、suggestions、exports、deletion-requests | `09` §8.2 | REV-003 PASS；P2 见 CON-006/007 | 已定义 |
| REQ-012 | `00` §3、§9；`09` §1.1；`10` §1.1；ADR-013/020/021 | 探索期以虚构数据分段建立纵向链路；任务 DONE 与真实试点分层门禁 | `MVP-V01`、`DEV-002/003/004/005/006/007` | 复用已冻结 REST/事件契约；测试转录和预创建项目仅内部夹具 | DEV-005 桌面/目标 Android 首次访谈纵向 E2E 已通过；真实试点仍执行 `09` §13 | DEV-005 已 DONE；当前推进 DEV-004C 可信说话人契约与实现，随后解锁 DEV-006/007 | 执行中 |

## 维护要求

- 新增正式需求时同步增加条目。
- 修改需求时保留变更记录，不得只改代码。
- 任务进入 `VERIFY` 前，相关条目必须能追溯到测试证据。
