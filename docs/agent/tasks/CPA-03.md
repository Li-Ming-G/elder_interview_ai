# CPA-03 — Existing real-ASR and audio-dependent readiness

Status: `DEFERRED`

## Goal

Prove that the formal Workbench can use the already accepted real ASR path so finalized transcript
depends on the audio being played, and prevent fixture transcript from being accepted as
Checkpoint A evidence.

## Architecture mapping

- Existing audio capture and Tencent realtime ASR integration: narrow verification only.
- New ASR provider/contract: out of scope.
- OpenRouter adapter: required predecessor, unchanged.
- T25 Prompt and final real-model activation: deferred.

## Allowed files / areas

- focused preflight/readiness code and tests under existing
  `apps/api/src/realtime-transcription/**`, `apps/web/src/interview/**` or `scripts/**` only where
  required to verify the accepted path;
- existing config tests and `.env.example` guidance only as needed;
- a concise Checkpoint A local runbook under `docs/agent/tasks/**`;
- no committed audio/transcript fixture derived from a real person;
- this Task Card and PR documentation.

## Accepted contracts

- `docs/contracts/checkpoint-a-openrouter-director-v1.md`;
- `docs/contracts/streaming-asr-provider-v2.md` and its accepted Tencent profile;
- `docs/contracts/question-runtime-orchestration-v1.md`;
- repository original-audio/transcript safeguards.

## Required behavior

1. Checkpoint readiness must distinguish the real Tencent ASR binding from deterministic fixture.
2. Formal Workbench audio frames must reach the existing real adapter and return finalized
   transcript through the existing event surface.
3. A fixture-generated transcript can satisfy CI plumbing tests but can never satisfy the live
   Checkpoint A readiness assertion.
4. Preflight reports only safe status/key names; it never reads back, prints or records secret
   values.
5. Existing ASR configuration is an entry condition. This task does not request, rotate or commit
   credentials.
6. ASR failure continues to protect original audio and maps to existing UI/runtime behavior.
7. No live public audio or transcript is committed, attached to PR, or placed in test artifacts.
8. If existing real ASR cannot be selected without additional product/architecture decisions,
   stop with `PRODUCT_AMBIGUITY` instead of adding a provider or accepting fixture proof.

## Explicit non-goals

- no new ASR provider, model, region or credential policy;
- no changes to transcript evidence ownership;
- no OpenRouter prompt/provider behavior changes;
- no new upload/test UI;
- no scoring/evaluation/dashboard work.

## Tests

- configuration/preflight differentiates fixture and real-ASR modes;
- mocked adapter flow proves captured audio reaches finalized event without storing real media;
- fixture mode is mechanically rejected as live Checkpoint evidence;
- ASR failure leaves recording/original audio healthy;
- relevant realtime/workbench integration, unit/auth/build/typecheck/lint/format/diff checks.

## Completion criteria

- repository has a safe, reproducible readiness check for the already accepted real ASR path;
- no real secret/media/transcript is inspected or committed;
- one PR contains exact review context and Worker handoff;
- Worker stops at `REVIEW`.

## Review gate

External Architect exact-head review. PASS + merge + successful main verification satisfies the
technical predecessor for CPA-04, but CPA-04 remains ineligible until its separate Owner Prompt
artifact dependency is durably recorded.

## Next task

`CPA-04`
