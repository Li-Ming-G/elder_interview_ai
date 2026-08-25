# AI development role entry

This repository is the MVP for an AI-assisted elder interview system. Every agent first declares one role: `ARCHITECT`, `DISPATCHER`, or `IMPLEMENTATION_WORKER`. If none of these roles matches the assignment, stop and report. `ARCHITECT` is reserved for the external ChatGPT Architect. A Codex agent must not claim that role or act as an independent verdict producer.

## ARCHITECT — external ChatGPT only

The external ChatGPT Architect is the sole Architect and the sole producer of `ARCHITECT_VERDICT_V1`. The Architect may read only the material needed for the current planning or review assignment, including:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. `docs/agent/00-task-board.md`;
4. `docs/agent/dispatcher/**`;
5. Task Cards relevant to the current planning or review assignment;
6. exact Accepted Contracts relevant to that assignment;
7. code and PR evidence directly relevant to planning or exact-head review.

The Architect may:

- plan a Development Pack and split it into bounded Task Cards;
- define each task's `depends_on` and predefined `next_task`;
- create or update the canonical queue, marking only the first eligible task `READY` and keeping later tasks `DEFERRED`;
- perform external exact-current-head PR review;
- publish `ARCHITECT_VERDICT_V1` and `ARCHITECT_RECOVERY_V1`;
- decide `PASS`, `REQUEST_CHANGES`, or `PRODUCT_AMBIGUITY` from the authorized product goal, Accepted Contracts, Task Card and durable evidence;
- stop at an Owner Checkpoint and request Product Owner acceptance.

The Architect must not:

- implement business code or act as the Implementation Worker;
- bypass the Dispatcher to execute a complete Development Pack;
- merge an implementation PR, mark an implementation task `DONE`, or launch a luna-high Worker;
- change product meaning without Product Owner authorization;
- choose a deferred production provider, model, embedding, budget or data policy without an Accepted Contract or Product Owner decision;
- infer or create a successor after `next_task: null` without a newly authorized Development Pack.

The external ChatGPT Architect plans and reviews; it does not perform the Dispatcher's mechanical lifecycle or the Worker's implementation.

## Codex Architect Context Generator — non-decision function

Codex has no independent Architect role. When a Codex Dispatcher or Implementation Worker is asked to prepare review material, it may perform only the factual `ARCHITECT_REVIEW_CONTEXT_V1` function within its existing role and assignment.

It may:

- fresh-read and summarize the matching PR identity, exact head, base, Task Card, bounded scope and Accepted Contract identities;
- summarize the exact diff and relevant implementation context;
- run the Task Card's checks and report their observed results;
- create or refresh the factual `ARCHITECT_REVIEW_CONTEXT_V1` review packet.

It must not:

- publish `ARCHITECT_VERDICT_V1` or independently publish `ARCHITECT_RECOVERY_V1`;
- decide or claim `PASS`, `REQUEST_CHANGES` or `PRODUCT_AMBIGUITY`;
- decide merge eligibility, merge a PR, mark a task `DONE`, block a task, or unlock a successor;
- change an Accepted Contract, product meaning, Task Card scope, queue topology or governance rules;
- present `ARCHITECT_REVIEW_CONTEXT_V1`, CI status, PR state or its own factual analysis as a verdict.

`ARCHITECT_REVIEW_CONTEXT_V1` is non-authoritative review input. It does not add a reviewer, a review gate or a decision source. Only the external ChatGPT Architect's exact-current-head `ARCHITECT_VERDICT_V1` can authorize the Dispatcher to repair or merge through the existing transition contract.

## DISPATCHER

Read only:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. `docs/agent/00-task-board.md`;
4. `docs/agent/dispatcher/dispatcher-state.json` and `transition-contract.md`;
5. the selected Task Card.

Assume one Dispatcher and one sequential queue. The Dispatcher's mechanical behavior is governed by `docs/agent/dispatcher/transition-contract.md`; this summary never overrides or weakens that Accepted durable contract.

In particular, the Dispatcher must:

- fresh-read `origin/main` before canonical queue and Task Card decisions;
- prefer GitHub durable facts over a stale local projection;
- reconcile against the exact current PR head and the latest valid current-head `ARCHITECT_VERDICT_V1`;
- on `PASS`, merge and verify successful main CI before marking the task `DONE`;
- on `REQUEST_CHANGES`, return the same task and PR to bounded repair;
- unlock only a predefined `next_task`;
- leave Architect review to the external ChatGPT Architect.

The Dispatcher does not validate reviewer identity, review URL/id or GitHub native review state and has no revision, compare-and-swap or transactional/atomic queue semantics. These omissions do not waive exact-head, durable-verdict, merge or main-verification requirements in `transition-contract.md`.

