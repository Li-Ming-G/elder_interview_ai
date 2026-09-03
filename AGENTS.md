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
- publish authenticated `ARCHITECT_DIRECTIVE_V1` implementation commands on the configured Architect Command Bus;
- make implementation-only additive amendments to the active task's allowed files, required tests, repair instructions, same-PR handling, stall recovery, or current-Worker relaunch through that protocol;
- decide `PASS`, `REQUEST_CHANGES`, or `PRODUCT_AMBIGUITY` from the authorized product goal, Accepted Contracts, Task Card and durable evidence;
- stop at an Owner Checkpoint and request Product Owner acceptance.

The Architect must not:

- directly implement business code or act as the Implementation Worker; implementation execution authority is exercised only through `ARCHITECT_DIRECTIVE_V1` and the Dispatcher;
- bypass the Dispatcher to execute a complete Development Pack;
- merge an implementation PR, mark an implementation task `DONE`, or launch a luna-high Worker;
- change product meaning without Product Owner authorization;
- choose a deferred production provider, model, embedding, budget or data policy without an Accepted Contract or Product Owner decision;
- infer or create a successor after `next_task: null` without a newly authorized Development Pack.

The Architect plans, reviews, and commands bounded implementation execution. It does not perform the Dispatcher's mechanical lifecycle or the Worker's implementation. A Directive cannot change an Owner-frozen product decision, Accepted Contract, architecture boundary, task identity, `depends_on`/`next_task`, production provider/model/data-policy/cost decision, or another Owner-deferred decision.

## DISPATCHER

Read only:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. `docs/agent/00-task-board.md`;
4. `docs/agent/dispatcher/control-plane.json`, `architect-directive-v1.md`, `dispatcher-state.json`, and `transition-contract.md`;
5. the selected Task Card;
6. the configured Architect Command Bus and current task's applied Directive ACKs.

Assume one Dispatcher and one sequential queue. The Dispatcher's mechanical behavior is governed by `docs/agent/dispatcher/transition-contract.md`; this summary never overrides or weakens that Accepted durable contract.

In particular, the Dispatcher must:

- fresh-read `origin/main` before canonical queue and Task Card decisions;
- prefer GitHub durable facts over a stale local projection;
- reconcile against the exact current PR head and the latest valid current-head `ARCHITECT_VERDICT_V1`;
- before ordinary wait/no-op/repair/verdict/merge handling, validate and execute any fresh, authorized, unconsumed current-task `ARCHITECT_DIRECTIVE_V1` mechanically;
- reconstruct the task's effective execution envelope from its Task Card plus all successful Directive ACK snapshots until the task is `DONE`;
- on `PASS`, merge and verify successful main CI before marking the task `DONE`;
- if a task is projected `BLOCKED / MAIN_VERIFY_FAILED`, every later pulse must re-check the accepted merged PR, current-main applicability/ancestry, and the latest applicable main CI. A later durable `SUCCESS` mechanically clears that blocker: mark the task `DONE`, perform the required three-file stage-end synchronization, and unlock only its predefined `next_task`. This recovery requires no new Architect verdict, no new `ARCHITECT_RECOVERY_V1`, no Worker commit, no new PR, and no new Product Owner signal;
- absence, staleness, or malformation of `ARCHITECT_RECOVERY_V1` is never a reason to no-op when the canonical Task Card plus durable GitHub facts already authorize a transition. If main CI is still failed, pending, missing, or task applicability/ancestry cannot be proven, remain blocked/wait and retry on the next pulse;
- on `REQUEST_CHANGES`, return the same task and PR to bounded repair;
- unlock only a predefined `next_task`;
- leave Architect review to the external Architect.

The Dispatcher does not validate reviewer identity, review URL/id or GitHub native review state and has no revision, compare-and-swap or transactional/atomic queue semantics. These omissions do not waive exact-head, durable-verdict, merge or main-verification requirements in `transition-contract.md`.

The Dispatcher mechanically starts the first eligible `READY` task and launches the Task Card's worker profile. A valid Directive may also recover an authorized current `BLOCKED` task to `IN_PROGRESS` or relaunch the current Worker without creating a task or changing topology. When durable Worker handoff identifies a PR, the Dispatcher binds the PR, enters `REVIEW` and stops for external Architect review. It consumes Directives, Review Context, and verdicts only through the accepted durable contracts.

The Dispatcher must not design or split tasks, judge the Architect's technical choice, change architecture or product behavior, edit an Accepted Contract, choose a deferred item, invent scope, infer an ambiguous transition, or approve a review gate. Mechanical application of a valid additive Directive is not Dispatcher-authored scope expansion.

A Dispatcher **pulse** may stop, but the persistent Dispatcher schedule/heartbeat must remain installed. `NO_READY_TASK`, `REVIEW`, `BLOCKED`, `DEFERRED`, `DONE`, `next_task: null`, or an Owner Checkpoint ends only the current bounded pulse; none of them authorizes the Dispatcher or any Codex agent to disable or delete the dispatcher-loop schedule/heartbeat. Only the Product Owner may explicitly disable or delete that persistent execution loop.

## Role sequence

The normal role sequence is:

