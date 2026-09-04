# Real Interview Usability 01

Status: `ACTIVE`

## Owner authorization

The Product Owner ran the first real end-to-end browser test of the completed Product Flow Closure
product and authorizes a bounded follow-up sequence. Product Flow Closure 01 proved the *chain* of
screens works. This pack addresses what that first real interview proved is still unusable inside
that chain.

Primary goal: **a listener conducting a real interview can tell who is speaking, and can always tell
what the AI assistant is doing — including when it is failing.**

Three Owner-reported defects motivate this pack, all reproduced against durable runtime evidence
from session `fdab6622-df28-4a79-be5a-8421753e4674`:

1. **Speaker identity is unusable.** Tencent realtime ASR diarization worked and returned three
   distinct provider speaker labels (`0`, `1`, `2`). The calibration attempt nonetheless ended
   `skipped`, produced zero speaker mappings, and therefore left every transcript segment with a
   `trusted_effective_role` of `unknown`. The listener had to hand-correct 7 segments to recover any
   speaker attribution at all.
2. **AI failure is completely invisible.** Ten consecutive `question_generate` attempts — nine
   automatic plus the Owner's one explicit manual request — failed with
   `failure_code: AI_PROVIDER_UNAVAILABLE`, `stage: director`, `director_invoked: true`. The product
   surface said nothing. The Owner could not distinguish "the AI decided no question was needed"
   from "the AI call is broken."
3. **There is no way to know when the next suggestion is due.** Automatic generation is gated behind
   a minimum interval plus new finalized transcript, so a silent panel is indistinguishable from a
   hung one.

The Product Owner decided, on the third point: **the AI status surface is a permanent, ordinary
product feature and is always visible. It is not a debug mode and is not gated behind a flag.** A
listener sitting with an elder is entitled to know that their assistant has stopped working.

Predefined sequence:

```text
RIU-01-DIRECTOR-LANDING
  -> RIU-02-CALIBRATION-USABLE
  -> RIU-03-AI-STATUS-CONTRACT
  -> RIU-04-AI-STATUS-UI
  -> RIU-05-REPO-HEALTH
  -> null
```

Only the first eligible task may run. Every successor remains locked until the predecessor receives
exact-head external Architect PASS, merges, and refreshed-main CI succeeds.

## Owner prerequisite (not an implementation task)

The Owner's local `.env.local` Director binding is currently misconfigured in two independent ways.
No code change can repair either; both are Owner actions:

1. `ANTHROPIC_BASE_URL` is `https://agentrouter.org`, which rejects every API request with
   `unauthorized client detected` regardless of credential. The documented API host is
   `https://co.agentrouter.org` (see `docs/local-ai-model-configuration.md`).
2. Against the correct host, the configured credential is rejected as `Invalid API Key!` under
   `x-api-key`, under `Authorization: Bearer`, and on the OpenAI-compatible path. The credential
   itself must be replaced.

`RIU-01` adds a loud startup diagnostic so this class of misconfiguration is reported at launch
instead of being discovered after a completed interview. It does not and cannot make an invalid
credential valid.

## Product invariants

The ten Product Flow Closure invariants remain in force unchanged. This pack adds four, all of which
are refinements of existing safeguards rather than new product scope:

11. **Speaker attribution is never invented.** Provider diarization output alone never becomes a
    trusted speaker role. Only an explicit human confirmation or correction produces trust. A
    calibration surface that cannot be satisfied must say what is missing, not silently degrade.
12. **AI state is always legible.** At every moment during formal recording the listener can see
    whether the assistant is working, waiting, or failed. Silence is never the representation of
    failure.
13. **A timing indicator never promises an outcome it cannot guarantee.** Automatic generation
    requires both an elapsed minimum interval and new finalized transcript. Any countdown must
    express the interval gate honestly and must not imply a question will appear when it reaches
    zero. This is invariant 2 (label and action must agree) applied to time.
14. **Diagnostics never expose secrets or model payloads.** Credentials, prompts, context, and raw
    provider payloads stay out of user-facing surfaces, logs, and traces. Only sanitized status and
    error codes are exposed.

## Defects covered

- **G1**: `assertObservedLabels` requires exactly two distinct *observed* provider speaker labels
  before calibration may be confirmed. A short calibration window in which diarization emits one
  label makes confirmation unreachable, and the only remaining exit is skip.
  (`apps/api/src/project-foundation/speaker-calibration.service.ts:250-277`)
- **G2**: a `skipped` or `failed` calibration leaves every segment `unconfirmed` / `unknown` via
  `projectTrustedSpeakerRole`, and the Workbench communicates none of this to the listener.
  (`apps/api/src/transcription/trusted-speaker-role.ts:19-22`)
- **G3**: automatic `question_generate` outcomes are persisted but never surfaced. The Suggestion
  Panel's `error` state is written only by user-initiated fetches, so background failure is
  invisible by construction. (`apps/web/src/interview/suggestion-panel.tsx`)
- **G4**: no surface expresses the automatic generation cadence
  (`AUTO_MIN_INTERVAL_MS = 20_000`, `DEBOUNCE_MS = 1_500`), so a correctly-waiting panel and a
  broken one look identical.
  (`apps/api/src/question-orchestration/question-orchestration.service.ts:76-78,1148`)
- **G5**: the accepted Checkpoint A Configurable Director V2 implementation exists in the working
  tree with no Task Card and is uncommitted, so the retired OpenRouter/Ox binding repair has no
  durable governance record.
- **G6**: the `anthropic_messages` profile sends only `Authorization: Bearer`. The Anthropic Messages
  API authenticates API keys with `x-api-key`; `Authorization: Bearer` is the OAuth-token channel.
  The current gateway accepts either, so this is latent rather than active, but any binding pointed
  at the first-party API would fail authentication.
- **G7**: a broken Director binding produces no startup signal, so misconfiguration is discovered
  only after a real interview has already been conducted.
- **G8**: repository health debt unrelated to product behavior — `pnpm lint` fails locally with 233
  errors sourced entirely from the git-ignored `tmp/` tree; one Workbench test is load-flaky; two
  placeholder route components survive as unreachable dead code carrying stale "即将可用" copy.

## Non-goals

- No new AI provider, model, embedding, or fallback-model decision. Production provider/model/data
  policy remains Owner-deferred.
- No Director prompt change, and no change to the accepted Director context/output schemas.
- No P1/P2 external provider activation. `AI_P1_*` and `AI_P2_*` remain reserved and inactive.
- No pause/resume feature.
- No broad UI redesign. UI work is limited to making speaker and AI state legible.
- No change to P1-P6 ownership boundaries, evidence authority, or consent/capture safety.
- No real or private elder data introduced by this pack.

## Governance

Standard lifecycle applies unchanged:

```text
READY -> IN_PROGRESS -> canonical PR -> REVIEW/repair loop -> external Architect PASS -> merge
      -> refreshed-main CI -> DONE -> predefined successor
```

Each task is exactly one implementation PR. The Worker stops at `REVIEW`. Product or architecture
ambiguity is `BLOCKED / PRODUCT_AMBIGUITY` and escalates to the Product Owner.
