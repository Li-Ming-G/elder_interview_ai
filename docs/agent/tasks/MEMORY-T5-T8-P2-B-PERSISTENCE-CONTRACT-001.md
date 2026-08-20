# MEMORY-T5-T8-P2-B-PERSISTENCE-CONTRACT-001

## 当前状态

- 状态：`DONE / PASS / CONTRACT ONLY`。
- 映射：`T5-T8/P2`、`T18-T19/P6`、`T0/Foundation-Observability`。
- 基线：`main@7d02fa65e283472f87c52fcae12b332d18e85ec4`；accepted head `717c5ca39e678c6f953d0430768ae715ef0feef2` / merge-main `8bbb2cc24dcea9cfdb556a44e86ce037cfa90b89`。
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

本轮已形成正式 PASS。已补齐：

- pure validator 先执行正式 AJV Schema；
- checkpoint/source job、layer revision/source checkpoint/job、Long projection/job 的跨对象 parity；
- layer identity + revision number 全局唯一；
- Claim 的 evidence ID 集合、authority scope、canonical evidence manifest digest 与 evidence bridge 完整性；
- 34 个定向 contract tests，以及 JSON/Prettier/ESLint/API typecheck/diff-check 本地验证。

独立 exact-head 复核为 `PASS P0=0/P1=0/P2=0`，PR #72 exact-head CI `32245656541` 与 merge/main CI `32254759316` 均 SUCCESS。该接收仅覆盖数据库无关 contract-only；现在允许另立 P2-C runtime 任务，但必须重新建立 Prisma/migration/runtime 的独立范围、验证与审查，不把本 PASS 扩大到下游。

## 明确排除

P2 LLM semantic consolidation 的 provider seam 仍保留，但本任务不选择 provider/model，不请求 secret，不发送真实数据；P1 不增加 Long retrieval；P3 的 PostgreSQL/pgvector provider-neutral seam、P4 budget 和真实 embedding/model 均保持 DEFERRED。

## Governance closeout

PR #73 只收口上述已接收事实，merge/main `7e183217` / main CI `32256919620` SUCCESS；它不改变 P2-B contract-only 接收边界，也不接收 P2-C runtime。
