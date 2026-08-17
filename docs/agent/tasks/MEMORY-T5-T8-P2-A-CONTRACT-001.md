# MEMORY-T5-T8-P2-A-CONTRACT-001

状态：`REVIEW`

## 基线与范围

- branch：`codex/memory-t5-t8-p2-a-contract-001`；base `main@58794c4c6e82a4dfeeb5e89af430c3bac85cfe3d` / main CI `32024183820` SUCCESS；
- mapping：T5-T8/P2、T0 reference-only observability；P1 final consumption/Working snapshot/thread seam/final completeness、MemoryModule Claim/Resolution authority、P6 job/retry remain separate;
- deliverables：formal `memory-evolution-v1`, evolution/Long schemas and fixtures, Decision Trace v1.1 schema/loader/fixtures, pure validators/tests, 04/05/07/08/09/10 and governance updates;
- exclusions：Prisma/migration/runtime/provider/P2-B/C/D/P3/P4/UI; `.codex/iteration-learning.md` untouched.

## Acceptance boundary

The contract candidate covers strict closed machine shapes, canonical digest/order/count/scope/identity checks, Long raw-content prohibition, Trace root readability and P1 terminal ordering. Duplicate/concurrent/replay/crash/late/CAS/transaction behavior is recorded as `pending_runtime`, not contract PASS. P2-B requires independent PASS and merge; P2-C requires runtime adversarial evidence; P2-D requires P2-C acceptance and separate provider/data governance.

## Review gate history

The first complete candidate (`8d48cd5` / CI `32028717254`) received independent `REQUEST_CHANGES` for five contract-level gaps: cross-document checkpoint/revision parity; Long Mid manifest/source parity; Trace membership root provenance; disputed/Boundary/deletion-retention fail-closed semantics; and strict calendar date-time validation. The correction stays within P2-A and must receive a fresh exact-head CI plus independent review before any PASS, merge, or P2-B start.
