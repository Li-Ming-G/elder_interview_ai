# MEMORY-T2-T4-CONTRACT-001｜正式 P1 Memory Maintainer 契约

状态：`REVIEW`

## 目标

把 PR #65 的 candidate/local seam 收敛为可供后续 migration/runtime 实现的正式机器契约，先冻结唯一 memory authority、P1 provider input/output、Hybrid Trigger、事务和 crash/replay 语义，不提前形成 producer 事实。

## 架构映射

| T 任务 | P 层 | 本任务实现 |
|---|---|---|
| T2 | Foundation / Memory Contract | Episode/Fact、Working/Mid/Long、Thread、Boundary、Evidence、revision/snapshot authority |
| T4 | P1 | Working Memory Maintainer 冻结输入与 candidate operations Schema |
| T18-T19 | P6 | durable trigger identity、freeze/call/writeback、scanner/recovery/late fence 契约 |
| T0 | Foundation / Observability | typed reference-only provenance，不复制完整正文/prompt/provider payload |

## 交付

- `docs/contracts/memory-maintainer-context-v1.schema.json`
- `docs/contracts/memory-maintainer-output-v1.schema.json`
- `docs/contracts/fixtures/memory-maintainer-v1.fixtures.json`
- `docs/contracts/memory-maintainer-v1.md`
- `apps/api/src/memory/memory-maintainer-contract.spec.ts`
- `04/07/09/10` 正式职责和 runtime gate 同步
- board、traceability、ADR-046、handoff/review index 同步

## 边界

- 本任务不改 Prisma schema/migration，不连接 finalized listener，不创建 runtime producer。
- 不复用 post-session `StructuredMemoryClaim[]` 作为正式 T4 output。
- 不接真实 provider/secret/data，不切 Context V2，不实现 P2/P3/P4/P5/UI。
- runtime 只能在本契约 exact-head 独立 PASS 并 merge 后开工。

## 审查重点

- `(batch OR time) AND minimumUseful` 是否被机械冻结；
- 是否保持 `MemoryClaim/Resolution` 为 value 唯一权威；
- provider 是否只产候选且返回完整 proposed next state/expected revisions；
- evidence/new-vs-overlap、事务原子性、crash/replay/late fence 是否足以支撑 durable runtime；
- legacy nullable 是否明确 unavailable 而非伪造 Working/Thread provenance。

## 本地验证

- 两份 Schema + fixtures：7/7 PASS；
- `format:check`、workspace `typecheck`、目标测试文件 ESLint、`git diff --check` PASS；
- 一次全仓 lint 先发现新测试缺显式返回类型，已修复；随后仅因本机 ignored `tmp/dev008a4-sandbox` 不在 TypeScript project 而失败。未删除该历史目录；目标源文件 lint PASS，最终 exact-head CI 将在 clean checkout 复核全仓 lint。
