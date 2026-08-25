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
| P5 | Evidence drill-down, Evidence Gate and non-destructive Correction | Complete through PR #93–#97; final merge/main `7cbd5d077352ed9b6c313207788c4d1ec6e8ac36` |
| P6 | Director/runtime orchestration, generation fences, deadlines and evaluation feedback | T18–T24 runtime pack complete through PR #103; Owner Checkpoint A provider/prompt integration is now planned as `CPA-01 → CPA-02 → CPA-03 → CPA-04 → CPA-05`; T26–T27 remain deferred |

Foundation/Observability T0 reference-only Decision Trace is accepted at `40cc61e12ef63096474fe63b69463920f2d6a7c4`. T0–T27 mapping remains defined by `docs/agent/tasks/SPEC-MEMORY-SYSTEM-V1.md`; every new task states both T and P/Foundation mapping.

## Current phase and real progress

Current phase: `OWNER CHECKPOINT A / REAL DIRECTOR INTEGRATION`.

Accepted and merged stages:

- T0 Foundation Decision Trace;
- P1 Working Memory v1.2;
- P2 semantic envelope/persistence/runtime through P2-C;
- P3 Retrieval V1 through PR #86;
- P4 Context V2 governance, contract, priority/budget policy, deterministic assembly and Director consumer handoff through PR #87–#92;
- P5 Evidence Drill-down + Gate/Correction through PR #93–#97.

P5 final accepted path:

- P5E-01: PR #93, accepted head `71599b7abe25969bd75e5a7758f8901b4d0d00fa`, merge `1def3836dba52d919a918b9b5a708cc16986ef`;
- P5E-02: PR #94, accepted head `29ec8cb297aa00acb1392b4f9468f5a162d3b9a8`, merge `7bd63cd4b5852c8762473905bebe28fdfbdf558a`;
- P5E-03: PR #95, accepted head `bac180dd8f24f1746bb9265f340eb78608f3eae7`, merge `80fee3eabcd57bf4d834648fed2216ccdea8c014`;
- P5C-01: PR #96, accepted head `9c859d83056343fff88dcd7a5b583a92fcb9c8c3`, merge `372b823d2bc7425ae52d0567526ae488de5a3188`;
- P5C-02: PR #97, accepted head `888d029b08e5330f4c68dc484cf42d487e16ecd6`, merge/main `7cbd5d077352ed9b6c313207788c4d1ec6e8ac36`, main CI run `32677630940` SUCCESS.

P6 accepted path:

- P6R-01: PR #99, accepted head `233ef14b68c42571217f95126e60763daf12456`, merge/main `5388bdc117b550d66388aec7acb9a79a934d92d7`;
- P6R-02: PR #100, accepted head `e0d20f167d1a52686efd3f1dcea5ab5028d6f3a5`, merge/main `8c103ef631851b833a57efebe3c1b3ddc8dcadd8`, main CI run `32691042422` SUCCESS.
- P6R-03: PR #101, accepted head `8a0b0f433b8cec1abb12497e655f61342b121be2`, merge/main `35c8b869f819ea3bc6a0f1e1d89cbadd1fa88c70`, main CI run `32695474272` SUCCESS.
- P6R-04: PR #102, accepted head `7d45756b671172dc5d67e724c68baed9ff34f9f2`, merge/main `272bc89782b38f356082fb0c21a30646b6c302bf`, main CI run `32701819747` SUCCESS.
- P6R-05: PR #103, accepted head `74cd8b263c7c65971ca229c3521c49cf64a2796f`, merge/main `045b041445eec2e73060afa5bbbe0e15c82cc51e`, main CI run `32711482477` SUCCESS.
- CPA-01: PR #105, accepted head `7809993d6cb7d59e4e6994bacdcf375d68246735`, merge/main `67a44562689e06c5bf007a1c0c8051d3c5e03208`, main CI run `32723843529` SUCCESS.

## P6 canonical queue

```text
P6R-01  T18–T24 Runtime Orchestration V1 contract
  → P6R-02  finalized trigger + automatic/manual gate runtime
  → P6R-03  generation fence + publication authority
  → P6R-04  deadline/error + background isolation
  → P6R-05  integrated runtime / Decision Trace closeout
```

`P6R-01` through `P6R-05` are complete through PR #103; this P6 runtime pack is closed. Later successors remain `DEFERRED` until explicitly issued.

The owner-issued planning source is `docs/agent/tasks/P6-DEVELOPMENT-PACK.md`.

## Owner Checkpoint A canonical queue

The Product Owner has authorized one local, non-production real-Director checkpoint:

```text
CPA-01  Checkpoint A server configuration authority
  → CPA-02  OpenRouter QuestionDirector adapter
  → CPA-03  existing real-ASR / audio-dependent readiness
  → CPA-04  Owner Prompt acceptance + version/digest/loader
  → CPA-05  formal Workbench integration + Owner Checkpoint A readiness
```

Planning source: `docs/agent/tasks/CHECKPOINT-A-DEVELOPMENT-PACK.md`.
Accepted bounded contract: `docs/contracts/checkpoint-a-openrouter-director-v1.md`.

Frozen Checkpoint A facts:

- OpenRouter `https://openrouter.ai/api/v1` and requested model `stealth/ox-alpha` are authorized
  only for local Checkpoint A with deliberately selected public, non-sensitive material.
