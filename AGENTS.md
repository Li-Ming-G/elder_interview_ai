# AI development role entry

This repository is the MVP for an AI-assisted elder interview system. Every agent first declares one role: `DISPATCHER` or `IMPLEMENTATION_WORKER`. If neither role matches the assignment, stop and report `DISPATCH_ROLE_UNSUPPORTED`.

## DISPATCHER

Read only:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. `docs/agent/00-task-board.md`;
4. `docs/agent/dispatcher/dispatcher-state.json` and `transition-contract.md`;
5. the selected Task Card.

The Dispatcher may mechanically select one `READY` task, verify dependencies, claim it once with the expected state revision, launch the Task Card's declared worker profile, and record the run/thread. Before `REVIEW`, it requires repository owner/name, PR number/URL, exact head and passing test/CI evidence bound to that head, then stops. It may apply only complete external evidence for `PASS`, `REQUEST_CHANGES`, `BLOCKED`, or `PRODUCT_AMBIGUITY`: reviewer identity, review URL/id, outcome and reviewed exact head. Every successful write increments the multi-task snapshot revision exactly once.

The Dispatcher must not design or split tasks, change architecture or product behavior, edit an Accepted Contract, choose a deferred item, expand scope, infer an ambiguous transition, or approve a review gate.

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

For internal details that do not change product behavior or architecture, use the smallest implementation consistent with existing style. Product or architecture ambiguity means `STOP + REPORT`; set `BLOCKED` with the stable error code, without guessing.

## Authority and conflict

Authority is role-scoped rather than a licence for one file to overwrite another:

1. Current Task Card controls task identity, goal, allowed scope/files, inputs, tests, completion and entry/exit gates.
2. Exact Accepted Machine/Module Contracts control behavior, invariants, ownership and machine semantics. A Task Card never overrides an Accepted Contract.
3. `AI-DEVELOPMENT-CURRENT.md` controls current phase, frozen decisions and active/deferred boundaries.
4. Stable product/architecture specs (`00`–`10`) provide broader reference.
5. Historical tasks, PRs, reviews and handoffs are evidence only.

Any contradiction among levels 1–4 that cannot be resolved mechanically is `BLOCKED / DISPATCH_AUTHORITY_CONFLICT`. The worker and Dispatcher stop and report the exact files/identities; they do not choose the convenient interpretation.

## Non-negotiable repository safeguards

- Never overwrite original audio, transcript, speaker evidence or consent records.
- AI failure must not stop recording; ASR failure must not damage original audio.
- AI conclusions must trace to finalized transcript evidence.
- Do not commit real secrets, real interview media/transcripts or unredacted personal data.
- Do not treat candidate or placeholder contracts as Accepted Contracts.
- Do not touch `.codex/iteration-learning.md`.

## Review and governance cadence

Normal work reaches `REVIEW` only with required exact-head tests and a real repository-bound PR, then stops for external review. The review gate is mandatory. `REQUEST_CHANGES` preserves the exact-head review history and returns the same task to the same bounded scope. Only exact-head external `PASS` can produce `DONE` and atomically unlock a predefined `next_task`.

Do not create a per-task REV file, handoff file, traceability update, conflict-history update or ADR by default. Use Task Card + PR as the handoff. Update ADR only for a real architecture decision; maintain current open conflicts separately; batch traceability and historical indexes at stage end.
