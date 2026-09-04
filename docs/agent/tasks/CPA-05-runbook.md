# CPA-05 Owner Checkpoint A local runbook

This is a local, reversible Owner checkpoint. It is not a production deployment and it must use
only deliberately selected public, non-sensitive interview material. Never use private family
interviews, health/financial/biometric details, consent records, unpublished recordings, or other
ordinary real interview data.

## Prerequisites

1. Start the local PostgreSQL service using the tracked Compose mapping (`127.0.0.1:15432` for
   development and `127.0.0.1:15433` for test), then apply the existing migrations.
2. If this checkout's ignored `.env.local` predates the repository port change, run the one-time
   migration from the repository root:

   ```text
   pnpm local:env:migrate-db-ports
   ```

   It changes only recognized local `DATABASE_URL`/`TEST_DATABASE_URL` host ports and preserves
   the rest of the file. If it reports an ambiguous URL, stop and correct that local configuration
   deliberately; do not work around it with a process-level `DATABASE_URL` override.
3. Put the already provisioned Tencent realtime ASR configuration and the active Director
   configuration in the single local-only `.env.local` described by
   [`docs/local-ai-model-configuration.md`](../../local-ai-model-configuration.md). Use exactly one
   documented three-variable `ANTHROPIC_*` or `OPENAI_*` group, or the optional advanced
   `AI_DIRECTOR_*` group. Do not commit or print that file, paste it into a terminal transcript, or
   put a real key in tracked documentation.
4. The Tencent ASR values must be real configuration for the accepted ASR path. The deterministic
   fixture is rejected by the checkpoint start command and cannot prove audio reached the Director.

## Start the formal Workbench

From the repository root, run:

```text
pnpm checkpoint-a:start
```

The command builds the current workspace, starts the API in explicit `--checkpoint-a` mode on
`127.0.0.1:3101`, and starts the existing Vite Workbench on `http://127.0.0.1:5173`. It loads
`.env.local` into the server process without printing its values and removes backend-only secrets
from the Vite child environment. Stop both processes with `Ctrl-C`; the launcher cleans up the
child process trees on native Windows as well.

Before the first checkpoint run, create the ordinary persisted local application user that the
Owner will use to log in. After the one-time migration and after the existing migrations are
applied, run the existing operator-managed CLI from the repository root:

```text
pnpm --filter @elder-interview/api user:create -- --operator-ref local-owner-setup --email "owner@example.invalid" --display-name "Owner display name" --role interviewer
```

Replace the example email and display name with the Owner-chosen values. The command prompts for
the password and confirmation through hidden interactive input; never add a password or other
secret as a command argument. This creates a normal persisted `User` record used by the existing
login endpoint and session flow. Use that email and password to log in, open the formal Workbench,
and play the selected public audio. Synthetic identities such as `listener-a@example.test` and
`seed-test-users.ts` remain available for automated tests only.

The visible path is:

```text
audio -> real finalized ASR transcript -> accepted P1-P6 runtime -> Owner Prompt -> configured Director API
-> current Question Presentation -> SuggestionPanel
```

The SuggestionPanel must visibly show a next question, `继续倾听`, or `问题建议暂不可用` on an
accepted fail-closed error. Click `下一个问题` once to verify that manual-next uses the same
configured Director path. Recording and finalized transcript must continue if the provider
times out or fails.

No backend JSON, logs, Decision Trace, prompt, context, transcript, evidence, provider body or
secret inspection is needed or permitted for Owner acceptance. CI remains network-free and uses
synthetic data with fake transport.
