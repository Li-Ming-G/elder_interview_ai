# CPA-05 Owner Checkpoint A local runbook

This is a local, reversible Owner checkpoint. It is not a production deployment and it must use
only deliberately selected public, non-sensitive interview material. Never use private family
interviews, health/financial/biometric details, consent records, unpublished recordings, or other
ordinary real interview data.

## Prerequisites

1. Start the local PostgreSQL service and apply the existing migrations.
2. Put the already provisioned Tencent realtime ASR configuration and the new
   `OPENROUTER_API_KEY` in a local-only `.env.local`. Do not commit it, print it, or paste it into
   a terminal transcript. The only new secret for this checkpoint is `OPENROUTER_API_KEY`.
3. The Tencent ASR values must be real configuration for the accepted ASR path. The deterministic
   fixture is rejected by the checkpoint start command and cannot prove audio reached the Director.

## Start the formal Workbench

From the repository root, run:

```text
pnpm checkpoint-a:start
```

The command builds the current workspace, starts the API in explicit `--checkpoint-a` mode on
`127.0.0.1:3101`, and starts the existing Vite Workbench on `http://127.0.0.1:5173`. It loads
`.env.local` into the server process without printing its values. Stop both processes with
`Ctrl-C`.

Log in using the existing local synthetic account, open the formal Workbench, and play the
selected public audio. The visible path is:

```text
audio -> real finalized ASR transcript -> accepted P1-P6 runtime -> Owner Prompt -> OpenRouter/Ox
-> current Question Presentation -> SuggestionPanel
```

The SuggestionPanel must visibly show a next question, `继续倾听`, or `问题建议暂不可用` on an
accepted fail-closed error. Click `下一个问题` once to verify that manual-next uses the same
OpenRouter-backed Director path. Recording and finalized transcript must continue if the provider
times out or fails.

No backend JSON, logs, Decision Trace, prompt, context, transcript, evidence, provider body or
secret inspection is needed or permitted for Owner acceptance. CI remains network-free and uses
synthetic data with fake transport.
