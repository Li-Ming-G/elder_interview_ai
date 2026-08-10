# DEV-007A 实现交接

## 状态与审查边界

- 状态：`REVIEW`，不得由实现 Agent 宣布 PASS/DONE 或合并。
- 基线：`origin/main@12021408242baeac99fdc89e00992bfdb0f14f1c`；分支：`codex/dev-007a-question-bank`；非 Draft [PR #24](https://github.com/Li-Ming-G/elder_interview_ai/pull/24)。
- 恰好一次 iteration-coach 独立只读复核采用 Learning mode：确认 A 只拥有 question bank release/item 和确定性读取/决策 seam；不得修改 DEV-006 QuestionEvidence writer、attempt/candidate/snapshot 或创建第二套 question history。

## Migration 与实现

- `20260810193000_dev007a_question_bank` 新建 `question_bank_release/question_bank_item`、受控枚举、全局 bank version、每 scope 至多一个 active、操作 request ID、来源/许可与集合不相交约束，以及 item/release 不可变和生命周期触发器。
- `QuestionBankImportService` 对固定 14 列 UTF-8 CSV 先全量校验，再以单事务创建完整 draft；导入、activate、retire 使用 actor/request 绑定、事务 advisory lock 和最小审计。激活在同一事务退休旧 active；许可或状态失败时旧 active 保留。
- CSV validator 拒绝未知/缺失表头、列数、重复 question ID、混合 version、未知枚举/purpose/condition、空 token、字段内重复、跨字段交集及非法 source/license；canonical content digest 与原文件 digest 分离。
- `QuestionBankReader` 只读数据库 active + enabled + runtime license 合格条目，执行 applicable all-of、inapplicable any-of、排除优先，投影原始 purpose；policy/release 无法证明时失败关闭。
- `QuestionJourneyService` 只消费冻结受控信号、转录水位、memory/trusted-role manifest 与 policy/boundary revision，按 `journey_policy_v1` 固定优先级输出稳定 stage/reasons/basis hash；题数、经过时间、输入排列与重复 signal 不参与决策。
- `InternalDemoQuestionSelector` 仅为基础设施/测试 deterministic fake，不发布 QuestionEvidence，不是 AI unavailable 的页面兜底。
- 受控 CLI 提供 validate/import/activate/retire；validate 不要求数据库且只输出 summary/errors，写操作要求 operator reference、UUID request ID 与部署环境。没有新增普通 HTTP/WS 管理入口或 UI。

## 测试证据

- 空 PostgreSQL 测试库：12 migrations 从零 deploy，status up to date；本轮 migration 成功应用。
- unit：37 files / 261 tests；本轮 CSV/journey 29 tests，覆盖严格格式、全部条件非法输入、digest、许可/fixture、全部 journey 分支/冲突/顺序/重复/basis。
- PostgreSQL integration：12 files / 71 tests；本轮 6 tests 覆盖 0 部分导入、精确幂等、immutable trigger、失败激活回滚、原子替换、active reader、purpose、条件 all/any/exclusion、fixture import/activate/select/retire 和不写 QuestionEvidence。
- auth：4 files / 18 tests；CLI validate 与写操作身份参数门禁已覆盖。
- 全局门禁：format、lint、typecheck、build、smoke、普通 Chromium 9/9、real Web/API auth Chromium 4/4、`git diff --check` 通过。
- 本机默认 `4173` 被共享进程占用，第一次 smoke/E2E 未执行；改用 `3197/4197`、`4198`、`4199` 隔离端口成功。auth E2E 首次把 API 端口一并改为 `3199`，但既有 Vite proxy 固定 `3101`，4 项均在登录前失败；恢复既有 API `3101`、仅隔离 Web `4199` 后 4/4 通过。未修改测试目标。

## Fixture、未实现与风险

- 使用仓库既有 `docs/question-bank/question-bank-internal-demo.fixture.csv`，其 `synthetic_fixture + fixture_only + INTERNAL_DEMO_ONLY/NOT_PRODUCT_CONTENT` 标记保持不变并走同一 validator/import/activation/reader；结果只能称 internal demo。
- 项目负责人 14 列正式题库内容尚未提供。A 的基础设施和合成 demo 不因此阻塞，但正式内部试用、产品内容质量/许可可用性和 DEV-007B 完成声明均不能成立。
- 未实现 LLM、轻调、QuestionEvidence publication、current/history/manual-next、工作台 UI、公开导入 API、未知许可公开题库或第二套 question history；DEV-006 所有权与当前显式 unavailable writer 行为未改。
- CON-023 deletion producer/read model 仍为 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`；A 的 policy seam 不把 fixture/no-op 当安全覆盖。

## 项目负责人手动审查重点

1. migration 触发器与 advisory lock 是否完整证明 draft immutable、单 active、失败回滚和并发 request/version/scope 绑定；
2. CSV 行级错误、canonical/raw digest、condition/purpose/source/license 组合是否与 `04/07/09` 逐值一致；
3. `journey_policy_v1` 的高优先分支、reason 顺序与 basis 是否覆盖全部冻结 provenance 且排除题数/时间；
4. A/B 与 DEV-006 所有权边界是否保持：本 PR 不应出现 attempt/candidate/snapshot/history/LLM/UI 写入；
5. fixture 报告是否始终限于 internal demo，正式题库缺失是否被清楚保留为后续门禁。
