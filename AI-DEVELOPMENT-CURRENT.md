# AI Development Current

## Product goal

Deliver a responsive web MVP where a listener can conduct a consented elder interview, preserve original audio/transcript evidence, receive evidence-linked AI assistance, continue the same project across sessions, and review saved records. AI assists the listener; it does not autonomously interview or write the final biography.

## P1–P6 architecture

| Layer | Frozen responsibility | Current truth |
| --- | --- | --- |
| P1 | Current-session Working Memory only; no Long retrieval | v1.2 runtime accepted at `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66` |
| P2 | LLM semantic consolidation Working→Mid and session-end Mid/current→Long; program owns persistence/CAS/revision/evidence/transaction | P2-C complete on main through PR #80 (`b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`), with runtime binding PR #81 (`279fe3d142bd87fc0ab215994ad8ab5dc6a2ee4a`) |
| P3 | PostgreSQL + pgvector retrieval, provider-neutral embeddings, minimal continuation/branch/related graph | Complete on main; final P3 merge is PR #86 at `18c4320f417fbfa90e41924ac7b049ea72b82379`; real embedding model remains deferred |
| P4 | Programmatic Context V2, priority, configurable budget and frozen membership/digest | Not started; numeric budget deferred |
| P5 | Evidence drill-down/gate/correction with bounded tools and preserved history | Memory System V1 slice not started |
| P6 | Director/runtime orchestration, fences, deadlines and evaluation feedback | T0/P1 seams accepted; P2 orchestration not accepted |

Foundation/Observability T0 reference-only Decision Trace is accepted at `40cc61e12ef63096474fe63b69463920f2d6a7c4`. T0–T27 mapping is defined by the current Memory System route card; new work must state both T and P mappings.

## Current phase and real progress

Current phase: `P4 GOVERNANCE HANDOFF / NO P4 BUSINESS IMPLEMENTATION`.

- Accepted: T0 trace, P1 v1.2 runtime, P2-A/A1 semantic envelope and P2-B database-agnostic persistence contract.
- Accepted: P2-C runtime is complete on main through the accepted PR #76–#81 sequence; the completion merge is PR #80 at `b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`.
- Accepted: P3 retrieval is complete through PR #82–#86; the final P3 merge to main is PR #86 at `18c4320f417fbfa90e41924ac7b049ea72b82379`.
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

Real LLM provider/model/region/secret, tokenizer and P1/P2/Director bindings; real embedding model; P4 numeric budget; P2-D; real-data, formal-consent, public-deployment and production gates.

## Current states

- `READY`: none while P4G-00 is awaiting external Architect review. After external `PASS`, only `P4C-01` may become `READY`.
- `REVIEW`: P4G-00 state synchronization is the current governance gate; no P4 business implementation is in review.
- `DEFERRED`: P2-D and the P4C-02 → P4C-04 successors until their predefined predecessor passes review.

## Worker prohibitions

Do not start P2-D or P4 implementation, choose deferred providers/models/tokenizers/embeddings/budgets, change P1–P6 ownership, alter Accepted Contracts, add an agent framework, use real data, or claim review acceptance.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. A card/contract contradiction is not resolved by order; it is an authority conflict and must stop.

## Next step

External Architect reviews P4G-00. Only after its `PASS` may Dispatcher unlock `P4C-01`; the P4C queue is `P4C-01 → P4C-02 → P4C-03 → P4C-04`. P2-D and real provider/model/tokenizer/embedding choices remain deferred.
