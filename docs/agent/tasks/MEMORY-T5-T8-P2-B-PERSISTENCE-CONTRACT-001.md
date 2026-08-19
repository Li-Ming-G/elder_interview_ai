# MEMORY-T5-T8-P2-B-PERSISTENCE-CONTRACT-001

## 当前状态

- 状态：`REVIEW / NOT ACCEPTED / CONTRACT ONLY`。
- 映射：`T5-T8/P2`、`T18-T19/P6`、`T0/Foundation-Observability`。
- 基线：`main@7d02fa65e283472f87c52fcae12b332d18e85ec4`。
- 范围：数据库无关的 persistence machine contract、JSON Schema、fixtures 与 pure validator；不实现 Prisma、migration、repository、runtime、provider、P3/P4 或 UI。

## 当前候选

候选文件：

1. `docs/contracts/memory-persistence-v1.schema.json`
2. `docs/contracts/memory-persistence-v1.md`
3. `docs/contracts/fixtures/memory-persistence-v1.fixtures.json`
4. `apps/api/src/memory/memory-persistence-contract.ts`
5. `apps/api/src/memory/memory-persistence-contract.spec.ts`

当前实现冻结的核心边界：MemoryClaim/MemoryResolution 仍是唯一 semantic authority；Checkpoint、LayerIdentity、LayerRevision、RevisionMember、Long projection、Job、Retention root 和 A1 Evidence 只保存 typed references、revision、status、digest 与 membership，不保存 prompt/context/transcript/provider payload。

## 审查历史与本轮修复

初始独立 adversarial 结果永久保留为 `P0=0/P1=6/P2=1`：正式 Schema 闭合校验、manifest/parity、predecessor/identity/layer/环、duplicate claim membership、FK 删除语义、A1 evidence provenance 与 Claim/Resolution 引用完整性均有缺口。

本轮仍未形成正式 PASS。已在候选中补齐：

- pure validator 先执行正式 AJV Schema；
- checkpoint/source job、layer revision/source checkpoint/job、Long projection/job 的跨对象 parity；
- layer identity + revision number 全局唯一；
- Claim 的 evidence ID 集合、authority scope、canonical evidence manifest digest 与 evidence bridge 完整性；
- 34 个定向 contract tests，以及 JSON/Prettier/ESLint/API typecheck/diff-check 本地验证。

独立只读复核最终为 `Clear`；下一步由项目负责人绑定 exact-head 建 PR/CI 并进行正式审查。在此之前不得标记 PASS/DONE 或进入 P2-C runtime。

## 明确排除

P2 LLM semantic consolidation 的 provider seam 仍保留，但本任务不选择 provider/model，不请求 secret，不发送真实数据；P1 不增加 Long retrieval；P3 的 PostgreSQL/pgvector provider-neutral seam、P4 budget 和真实 embedding/model 均保持 DEFERRED。
