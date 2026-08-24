# P6 Development Pack

Status: `OWNER_ISSUED`

## Purpose

This pack bridges the completed P5 stage into the next provider-neutral P6 runtime stage without asking Dispatcher or Implementation Workers to invent product/architecture meaning.

P5 is durably complete through PR #97. The P6 queue defined here covers T18–T24 only. T25 Prompt and T26–T27 Evaluation remain deferred until the P6 runtime path is accepted and merged.

## Ownership

- Product Owner / Architect defines this pack, Task Cards, queue order, scope and `next_task` edges.
- Dispatcher only executes the already-defined queue and lifecycle. It must not create or reinterpret Task Cards.
- Implementation Worker uses `luna-high` and implements exactly one active Task Card at a time.
- External Architect performs exact-head PR review and emits `ARCHITECT_VERDICT_V1`.

## Durable P5 completion facts

- P5E-01: PR #93, accepted head `71599b7abe25969bd75e5a7758f8901b4d0d00fa`, merge `1def3836dba52d919a918b9b8b5a708cc16986ef`.
- P5E-02: PR #94, accepted head `29ec8cb297aa00acb1392b4f9468f5a162d3b9a8`, merge `7bd63cd4b5852c8762473905bebe28fdfbdf558a`.
- P5E-03: PR #95, accepted head `bac180dd8f24f1746bb9265f340eb78608f3eae7`, merge `80fee3eabcd57bf4d834648fed2216ccdea8c014`.
- P5C-01: PR #96, accepted head `9c859d83056343fff88dcd7a5b583a92fcb9c8c3`, merge `372b823d2bc7425ae52d0567526ae488de5a3188`.
- P5C-02: PR #97, accepted head `888d029b08e5330f4c68dc484cf42d487e16ecd6`, merge/main `7cbd5d077352ed9b6c313207788c4d1ec6e8ac36`.
- Main CI for the P5C-02 merge: run `32677630940`, `SUCCESS`.

## P6 runtime intent

The existing code already contains compatibility behavior for finalized-transcript automatic scheduling, debounce, automatic minimum interval, manual-next, generation attempts, publication state, deadline handling, Decision Trace and the P5 evidence round. P6 does not replace that runtime with a new Director or agent framework. It freezes and hardens the runtime authority rules around those seams.

The accepted route from `SPEC-MEMORY-SYSTEM-V1.md` for T18–T24 is:

```text
finalized ASR
  -> bounded buffer / hybrid trigger
  -> automatic gate or manual-next
  -> frozen generation authority
  -> Director (+ optional accepted P5 evidence round)
  -> publication fence
  -> QUESTION / CONTINUE_LISTENING / SYSTEM_ERROR
```

Key invariants:

- no Director call per transcript segment;
- manual-next may bypass automatic waiting but never authority/fence/policy checks;
- stale/late generation cannot publish over newer state;
- timeout/runtime failure is never disguised as `CONTINUE_LISTENING`;
- P2 background work cannot block recording, finalized ASR or Director;
- existing P1–P5 semantic/data authorities remain unchanged;
- no provider/model/prompt activation is selected in this pack.

## Canonical P6 queue

```text
P6R-01  Runtime Orchestration V1 contract
  -> P6R-02  finalized trigger + automatic/manual gate runtime
  -> P6R-03  generation fence + publication authority
  -> P6R-04  deadline/error + background isolation
  -> P6R-05  integrated runtime / Decision Trace closeout
```

Initial queue state:

- `P6R-01`: `READY`
- `P6R-02`: `DEFERRED`
- `P6R-03`: `DEFERRED`
- `P6R-04`: `DEFERRED`
- `P6R-05`: `DEFERRED`

Only predecessor external Architect `PASS` + merge + successful main verification may unlock the predefined successor.

## Why P6R-05 ends with `next_task = null`

T25 changes the Interview Director prompt/product semantics and T26–T27 define the evaluation corpus/feedback taxonomy. Those should be issued as a later Owner/Architect pack after the accepted T18–T24 runtime contract and implementation reveal the final stable runtime boundaries. Dispatcher must stop at P6R-05 completion rather than inventing those tasks.
