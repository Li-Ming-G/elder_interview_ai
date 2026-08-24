# Owner Checkpoint A Development Pack

Status: `OWNER_ISSUED / ARCHITECT_PLANNED`

## Purpose

Move the accepted P1-P6 runtime from provider-neutral synthetic verification to one bounded local
Owner experience using the formal Workbench, existing real ASR, the Owner's existing Interview
Director Prompt and OpenRouter `stealth/ox-alpha`.

The target is not production readiness. It is a human checkpoint that ends when the current
SuggestionPanel visibly presents one next question or `继续倾听`, and manual-next uses the same
real Director path.

## Durable baseline

- Refreshed planning base: `origin/main` at
  `d6449fe751c6b26797178f7fcb1e3a101912e6f3`.
- P6R-01 through P6R-05 are DONE through PR #103; merge/main
  `045b041445eec2e73060afa5bbbe0e15c82cc51e`; main CI `32711482477` SUCCESS.
- Formal Director port is `QuestionDirector`. `StructuredAiProvider` is a separate P1/P2 and
  actual-question extraction port and is unchanged.
- Formal Workbench already renders SuggestionPanel with question, continue-listening, unavailable
  and manual-next behavior.
- Local default ASR is deterministic fixture data and cannot prove audio-dependent Checkpoint A.
- Accepted pack contract: `docs/contracts/checkpoint-a-openrouter-director-v1.md`.

## Owner-authorized decisions

- Local checkpoint gateway: OpenRouter.
- Base URL: `https://openrouter.ai/api/v1`.
- Requested model: `stealth/ox-alpha`.
- Allowed material: deliberately selected public, non-sensitive interview material only.
- New secret reference: `OPENROUTER_API_KEY`, server environment only.
- This does not select a production provider/model or authorize ordinary real interview data.
- The final prompt must derive from the Owner's prior complete Interview Director Prompt; Agents
  must not invent replacement interviewing strategy.

## Canonical queue

```text
CPA-01  Checkpoint A server configuration authority
  -> CPA-02  OpenRouter QuestionDirector adapter
  -> CPA-03  existing real-ASR / audio-dependent readiness
  -> CPA-04  Owner Prompt acceptance + version/digest/loader
  -> CPA-05  formal Workbench integration + Owner Checkpoint A readiness
  -> null
```

Initial state:

- `CPA-01`: `READY`
- `CPA-02`: `DEFERRED`
- `CPA-03`: `DEFERRED`
- `CPA-04`: `DEFERRED`
- `CPA-05`: `DEFERRED`

There is exactly one READY task. Each successor requires predecessor external Architect PASS,
merge and successful main verification.

## Owner Prompt dependency gate

`CPA-04` additionally depends on `OWNER_DIRECTOR_PROMPT_ARTIFACT`. Until the Owner supplies that
artifact and the Architect records its exact durable identity in CPA-04 through a planning-only
update, CPA-04 is not eligible and remains `DEFERRED`, even if CPA-03 is DONE. Dispatcher must not
invent prompt content or treat `v2-draft` as the missing artifact.

The update that records the artifact may fill an already-defined input identity; it must not
change this queue, prompt product meaning or task scope.

## Checkpoint A readiness meaning

The final task may report readiness only when:

1. the already accepted real ASR configuration is pre-provisioned outside Git;
2. the Owner's only newly added secret for this pack is `OPENROUTER_API_KEY`;
3. one documented local start command launches the formal Checkpoint A path;
4. audio played into the formal Workbench reaches audio-dependent finalized transcript;
5. the accepted P1-P6 generation/publication path invokes OpenRouter/Ox Alpha;
6. the current SuggestionPanel visibly shows question, continue-listening or accepted unavailable;
7. manual-next uses the same authority and provider binding;
8. no secret or prompt/context/transcript/provider body is exposed in Git, PR, logs or trace.

CI must remain network-free. Live model and audio use occur only during Owner acceptance after
readiness is merged and main is green.

## Mandatory STOP

After CPA-05 external PASS, merge and successful main verification, report:

`OWNER_CHECKPOINT_A_READY: YES`

Then stop and wait for the Product Owner's hands-on result. Do not create or start T26-T27 scoring,
evaluation dashboards, model comparison, scoring popups or new test UI unless the Owner explicitly
says: `Checkpoint A 通过，继续做评分系统`.
