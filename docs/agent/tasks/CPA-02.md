# CPA-02 — OpenRouter QuestionDirector adapter

Status: `DEFERRED`

## Goal

Implement the smallest network adapter that satisfies the existing `QuestionDirector` port for
OpenRouter `stealth/ox-alpha`, while preserving all P5/P6 validation, deadline and publication
authorities.

## Architecture mapping

- P6 Director provider call seam: in scope.
- `StructuredAiProvider`, P1/P2 provider and embeddings: unchanged/deferred.
- Prompt acceptance: deferred to CPA-04.
- Workbench activation: deferred to CPA-05.

## Allowed files / areas

- a focused OpenRouter Director adapter and tests under
  `apps/api/src/question-orchestration/**`;
- `question-director.ts`, `question-director-evidence-round.ts` and module wiring only for the
  minimum deadline/config injection seam;
- `apps/api/src/question-orchestration/question-orchestration.service.ts` only if required to pass
  the already accepted absolute deadline into the provider request;
- CPA-01 config types;
- package/lockfile only if essential; use built-in `fetch` unless exact-head evidence requires an
  Architect correction;
- this Task Card and PR documentation.

## Accepted contracts

- `docs/contracts/checkpoint-a-openrouter-director-v1.md`;
- `docs/contracts/question-runtime-orchestration-v1.md`;
- `docs/contracts/interview-director-output.schema.json`;
- `docs/contracts/evidence-drilldown-v1.md`;
- accepted P6R-03/P6R-04 fence and error semantics.

## Required behavior

1. Bind only `QuestionDirector`; do not modify or instantiate a real `StructuredAiProvider`.
2. Send the exact OpenRouter endpoint and requested model with fallback disabled.
3. Request JSON-object output and never claim provider-side JSON-Schema enforcement.
4. Include the frozen prompt, output-schema instruction, context and optional one-round P5 evidence
   in deterministic messages.
5. Parse JSON and return unknown data to the existing local schema/reference validator; never
   publish or bypass `QuestionDirectorContract.parseOutput`.
6. Respect the remaining P6 deadline with an abortable request. Late completion cannot publish.
7. Sanitize HTTP, timeout, abort, empty-body, malformed-JSON and response-shape failures into
   existing safe error surfaces.
8. Never log or trace API key, headers, prompt/context/transcript/evidence bodies or provider body.
9. Network is absent from unit/integration CI; tests use a local fake transport/injected fetch.
10. Preserve the same provider binding across the optional accepted second evidence call.

## Explicit non-goals

- no real live OpenRouter call in CI or Worker review;
- no runtime activation in generic local/staging/production startup;
- no provider fallback, agent SDK, tool loop or second Director;
- no P2-D/embedding/provider work;
- no Prompt strategy change;
- no UI/evaluation/scoring work.

## Tests

- exact request endpoint/model/headers/body with fictional secret and fake transport;
- JSON suggestion and continue-listening parsing handoff;
- evidence request then exactly one second Director call under one deadline;
- malformed/empty/non-JSON/HTTP/abort/timeout response fails closed;
- secret and request/response bodies absent from errors and logs;
- invalid schema/reference remains rejected by the existing contract;
- late/aborted result cannot reach publication;
- targeted Director/P5/P6 suites, unit tests, API typecheck, build, ESLint, Prettier and diff check.

## Completion criteria

- the adapter is production-code capable but remains inactive outside explicit Checkpoint A mode;
- P1-P6 ownership and current UI are unchanged;
- one PR contains exact review context and Worker handoff;
- Worker stops at `REVIEW`.

## Review gate

External Architect exact-head review. PASS + merge + successful main verification is required
before CPA-03 becomes READY.

## Next task

`CPA-03`