- The only new external Director binding is `QuestionDirector`; `StructuredAiProvider`, P2-D and
  real embeddings remain unavailable/deferred.
- Ox Alpha uses JSON-object transport followed by existing local schema/reference validation; it
  must not be represented as provider-enforced JSON Schema.
- The anonymous model provider retains prompts/completions and states they are not used for
  training. This is accepted only inside the bounded public-material checkpoint.
- The Owner's prior complete Interview Director Prompt is now durably recorded at
  `docs/prompts/interview-director/owner-inputs/Interview_Director_System_v2.md@22760af1adc5d08f51f5dd3ed0aebca5f3c7d984`.
  It is the primary product input for CPA-04; Agents must preserve its interview strategy and only
  perform mechanical adaptation required by the current contracts/runtime.
- Checkpoint A requires the already accepted real ASR path. Deterministic fixture transcript cannot
  prove that played audio reached the Director.
- After CPA-05 PASS, merge and successful main CI, report `OWNER_CHECKPOINT_A_READY: YES` and stop
  for Owner hands-on acceptance. No scoring/evaluation UI may start automatically.
- CPA-02 is accepted through PR #106, accepted head `bde59361ff4ce4ed76e72164597df324d7caf2a5`,
  merge/main `74882ef57fb932f673ccbc5890a08b97bf2de6fe`, with main CI run `32729016596` SUCCESS.
- CPA-03 is accepted through PR #107, accepted head `72338b8c7acab11b714bdc92bd11f60d568c7dd6`,
  merge/main `8a531f527bc90770ee2ead622a48983498d2fbfe`, with main CI run `32746977248` SUCCESS.

## Frozen P6 runtime decisions for this pack

- Existing finalized-ASR → question orchestration behavior is a compatibility baseline, not a mandate to preserve accidental implementation details.
- Automatic generation must be bounded; finalized transcript must not imply one Director call per segment.
- Manual-next may bypass automatic waiting but never bypass authorization, idempotency, presentation/snapshot authority, retention/deletion or publication fencing.
- Every generation has durable request/attempt/generation identity and one current publication authority.
- Stale/late generation results cannot publish over a newer accepted presentation basis.
- Timeout/runtime/context/P3/P4/evidence failures are `SYSTEM_ERROR`/unavailable according to accepted compatibility surfaces, never disguised as `CONTINUE_LISTENING`.
- Genuine `CONTINUE_LISTENING` remains a successful Director semantic decision.
- P2/background memory work must not block recording, finalized ASR, manual-next or the Director live lane.
- P1–P5 semantic/data ownership remains unchanged; no second Director, second semantic memory authority or agent framework.
- The original P6 pack did not activate T25/provider work. The separate Owner-authorized
  Checkpoint A pack now permits only its bounded local Prompt and OpenRouter/Ox seams; T26–T27,
  production provider/model/region, real embeddings, tokenizer, production P4 numeric budget,
  P2-D, ordinary real interview data and deployment remain deferred.

## Governance

Canonical Task Cards and queue topology on refreshed `main` define task identity/dependencies/next task. GitHub PR/head/top-level `ARCHITECT_VERDICT_V1`/merge/main-CI facts are durable runtime truth. `dispatcher-state.json` is a reconstructable projection/cache and cannot override durable GitHub facts.

The accepted lifecycle is:

`READY → Worker → PR REVIEW → external Architect verdict → merge → main CI → DONE → only predefined next_task READY`.

Dispatcher never invents Task Cards or task IDs, never self-reviews, never advances on stale-head verdicts and never treats an unpushed local worktree as canonical state. A stage-end sync is complete only after commit/push and a fresh durable reread of the current-state files. Product/architecture ambiguity fails closed and returns to the Product Owner/Architect.

## Current states

- `READY`: `CPA-05`.
- `IN_PROGRESS`: none.
- `REVIEW`: none.
- `DEFERRED`: P2-D, T26–T27 and production provider/model/budget/data/deployment decisions remain deferred.
- P5: closed / DONE.

## Worker prohibitions

Do not choose deferred provider/model/tokenizer/embedding/budget values, alter P1–P6 ownership, create a second semantic memory or presentation authority, add an agent framework/tool loop, use real data, alter Accepted Contracts, activate T26–T27 evaluation, or claim review acceptance unless the current Task Card explicitly authorizes that scope. CPA-04 is the only currently authorized T25/Prompt adaptation task and is bounded by the Owner Prompt artifact.

## Authority order

Task Card for scope/entry → exact Accepted Contract for behavior/invariants → this file → stable `00`–`10` specs → history. A Task Card/Accepted Contract contradiction is `PRODUCT_AMBIGUITY`; the Worker does not resolve it by precedence guessing.

## Next step

Dispatcher has fresh-read `origin/main`, confirmed CPA-03 is DONE, confirmed the exact Owner Prompt artifact identity
`docs/prompts/interview-director/owner-inputs/Interview_Director_System_v2.md@22760af1adc5d08f51f5dd3ed0aebca5f3c7d984`,
and dispatched the predefined task `CPA-04` with worker profile `luna-high`; it is now DONE after merge and successful main verification.
The predefined successor `CPA-05` is now READY; no later task is unlocked.
CPA-05 ends at the Owner acceptance gate with `next_task: null`.
