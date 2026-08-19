# 审查归档索引

MEMORY-T0-TRACE 使用 [`REV-057`](REV-057.md) 永久记录 PR #63 两轮定向 `REQUEST_CHANGES`：`b34000a6` / CI `31922715469` P1=5，以及 `b137b44` / CI `31924593302` P1=5。当前仅形成五项 P1 修复候选，继续 REVIEW，等待项目负责人绑定新 exact head/CI 复审。

DEV-ASR-PROVIDER-001 的 [`REV-055`](REV-055.md) 永久分层记录 accepted content `5271b52` / CI `31800257197` / 项目负责人 PASS，latest-main integration `27f1c84` / CI `31824839261` / 正式 PASS 评论 `5296422732` / P0/P1/P2=0，以及 implementation merge/main `dd45f5e` / CI `31825548551` SUCCESS；旧 `af99d91` 外部虚构证据与所有失败历史继续按原 head 保留。

历史审查正文集中保存在 [`04-review-report-history.md`](04-review-report-history.md)，包含 `REV-001` 至 `REV-049`、SPEC-LLM-PROVIDER-001 的 canonical `REV-051（branch-local REV-050）` 及 REV-052/053；REV-047 至 REV-049 的旧失败与 accepted 历史不变。DEV-008B1 使用单篇 [`REV-050`](REV-050.md)，accepted 内容已 PASS/merge 并完成治理收口；REV-051 至 REV-053 分别永久保留各自 old/content/integration/PASS/merge/CI 与范围边界。DEV-008B2 使用单篇 [`REV-054`](REV-054.md)，并保留其 branch-local REV-052 历史。当前有效结论只看上一级的 [`04-review-report.md`](../04-review-report.md)。

后续若单篇拆分归档，文件名使用 `REV-XXX.md`，并在此处登记范围、结论和替代关系。

REV-052 记录 PR #54：old `195c4be2` / CI `31798730203` REQUEST_CHANGES（P1=1）与 accepted `64cf94f3` / CI `31808762082` PASS（P0/P1/P2=0）均永久保留；merge `751a32e1` / main CI `31815415871` SUCCESS。只接收 staging docs/machine contract。

REV-053 记录 PR #55：content `0101837` / CI `31798421917` 与 integration `d67dd12d` / CI `31816652463` 均获项目负责人 PASS（P0/P1/P2=0）；merge/main `8bcf65b2` / main CI `31817732960` SUCCESS。branch-local ADR-041 alias、REV-007/`ab9628b` REVIEW 与所有旧失败永久保留；只接收应用身份/会话和 direct-peer seam，不接收 trusted ingress 或公网部署。

REV-054 记录 PR #56 DEV-008B2（branch-local REV-052）：old `0e703af` / CI `31800324817` REQUEST_CHANGES P1=3 与 next `996994f` / CI `31812498482` REQUEST_CHANGES P1=1 永久保留；accepted `90ce5b35` / CI `31820768146` 获临时授权总控独立 PASS（P0/P1/P2=0），merge/main `4b59c4d3` / CI `31821662034` SUCCESS。DONE 仅限 fail-closed/provider-neutral 范围。

MEMORY-T0-TRACE final closeout: REV-058 records independent PASS for `40cc61e12ef63096474fe63b69463920f2d6a7c4` / CI `31936839303`, merge/main `a9363dcd` / CI `31937348480` SUCCESS. Old REQUEST_CHANGES heads and all failure history remain immutable. PASS is limited to T0 / Foundation-Observability reference-only implementation; P1-P6 producers, real provider/data/public deployment remain blocked.

MEMORY-T2-T4-CORE-001: [`REV-059`](REV-059.md) records independent PASS for PR #65 exact head `7d0a0460` / CI `31941029795`, merge/main `081b404e` / main CI `31989367027` SUCCESS. PASS is limited to the candidate/local seam; formal T2/T4 authority and durable runtime remain separate.

