# SPEC-DEV-008A1-ACCESS 交接｜restricted 首页投影与 evidence-finalization 边界

## 基本信息

- 状态：`DONE`
- base：`origin/main@29bdce17c0b9b81c965078fd12600b340b564194`
- branch：`codex/spec-dev-008a1-access-projection`
- PR：[PR #33](https://github.com/Li-Ming-G/elder_interview_ai/pull/33)；final exact head `81f0bba3d30139e458e919da969d40386231cc62` / CI `31586889712` SUCCESS；merge `18ba7381f7ba747c2fb3beefe28297c6d063a174` / main CI `31587442461` SUCCESS
- 审查：项目负责人正式 PASS，P0/P1/P2=0；记录见 [issuecomment-5265462316](https://github.com/Li-Ming-G/elder_interview_ai/pull/33#issuecomment-5265462316)

## 已完成

- 读取规定基础文档、SPEC-DEV-008A/DEV-008A/A1、ADR-034、REV-041、相关正式专项条款和最新交接；
- 读取 DEV-008A1 原实现窗口及其唯一独立只读 Correction 证据，未启动第二次 iteration-coach；
- 冻结有效 assignment + restricted 的独立最小项目列表投影；deleted/软删除/assignment 失效完全不可见；
- 冻结 session cursor 的 `project_id + created_at + id` 签名绑定与失败关闭；
- 冻结普通 Home/prepare/workbench/review readers 与专属 evidence-finalization seam 的边界；
- 在 shared contracts 新增 project list、session page 与 evidence-finalization DTO；
- 同步任务板、A1 任务卡、追踪、CON-028、ADR-035、REV-042、交接与 iteration journal。

## 明确未实现

- 无业务代码、Prisma、migration、页面或测试实现变更；
- 未实现 GET handlers、repository/query、cursor signer、路由、UI 或安全回归；
- 未实现 A2/A3/008D、导出、server deletion、PWA/App、ASR/LLM；
- 未改变已冻结 stop/commitment、授权或 deletion scope 的业务状态机。

## 本地验证

- `git diff --check`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck` 通过；
- `pnpm test:unit --run`：45 files / 290 tests 通过；
- 在独立新建测试库 `elder_interview_test_docs_2530_20260812` 上从空库执行 13 个 migration，`migrate status` 为 up to date；integration 13 files / 76 tests、auth 4 files / 23 tests 全通过；
- `pnpm build` 通过；smoke 使用隔离端口 3200/4273，Web/API/PostgreSQL 与 2 个静态资产通过；
- baseline Chromium 10/10、auth Chromium 4/4 通过。隔离端口仅用于避开另一工作区已有的 4173 Vite preview；未终止或复用该进程；
- 首次 integration 在共享 `elder_interview_test` 因既有 question-bank version 残留触发 `QUESTION_BANK_VERSION_EXISTS`。没有绕过 Prisma 的危险 reset 门禁，改用全新独立测试库后完整通过；该失败不归因于本次 docs/shared-contract diff。

## 恢复 A1 后的必修项

1. `GET /projects` 仅对 restricted+有效 assignment 返回 `ProjectListRestrictedProjection`，无主动作；
2. session list cursor 跨项目、篡改、失效/过期和权限漂移失败关闭；
3. `GET /sessions/:id` 不得以 session/finalization `created_by` 绕过 assignment；
4. restricted/soft-deleted/deleted 的 project/service-term/consent/session 普通深链不返回正文；
5. 只有限制前冻结 stop 的原 actor 可消费 `EvidenceFinalizationResponse`，且不能进入普通页面；
6. 为上述成功/反例补 PostgreSQL/API/auth/component/Chromium 验证，再按 A1 原任务完成全门禁。

## REV-042 最终接收

- exact head/CI、正式 PASS、merge commit 与 main CI 已形成完整证据链；
- SPEC-DEV-008A1-ACCESS `DONE`、ADR-035 `Accepted`、CON-028 `RESOLVED`、DEV-008A1 `READY`；
- 父 DEV-008A、A2、A3、008D 保持 `BLOCKED`，CON-023 继续 `OPEN`；
- 旧 Correction 和 REV-042 `PENDING` 候选历史保留；本接收不冒充 A1 runtime 实现或安全回归通过。

## 治理 closeout 验证

- `git diff --check` 通过；
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck` 通过；
- closeout diff 仅包含治理文档、索引、任务/交接、contract README 与 journal；未修改业务代码、shared DTO 内容、Prisma、migration、页面或运行时测试目标。

## iteration-coach 证据

- DEV-008A1 实现窗口：`019ff4ed-ed98-7e00-a592-6c6036a53a62`；
- 唯一独立只读复核：`019ff55e-3879-77e3-b539-b924d3fc330d`，Correction mode，阻断于零改动阶段；
- 总控裁决：有效 assignment 的 restricted 项目显示无正文中性占位；deleted/软删除/assignment 失效不可见；独立最小 DTO；A1 保持零改动直到本契约 PASS/merge；
- 本 docs-only 任务复用该 Correction，不重复启动独立复核。

## 下一位必须先读取

DEV-008A1 实现：除原任务要求外，必须先读取本交接及 REV-042 最终审查/merge 证据；不得重新解释 restricted 字段或复用 `ProjectResponse` 返回受限正文，也不得启动第二次 iteration-coach。
