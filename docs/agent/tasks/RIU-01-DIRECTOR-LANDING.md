# RIU-01-DIRECTOR-LANDING

Status: `READY`

## Goal

Give the already-implemented Checkpoint A Configurable Director V2 a durable governance record, correct
its Anthropic Messages authentication header, and make a broken Director binding report itself at
startup instead of after a completed interview.

Covers defects **G5**, **G6**, **G7**.

The V2 implementation already exists in the working tree and already passes `pnpm typecheck`,
`pnpm test:unit` (1088/1088), and `pnpm test:local-operability` (8/8). This task lands it under a Task
Card, plus the two additions below. It is deliberately first in the sequence: until the Director can
actually reach a provider, no later task in this pack can be acceptance-tested against real behavior.

## Entry / dependencies

- `PFC-07-FULL-FLOW-E2E` is `DONE`; the Product Flow Closure pack is closed.
- Accepted Contract: `docs/contracts/checkpoint-a-configurable-director-v2.md`.

## Required behavior

1. The uncommitted Configurable Director V2 change set lands as one PR: config loader and validation,
   `ConfiguredQuestionDirector`, module rebinding, start-mode gate, launcher secret stripping,
   `.env.example`, the V2 Accepted Contract, the `docs/contracts/README.md` supersession note, and the
   Chinese operator document.
2. The retired `openrouter-question-director.ts` / `.spec.ts` deletions land with it. No stale
   `OpenRouterQuestionDirector`, `OPENROUTER_FETCH`, `CHECKPOINT_A_OPENROUTER_ENDPOINT`, or
   `CheckpointAOpenRouterConfig` symbol reference may remain in `apps/`, `packages/`, `scripts/`, or
   `tests/`.
3. For the `anthropic_messages` profile the request must send `x-api-key: <credential>` — the
   documented Anthropic Messages API authentication header for an API key. The existing
   `Authorization: Bearer <credential>` header is retained for gateway compatibility. Both carry the
   same already-configured secret to the same already-configured endpoint, so this adds no new
   exposure surface. `anthropic-version: 2023-06-01` remains unchanged.
4. `openai_chat_completions` and `openrouter_chat_completions` header construction is unchanged.
5. On the explicit `pnpm checkpoint-a:start` path only, the API performs exactly one bounded Director
   binding probe before serving traffic, and reports the outcome to the operator console.
6. The probe **must not block startup**. A failed or unreachable probe logs a clear, sanitized
   diagnostic and the application still starts. Recording and transcription must remain available when
   the Director binding is broken — this is the existing non-negotiable safeguard that AI failure must
   never stop recording, and it outranks any desire to fail fast here.
7. The probe diagnostic names the misconfigured environment variable and the sanitized transport
   outcome (HTTP status, or a timeout/unreachable classification). It must never print, log, or
   otherwise emit the credential, any part of it, its length, the resolved endpoint credential
   material, the Director prompt, or any provider payload.
8. The probe is bounded: one request, one short deadline, minimal output request, no retry loop.
9. The probe never runs during generic local startup, unit/integration tests, CI, staging, or
   production. It is reachable only through the same explicit Checkpoint A start argument that already
   gates the networked Director.
10. All V2 preserved invariants continue to hold: ambient configuration never activates a networked
    Director, CI stays network-free with fake transports, and empty/malformed/timeout/HTTP/
    incompatible-profile/schema-invalid results keep failing closed through existing sanitized error
    surfaces and never become `continue_listening`.

## Allowed files

- `packages/config/src/index.ts`
- `packages/config/src/index.spec.ts`
- `apps/api/src/question-orchestration/configured-question-director.ts`
- `apps/api/src/question-orchestration/configured-question-director.spec.ts`
- `apps/api/src/question-orchestration/question-orchestration.module.ts`
- `apps/api/src/question-orchestration/question-director-contract.ts`
- `apps/api/src/question-orchestration/question-director-contract.spec.ts`
- `apps/api/src/question-orchestration/openrouter-question-director.ts` (deletion)
- `apps/api/src/question-orchestration/openrouter-question-director.spec.ts` (deletion)
- `apps/api/src/start-mode.ts`
- `apps/api/src/start-mode.spec.ts`
- `apps/api/src/main.ts` and the minimal existing startup/logging file required by the probe
- `scripts/start-checkpoint-a.mjs`
- `scripts/local-operability.test.mjs`
- `.env.example`
- `docs/contracts/checkpoint-a-configurable-director-v2.md`
- `docs/contracts/checkpoint-a-openrouter-director-v1.md`
- `docs/contracts/README.md`
- `docs/local-ai-model-configuration.md`
- `docs/agent/tasks/CPA-05-runbook.md`

No Director prompt change. No context/output schema change. No P1/P2 activation. No API route shape
change.

## Regression / acceptance

Tests must prove at minimum:

- the `anthropic_messages` profile sends both `x-api-key` and `Authorization: Bearer`, plus
  `anthropic-version`;
- `openai_chat_completions` and `openrouter_chat_completions` headers are unchanged, and only the
  OpenRouter profile sends the no-fallback / required-parameters routing controls;
- the credential remains non-enumerable, absent from `toJSON()`, and absent from the Workbench child
  environment for every supported variable name including the deprecated `OPENROUTER_API_KEY`
  fallback;
- simultaneous Anthropic and OpenAI variable groups are rejected as ambiguous;
- a non-HTTPS remote endpoint, and any endpoint carrying userinfo, query, or fragment, is rejected;
  loopback HTTP is accepted;
- a failing binding probe leaves the application started and recording-capable, and emits a
  diagnostic that contains the offending variable name and contains no credential material;
- the probe does not execute for generic start mode or under test configuration;
- existing fail-closed Director error mapping is unchanged, and no failure path yields
  `continue_listening`.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:local-operability
pnpm build
git diff --check
```

## Non-goals

- No repair of the Owner's invalid credential or wrong base URL; those are Owner prerequisites
  recorded in the pack.
- No provider/model selection change, and no production provider decision.
- No retry, backoff, or fallback-model behavior for Director calls.
- No AI status surfacing; `RIU-03` and `RIU-04`.
- No calibration change; `RIU-02`.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews the exact PR head
before Dispatcher merge/main verification.

Next Task: `RIU-02-CALIBRATION-USABLE`
