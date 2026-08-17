# MEMORY-T2-T4-CONTRACT-002｜Memory Maintainer V1.1 前向契约修订

状态：`REVIEW`

## 基线与历史

- base：`main@27e8d8d6aaa523b3298b5d64f6f27240696c542c`，CI `32001983350` SUCCESS；
- v1 accepted history：PR #66 head `224445064613cb2abd24a7c761052b7679bbcbd6` / CI `31994482841` / PASS comment `5312635580` / merge `27e8d8d6`；
- 唯一 iteration-coach/独立审计结论：`Correction`；本任务不启动第二次；
- branch：`codex/memory-t2-t4-contract-002`。

## 目标

新增 forward-only v1.1 machine contract，在 Prisma/migration/runtime 开工前修复：

1. `text_revision` 允许 0、拒绝 -1，Context/Trace/CAS 逐值使用 DB revision；
2. `MemorySemanticStatus` 与 `MemoryResolutionStatus` lifecycle 分离，disputed 强制 existing conflict set；
3. `working_memory_maintain` failed retry 和 partial unique dedupe；
4. transcript-owned consumption 与 AI cleanup pointer detach；
5. P1 scanner/final flush 与旧 post-session extract 的单 producer cutover；
6. v1 bytes 和 PR #66 接收历史永久保留。

## 交付

- `docs/contracts/memory-maintainer-v1.1.md`；
- v1.1 Context/Output JSON Schema 与 fixtures；
- pure semantic/revision/dedupe/consumption/cutover validator 与 contract tests；
- `04/07/08/09/10`；board、trace、ADR、handoff、review current index；
- non-Draft PR 与一次 exact-head CI。

## 边界

- 不改 Prisma schema、migration、repository、runtime、post-session producer 或 UI；
- 不接 provider/secret/真实数据，不实现 P2/P3/P4/P5/Context V2；
- 不修改 `.codex/iteration-learning.md`；
- 执行 Agent保持 REVIEW，不宣布 PASS/DONE，不 merge。

## 验收

- v1 三 machine artifacts SHA-256 不变；
- v1.1 contract fixtures 覆盖六类 Correction 正反例；
- format、typecheck、target lint、git diff check 和 exact-head CI SUCCESS；
- 项目负责人或被明确授权的独立 reviewer 绑定 exact head 给出结论。
