# Checkpoint A OpenRouter Director V1

Status: `ACCEPTED / OWNER-AUTHORIZED / CHECKPOINT-A-ONLY`

## Authority and purpose

This contract authorizes one reversible local verification path for `OWNER CHECKPOINT A`:

```text
public non-sensitive interview audio
  -> existing real ASR
  -> finalized transcript
  -> accepted P1-P6 runtime
  -> Interview Director
  -> OpenRouter / stealth/ox-alpha
  -> accepted Question Presentation
  -> existing Workbench SuggestionPanel
```

It is not a production-provider decision. It does not authorize private, sensitive or ordinary
real interview material to leave the device.

## Frozen binding

- Director port: `QuestionDirector` only.
- `StructuredAiProvider` remains unchanged and unavailable for real external P1/P2 memory or
  actual-question extraction.
- Environment scope: local Checkpoint A only. Tests remain deterministic and network-free;
  staging and production remain unavailable.
- Gateway/provider: `openrouter`.
- Endpoint origin: `https://openrouter.ai`.
- Chat endpoint: `https://openrouter.ai/api/v1/chat/completions`.
- Requested model: `stealth/ox-alpha`.
- Secret reference: `OPENROUTER_API_KEY`, injected only from the server process environment.
- Routing: no model fallback and no silent model substitution.
- Transport output mode: JSON object. Ox Alpha must not be represented as provider-enforced JSON
  Schema because its published capability does not provide JSON-Schema enforcement.
- Application authority: parse JSON, then validate against the accepted
  `InterviewDirectorOutputV1` schema and current frozen context references before publication.

If `stealth/ox-alpha` becomes unavailable or its declared capability changes, runtime fails
closed as unavailable and Architect returns to the Owner. No Agent or Dispatcher may substitute a
different model.

The API key's presence may activate this binding only in the explicit local Checkpoint A start
path. Ordinary tests, generic local startup, staging and production must not become networked
because an ambient secret happens to exist.

## Data boundary

Allowed input is restricted to material that the Product Owner deliberately selects for this
checkpoint and that is both publicly available and non-sensitive. The chosen anonymous Ox Alpha
provider retains prompts and completions and states that it does not use them for training. This
retention is accepted only for the bounded public-material checkpoint.

The following remain denied:

- private family interviews;
- unpublished or access-controlled recordings/transcripts;
- sensitive personal, health, financial, biometric or consent records;
- real elder-interview production data;
- arbitrary local sessions outside the explicit Checkpoint A start path;
- P2 provider traffic, real embeddings, shadow traffic or fallback models.

No prompt, context, transcript body, evidence body, provider payload, response body or API key may
be copied into application logs, Decision Trace, PR text or committed configuration. Existing
reference/digest-only trace rules remain authoritative.

## Request and output behavior

Each Director call sends only the already frozen Director prompt, output-schema instruction,
current `InterviewDirectorContextV1`, and the optional single accepted P5 evidence result. Input
membership and publication authority remain owned by P4/P5/P6; the adapter has no database, tool,
memory or presentation authority.

The adapter must:

1. send the exact requested model and JSON-object response mode;
2. disable fallback and require requested parameters where supported by the gateway;
3. use the remaining accepted P6 generation deadline as an abort boundary;
4. reject empty, non-JSON, malformed, schema-invalid and outside-context outputs;
5. map timeout, HTTP, gateway, parse and validation failures to sanitized existing error surfaces;
6. never turn a failure into `CONTINUE_LISTENING`;
7. never publish directly;
8. allow the accepted P5 evidence flow to make at most one second call under the same deadline,
   generation authority and provider binding.

Provider request/response identifiers may be retained only when already accepted typed fields
exist and only as bounded identifiers. Their absence must not be replaced with invented values.

## Prompt and provenance

The final active prompt for Checkpoint A must be derived from the Product Owner's existing
Interview Director Prompt. Until that artifact is supplied, no Worker may rewrite interview
strategy or activate `v2-draft`.

Every generation attempt must record truthful values for:

- prompt bundle version and SHA-256 digest of the exact loaded system/task bytes;
- context/output schema versions and digests;
- model config version and digest for the actual OpenRouter/Ox binding;
- requested provider/model identity through existing safe provenance fields where available.

`local-test-director-v1` must never describe an actual OpenRouter call. Draft prompt bytes are
never runtime-loadable merely because they exist.

## Existing ASR entry condition

Checkpoint A requires audio-dependent finalized transcript from the already accepted real ASR
path. The deterministic local ASR fixture cannot satisfy the checkpoint because it emits fixed
fictional transcript content unrelated to the played audio.

No new ASR provider is authorized. Existing Tencent realtime ASR may be used only through its
already accepted configuration and secret-injection rules. The checkpoint claim that the only new
secret is `OPENROUTER_API_KEY` assumes the Owner's real ASR environment was previously provisioned.
If that prerequisite cannot be proven without exposing secrets, the readiness task must stop with
`PRODUCT_AMBIGUITY`; it must not substitute fixture ASR as evidence.

## Owner-visible acceptance

The final readiness path must require no new test UI and no inspection of backend JSON or logs.
With the existing ASR environment already provisioned, the Owner must only add
`OPENROUTER_API_KEY`, start the documented local Checkpoint A command, open the formal Workbench
and play selected public material. The current SuggestionPanel must visibly show one of:

- one next question;
- continue listening;
- unavailable when the accepted fail-closed path is exercised.

The existing manual `下一个问题` control must exercise the same OpenRouter-backed Director path
without bypassing P6 authority.

## Explicit non-goals

- no production provider/model approval;
- no real P2 provider or real embedding activation;
- no production budget or deployment policy;
- no T26-T27 scoring or evaluation system;
- no scoring popup, dashboard, model-comparison page or new test UI;
- no Prompt strategy invention by an Agent;
- no second Director, provider framework, tool loop or publication authority.

After final PASS, merge and successful main verification, development stops at the Owner gate and
reports `OWNER_CHECKPOINT_A_READY: YES`.

## Provider evidence checked for this contract

Checked on 2026-08-24 against OpenRouter's official surfaces:

- `https://openrouter.ai/stealth/ox-alpha`: exact model slug, preview/anonymous-provider status,
  provider retention/no-training statement, and JSON `response_format` without JSON-Schema
  enforcement;
- `https://openrouter.ai/docs/quickstart`: bearer authentication and
  `https://openrouter.ai/api/v1/chat/completions`;
- `https://openrouter.ai/docs/guides/routing/provider-selection`: fallback/parameter/data-policy
  routing controls;
- `https://openrouter.ai/docs/guides/privacy/data-collection` and
  `https://openrouter.ai/docs/guides/privacy/provider-logging/`: gateway/provider data boundaries.
