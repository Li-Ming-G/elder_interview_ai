# MEMORY-T5-T8-P2-A1-SEMANTIC-ENVELOPE-001

状态：`REVIEW / CONTRACT ONLY / LOCAL PASS / NOT ACCEPTED`

## 目标

在已接收 P2-A contract 与 P1 v1.2 基线上，冻结 P2 semantic consolidation 的最小、provider-neutral envelope：

```text
transient MemorySemanticContext
  -> SemanticProposal
  -> deterministic validation
  -> transient ValidatedMemoryMutationPlan
  -> committed-authority bridge contract
```

本任务只定义边界、Schema、fixtures、pure validator/loader 与 reference-only bridge，不实现持久化、Prisma、migration、runtime orchestration 或真实 provider。

## 唯一 iteration-coach 结论

结论：`Correction`。P2-B 不应直接从 P2-A 进入 persistence；必须先由 A1 冻结 transient semantic envelope，并把 semantic authority 与 projection/reference 层分开。该结论是路线修正，不是实现 PASS。

## T / P 映射

| T / P | A1 责任 | 本任务状态 |
|---|---|---|
| T4 / P1 | 只消费已接收 v1.2 的 current-session MemoryClaim/Resolution authority；不改变 P1 writer/trigger | UPSTREAM ACCEPTED / UNCHANGED |
| T5-T8 / P2 | 冻结 transient Context、SemanticProposal、非持久化 ValidatedMemoryMutationPlan 与 committed bridge contract | REVIEW / CONTRACT ONLY |
| T9-T10 / P3 | 不实现 Long retrieval、pgvector、embedding 或 Graph；仅保留未来可引用的 authority IDs | NOT STARTED |
| T11-T12 / P4 | 不实现 Director Context assembly 或 budget；不得把 P2 Context 冒充 P4 Context | NOT STARTED |
| T13-T15 / P5 | 不实现 evidence tool 调用；proposal 只能携带已授权的 evidence references | NOT STARTED |
| T18-T25 / P6 | 不实现 job/retry/CAS/transaction/retention runtime；只冻结未来 bridge/trace 所需的 typed references | DEFERRED TO P2-B/C |
| T0 / Observability | Trace/log 只允许 IDs、revision、digest、manifest 与状态引用，不保存语义正文、Prompt、Context 或 provider payload | CONTRACT REVIEW |

## 语义权威与引用边界

1. `MemoryClaim` / `MemoryResolution` 是唯一 semantic value authority；proposal、plan、Long、layer、Trace、log 均不得成为第二套语义值事实源。
2. `MemorySemanticContext` 是单次调用的 transient input，不持久化为长期业务真相。
3. `SemanticProposal` 是 LLM 的结构化建议，不具备写库、CAS、revision 或状态流转权限。
4. `ValidatedMemoryMutationPlan` 由程序验证后产生，但仍是 non-persistent transient plan；它不能被 reader 当作 committed memory。
5. committed bridge 只能在未来 P2-B 成功事务之后引用实际提交的 Resolution/Evidence/layer authority；A1 只冻结 shape，不执行 commit。
6. Long、layer、Decision Trace 与普通 log 只保存 reference-only provenance；禁止复制完整 semantic value、transcript、Prompt、Context 或 provider payload。
7. 同一 evidence 可支持多个 claim；proposal/commit membership 唯一性按 `(claim_ref, evidence_ref)` pair，且两侧 pair 集合必须完整一致。Context transcript segment membership 仍保持唯一。

## 交付范围

- `memory-semantic-context-v1`；
- `memory-semantic-proposal-v1`；
- `validated-memory-mutation-plan-v1`；
- `committed-semantic-projection-v1`；
- `memory-semantic-trace-v1`；
- 对应 docs、fixtures、pure semantic validators/loaders/tests 与 governance sync；
- 仅为对齐本 A1 machine contract 语义，允许必要同步正式 `04/05/07/08/09/10`；不得借此新增产品含义、runtime 行为、数据库事实或 provider activation。

## 明确不做

- 不实现 P2-B persistence、P2-C adversarial runtime、P2-D provider/data；
- 不修改 Prisma、migration、apps/packages runtime 或既有 accepted machine contract bytes；`04/05/07/08/09/10` 仅允许必要的 A1 契约语义同步，不允许扩展为 runtime、数据模型实现或新产品决定；
- 不启用 P3/P4/P5，不实现真实 Long retrieval、Graph、embedding、Director Context 或 evidence tools；
- 不选择真实 provider/model，不索取 secret，不发送真实数据；
- 不进入 P3/P4、真实授权、真实长者数据、公网、staging 或生产试点。

## 顺序门禁

唯一允许的推进顺序是：

```text
A1 exact-head independent acceptance
  -> P2-B persistence
  -> P2-C adversarial runtime verification
  -> P2-D real provider/data gate
```

A1 未被正式接收前，P2-B 不得开工；A1 的 Schema/本地测试/CI 均不能自行解锁 B。P2-C/D 也不得由 A1 提前实现或宣称 READY。

## 基线与审查

- branch：`codex/memory-p2-a1-semantic-envelope-001`；
- base/main：`00953acadb8edabefe0e59a9c570af745d22100b`；
- base tree：`033d3a9b2d905c8c758e6784063eae0da405b3bb`，与 PR #70 accepted head tree 一致；
- review package：REV-063；ADR-052；
- 首次独立 implementation review：`FAIL / P0=0/P1=3/P2=2`，详见 REV-063。当前只存在 dirty contract-only 修复候选，尚无 exact-head 独立 PASS、merge 或 DONE 结论。
- 第二轮定向 re-review：`FAIL / P0=0/P1=2/P2=1`。P1 为 duplicate durable resolution source 与 proposal/commit evidence uniqueness 语义矛盾；P2 为剩余 tamper test gap。状态继续 `REVIEW`。
- 第三次审查（第二次定向 re-review）：`FAIL / P0=0/P1=2/P2=0`。P1 为 projection-wide target/CAS/Resolution ID 未唯一，以及 MemoryEvidence ID 仅 entry-local 唯一。前两轮历史与 `REVIEW` 状态不变。
- 第四次审查（第三次定向 re-review）：本地 `PASS / P0=0/P1=0/P2=0`；定向矩阵 `138/138` 与适用 static checks 通过。前三轮 FAIL 永久保留。本结论仅绑定 dirty contract candidate，不等于 GitHub/CI/merge/DONE，A1 继续 `REVIEW`。

## 文件授权更正

原始总控委派与后续文件所有权均明确要求必要同步 `04/05/07/08/09/10`。本任务卡此前写成“不得修改正式 `04`-`10`”，与该授权矛盾。现按最新且更具体的授权修正为“仅允许 A1 契约语义同步 `04/05/07/08/09/10`”。

该更正不新增产品含义，不改变 A1 contract-only 边界，也不授权 runtime、Prisma、migration、provider activation、P2-B/C/D、P3/P4 或 UI，因此不登记 conflict log。首次 review 的该项 P2 仍在 REV-063 永久保留。
