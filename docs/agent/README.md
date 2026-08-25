# AI development document index

The default path is deliberately small. Historical evidence remains traceable but is not worker context.

## ACTIVE

- [`../../AI-DEVELOPMENT-CURRENT.md`](../../AI-DEVELOPMENT-CURRENT.md): current phase, frozen decisions and stop conditions.
- [`00-task-board.md`](00-task-board.md): compact human-readable task index.
- [`dispatcher/dispatcher-state.json`](dispatcher/dispatcher-state.json): single Dispatcher sequential queue.
- [`dispatcher/README.md`](dispatcher/README.md): minimal transitions, launch profile, factual Review Context handoff and external ChatGPT Architect review entry.
- [`tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md`](tasks/MEMORY-T5-T8-P2-C-RUNTIME-001.md): current blocked Task Card.

## STABLE REFERENCE

- Root `00`–`10` formal product, architecture, data, API, AI, security and test specifications.
- `docs/contracts/` Accepted Machine/Module Contracts. Exact accepted commit identity must be named by a Task Card; a filename alone is insufficient.
- Formal prompts and question-bank assets explicitly named by a Task Card.

## ARCHIVE

- [`archive/README.md`](archive/README.md): classification and snapshot index.
- `tasks/`, `handoffs/`, `reviews/`, conflict history and governance records are historical by default and remain at their existing paths. Only a current Task Card can make a specific file active.
- The governance handoff does not bulk-move historical files.

## Update cadence

- Per transition: machine state, compact board and current summary when materially affected.
- Per normal task: Task Card + GitHub PR are the handoff; no duplicate REV or handoff document is required.
- Ordinary Implementation Task: no default iteration-coach or additional internal Reviewer; factual `ARCHITECT_REVIEW_CONTEXT_V1` is prepared without a decision, and external ChatGPT Architect PR review is the sole verdict source unless the Product Owner explicitly changes governance.
- Stage end: batch requirement traceability, resolved conflict history, review/handoff indexes and other historical summaries.
- ADR: only when a real architecture decision is made.
- Open conflict: keep a short current entry; archive the full history.
