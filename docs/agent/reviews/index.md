# 审查归档索引

历史审查正文集中保存在 [`04-review-report-history.md`](04-review-report-history.md)，包含 `REV-001` 至 `REV-049`、SPEC-LLM-PROVIDER-001 的 canonical `REV-051（branch-local REV-050）` 及 REV-052/053；REV-047 至 REV-049 的旧失败与 accepted 历史不变。DEV-008B1 使用单篇 [`REV-050`](REV-050.md)，accepted 内容已 PASS/merge 并完成治理收口；REV-051 至 REV-053 分别永久保留各自 old/content/integration/PASS/merge/CI 与范围边界。DEV-008B2 使用单篇 [`REV-054`](REV-054.md)，并保留其 branch-local REV-052 历史。当前有效结论只看上一级的 [`04-review-report.md`](../04-review-report.md)。

后续若单篇拆分归档，文件名使用 `REV-XXX.md`，并在此处登记范围、结论和替代关系。

REV-052 记录 PR #54：old `195c4be2` / CI `31798730203` REQUEST_CHANGES（P1=1）与 accepted `64cf94f3` / CI `31808762082` PASS（P0/P1/P2=0）均永久保留；merge `751a32e1` / main CI `31815415871` SUCCESS。只接收 staging docs/machine contract。

REV-053 记录 PR #55：content `0101837` / CI `31798421917` 与 integration `d67dd12d` / CI `31816652463` 均获项目负责人 PASS（P0/P1/P2=0）；merge/main `8bcf65b2` / main CI `31817732960` SUCCESS。branch-local ADR-041 alias、REV-007/`ab9628b` REVIEW 与所有旧失败永久保留；只接收应用身份/会话和 direct-peer seam，不接收 trusted ingress 或公网部署。

REV-054 记录 PR #56 DEV-008B2（branch-local REV-052）：old `0e703af` / CI `31800324817` REQUEST_CHANGES P1=3 与 next `996994f` / CI `31812498482` REQUEST_CHANGES P1=1 永久保留；accepted `90ce5b35` / CI `31820768146` 获临时授权总控独立 PASS（P0/P1/P2=0），merge/main `4b59c4d3` / CI `31821662034` SUCCESS。DONE 仅限 fail-closed/provider-neutral 范围。
