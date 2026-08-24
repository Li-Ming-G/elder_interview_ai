# CPA-03 local ASR readiness runbook

This runbook verifies the already accepted Tencent realtime ASR binding for the formal Workbench.
It does not add a provider, select credentials, or activate the Director.

## 1. Safe preflight

Inject the existing Tencent values into the server process environment or a local-only
`.env.local` outside version control. Never paste them into this file, a terminal transcript, or
the PR. Then run:

```text
pnpm build
node --env-file-if-exists=.env.local scripts/checkpoint-a-asr-readiness.mjs
```

The successful output is safe JSON containing `provider`, `appEnv`, readiness status, and secret
key names only. It must report `mode: "real_tencent"`, `provider:
"tencent_realtime_asr_v2"`, and `configurationStatus: "configuration_ready"`.

If `mode` is `deterministic_fixture`, the command exits non-zero with
`DETERMINISTIC_FIXTURE_NOT_CHECKPOINT_EVIDENCE`. This is a hard rejection; do not use the fixture
transcript as Checkpoint A evidence. Missing or invalid existing Tencent configuration is also a
stop condition. Do not rotate credentials or add another provider.

## 2. Formal Workbench observation

With the successful local preflight still in force, start the existing local API and web
Workbench, use a consented public and non-sensitive audio selection, and record no media or
transcript in the repository. Play two short selections with materially different spoken content.
The Workbench must remain recordable and show finalized transcript events corresponding to the
played audio. The existing runtime event path is the evidence boundary:

```text
audio.frame -> existing Tencent adapter -> transcript ingestion -> asr.final
```

The implementation test asserts that forwarded frames reach a finalized event with the `realtime`
source; the owner-visible check is the Workbench result after the real preflight succeeds. A
deterministic fixture result, a direct adapter probe, or a fixture transcript is not a live
Checkpoint A pass. Do not inspect, print, or attach secret values, raw provider payloads, audio,
or transcript text.
