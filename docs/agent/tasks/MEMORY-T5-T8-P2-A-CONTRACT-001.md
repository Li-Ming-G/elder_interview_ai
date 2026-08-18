# MEMORY-T5-T8-P2-A-CONTRACT-001

状态：`DONE / PASS / CONTRACT ONLY`

## 基线与范围

- branch：`codex/memory-t5-t8-p2-a-contract-001`；base `main@58794c4c6e82a4dfeeb5e89af430c3bac85cfe3d` / main CI `32024183820` SUCCESS；
- mapping：T5-T8/P2、T0 reference-only observability；P1 final consumption/Working snapshot/thread seam/final completeness、MemoryModule Claim/Resolution authority、P6 job/retry remain separate;
- deliverables：formal `memory-evolution-v1`, evolution/Long schemas and fixtures, Decision Trace v1.1 schema/loader/fixtures, pure validators/tests, 04/05/07/08/09/10 and governance updates;
- exclusions：Prisma/migration/runtime/provider/P2-B/C/D/P3/P4/UI; `.codex/iteration-learning.md` untouched.

## Acceptance boundary

The contract candidate covers strict closed machine shapes, canonical digest/order/count/scope/identity checks, Long raw-content prohibition, Trace root readability and P1 terminal ordering. Duplicate/concurrent/replay/crash/late/CAS/transaction behavior is recorded as `pending_runtime`, not contract PASS. P2-B requires independent PASS and merge; P2-C requires runtime adversarial evidence; P2-D requires P2-C acceptance and separate provider/data governance.

## Review gate history

The first complete candidate (`8d48cd5` / CI `32028717254`) received independent `REQUEST_CHANGES` for five contract-level gaps: cross-document checkpoint/revision parity; Long Mid manifest/source parity; Trace membership root provenance; disputed/Boundary/deletion-retention fail-closed semantics; and strict calendar date-time validation. The correction stays within P2-A and must receive a fresh exact-head CI plus independent review before any PASS, merge, or P2-B start.

The next candidate `bd299fb` / CI `32037158715` received a further independent `REQUEST_CHANGES` (P0=0/P1=4): cross-session Long source-set semantics, duplicate claim/layer identifiers, terminal reference conditions, and Trace member-manifest canonical parity. A second narrow correction is required before the same gates can close.

The second correction was reviewed at exact head `fd31cd5587a6feeee888678a26b2c799a373b73f` / CI `32040317089` SUCCESS with code P0=0/P1=0. The first docs-only sync `34257b0` / CI `32041643087` still left two dynamic indexes stale; the final batched sync produced accepted exact head `042ec56f2b0362679bf240fcced95c61be77141f` / CI `32042589647` SUCCESS. Independent final review returned PASS P0=0/P1=0/P2=0; formal comment `5317377208` bound the same object. PR #69 merged as `d50e56886723de41f3fccf38a9d76b5b70541b32`, and main CI `32042952178` completed SUCCESS. This acceptance remains contract-only and does not start P2-B/C/D.

## 后续 P2-B/C/D 产品负责人边界

- P2 runtime 必须调用 LLM 做 semantic consolidation：Working→Mid，以及 session end 的 Mid/current→Long；不得实现为纯机械 persistence。
- LLM 只提出结构化语义整理结果；persistence、CAS、revision、evidence、状态变更和 transaction 由程序控制，LLM 不直接访问或修改数据库。
- 真实 provider/model 当前 `DEFERRED`；可继续 provider-neutral contract/runtime framework 与 fake/local provider，但不得自行选择厂商或模型。P2 使用独立 `P2_MODEL` 配置槽。
- 本节只冻结后续职责，不扩大 PR #69 的 `CONTRACT ONLY` 接收范围，父任务继续 `REVIEW`。
