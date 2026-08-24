# CPA-05 — Formal Workbench integration and Owner Checkpoint A readiness

Status: `DEFERRED`

## Goal

Activate the already accepted Checkpoint A config, OpenRouter QuestionDirector, existing real ASR
and Owner Prompt in one explicit local start path, then prove readiness through the formal
Workbench and current SuggestionPanel.

## Architecture mapping

- P1-P6 + T25 bounded Checkpoint A integration: in scope.
- T26-T27 scoring/evaluation and production deployment: out of scope.

## Allowed files / areas

- narrow module/config/runtime wiring across accepted CPA-01..04 seams;
- focused integration/E2E tests using fake network transport and synthetic data;
- existing Workbench/SuggestionPanel only for regressions or minimal wiring; no new test UI;
- one local Checkpoint A start command/script and concise Owner runbook;
- `.env.example` names/placeholders only;
- this Task Card and PR documentation.

## Accepted contracts

- `docs/contracts/checkpoint-a-openrouter-director-v1.md`;
- CPA-01 through CPA-04 accepted exact heads;
- `docs/contracts/question-runtime-orchestration-v1.md`;
- accepted P1-P6, P5 evidence and current Workbench behavior.

## Required behavior

1. Generic local/test/staging/production behavior remains unchanged; only the explicit local
   Checkpoint A start path activates OpenRouter.
2. The start path loads `.env.local` without printing it and requires the pre-provisioned real ASR
   configuration plus newly supplied `OPENROUTER_API_KEY`.
3. The formal Workbench path is audio -> real finalized transcript -> existing P1-P6 -> accepted
   Owner Prompt -> OpenRouter/Ox -> current Question Presentation -> current SuggestionPanel.
4. Automatic path visibly resolves to one question or continue-listening; unavailable remains the
   accepted failure surface.
5. Existing `下一个问题` manual-next uses the same OpenRouter binding and all P6 fences.
6. No backend JSON/log inspection is required for Owner acceptance.
7. All CI tests are network-free and use fictional/synthetic inputs and fake transport.
8. The runbook instructs the Owner to use deliberately selected public/non-sensitive material and
   never private/sensitive interview data.
9. Secrets, prompt/context/transcript/evidence/provider bodies remain absent from logs, traces,
   committed files, PR and test artifacts.
10. Existing original-audio/ASR-failure safeguards remain healthy.

## Fixed integration matrix

- automatic real-Director suggestion reaches SuggestionPanel;
- real-Director continue-listening reaches SuggestionPanel;
- manual-next reaches the same provider and supersedes late automatic work;
- malformed/timeout/provider failure displays unavailable and does not stop recording/transcript;
- prompt/model/config digests on attempts match actual selected artifacts;
- fixture ASR cannot satisfy live readiness;
- no scoring/evaluation/model-comparison UI exists.

## Explicit non-goals

- no production deployment/provider approval;
- no real P2/embedding activation;
- no additional UI beyond current Workbench/SuggestionPanel;
- no scoring popup, dashboard, model comparison or evaluation workflow;
- no automatic successor after this task.

## Tests

Run the fixed matrix plus relevant unit/integration/auth/build/smoke/E2E, API/web typecheck, ESLint,
Prettier, migration status where required, secret/body leakage scans and `git diff --check`.

## Completion criteria

- one documented local command makes Checkpoint A ready under the accepted ASR prerequisite;
- Owner's only new secret for this pack is `OPENROUTER_API_KEY`;
- current formal UI can visibly demonstrate automatic and manual-next outcomes;
- one PR contains exact review context and Worker handoff;
- Worker stops at `REVIEW`.

## Review gate and Owner STOP

External Architect exact-head review. After PASS, merge and successful main verification, report:

`OWNER_CHECKPOINT_A_READY: YES`

Then stop for Product Owner hands-on acceptance. Do not start scoring/evaluation work.

## Next task

`null`
