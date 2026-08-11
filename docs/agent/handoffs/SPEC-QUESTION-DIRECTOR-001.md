# SPEC-QUESTION-DIRECTOR-001 交接

## 结论

本候选把题库从强制白名单改为可选参考，同时保留 DEV-006、DEV-007A 与 ADR-027-029 已有的数据库、历史、幂等和安全基座。它是 docs-only 契约纠偏，不是 DEV-007B 实现。

- 分支：`codex/spec-question-director-001`
- PR：[#26](https://github.com/Li-Ming-G/elder_interview_ai/pull/26)
- 状态：`REVIEW`；项目负责人 exact-head PASS 前不得合并或解锁 DEV-007B。

## 后续实现边界

- 新建 DEV-007B v2 分支/PR；PR #25 old head 保留 REQUEST_CHANGES 历史，不直接合并。
- 可以选择性移植 #25 中契约中立的 current/history/API/WS/UI/幂等代码；director、Context、candidate persistence 与测试按新契约重写。
- 第一版一个实时模型调用；数据库读写和 Context 构建由普通后端服务负责。
- 正式题库缺失不阻止虚构数据工程验证，但阻止题库内容、许可和真实问题质量的产品结论。

## 审查重点

1. 是否彻底消除必填单一题库来源和轻调白名单，而非只把 FK 设 nullable；
2. Context、Output、Prompt 版本和三类 provenance 是否足够实现；
3. source facts 只读与 suggestion history 追加持久化是否同时成立；
4. ADR-027-029、硬安全、retention、幂等与 displayed != actual asked 是否保持。

## 本地验证

- `pnpm format:check`、Markdown 相对链接、两份 JSON 解析、`git diff --check`：PASS。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`：PASS；typecheck 首次因本地 Prisma generated client 未同步 main 的题库模型失败，执行标准 `pnpm db:generate` 后重跑通过，生成物无 Git diff。
- `pnpm test:unit -- --run`：38 files / 265 tests PASS。
- migration/integration/auth 首次尝试连接共享 `127.0.0.1:5433/elder_interview_test`；该库已有历史失败 migration `20260810062000_dev006_review_invariants`，Prisma P3009 在测试执行前阻止 deploy。本任务不修改数据库或清理共享库，完整 PostgreSQL/CI 门禁交 exact-head GitHub CI。
