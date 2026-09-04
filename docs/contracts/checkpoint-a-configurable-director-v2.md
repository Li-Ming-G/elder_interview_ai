# Checkpoint A Configurable Director V2

Status: `ACCEPTED / OWNER-AUTHORIZED / CHECKPOINT-A-ONLY`

## Purpose and scope

This contract supersedes `checkpoint-a-openrouter-director-v1.md` because its frozen Ox model is
no longer available. It authorizes one reversible local Checkpoint A Director binding configured
through the ignored `.env.local` file.

The binding remains limited to `QuestionDirector`. It does not activate an external P1 or P2
Provider, approve a production Provider/model/data policy, change the accepted Director Prompt,
or authorize private or sensitive interview material to leave the device.

## Configurable binding

The preferred local configuration is exactly one standard server-only variable group:

- Anthropic Messages: `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`;
- OpenAI Chat Completions: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.

The variable namespace selects the wire protocol, and the runtime derives the protocol endpoint
from the supplied Base URL. Simultaneous Anthropic and OpenAI groups are rejected as ambiguous.
`AI_DIRECTOR_MODEL` may override the selected group's shared model. The advanced local
configuration remains available for unusual gateways and consists of:

- `AI_DIRECTOR_API_PROFILE`: `openai_chat_completions` or
  `openrouter_chat_completions`;
- `AI_DIRECTOR_ENDPOINT`: the full Chat Completions endpoint;
- `AI_DIRECTOR_MODEL`: the exact model identifier accepted by that endpoint;
- `AI_DIRECTOR_API_KEY`: the bearer credential.

The first profile sends only the common `model`, `messages`, and JSON-object response format. The
OpenRouter profile additionally sends the existing no-fallback and required-parameters routing
controls. Remote endpoints must use HTTPS; loopback endpoints may use HTTP. URL userinfo, query
parameters, and fragments are rejected so credentials cannot be hidden inside the endpoint.

The model-config version identifies this configuration schema. Its digest is computed from the
effective non-secret profile, endpoint, model, provider identity, response format, and routing
controls. The API key is never part of the digest, serialization, logs, traces, browser environment,
or committed files.

For local migration safety, an existing `OPENROUTER_API_KEY` may be used as a deprecated fallback
when `AI_DIRECTOR_API_KEY` is absent. Both names remain server-only and are removed from the
Workbench child environment.

## Preserved invariants

- Only the explicit local `pnpm checkpoint-a:start` path enables the networked Director.
- Generic local startup, tests, staging, and production do not become networked because ambient
  configuration exists.
- CI remains network-free and uses synthetic data and fake transports.
- The accepted Prompt, context/output schemas, P5 evidence round, P6 deadline/generation fences,
  local schema/reference validation, and Question Presentation authority remain unchanged.
- Empty, malformed, timeout, HTTP, incompatible-profile, and schema-invalid results fail closed
  through existing sanitized error surfaces; they never become `continue_listening`.
- Provider failure must not stop recording or damage original audio/final transcript evidence.
- Checkpoint A may use only deliberately selected public, non-sensitive material.

## P1 and P2 status

The single local configuration template documents reserved `AI_P1_*` and `AI_P2_*` namespaces so
future model settings have one discoverable home. Those variables are inactive in V2. P1 continues
to use its accepted local deterministic Provider, and P2 remains without a real application-runtime
Provider binding. Activating either requires a separate accepted implementation with Prompt,
output-validation, adapter, runtime-binding, safety, provenance, and network-free test coverage.
