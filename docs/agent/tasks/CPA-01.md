# CPA-01 — Checkpoint A server configuration authority

Status: `READY`

## Goal

Implement a typed, fail-closed server configuration authority for the already accepted
Checkpoint A OpenRouter/Ox Director binding, without making a network call or activating it in the
generic application startup path.

## Architecture mapping

- Foundation/P6 provider configuration seam: in scope.
- `QuestionDirector` network adapter: deferred to CPA-02.
- Real ASR readiness: deferred to CPA-03.
- T25 Owner Prompt: deferred to CPA-04.
- T26-T27 evaluation/scoring: out of scope.

## Allowed files / areas

- `packages/config/src/index.ts` and focused config tests;
- `apps/api/src/api-config.ts` only if its type surface mechanically requires it;
- `.env.example`, with names/placeholders only and no credential value;
- a narrow immutable Checkpoint A config manifest/validator under `docs/contracts/**` and focused
  contract tests if needed;
- dependency lockfiles only if mechanically required (no provider SDK in this task);
- this Task Card and PR documentation.

## Accepted contracts

- `docs/contracts/checkpoint-a-openrouter-director-v1.md`;
- `docs/contracts/question-runtime-orchestration-v1.md`;
- `docs/contracts/interview-director-output.schema.json`;
- existing config validation conventions in `packages/config/src/index.ts`.

## Required behavior

1. Represent the Checkpoint A Director configuration as a typed server-only config.
2. Freeze endpoint/model/secret reference to the Accepted Contract; do not accept arbitrary URL,
   model or secret names from browser input.
3. Generic local/test behavior remains deterministic and network-free.
4. An explicit Checkpoint A start mode may select OpenRouter only in local environment and only
   when `OPENROUTER_API_KEY` is present.
5. Test, staging and production must fail closed or retain their existing unavailable/fixture
   behavior; an ambient key must not silently activate network calls.
6. Configuration errors expose only invalid key names, never values.
7. The returned config must not be JSON-logged or copied into Decision Trace.
8. Add non-secret `.env.example` guidance stating public/non-sensitive material only and that
   existing real ASR configuration is a separate prerequisite.

## Explicit non-goals

- no OpenRouter HTTP call or SDK;
- no `QuestionDirector`/`StructuredAiProvider` implementation change;
- no Prompt loading or content change;
- no ASR implementation or secret inspection;
- no production provider/model decision;
- no scoring/evaluation/UI work.

## Tests

- exact local Checkpoint A configuration loads with a fictional key;
- missing key fails by key name only;
- invalid environment/provider combinations fail closed;
- generic test/local startup remains deterministic without network activation;
- staging/production cannot activate the checkpoint binding;
- secret values do not appear in thrown errors or serialized test diagnostics;
- config unit tests, typecheck, ESLint, Prettier and `git diff --check`.

## Completion criteria

- typed configuration matches the Accepted Contract;
- no network-capable provider is added or activated;
- one PR contains exact `ARCHITECT_REVIEW_CONTEXT_V1` and durable Worker handoff;
- Worker stops at `REVIEW`.

## Review gate

External Architect exact-head review. PASS + merge + successful main verification is required
before CPA-02 becomes READY.

## Next task

`CPA-02`
