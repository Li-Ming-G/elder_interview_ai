# CPA-04 — Owner Prompt acceptance, version, digest and loader

Status: `DEFERRED / OWNER_INPUT_REQUIRED`

## Goal

Turn the Product Owner's existing complete Interview Director Prompt into one immutable formal
Checkpoint A bundle, prove compatibility with current context/output/evidence contracts, and make
it selectable by the runtime without rewriting its interviewing strategy.

## Architecture mapping

- T25 Prompt acceptance/runtime loading: in scope only for Owner Checkpoint A.
- T26-T27 evaluation/scoring: explicitly deferred.
- Provider/ASR implementation: predecessors, unchanged.

## Entry gate and inputs

- CPA-03 external PASS + merge + successful main verification;
- `OWNER_DIRECTOR_PROMPT_ARTIFACT`: not yet supplied;
- before this task becomes READY, Architect must record the artifact's exact durable path/commit
  identity here and in the planning queue without changing task meaning;
- existing formal v1 and `v2-draft` are reference inputs, not substitutes for the missing Owner
  artifact.

## Allowed files / areas

- `docs/prompts/interview-director/**` for one new immutable formal Checkpoint A bundle;
- `question-director-contract.ts` and focused tests for version/digest/loader selection;
- context/output schema compatibility tests; narrow evidence-round prompt compatibility tests;
- non-secret config manifest linkage from CPA-01;
- this Task Card and PR documentation.

## Accepted contracts

- `docs/contracts/checkpoint-a-openrouter-director-v1.md`;
- `docs/contracts/interview-director-context.schema.json`;
- `docs/contracts/interview-director-output.schema.json`;
- `docs/contracts/evidence-drilldown-v1.md`;
- Owner-provided Prompt artifact once its exact identity is recorded.

## Required behavior

1. Preserve the Owner artifact as primary product input; do not invent or substantially rewrite
   interview strategy.
2. Adapt only mechanical wrapping required for current system/task split, immutable versioning,
   JSON-only output and current schema/evidence compatibility.
3. Any material semantic mismatch returns `PRODUCT_AMBIGUITY` to Owner.
4. Create a new immutable formal bundle; never overwrite v1 or activate `v2-draft` by renaming.
5. Compute digest from exact loaded system/task bytes using existing canonical hashing.
6. Runtime-selected version/digest must match persisted attempt provenance.
7. Draft or missing bundle fails closed; no fallback to a different prompt under the same version.
8. Tests may use synthetic contexts only and do not call a live model.

## Explicit non-goals

- no autonomous Prompt rewrite or new interview methodology;
- no scoring rubric, evaluation corpus/dashboard or model comparison;
- no context/output schema product expansion unless Owner separately authorizes it;
- no Provider/ASR/UI implementation change;
- no real interview content in prompt examples.

## Tests

- exact bytes produce stable version/digest;
- mutation changes digest and cannot retain identity;
- missing/draft/unknown bundle fails closed;
- accepted synthetic suggest/continue outputs validate;
- output references remain inside context and evidence round remains at most one;
- targeted contract/director tests, unit/typecheck/build/lint/format/diff checks.

## Completion criteria

- Owner Prompt is preserved as an immutable formal Checkpoint A bundle;
- loader/provenance is truthful and runtime-selectable but not yet generic-production active;
- one PR contains exact review context and Worker handoff;
- Worker stops at `REVIEW`.

## Review gate

External Architect reviews exact prompt source correspondence as well as code. PASS + merge +
successful main verification is required before CPA-05 becomes READY.

## Next task

`CPA-05`
