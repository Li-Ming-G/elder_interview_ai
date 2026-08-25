# Real-Flow Cleanup Development Pack

Status: `ACTIVE`

## Owner authorization

The Product Owner authorizes one bounded cleanup sequence that removes owner-facing/local-runtime dependence on fake, synthetic, test, demo and harness artifacts while preserving legitimate automated-test infrastructure.

Predefined sequence:

```text
REAL-IDENTITY-01 -> REAL-RUNTIME-02 -> null
```

Only the first eligible task may be `READY`; the successor remains `DEFERRED` until the Dispatcher closes the predecessor through external Architect PASS, merge, successful main verification and stage-state synchronization.

## Product outcome

The ordinary local product path used by the Product Owner must behave like the real application rather than a test harness:

1. normal login uses an ordinary persisted application user created through the existing operator user-management path, not the repository synthetic `.test` identity;
2. the normal web entry always renders the real application and does not expose query-string switches that replace it with engineering harnesses;
3. synthetic identities, fake transports and harnesses remain available only where automated/local engineering tests explicitly need them.

## Architecture mapping

This pack is Foundation/product-surface cleanup only.

- P1-P6: `UNCHANGED`.
- T0-T27 semantic/runtime responsibilities: `UNCHANGED`.
- T26-T27 evaluation/scoring: `DEFERRED` and not activated.
- Checkpoint A OpenRouter/Ox, Owner Prompt and Tencent ASR bindings: `UNCHANGED`.
- Authentication semantics: existing behavior preserved; this pack changes owner-facing provisioning/runbook dependence, not auth architecture.
- Web product entry: test-only harness selection is isolated from the ordinary application entry; interview/product semantics are unchanged.

## Task 1 — REAL-IDENTITY-01

Replace the Owner Checkpoint/local normal-login instruction's dependency on the synthetic account with the existing persisted user/operator flow.

Key constraints:

- preserve `seed-test-users.ts` and synthetic accounts for automated tests only;
- use the existing `user:create` / user-management CLI path;
- secret input remains interactive and hidden;
- secrets must never be accepted as command arguments, logged, committed or pasted into durable evidence;
- do not create public sign-up, email verification, OAuth or a new auth provider;
- do not create or commit the Owner's private account data;
- update the Owner Checkpoint runbook so it instructs the Owner to provision/use an ordinary local application account, without embedding a credential.

## Task 2 — REAL-RUNTIME-02

Remove harness switching from `apps/web/src/main.tsx` so the ordinary application entry cannot be replaced through query parameters such as `audio_harness`, `realtime_harness`, `capture_core_harness`, `interview_controller_harness` or `suggestion_harness`, including fake default IDs.

Key constraints:

- preserve engineering harness components and automated test coverage through an explicit test/dev-only entry or test configuration;
- normal app entry renders `App` only;
- audit owner-visible normal-route code touched by this task for unambiguously test-only fake/demo/harness artifacts and isolate/remove only those;
- genuine unfinished product features/placeholders are not silently implemented or deleted; they are reported as separate Owner decisions.

## Hard boundaries

This pack must not:

- alter P1-P6 responsibilities or accepted memory/evidence semantics;
- alter Owner Director Prompt meaning;
- alter OpenRouter/Ox or Tencent ASR behavior;
- activate scoring, evaluation, model comparison, real embeddings, P2-D, production provider/model/budget/data/deployment policy;
- use ordinary real interview data or commit personal data/secrets;
- modify, merge, close or otherwise act on open PRs #25, #43, #45, #62 or #110;
- invent a successor after `REAL-RUNTIME-02`.

## Governance

The external/web Architect owns this plan, Task Cards, exact-head review and verdict. The Dispatcher mechanically launches the first `READY` task, binds the Worker PR, consumes Architect verdicts, merges only after PASS, verifies main, synchronizes durable state and unlocks only the predefined successor. Implementation Workers implement only their current Task Card.

The accepted lifecycle remains:

```text
READY -> Worker -> PR REVIEW -> external Architect verdict -> merge -> main CI -> DONE -> predefined next_task
```

## Baseline identity

Planning baseline: `main@055bb9b9a91ff9ae696495f9688da7d8d02d3552`.

No new Accepted Machine/Module Contract is introduced by this pack. Existing accepted/stable authentication, privacy, interview-runtime and Checkpoint A invariants remain authoritative and must not be weakened.
