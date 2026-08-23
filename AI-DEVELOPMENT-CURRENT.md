# AI Development Current

## Product goal

Deliver a responsive web MVP where a listener can conduct a consented elder interview, preserve original audio/transcript evidence, receive evidence-linked AI assistance, continue the same project across sessions, and review saved records. AI assists the listener; it does not autonomously interview or write the final biography.

## P1–P6 architecture

| Layer | Frozen responsibility | Current truth |
| --- | --- | --- |
| P1 | Current-session Working Memory only; no Long retrieval | v1.2 runtime accepted at `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66` |
| P2 | LLM semantic consolidation Working→Mid and session-end Mid/current→Long; program owns persistence/CAS/revision/evidence/transaction | P2-C complete through PR #80 (`b0d8c49c5cdd83b808c0bb2e411b759c024b40c0`), runtime binding PR #81 (`279fe3d142bd87fc0ab215994ad8ab5dc6a2ee4a`) |
| P3 | PostgreSQL + pgvector retrieval, provider-neutral embeddings, minimal continuation/branch/related graph | Complete through PR #86, final main identity `18c4320f417fbfa90e41924ac7b049ea72b82379`; real embedding model deferred |
| P4 | Programmatic Context V2, priority, configurable budget and frozen membership/digest | Complete through PR #88–#92; final consumer merge `8b1195d185bc07622c446bdd9023ab1cf6a6fcb0`; production numeric budget remains deferred |
| P5 | Evidence drill-down, Evidence Gate and non-destructive Correction | Current active stage: T13–T17, canonical queue `P5E-01 → P5E-02 → P5E-03 → P5C-01 → P5C-02` |
| P6 | Director/runtime orchestration, generation fences, deadlines and evaluation feedback | Existing runtime remains compatibility baseline; broader T18–T27 work is not started by the P5 queue |

Foundation/Observability T0 reference-only Decision Trace is accepted at `40cc61e12ef63096474fe63b69463920f2d6a7c4`. T0–T27 mapping remains defined by `docs/agent/tasks/SPEC-MEMORY-SYSTEM-V1.md`; every new task states both T and P/Foundation mapping.

## Current phase and real progress

Current phase: `P5 / T13–T17 EVIDENCE + GATE/CORRECTION`.

Accepted and merged stages:

- T0 Foundation Decision Trace;
- P1 Working Memory v1.2;
- P2 semantic envelope/persistence/runtime through P2-C;
- P3 Retrieval V1 through PR #86;
- P4 Context V2 governance, contract, priority/budget policy, deterministic assembly and Director consumer handoff through PR #87–#92.

P4 final accepted path:

- P4G-00-STATE-SYNC: PR #87 `DONE`;
- P4C-01: PR #88 `DONE`;
- P4C-02: PR #89 `DONE`;
- DISPATCHER-RECOVERY-001: PR #90 `DONE`;
- P4C-03: PR #91 `DONE`, accepted head `655f08cb72561ad6930b7acb662a12deaac6e87f`, merge `9faf0e94c6c65c585e925d959eeab9e85b2ba142`;
- P4C-04: PR #92 `DONE`, accepted head `ec7660e05690618780ac00af053a6610666d02d7`, merge `8b1195d185bc07622c446bdd9023ab1cf6a6fcb0`.

## P5 canonical queue

```text
P5E-01  T13–T15 Evidence contract
  → P5E-02  read-only evidence tools
  → P5E-03  one-round Director evidence integration
  → P5C-01  T16–T17 Gate/Correction contract
  → P5C-02  Gate/Correction runtime
```

Only `P5E-01` is initially `READY`; all successors are `DEFERRED` and may be unlocked only by the canonical Dispatcher after predecessor external Architect `PASS`, merge and successful main verification.

## Frozen P5 decisions

- Evidence tools are exactly the bounded read-only surfaces `get_memory_evidence(memory_id)` and limited `search_transcript(query)` unless the accepted P5E-01 contract narrows them further.
- Evidence access is constrained by the current frozen generation/P4-authorized scope; it is not arbitrary project/global search.
- At most one evidence drill-down round per generation; no recursive tool loop or multi-tool fanout in V1.
- Evidence/tool failure is `SYSTEM_ERROR`, never disguised as `CONTINUE_LISTENING` or a fallback question.
- Transcript remains source truth; Memory is derived.
- Fact requires explicit eligible elder evidence; do not promote implication/model inference/interviewer suggestion into Fact.
- Boundary is explicit control intent; absence of repetition is not revocation. Correction is non-destructive and preserves prior revision/evidence.
- MemoryClaim/MemoryResolution remain the only semantic value authority. Program code owns durable mutation; LLM output is proposal-only.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are durable runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable GitHub facts.

The accepted lifecycle is:

`READY → Worker → PR REVIEW → external Architect verdict → merge → main CI → DONE → only predefined next_task READY`.

Dispatcher never invents Task Cards or task IDs, never self-reviews, and never advances on stale-head verdicts. Product/architecture ambiguity fails closed and returns to the Product Owner/Architect.

## Deferred decisions

Real LLM provider/model/region/secret, tokenizer and P1/P2/Director bindings; real embedding model; production P4 numeric budget; P2-D; formal real-data/consent/public-deployment gates; T25 production prompt activation. These are not blockers for synthetic/provider-neutral P5 contract/runtime work unless a Task Card explicitly reaches one of those decisions.

## Current states

- `READY`: `P5E-01` only.
- `IN_PROGRESS`: none at Architect issuance time.
- `REVIEW`: none at Architect issuance time.
- `DEFERRED`: `P5E-02`, `P5E-03`, `P5C-01`, `P5C-02`, P2-D and real provider/model/budget decisions.
- P4: closed / DONE.

## Worker prohibitions

Do not choose deferred provider/model/tokenizer/embedding/budget values, alter P1–P6 ownership, create a second semantic memory authority, add an agent framework/tool loop, use real data, alter Accepted Contracts, expand P5 into broad P6/T25 work, or claim review acceptance.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. A Task Card/Accepted Contract contradiction is `PRODUCT_AMBIGUITY`; the Worker does not resolve it by precedence guessing.

## Next step

Dispatcher fresh-reads `main`, reconciles the completed P4 durable facts, sees canonical `P5E-01 = READY`, persists `IN_PROGRESS`, and launches the declared `luna-high` Worker. P5 successors remain deferred until the accepted lifecycle unlocks them.