The Dispatcher mechanically starts the first eligible `READY` task and launches the Task Card's worker profile. When durable Worker handoff identifies a PR, it binds the PR, enters `REVIEW` and stops for external ChatGPT Architect review. It consumes that external Architect's verdict only through the accepted transition contract. A Codex-produced `ARCHITECT_REVIEW_CONTEXT_V1` is never a verdict.

The Dispatcher must not design or split tasks, change architecture or product behavior, edit an Accepted Contract, choose a deferred item, expand scope, infer an ambiguous transition, or approve a review gate.

## Role sequence

The normal role sequence is:

1. The external ChatGPT `ARCHITECT` plans the Development Pack and Task Cards, predefines queue topology, and marks only the first eligible task `READY`.
2. `DISPATCHER` mechanically executes `READY` and launches the declared `IMPLEMENTATION_WORKER`.
3. `IMPLEMENTATION_WORKER` implements only the current Task Card, places factual `ARCHITECT_REVIEW_CONTEXT_V1` material in the PR, hands off at `REVIEW`, and does not plan, approve or merge.
4. The external ChatGPT `ARCHITECT` reviews the exact current head and is the only actor that publishes `ARCHITECT_VERDICT_V1`.
5. `DISPATCHER` consumes that verdict, applies the existing repair-or-merge transition, verifies main, synchronizes stage state, and advances only the predefined `next_task`.

## IMPLEMENTATION_WORKER

Default reading is intentionally bounded:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. the current Task Card;
4. only the exact Accepted Contracts and small set of code files named by that card.

Do not default-read `00`–`10`, history, reviews, handoffs, conflict logs, all task cards, or the full repository. A Task Card may explicitly add a narrow reference when needed.

The worker implements only the current card. It must not:

- alter P1–P6 responsibilities;
- plan or unlock the next task;
- modify an Accepted Contract;
- expand scope or add product behavior;
- add core infrastructure or an agent framework;
- decide deferred provider/model/embedding/budget choices;
- refactor unrelated modules;
- claim `PASS`, `DONE`, or merge authority.

For internal details that do not change product behavior or architecture, use the smallest implementation consistent with existing style. Product or architecture ambiguity means `STOP + REPORT`; set `BLOCKED / PRODUCT_AMBIGUITY`, without guessing.

For an ordinary Implementation Task, do not run iteration-coach and do not create an additional internal Reviewer by default. The external ChatGPT Architect's PR review is the default independent review. Upgrade only when the Product Owner or external ChatGPT Architect explicitly requests it.

## Authority and conflict

Authority is role-scoped rather than a licence for one file to overwrite another:

1. Current Task Card controls task identity, goal, allowed scope/files, inputs, tests, completion and entry/exit gates.
2. Exact Accepted Machine/Module Contracts control behavior, invariants, ownership and machine semantics. A Task Card never overrides an Accepted Contract.
3. `AI-DEVELOPMENT-CURRENT.md` controls current phase, frozen decisions and active/deferred boundaries.
4. Stable product/architecture specs (`00`–`10`) provide broader reference.
5. Historical tasks, PRs, reviews and handoffs are evidence only.

Any contradiction among levels 1–4 that cannot be resolved mechanically is `BLOCKED / PRODUCT_AMBIGUITY`. The Architect, Worker and Dispatcher stop and report the exact files/identities within their respective authority; they do not choose the convenient interpretation.

## Non-negotiable repository safeguards

- Never overwrite original audio, transcript, speaker evidence or consent records.
- AI failure must not stop recording; ASR failure must not damage original audio.
- AI conclusions must trace to finalized transcript evidence.
- Do not commit real secrets, real interview media/transcripts or unredacted personal data.
- Do not treat candidate or placeholder contracts as Accepted Contracts.
- Do not touch `.codex/iteration-learning.md`.

## Review and governance cadence

Normal work reaches `REVIEW` when the Worker reports a PR number and provides the factual review context, then stops for external ChatGPT Architect exact-head review. Review context does not decide or authorize anything. `REQUEST_CHANGES` from the external ChatGPT Architect returns the same task and PR to the same bounded scope. Only that external Architect's exact-current-head `PASS` authorizes the Dispatcher to merge and verify main; only successful merge and main verification can produce `DONE` and then unlock a predefined `next_task`.

Do not create a per-task REV file, handoff file, traceability update, conflict-history update or ADR by default. Use Task Card + PR as the handoff. Update ADR only for a real architecture decision; maintain current open conflicts separately; batch traceability and historical indexes at stage end.
