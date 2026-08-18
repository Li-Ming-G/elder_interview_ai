# Handoff｜MEMORY-T5-T8-P2-A1-SEMANTIC-ENVELOPE-001

状态：`REVIEW / CONTRACT ONLY / LOCAL PASS / NOT ACCEPTED`

## 当前接收对象

- branch：`codex/memory-p2-a1-semantic-envelope-001`；
- base/main：`00953acadb8edabefe0e59a9c570af745d22100b`；
- review：REV-063；
- ADR：ADR-052；
- mapping：T5-T8/P2，T0 reference-only；P1 accepted upstream，P3/P4/P5 未启动，P6 runtime 后置。

## Correction 后的路线

P2-B 不直接承接 P2-A 进入 persistence。先由 A1 冻结：

```text
transient Context -> SemanticProposal -> validated transient plan -> committed bridge
```

`MemoryClaim/Resolution` 始终是唯一 semantic authority；Long/layer/Trace/log 只保存引用。LLM 只提出 proposal，程序负责验证；A1 不写库、不运行 CAS/transaction，也不选择真实 provider/model。

## 当前候选

候选工作树中已有 semantic envelope contract/Schema/fixtures/pure validator/tests 与必要 `04/05/07/08/09/10` 契约语义同步。首次独立 implementation review 返回 `FAIL / P0=0/P1=3/P2=2`；不得据局部测试写 PASS/DONE。

三项 P1：source/claim/evidence provenance 子图未闭合；authority revision/slot/state parity 不完整；Long final Mid/current manifest/checkpoint/source-set 证明不足。两项 P2：canonical/digest golden 覆盖不足；task card 与已授权 `04/05/07/08/09/10` 同步范围矛盾。

第二项 P2 已按最新更具体授权修正：A1 允许仅为 machine contract 对齐而必要同步 `04/05/07/08/09/10`，但继续禁止 runtime、Prisma、migration、provider activation 或新产品含义。无需 conflict log；首次 finding 永久保留。

第二轮定向 re-review 继续为 `FAIL / P0=0/P1=2/P2=1`。两项 P1：不同 source ref 可重复引用同一 durable Resolution authority；proposal/commit evidence uniqueness 与跨 claim evidence 复用语义冲突。一项 P2：上述修复仍缺完整 tamper 回归。

总控裁决：同一 evidence 可以支持多个 claim；唯一性按 `(claim_ref, evidence_ref)` pair，proposal/commit pair 集合必须完整一致；Context transcript segment membership 仍唯一。该裁决是修复语义，不构成 finding 已关闭或 PASS。

第三次审查（第二次定向 re-review）仍为 `FAIL / P0=0/P1=2/P2=0`。两项 P1：projection 范围内 target/CAS/committed Resolution ID 未唯一；MemoryEvidence ID 只在单 entry 内唯一、未在整个 projection 失败关闭。前两轮历史、evidence pair 裁决与 `REVIEW` 状态不变。

第四次审查（第三次定向 re-review）对当前 dirty contract candidate 给出本地 `PASS / P0=0/P1=0/P2=0`；定向矩阵 `138/138`、适用 static checks 通过。前三轮 FAIL 永久保留。本地 PASS 不等于 GitHub exact-head review、CI、merge、项目负责人 acceptance 或 DONE；A1 继续 `REVIEW`，B/C/D 不解锁。

## 后续门禁

1. A1 完成 docs/Schema/fixtures/pure validators/loaders/tests 与本地验证；
2. A1 exact-head 独立审查并由项目负责人正式接收；
3. 接收后另立 P2-B persistence；
4. B 后再进入 P2-C adversarial runtime；
5. C 后才讨论 P2-D real provider/data gate。

真实 LLM provider/model、真实 embedding model、P4 budget、真实数据/授权/公网/生产继续 `DEFERRED/BLOCKED`。

## 历史保留

- PR #69 / REV-061 的全部失败、REQUEST_CHANGES、中间治理意见与 contract-only PASS 不变。
- PR #70 / REV-062 的四轮 REQUEST_CHANGES、accepted exact head 与 main CI infra exception 不变。
- `.codex/iteration-learning.md` 不在本治理任务获准目录且属于用户文件，未修改。
