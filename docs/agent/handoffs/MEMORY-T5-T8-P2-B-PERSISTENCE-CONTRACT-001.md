# MEMORY-T5-T8-P2-B-PERSISTENCE-CONTRACT-001 交接

当前停点：`REVIEW / NOT ACCEPTED / CONTRACT ONLY`，基线 `main@7d02fa65e283472f87c52fcae12b332d18e85ec4`。候选五个 contract 文件尚未 commit/push/建 PR/跑远端 CI；不得把它们描述为已实现 Prisma、migration 或 persistence runtime。

本轮本地证据：`memory-persistence-contract.spec.ts` 定向 `34/34`；API typecheck、目标 ESLint、Prettier、JSON parse、`git diff --check` 通过。全量 unit 为 `78 files / 800 passed / 1 failed`，唯一失败是既有 `apps/web/src/interview/workbench-shell.spec.tsx` 的 completed-heading focus timing assertion，未改产品或测试目标；用户原有 `.codex/iteration-learning.md` 保留且未触碰。

已知旧审查 `REV-063` adversarial `P0=0/P1=6/P2=1` 历史不改写。本轮修复了 Schema-first validation、checkpoint/revision/Long job parity、typed FK allowlist、identity+revision 唯一、Claim evidence authority/manifest/bridge 闭环、retry provenance/cycle/lifecycle 以及单一 Long target 集合；独立最终 re-review 为 `Clear`。仍等待项目负责人 exact-head 审查，不进入 P2-C，不接真实 provider/model/secret/data。
