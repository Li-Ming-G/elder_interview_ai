# AI development role entry

This repository is the MVP for an AI-assisted elder interview system. Every agent first declares one role: `DISPATCHER` or `IMPLEMENTATION_WORKER`. If neither role matches the assignment, stop and report.

## DISPATCHER

Read only:

1. `AGENTS.md`;
2. `AI-DEVELOPMENT-CURRENT.md`;
3. `docs/agent/00-task-board.md`;
4. `docs/agent/dispatcher/dispatcher-state.json` and `transition-contract.md`;
5. the selected Task Card.

Assume one Dispatcher and one sequential queue. The Dispatcher mechanically starts the first eligible `READY` task and launches the Task Card's worker profile. When the worker reports a PR number, store that number, set `REVIEW` and stop. The external Architect performs the actual PR review. On external `PASS`, mark current `DONE`, then mark only its predefined `next_task` `READY`; on `REQUEST_CHANGES`, return the same task to `IN_PROGRESS`.

The Dispatcher does not validate reviewer identity, review URL/id, GitHub review state, PR exact head or CI evidence. It has no revision, compare-and-swap or transactional/atomic queue semantics.

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

For internal details that do not change product behavior or architecture, use the smallest implementation consistent with existing style. Product or architecture ambiguity means `STOP + REPORT`; set `BLOCKED / PRODUCT_AMBIGUITY`, without guessing.

For an ordinary Implementation Task, do not run iteration-coach and do not create an additional internal Reviewer by default. The external Architect's PR review is the default independent review. Upgrade only when the Product Owner or Architect explicitly requests it.

## Authority and conflict

Authority is role-scoped rather than a licence for one file to overwrite another:

1. Current Task Card controls task identity, goal, allowed scope/files, inputs, tests, completion and entry/exit gates.
2. Exact Accepted Machine/Module Contracts control behavior, invariants, ownership and machine semantics. A Task Card never overrides an Accepted Contract.
3. `AI-DEVELOPMENT-CURRENT.md` controls current phase, frozen decisions and active/deferred boundaries.
4. Stable product/architecture specs (`00`–`10`) provide broader reference.
5. Historical tasks, PRs, reviews and handoffs are evidence only.

Any contradiction among levels 1–4 that cannot be resolved mechanically is `BLOCKED / PRODUCT_AMBIGUITY`. The worker and Dispatcher stop and report the exact files/identities; they do not choose the convenient interpretation.

## Non-negotiable repository safeguards

- Never overwrite original audio, transcript, speaker evidence or consent records.
- AI failure must not stop recording; ASR failure must not damage original audio.
- AI conclusions must trace to finalized transcript evidence.
- Do not commit real secrets, real interview media/transcripts or unredacted personal data.
- Do not treat candidate or placeholder contracts as Accepted Contracts.
- Do not touch `.codex/iteration-learning.md`.

## Review and governance cadence

Normal work reaches `REVIEW` when the worker reports a PR number, then stops for external Architect review. `REQUEST_CHANGES` returns the same task to the same bounded scope. Only external Architect `PASS` can produce `DONE` and then unlock a predefined `next_task`.

Do not create a per-task REV file, handoff file, traceability update, conflict-history update or ADR by default. Use Task Card + PR as the handoff. Update ADR only for a real architecture decision; maintain current open conflicts separately; batch traceability and historical indexes at stage end.
