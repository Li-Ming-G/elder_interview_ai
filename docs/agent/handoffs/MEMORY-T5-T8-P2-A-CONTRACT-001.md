# Handoff｜MEMORY-T5-T8-P2-A-CONTRACT-001

状态：`REVIEW`

已完成 P2-A formal docs/schema/fixtures/pure validators/loader and governance updates on `codex/memory-t5-t8-p2-a-contract-001`. PR #68 accepted facts are recorded as low-risk governance closeout: accepted `f55da95`, PASS comment `5315324044`, merge/main `58794c4`, main CI `32024183820`; its T2-T4/P1/T18-T19/P6 scope is closed without implying P2 runtime.

下一审查者需核对：strict schema compilation and format failures; semantic-invalid fixture primary error codes; canonical `[]` digest golden; Long recursive raw-key denial; Trace v1.1 root/readability/trace-kind rules; changed-file diff contains no Prisma/runtime/provider and does not touch `.codex/iteration-learning.md`. Runtime adversarial matrix remains pending.

PR #69 initial exact head `466124058a2358b4afeef6e8433aedf43650ff58` / CI `32028285170` remains recorded as lint-only failure (three non-null assertions). Narrow explicit-guard fix is ready locally; next push/CI is pending. Status remains `REVIEW`.

独立复审已对 `8d48cd5ec25dc6951f4f8a6af07ee93aad027b1a` / CI `32028717254` 给出 `REQUEST_CHANGES`（P0=0/P1=5/P2=0）。本次修正仅补 P2-A machine contract：checkpoint/revision parity、Long Mid manifest parity、Trace membership root provenance、disputed/Boundary/deletion-retention fail-closed 与严格日历时间。未进入 Prisma/runtime/provider/P2-B/C/D/P3/P4；修正完成前保持 REVIEW。

随后 `bd299fb5c315d2907a837362d433aa174ba82075` / CI `32037158715` 的独立复审新增 P1=4：Long 跨 session source set、revision/member ID uniqueness、terminal reference fail-closed、Trace member manifest canonical parity。当前 worktree 正在同一 PR 做第二次窄修，仍不宣称 PASS/DONE/merge。

第二次窄修已冻结为 `fd31cd5587a6feeee888678a26b2c799a373b73f`，exact-head CI `32040317089` SUCCESS；contract tests 45/45、full unit 547/547、typecheck/build/lint/format 全绿。独立复审确认代码 P0=0/P1=0，并要求同步动态索引中的最新 governance head；本批仅更新 board/handoff-log，待其 docs-only exact-head CI 作为最终记录证据，不改变 P2-B/C/D/P3/P4/Prisma/runtime/provider 范围。
