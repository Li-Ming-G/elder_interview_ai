# DEV-007A 实现交接

## 状态与审查边界

- 状态：`REVIEW`，不得由实现 Agent 宣布 PASS/DONE 或合并。
- 基线：`origin/main@12021408242baeac99fdc89e00992bfdb0f14f1c`；分支：`codex/dev-007a-question-bank`；非 Draft [PR #24](https://github.com/Li-Ming-G/elder_interview_ai/pull/24)。
- 首轮实现恰好一次 iteration-coach 独立只读复核采用 Learning mode：确认 A 只拥有 question bank release/item 和确定性读取/决策 seam；不得修改 DEV-006 QuestionEvidence writer、attempt/candidate/snapshot 或创建第二套 question history。
- 项目负责人对 old exact head `5cea9726994656c6a95babdcb6bc8f3f7ce4014e`、CI `31385629751` 正式 `REQUEST_CHANGES`（P0=0/P1=2）；该事实按 REV-035 永久保留。本轮定向修复恰好一次独立只读复核采用 Correction mode，确认只闭合既有数据库完整性和可信部署门禁，无需重开 ADR-030/CON-025，也不改变 A/B/DEV-006 所有权。

## Migration 与实现

- PR 尚未合入 main，因此直接修订未发布的 `20260810193000_dev007a_question_bank` migration：release 增加 `item_count/membership_sealed_at`；item INSERT 只允许同一未提交事务中的 draft/unsealed 构建窗口，并在数据库层重检 scope/source/license；seal 后 draft/active/retired 均拒绝 INSERT/UPDATE/DELETE。
- canonical membership 按 `question_id` 排序，对 validator/bank version 与全部版本化 item 字段做 UTF-8 byte-length framing；TypeScript 预计算 SHA-256，PostgreSQL `pgcrypto` 独立重算。一次 seal 必须满足 actual count=`item_count` 且数据库 digest=`content_digest`；deferred constraint trigger 在 commit 再读最终状态，禁止未 seal 或不一致的半 release 提交。
- `QuestionBankImportService` 对固定 14 列 UTF-8 CSV 先全量校验，再以单事务按“create unsealed draft → createMany items → DB seal → audit → commit”创建完整 draft；导入、activate、retire 使用 actor/request + 可信 app environment 绑定、事务 advisory lock 和最小审计。激活在同一事务退休旧 active；许可或状态失败时旧 active 保留。
- CSV validator 拒绝未知/缺失表头、列数、重复 question ID、混合 version、未知枚举/purpose/condition、空 token、字段内重复、跨字段交集及非法 source/license；canonical membership digest 与原文件 digest 分离。
- `QuestionBankReader` 只读数据库 active + enabled + runtime license 合格条目，执行 applicable all-of、inapplicable any-of、排除优先，投影原始 purpose；policy/release 无法证明时失败关闭；`staging|production` 进程也不能读取 historical internal-demo active fact。
- `QuestionJourneyService` 只消费冻结受控信号、转录水位、memory/trusted-role manifest 与 policy/boundary revision，按 `journey_policy_v1` 固定优先级输出稳定 stage/reasons/basis hash；题数、经过时间、输入排列与重复 signal 不参与决策。
- `InternalDemoQuestionSelector` 仅为基础设施/测试 deterministic fake，不发布 QuestionEvidence，不是 AI unavailable 的页面兜底。
- 受控 CLI 提供 validate/import/activate/retire；validate 不要求数据库且只输出 summary/errors，写操作要求 operator reference 与 UUID request ID。`--environment` 被明确拒绝，可信环境只来自共享 config schema 校验的 `APP_ENV`：`local|test` 可承载 internal-demo scope，`staging` 映射正式内部环境，`production` 映射生产。没有新增普通 HTTP/WS 管理入口或 UI。

## 测试证据

- 空 PostgreSQL 测试库：12 migrations 从零 deploy，status up to date；本轮 migration 成功应用。
- unit：38 files / 265 tests；CSV/journey 与可信 `APP_ENV` 映射覆盖严格格式、全部条件非法输入、digest、许可/fixture、全部 journey 分支/冲突/顺序/重复/basis 和 `staging -> formal_internal`。
- PostgreSQL integration：12 files / 73 tests；题库 8 tests 覆盖 0 部分导入、精确幂等、membership seal/count/digest、draft/active/retired direct INSERT 反例、mismatch/fixture bypass 事务回滚、失败激活回滚、原子替换、active reader、purpose、条件 all/any/exclusion、可信环境下 fixture import/activate/select/retire 和不写 QuestionEvidence。
- auth：4 files / 23 tests；CLI validate、写操作身份参数、拒绝 `--environment value|--environment=value`、缺失/非法 APP_ENV、test 合法 fixture 与 staging/production fixture 拒绝已覆盖。
- 全局门禁：format、lint、typecheck、build、smoke、普通 Chromium 9/9、real Web/API auth Chromium 4/4、`git diff --check` 通过。
- 本机默认 `4173` 被共享进程占用，第一次 smoke/E2E 未执行；改用 `3197/4197`、`4198`、`4199` 隔离端口成功。auth E2E 首次把 API 端口一并改为 `3199`，但既有 Vite proxy 固定 `3101`，4 项均在登录前失败；恢复既有 API `3101`、仅隔离 Web `4199` 后 4/4 通过。未修改测试目标。
- 定向修复后在已跑真实音频 E2E 的库再次执行 auth，既有测试清理被残留 capture 外键阻止；未修改测试目标，改用新专用空库从零部署 12 migrations 后完整 auth 4 files / 23 tests 通过。

### REV-035 两项 P1 定向证据（候选）

- PostgreSQL 定向测试在专用空库从零应用 12 migrations；正常 import 查询 stored/actual item count 与数据库重算 digest 一致，中文 UTF-8 内容与空条件参与同一 framing；draft、active、retired 三种状态 direct INSERT 均命中稳定 seal 错误。
- 真实事务分别制造 count/digest mismatch 与 product-scope fixture 直接写入，均整体回滚且 0 half release；既有原子 activate/replay/reader/journey 逻辑未重写。
- CLI/auth 定向测试证明 `--environment test` 不再可用；`APP_ENV=staging|production` 即使 validate 同一 fixture 也稳定拒绝，`APP_ENV=test` 仍允许推导 `internal_demo` scope，非法 `APP_ENV=internal_demo` 启动即失败。
- 新 exact head 与 GitHub CI 将在提交/推送后补充；当前仍为 `REVIEW / REQUEST_CHANGES` 修复候选，不表示两项 P1 已由项目负责人关闭。

## Fixture、未实现与风险

- 使用仓库既有 `docs/question-bank/question-bank-internal-demo.fixture.csv`，其 `synthetic_fixture + fixture_only + INTERNAL_DEMO_ONLY/NOT_PRODUCT_CONTENT` 标记保持不变并走同一 validator/import/activation/reader；结果只能称 internal demo。
- 项目负责人 14 列正式题库内容尚未提供。A 的基础设施和合成 demo 不因此阻塞，但正式内部试用、产品内容质量/许可可用性和 DEV-007B 完成声明均不能成立。
- 未实现 LLM、轻调、QuestionEvidence publication、current/history/manual-next、工作台 UI、公开导入 API、未知许可公开题库或第二套 question history；DEV-006 所有权与当前显式 unavailable writer 行为未改。
- CON-023 deletion producer/read model 仍为 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`；A 的 policy seam 不把 fixture/no-op 当安全覆盖。

## 项目负责人手动审查重点

1. 未提交 draft 构建窗口、seal update、deferred commit trigger 与 item INSERT trigger 是否共同证明 count/digest/许可 scope 完整且所有已提交状态不可追加；
2. CSV 行级错误、canonical/raw digest、condition/purpose/source/license 组合是否与 `04/07/09` 逐值一致；
3. `journey_policy_v1` 的高优先分支、reason 顺序与 basis 是否覆盖全部冻结 provenance 且排除题数/时间；
4. A/B 与 DEV-006 所有权边界是否保持：本 PR 不应出现 attempt/candidate/snapshot/history/LLM/UI 写入；
5. `APP_ENV=staging|production` 是否在 CLI/service/reader 全部失败关闭，`--environment` 是否彻底失去覆盖权；fixture 报告是否始终限于 internal demo，正式题库缺失是否被清楚保留为后续门禁。
