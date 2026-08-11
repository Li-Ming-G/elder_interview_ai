# SPEC-QUESTION-DIRECTOR-001 交接

## 结论

本任务已把题库从强制白名单改为可选参考，同时保留 DEV-006、DEV-007A 与 ADR-027-029 已有的数据库、历史、幂等和安全基座。它是已审查合并的 docs-only 契约，不是 DEV-007B 实现。

REV-037 对 old head `0a75b170` 的四项 P1 已在 final head `8938d525` 关闭：两份 JSON Schema 成为唯一 wire structure；Director 只经过基础硬校验；技术失败最多一次完全同输入 retry；seen 题库 membership 与 declared attribution 分离。旧 REQUEST_CHANGES 历史永久保留。

- 分支：`codex/spec-question-director-001`
- PR：[#26](https://github.com/Li-Ming-G/elder_interview_ai/pull/26)
- 状态：`DONE`；项目负责人对 final head `8938d525`、CI `31454260127` 定向复审 PASS，PR merge `d320f642`。DEV-007B 仅解锁为 READY，尚未开工。

## 后续实现边界

- 新建 DEV-007B v2 分支/PR；PR #25 old head 保留 REQUEST_CHANGES 历史，不直接合并。
- 可以选择性移植 #25 中契约中立的 current/history/API/WS/UI/幂等代码；director、Context、candidate persistence 与测试按新契约重写。
- 第一版一个实时 Director；一次逻辑生成遇 transport/timeout 或第一次返回未过基础硬校验时最多一次完全同输入 retry，不携带前次输出/错误/修复提示。数据库读写和 Context 构建由普通后端服务负责。
- 正式题库缺失不阻止虚构数据工程验证，但阻止题库内容、许可和真实问题质量的产品结论。

## 审查重点

1. 两份 JSON Schema 是否是 AI 实际输入/输出的唯一技术结构，Markdown/Prompt 是否已删除平行 shape；
2. 后端是否只做 Schema、ID/subset、权限、安全、版本、重复等可确定硬校验，没有复杂事实语义 validator 或第二个 AI；
3. primary 后的 retry 是否完全同 Prompt/Context/Schema/model config，第二次失败是否 0 candidate/current/history mutation；
4. frozen seen membership 与 candidate declared attribution 是否分开且 declared 空集合合法；
5. source facts 只读、suggestion history 追加持久化、ADR-027-029 与 displayed != actual asked 是否保持。

## 本地验证

- `pnpm format:check`、Markdown 相对链接、两份 JSON 解析、`git diff --check`：PASS。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`：PASS；typecheck 首次因本地 Prisma generated client 未同步 main 的题库模型失败，执行标准 `pnpm db:generate` 后重跑通过，生成物无 Git diff。
- `pnpm test:unit -- --run`：38 files / 265 tests PASS。
- migration/integration/auth 首次尝试连接共享 `127.0.0.1:5433/elder_interview_test`；该库已有历史失败 migration `20260810062000_dev006_review_invariants`，Prisma P3009 在测试执行前阻止 deploy。本任务不修改数据库或清理共享库，完整 PostgreSQL/CI 门禁交 exact-head GitHub CI。
