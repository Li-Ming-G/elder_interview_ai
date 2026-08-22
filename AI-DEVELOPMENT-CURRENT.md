# AI Development Current

## Product goal

Deliver a responsive web MVP where a listener can conduct a consented elder interview, preserve original audio/transcript evidence, receive evidence-linked AI assistance, continue the same project across sessions, and review saved records. AI assists the listener; it does not autonomously interview or write the final biography.

## P1–P6 architecture

| Layer | Frozen responsibility | Current truth |
| --- | --- | --- |
| P1 | Current-session Working Memory only; no Long retrieval | v1.2 runtime accepted at `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66` |
| P2 | LLM semantic consolidation Working→Mid and session-end Mid/current→Long; program owns persistence/CAS/revision/evidence/transaction | A1 and P2-B contracts accepted; P2-C candidates exist but are blocked and not accepted |
| P3 | PostgreSQL + pgvector retrieval, provider-neutral embeddings, minimal continuation/branch/related graph | Not started; embedding model deferred |
| P4 | Programmatic Context V2, priority, configurable budget and frozen membership/digest | Not started; numeric budget deferred |
| P5 | Evidence drill-down/gate/correction with bounded tools and preserved history | Memory System V1 slice not started |
| P6 | Director/runtime orchestration, fences, deadlines and evaluation feedback | T0/P1 seams accepted; P2 orchestration not accepted |

Foundation/Observability T0 reference-only Decision Trace is accepted at `40cc61e12ef63096474fe63b69463920f2d6a7c4`. T0–T27 mapping is defined by the current Memory System route card; new work must state both T and P mappings.

## Current phase and real progress

Current phase: `GOVERNANCE HANDOFF / NO P2-P4 BUSINESS DEVELOPMENT`.

- Accepted: T0 trace, P1 v1.2 runtime, P2-A/A1 semantic envelope and P2-B database-agnostic persistence contract.
- Not accepted: any combined P2-C runtime.
- P2-C has real candidate work; it is false to say implementation never started.
- Candidate heads are database `87ee56c6ceb1aee7897d1d62a2b18703c304c2e3`, orchestration `97f647d607b020ef524014cfdab3e7b13eccd098`, trace `5ada42209e5ab245e1b799456694a1cac9ca7ab9`, and integration docs `419f7bfc447b4b605c87e6c173b09c304cba5a41`.
- The formal old combination verdict is `FAIL P0=0/P1=6/P2=1`. None of those candidates may be integrated.
- PR #75 history is permanently retained: exact head `025d9db1dd2a01c08d8f554716acca305e40b001`, CI run `32544880685 SUCCESS`, external `REQUEST_CHANGES`, findings `P0=0/P1=3/P2=0`. This is historical evidence, not an outstanding formal gate after the Product Owner's Dispatcher Simplification Correction.

## Frozen decisions

- Task Card controls scope/entry; exact Accepted Contract controls behavior/invariants. Conflict means `BLOCKED`.
- `MemoryClaim`/`MemoryResolution` remain the only semantic value authority; proposal/plan/layer/Long/Trace are not a second truth source.
- P2 must remain semantic consolidation, not mechanical persistence alone; the program owns all durable state changes.
- P1 does not retrieve Long memory. P3/P4 stay separate.
- Review is external. CI, worker output and synthetic evidence do not equal `PASS`.
- Governance route is frozen as `Single Dispatcher → Sequential Task Queue → External Architect PR Review`. Dispatcher stores only a worker-reported PR number; it does not use revision/CAS/atomic snapshot semantics or validate reviewer identity, review URL, GitHub review state, exact head or CI evidence.
- Ordinary Implementation Tasks do not run iteration-coach or add an internal Reviewer by default. External Architect PR review is the default independent review; only the Product Owner or Architect may explicitly require escalation.

## Deferred decisions

Real LLM provider/model/region/secret and P1/P2/Director bindings; real embedding model; P4 numeric budget; P2-D; P3/P4 implementation; real-data, formal-consent, public-deployment and production gates.

## Current states

- `READY`: none.
- `REVIEW`: the simplified PR #75 governance route awaits external Architect review. The prior `025d9db` `REQUEST_CHANGES` remains history and is not the current gate; no business implementation is in review.
- `BLOCKED`: `MEMORY-T5-T8-P2-C-RUNTIME-001`; governance handoff reconciliation is still required.

## Worker prohibitions

Do not integrate candidate heads, continue P2-C, start P2-D/P3/P4, change P1–P6 ownership, alter Accepted Contracts, choose deferred providers/models/budgets, add an agent framework, use real data, or claim review acceptance.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. A card/contract contradiction is not resolved by order; it is an authority conflict and must stop.

## Next step

External Architect reviews the simplified PR #75. Separately, the external Architect must reconcile the four P2-C candidates against the accepted A1/P2-B identities and the old FAIL findings, issue a new exact Development Pack/Task Card, and explicitly state which candidate work is discarded or rebased. Until then Dispatcher returns `TASK_BLOCKED` for P2-C and stops.