MEMORY-T2-T4-CONTRACT-001: PR #66 exact head `224445064613cb2abd24a7c761052b7679bbcbd6` / CI `31994482841` received independent PASS (P0/P1/P2=0) in comment `5312635580`, then merged as `27e8d8d6aaa523b3298b5d64f6f27240696c542c` with main CI `32001983350` SUCCESS. This accepted history remains immutable. A later pre-runtime independent audit returned `Correction`; therefore v1 is `accepted-history/pre-runtime-superseded`, not runtime-loadable, and MEMORY-T2-T4-CONTRACT-002/v1.1 is REVIEW. No new PASS or review ID is claimed by the implementation Agent.

MEMORY-T2-T4-CONTRACT-002 / PR #67 old exact head `fdd309a97e5979b092f1ef094f62c1eaecf47071` / CI `32004656762` SUCCESS received formal `REQUEST_CHANGES` in comment `5313116887` (P0=0/P1=2/P2=1). Accepted exact head `02706534d1aa9094699d991ae3584edb651560a8` / CI `32006749030` then received formal PASS in comment `5313281208`, merged as `d48e022a5e3a6ed7fde5beb11b9c214f2509c9ae`, with main CI `32007442074` SUCCESS. Both old and accepted histories are permanent; PASS is contract-only.

MEMORY-T2-T4-RUNTIME-001: [`REV-060`](REV-060.md) permanently records PR #68 old `4bda58c` / CI `32017818045` and initial P1=4, plus `7f5a413` / CI `32021995353` re-review comment `5315170627`: original four findings CLOSED, one adjacent detached-reader P1 OPEN. The final profile-strict reader/eligibility fix at `f55da95` received PASS in comment `5315324044`, then merged as `58794c4` with main CI `32024183820` SUCCESS; old findings remain permanent.

MEMORY-T5-T8-P2-A-CONTRACT-001: [`REV-061`](REV-061.md) permanently records PR #69 lint failure, `8d48cd5` / CI `32028717254` REQUEST_CHANGES P1=5, `bd299fb` / CI `32037158715` REQUEST_CHANGES P1=4, intermediate code/governance reviews, and final accepted `042ec56f` / CI `32042589647` / PASS `5317377208`; merge/main `d50e5688` / CI `32042952178` SUCCESS. PASS is contract-only.

MEMORY-T4-P1-SEMANTIC-TRIGGER-001: [`REV-062`](REV-062.md) permanently records four `REQUEST_CHANGES` rounds: P1=3/P2=3, P1=2, P1=2, then P1=1. PR #70 accepted `cc2b82d` / CI `32161806857` with formal PASS P0=P1=P2=0, then merged as main `00953ac`; accepted/main tree is `033d3a9b`. Main CI `32165583907` attempt 1 was cancelled after 20m in E2E install and was not rerun; it is not SUCCESS. DONE is limited to accepted v1.2 scope.

MEMORY-T5-T8-P2-A1-SEMANTIC-ENVELOPE-001: [`REV-063`](REV-063.md) records PR #71 formal `REQUEST_CHANGES` on head `258eb46d` / CI `32177083890` / [comment `5333195637`](https://github.com/Li-Ming-G/elder_interview_ai/pull/71#issuecomment-5333195637), including canonical_key 240-vs-200 and code-point/UTF-16 drift. The narrow fix uses `Array.from`; 120/121/240/241 emoji and mixed boundaries, core+adversarial `159/159`, and static checks pass. Final dirty-candidate local review is `P0=P1=P2=0`, not GitHub acceptance/new CI/merge/DONE. Earlier FAIL/local PASS history remains permanent; status REVIEW.

2026-08-18 Memory System V1 product-decision sync is recorded in ADR-051 and the product-decision handoff. It does not replace REV-058-063 history. The parent SPEC remains REVIEW while A1 is reviewed.
