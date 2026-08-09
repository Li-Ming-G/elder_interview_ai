# 需求追踪矩阵

## 文件用途

本文件用于把产品需求、业务规则、代码模块、接口、测试用例和审查结论连接起来，防止需求在开发过程中被遗漏。

以下条目把 MVP 需求组映射到路线任务和验收依据；代码路径、实现接口、测试结果和审查结论在对应任务推进时持续补齐。

| 追踪编号 | 需求或规则来源 | 需求摘要 | 代码模块 | 接口或事件 | 测试用例 | 审查结果 | 状态 |
|---|---|---|---|---|---|---|---|
| REQ-001 | `01` §6、§9；`03` §4-6；`04` §4.2-4.6、§4.23；`08` §4-5；ADR-014/015 | 项目、服务条款、捆绑授权与访问/start 门禁 | `apps/api/src/project-foundation`、Prisma migration `20260803153000_project_consent_session`、`f16b82a` | `05` §3.1-3.5、§4；snake_case contracts | project integration 5/5、根 integration 7/7、auth 13/13、unit 45/45；迁移 deploy/status 通过 | REV-009 PASS，P0/P1/P2=0；CON-010 只阻塞口头授权音频与真实试点 | DONE |
| REQ-002 | `01` §6；`04` §4.8/§4.24；`06` §2-3；ADR-016/017 | 原始录音、授权/访谈用途隔离、分片幂等、连续性与恢复 | `apps/web/src/audio`；`apps/api/src/audio`；Prisma migration `20260804120000_audio_objects`；持久化 `AudioUploadJob` | `05` §3.6、§4 的 audio object init/raw upload/complete/manifest | DEV-003C：unit 56/56、Chromium 3/3；响应丢失/刷新/ACK 严格匹配；最终 head CI `30875834803` migration/integration/auth/真实 API E2E 全通过 | REV-010 对 DEV-003A/B PASS；REV-011 对 PR #2 head `1aa643a` PASS；merge `bdf2910` | DONE |
| REQ-003 | `01` §6；`04` §4.7/4.9；`05` §5；`06` §4-10；ADR-006/018/019 | 实时 ASR、确定态转录与说话人映射 | DEV-004A/B1/B2 已合并；DEV-004C 校准/remap 与真实供应商链路待后续 | B1 静态 `/ws/interviews`、join/PCM/ACK/恢复；B2 browser transport/harness 消费同一 wire contract，无公开文字注入 | B2 final head `73a07cb` CI `31143035668` 全部门禁 PASS；本地 unit 109、Chromium 4/4 | REV-012/013/014 PASS；父 DEV-004 保持开放 | IN_PROGRESS |
| REQ-004 | `01` §8；`03` §7-12、§17.2/§18；`04` §4.6/§4.25-4.27；`05` §3.5；`06` §3/§9-11；`08` §4.5；`09` §10.2/场景 A；ADR-020-024 | 首次访谈准备、真实单流录音与本浏览器 archive、实时转录、中断恢复、安全收束和事实展示；Android Chrome 为完整主设备，iPhone Safari 延期；项目管理/完整回顾后置 | `SPEC-DEV-005R`、`DEV-005R1`、`DEV-005R2C`、`DEV-005R2` 已 DONE；`DEV-005R3` 已交 GitHub REVIEW，`DEV-005R4` 等待 R3 PASS | 原子 start、capture generation、同一 audio object、archive/delivery 分离、controller 完整事实 projection、既有 stop/finalize/recover/abandon；R3 修复提交 `433e098a` 增加 attempt-scoped reconcile ID 与 auth-expired 登录 seam | R3 full unit 32 files / 212 tests；PostgreSQL integration 41、auth 13、普通 Chromium 8/8、auth Chromium 4/4；五视口 × recording/interrupted/stopping/processing/completed/failed/NO_AUDIO 共 35 张截图与尺寸断言；401/403、deliveryError、三入口 modal 焦点和真假完成文案已有定向回归；R2 Android 事实见 REV-024，R3 未冒充真机 R4 | 首轮 head `db9579c4` 的 REQUEST_CHANGES 已定向修复，R3 仍等待项目负责人手动复核新 GitHub final head；CON-020/021 继续开放到 R4 完整恢复/安全结束，CON-022 保持开放等待 Android 复验，父 DEV-005 仍执行中 | 执行中 |
| REQ-005 | `01` §6、§9；`07` §3-5 | 项目级结构化记忆、证据回链与冲突处理 | `DEV-006`（未实现） | `05` §3.10 | `09` §4、§7、场景 B | 待执行 | 规划 |
| REQ-006 | `01` §6、§9；`03` §9.3；`07` §6-13；ADR-020/024 | 单个当前最佳追问、推荐原因、继续倾听、“没用，换一个”、只撤销最近一次更换、边界与降级 | `SPEC-AI-QUESTION-001`、`DEV-007A`（未实现）；R3 只留状态容器 | `05` §3.9、§5.10；replace/undo 幂等、竞态和排除集合恢复待冻结 | `09` §7、场景 A/B/C | DISC-005R-UI 已确认用户语义；旧采用/已问/忽略动作继续冻结 | 规划 |
| REQ-007 | `01` §6；`03` §13-17；`08` §11-14 | 回顾、普通/受限导出、撤回和删除 | `DEV-008`（未实现） | `05` §3.11-3.12、§7 | `09` §8、场景 D | REV-003 契约 PASS；CON-006/007 待 DEV-008 前解决 | 规划 |
| REQ-008 | `00` §11；`02` §6、§12-13；`08`；`09` §13 | 三链路降级、审计、安全和 MVP 发布门禁 | `DEV-001` 至 `QA-001`（未实现） | 全局 | `09` 发布门禁 | 待执行 | 规划 |
| REQ-009 | `02` §3；`ADR-007`、`ADR-008`、`ADR-010` | 可重复 workspace、PostgreSQL 迁移、统一测试和 CI 根门禁 | `package.json`、`apps/web`、`apps/api`、`packages/*`、`scripts`、`.github/workflows/ci.yml` | `GET /api/v1/health`、公共错误外壳 | 全新 clone：冻结安装、单元 6/6、集成 2/2、空迁移 deploy/status/重复 deploy、build、真实 dist 资产 smoke、Chromium E2E 1/1；Git 干净 | REV-006 PASS；P0/P1/P2 均为 0 | 已验收 |
| REQ-010 | `02` §3.5；`04` §4.1、§4.19-4.20；`05` §3.0；`08` §5.1 | 密码、production 身份启停、服务端会话、登录限流、CSRF、角色和逐资源授权基础 | `apps/api/src/auth`、`apps/api/src/cli`、`apps/web/src/app.tsx`、Prisma identity migration、`tests/auth`、`tests/e2e-auth` | `/api/v1/auth/login`、`logout`、`me`、`csrf`；`user:create/set-password/disable/enable` | auth 3 files/13 tests；unit 8/8；integration 2/2；build/smoke；迁移 status/重复 deploy；baseline Chromium 1 条、auth Chromium 2 条待外部执行 | REV-007 修复进入 REVIEW；CON-008 阻塞未知账号审计完整性与最终独立验收 | 待复审 |
| REQ-011 | `01` §9；`03` §10；`04` §4.13、§4.18、§4.21-4.22；`07` §5；`08` §11、§14 | 四类 marker 分义、候选载体、scope 删除状态机、AI 竞态/tombstone、最小控制信封和失败安全 | `DEV-005` 至 `DEV-008`（未实现） | markers、boundary-candidates、suggestions、exports、deletion-requests | `09` §8.2 | REV-003 PASS；P2 见 CON-006/007 | 已定义 |
| REQ-012 | `00` §3、§9；`09` §1.1；`10` §1.1；ADR-013/020/021 | 探索期以虚构数据分段建立纵向链路，当前优先首次访谈三页闭环；任务 DONE 与真实试点分层门禁 | `MVP-V01`、`DEV-002/003/004/005/006/007` | 复用已冻结 REST/事件契约；测试转录和预创建项目仅内部夹具 | 首次访谈 Chromium 纵向 E2E；真实试点仍执行 `09` §13 | DEV-005A/B/C 已 PASS/DONE；完整闭环只剩 DEV-005D | 执行中 |

## 维护要求

- 新增正式需求时同步增加条目。
- 修改需求时保留变更记录，不得只改代码。
- 任务进入 `VERIFY` 前，相关条目必须能追溯到测试证据。
