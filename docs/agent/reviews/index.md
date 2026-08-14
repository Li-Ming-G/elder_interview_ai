# 审查归档索引

历史审查正文集中保存在 [`04-review-report-history.md`](04-review-report-history.md)，包含 `REV-001` 至 `REV-048`；REV-041 同时保留首轮 REQUEST_CHANGES 与 final exact-head 定向接收，REV-042、REV-043 与 REV-044 均同时保留 PENDING 候选与 final exact-head PASS；REV-045 永久保留 DEV-008A2 的两轮 P1、CI flake 与 final exact-head PASS/merge，REV-046 永久保留 DEV-008A3 的 `70b8fe8` REQUEST_CHANGES、`f491d99` 中间修复、final main 整合候选与 accepted exact-head PASS/merge。REV-047 永久保留 DEV-008A4 的多轮 CI/夹具失败、`f1eea3c` 全绿但用户发现缺口、`1f3e7c4` ordinary Chromium 22/27，以及 accepted exact-head `3824da7c` 的项目负责人 PASS/merge；REV-048 永久保留 SPEC-REPEAT-INTERVIEW-001 old head `99e5d31` 的 REQUEST_CHANGES/P1=1、fix `0623b5f` 与 accepted exact head `8d4a2626` 的项目负责人 PASS/merge。当前有效结论只看上一级的 [`04-review-report.md`](../04-review-report.md)。

后续若单篇拆分归档，文件名使用 `REV-XXX.md`，并在此处登记范围、结论和替代关系。
