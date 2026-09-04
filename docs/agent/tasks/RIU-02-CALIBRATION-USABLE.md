# RIU-02-CALIBRATION-USABLE

Status: `DEFERRED`

## Goal

Make speaker calibration reachable and its outcome honest, so a listener can actually obtain trusted
speaker attribution — without the system ever inventing who was speaking.

Covers defects **G1**, **G2**.

## Entry / dependencies

- `RIU-01-DIRECTOR-LANDING` is `DONE` through Architect PASS + merge + refreshed-main CI.

## Root cause

Confirmation requires two distinct provider speaker labels that were *actually observed* inside the
calibration attempt window (`assertObservedLabels`,
`apps/api/src/project-foundation/speaker-calibration.service.ts:250-277`). In the Owner's session the
attempt spanned `startMs: 100` to `endMs: 2300` — 2.2 seconds — during which Tencent diarization
emitted a single label (`0`). Confirmation was therefore unreachable and the only available exit was
skip. Because `projectTrustedSpeakerRole` grants trust only to a `user_confirmed` mapping or an
explicit correction (`apps/api/src/transcription/trusted-speaker-role.ts:19-22`), the skip left every
later segment `unknown`, and nothing on the Workbench said so.

The two-distinct-observed-labels rule is **correct and must be preserved** — it is what stops the
product from inventing speaker identity. The defect is that the surface never tells the listener what
the rule requires, and closes the window before the rule can be satisfied.

## Required behavior

1. The calibration surface states plainly, before and during the attempt, that **both people must
   speak** for calibration to succeed, and roughly how much speech is needed.
2. While an attempt is open, the surface reflects observed progress from server-authoritative
   calibration state — how many distinct speakers have been heard so far, and that confirmation
   becomes available once two have been heard. It reports observation counts and role-assignment
   status only; it must not display raw provider label values as if they were speaker identities.
3. An attempt must not reach a state where confirmation is impossible while the surface still presents
   confirmation as the expected action. If only one speaker has been observed, the surface says so and
   says what to do about it.
4. The listener can continue an in-progress attempt until two distinct speakers have been observed, or
   can explicitly and knowingly skip. Skip remains available at all times.
5. `assertObservedLabels` semantics are preserved: exactly two mappings, two distinct provider labels,
   two distinct roles, one `elder` and one `interviewer`, and every submitted label must have been
   observed in the attempt. Do not weaken any of these.
6. No inferred, defaulted, positional, or first-speaker-wins role assignment is introduced anywhere.
   A provider label never becomes a trusted role without explicit human confirmation.
7. When calibration ends `skipped` or `failed`, the Workbench states plainly and persistently that
   speaker identity is unconfirmed, explains that transcript and recording are unaffected, and
   surfaces the existing per-segment speaker-correction path as the available remedy.
8. Existing safe End Interview availability during calibration is unchanged, and calibration remains
   incapable of hard-locking interview completion.
9. Original audio, transcript text, existing speaker evidence, calibration attempt records, and
   consent records are never overwritten or rewritten by this task. Correction remains non-destructive
   and append-only through the existing mechanism.
10. Segments captured during a calibration attempt keep `content_kind: speaker_calibration` and remain
    excluded from AI eligibility.

## Allowed files

- `apps/api/src/project-foundation/speaker-calibration.service.ts`
- the existing calibration snapshot source and its spec, only if observed-progress state is
  server-owned
- `apps/api/src/transcription/speaker-calibration-snapshot.service.ts`
- the existing calibration contract/type file and spec required by an additive snapshot field
- `apps/web/src/interview/workbench-shell.tsx`
- `apps/web/src/interview/workbench-shell.spec.tsx`
- the existing calibration UI component and spec reached from the Workbench
- minimal adjacent copy/snapshot tests strictly required by the above

No change to `trusted-speaker-role.ts` trust semantics. No change to
`assertObservedLabels` acceptance rules. No new ASR provider parameter. No diarization tuning. No
Director or AI change.

## Regression / acceptance

Tests must prove at minimum:

- a one-observed-speaker attempt cannot be confirmed, and the surface reports the missing second
  speaker rather than presenting confirmation as available;
- a two-observed-speaker attempt can be confirmed, produces `user_confirmed` mappings, and the
  resulting segments project a trusted `elder` / `interviewer` role;
- submitting a label that was never observed is still rejected;
- submitting one mapping, two mappings with one role, or two mappings with a duplicate label is still
  rejected;
- skip remains available throughout, and a skipped attempt yields a persistent unconfirmed-speaker
  disclosure on the Workbench plus the correction path;
- a skipped or failed attempt does not block End Interview and does not block completion;
- no code path assigns a speaker role without an explicit confirmation or correction;
- calibration-window segments remain `speaker_calibration` and AI-ineligible;
- existing speaker evidence and attempt records are unmodified by the new flow.

Minimum verification:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
git diff --check
```

## Non-goals

- No automatic speaker identification, voiceprint matching, or speaker re-identification.
- No change to Tencent ASR wire parameters or the accepted ASR provider profile.
- No bulk speaker remap feature beyond the existing correction path.
- No AI status work; `RIU-03` and `RIU-04`.

## Completion

Exactly one implementation PR. Worker stops at `REVIEW`; external Architect reviews the exact PR head
before Dispatcher merge/main verification.

Next Task: `RIU-03-AI-STATUS-CONTRACT`