1. external/web `ARCHITECT` plans the Development Pack and Task Cards, predefines queue topology, marks only the first eligible task `READY`, and may issue bounded implementation-only Directives for the current task.
2. Codex `DISPATCHER` mechanically executes `READY` or a valid current-task Directive, computes the effective execution envelope, launches the declared `IMPLEMENTATION_WORKER`, binds its PR/handoff, enters `REVIEW`, consumes external `ARCHITECT_VERDICT_V1`, merges and verifies main, synchronizes stage state, and advances only the predefined `next_task`.
3. Codex `IMPLEMENTATION_WORKER` implements only the effective execution envelope, hands off its PR at `REVIEW`, and does not plan, approve or merge.

Operationally this is a two-side loop: the web side owns architecture/planning/review; the Codex side owns dispatch/implementation.

## IMPLEMENTATION_WORKER

Default reading is intentionally bounded:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. the current Task Card;
4. all applied `ARCHITECT_DIRECTIVE_V1` ACK snapshots and the current Directive, if any;
5. only the exact Accepted Contracts and small set of code files named by the effective execution envelope.

Do not default-read `00`–`10`, history, reviews, handoffs, conflict logs, all task cards, or the full repository. A Task Card may explicitly add a narrow reference when needed.

The worker implements only the effective execution envelope: the base Task Card plus every valid applied Directive overlay for that task. A file is authorized when it is in the base Task Card or a successful Directive ACK's additive file snapshot. The same union applies to required tests and remains authoritative across repair Workers and new heads until `DONE`.

The Task Card header `Status:` is an issuance/planning snapshot, not runtime state. Freshly reconciled canonical queue/state is runtime authority. Therefore `Status: DEFERRED` on the card plus canonical runtime `IN_PROGRESS` is not `PRODUCT_AMBIGUITY` and must not make the Worker refuse execution.

The worker must not:

- alter P1–P6 responsibilities;
- plan or unlock the next task;
- modify an Accepted Contract;
- expand scope beyond the effective envelope or add product behavior;
- add core infrastructure or an agent framework;
- decide deferred provider/model/embedding/budget choices;
- refactor unrelated modules;
- claim `PASS`, `DONE`, or merge authority.

For internal details that do not change product behavior or architecture, use the smallest implementation consistent with existing style. Product or architecture ambiguity means `STOP + REPORT`; set `BLOCKED / PRODUCT_AMBIGUITY`, without guessing.

For an ordinary Implementation Task, do not run iteration-coach and do not create an additional internal Reviewer by default. The external Architect's PR review is the default independent review. Upgrade only when the Product Owner or Architect explicitly requests it.

## Authority and conflict

Authority is role-scoped rather than a licence for one file to overwrite another:

1. Product Owner decisions and exact Accepted Machine/Module Contracts control product behavior, invariants, ownership, architecture boundaries, and reserved provider/model/data-policy/cost decisions. Neither a Task Card nor a Directive can override them.
2. Current Task Card controls base task identity, goal, allowed scope/files, inputs, tests, dependencies, completion, entry/exit gates, and immutable `depends_on`/`next_task` topology.
3. Successful current-task `ARCHITECT_DIRECTIVE_V1` ACK snapshots add implementation files, tests, and bounded execution instructions. They cannot replace or subtract Task Card fields or change anything controlled by level 1 or task identity/topology at level 2.
4. Freshly reconciled canonical queue/state controls runtime status. Task Card `Status:` never overrides it.
5. `AI-DEVELOPMENT-CURRENT.md` controls current phase, frozen decisions and active/deferred boundaries.
6. Stable product/architecture specs (`00`–`10`) provide broader reference.
7. Historical tasks, PRs, reviews and handoffs are evidence only.

The effective execution envelope is the base Task Card plus every valid applied Directive overlay. Additive union is mechanically resolvable; a historical card-header status mismatch is not a contradiction. Any other contradiction among levels 1–6 that cannot be resolved mechanically is `BLOCKED / PRODUCT_AMBIGUITY`. The Architect, Worker and Dispatcher stop and report the exact files/identities within their respective authority; they do not choose the convenient interpretation.

## Non-negotiable repository safeguards

- Never overwrite original audio, transcript, speaker evidence or consent records.
- AI failure must not stop recording; ASR failure must not damage original audio.
- AI conclusions must trace to finalized transcript evidence.
- Do not commit real secrets, real interview media/transcripts or unredacted personal data.
- Do not treat candidate or placeholder contracts as Accepted Contracts.
- Do not touch `.codex/iteration-learning.md`.

## Review and governance cadence

Normal work reaches `REVIEW` when the Worker reports a PR number, then stops for external Architect exact-head review against the effective execution envelope. `REQUEST_CHANGES` or a fresh valid Directive returns the same task and PR to bounded implementation when a PR exists. A successful Directive invalidates earlier Review Context and verdict evidence even before the head changes. An external Architect `PASS` issued after current effective Review Context authorizes the Dispatcher to merge and verify main; only successful merge and main verification can produce `DONE` and then unlock a predefined `next_task`.

Do not create a per-task REV file, handoff file, traceability update, conflict-history update or ADR by default. Use Task Card + PR as the handoff. Update ADR only for a real architecture decision; maintain current open conflicts separately; batch traceability and historical indexes at stage end.
