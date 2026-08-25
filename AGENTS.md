# AI development role entry

This repository is the MVP for an AI-assisted elder interview system. Every agent first declares one role: `ARCHITECT`, `DISPATCHER`, or `IMPLEMENTATION_WORKER`. If none of these roles matches the assignment, stop and report.

Default operating topology is **external/web Architect + Codex execution**. Unless the Product Owner explicitly authorizes a temporary exception, Codex-hosted windows, scheduled tasks and workers may declare only `DISPATCHER` or `IMPLEMENTATION_WORKER`; the `ARCHITECT` role is reserved for the external/web Architect. The existence of the `ARCHITECT` role in this file does not authorize a Codex agent to assume it on its own.

## ARCHITECT

The Architect may read only the material needed for the current planning or review assignment, including:

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

The Architect plans and reviews; it does not perform the Dispatcher's mechanical lifecycle or the Worker's implementation.

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
- leave Architect review to the external Architect.

The Dispatcher does not validate reviewer identity, review URL/id or GitHub native review state and has no revision, compare-and-swap or transactional/atomic queue semantics. These omissions do not waive exact-head, durable-verdict, merge or main-verification requirements in `transition-contract.md`.

The Dispatcher mechanically starts the first eligible `READY` task and launches the Task Card's worker profile. When durable Worker handoff identifies a PR, it binds the PR, enters `REVIEW` and stops for external Architect review. It consumes the Architect's verdict only through the accepted transition contract.

The Dispatcher must not design or split tasks, change architecture or product behavior, edit an Accepted Contract, choose a deferred item, expand scope, infer an ambiguous transition, or approve a review gate.

A Dispatcher **pulse** may stop, but the persistent Dispatcher schedule/heartbeat must remain installed. `NO_READY_TASK`, `REVIEW`, `BLOCKED`, `DEFERRED`, `DONE`, `next_task: null`, or an Owner Checkpoint ends only the current bounded pulse; none of them authorizes the Dispatcher or any Codex agent to disable or delete the dispatcher-loop schedule/heartbeat. Only the Product Owner may explicitly disable or delete that persistent execution loop.

## Role sequence

The normal role sequence is:

1. external/web `ARCHITECT` plans the Development Pack and Task Cards, predefines queue topology, and marks only the first eligible task `READY`.
2. Codex `DISPATCHER` mechanically executes `READY`, launches the declared `IMPLEMENTATION_WORKER`, binds its PR/handoff, enters `REVIEW`, consumes external `ARCHITECT_VERDICT_V1`, merges and verifies main, synchronizes stage state, and advances only the predefined `next_task`.
3. Codex `IMPLEMENTATION_WORKER` implements only the current Task Card, hands off its PR at `REVIEW`, and does not plan, approve or merge.

Operationally this is a two-side loop: the web side owns architecture/planning/review; the Codex side owns dispatch/implementation.

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

For an ordinary Implementation Task, do not run iteration-coach and do not create an additional internal Reviewer by default. The external Architect's PR review is the default independent review. Upgrade only when the Product Owner or Architect explicitly requests it.

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

Normal work reaches `REVIEW` when the Worker reports a PR number, then stops for external Architect exact-head review. `REQUEST_CHANGES` returns the same task and PR to the same bounded scope. An external Architect `PASS` authorizes the Dispatcher to merge and verify main; only successful merge and main verification can produce `DONE` and then unlock a predefined `next_task`.

Do not create a per-task REV file, handoff file, traceability update, conflict-history update or ADR by default. Use Task Card + PR as the handoff. Update ADR only for a real architecture decision; maintain current open conflicts separately; batch traceability and historical indexes at stage end.
