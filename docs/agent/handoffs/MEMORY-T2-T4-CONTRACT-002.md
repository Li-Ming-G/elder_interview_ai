# MEMORY-T2-T4-CONTRACT-002 交接

## 状态与基线

- 状态：`REVIEW`；执行 Agent 不宣布 PASS/DONE，不 merge。
- branch：`codex/memory-t2-t4-contract-002`。
- base：`main@27e8d8d6aaa523b3298b5d64f6f27240696c542c` / CI `32001983350` SUCCESS。
- v1 history：PR #66 accepted `224445064613cb2abd24a7c761052b7679bbcbd6` / CI `31994482841` / PASS `5312635580` / merge `27e8d8d`。
- 唯一 iteration-coach/独立审计结论：`Correction`；未启动第二次。

## 实际改动

1. 新增 v1.1 Context/Output Schema、fixtures、正式 Markdown 契约；v1 标记 accepted-history/pre-runtime-superseded，三份 v1 machine artifacts 由固定 SHA-256 测试保护。
2. 新增纯 semantic/revision/dedupe/consumption/cutover validators 与契约测试，不接数据库或 runtime。
3. 冻结 text revision 0/exact parity、semantic/lifecycle 分离、existing disputed conflict set、failed stable-identity retry、partial unique SQL、transcript-owned consumption 和单 producer final-flush cutover。
4. 同步 `04/07/08/09/10`、task/board/trace、ADR-047、handoff/review indexes。
5. 未修改 Prisma、migration、repository、runtime、post-session producer、UI 或 `.codex/iteration-learning.md`。

## 验证

- v1 + v1.1 targeted contract suite：2 files / 45 tests PASS。
- workspace `format:check`：PASS。
- workspace `typecheck`：PASS。
- target ESLint（v1.1 validator/spec）：PASS。
- modified Markdown relative links：PASS。
- `git diff --cached --check`：PASS。
- exact-head CI：待提交后只运行一次并补充。

## 后续 reviewer / runtime 边界

- reviewer 必须绑定 non-Draft PR exact head 和 CI 给出结论；执行 Agent的本地 PASS 不等于独立 PASS。
- v1.1 PASS/merge 前不得启动 P1 runtime；之后 migration/runtime 仍需独立任务与 PostgreSQL fresh/upgrade/repeat、FK/partial index、concurrency/crash/cutover 验证。
- P2/P3/P4/P5、Context V2、真实 provider/secret/data、UI/production 保持后置。
