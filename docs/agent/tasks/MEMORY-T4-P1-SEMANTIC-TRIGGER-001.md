# MEMORY-T4-P1-SEMANTIC-TRIGGER-001

状态：`DONE / PASS / ACCEPTED V1.2 SCOPE ONLY`

## 目标

以 forward-only `memory-maintainer-v1.2` 修正已接收 v1.1 的两个相邻 P1，不改写任何既有 contract、fixture、migration 或审查历史：

1. P0 记忆核心只有 `Episode | Fact | Boundary`。`person|relationship|place|event|time|time_range|important_choice|reason_clue|unfinished_story` 只可作为可空 metadata tag，不是 Episode/Fact 的必填分类，也不得参与 semantic identity、dedupe 或 target CAS。
2. `minimumUsefulCharacters` 只按本次实际冻结为 `new` 的 eligible finalized trusted-elder conversation segments 的规范化正文累计计算；不得要求某一个 ASR segment 单独达到阈值。

## T / P 映射

| T | P 层 | 本任务交付 |
|---|---|---|
| T2 | Foundation / Memory Contract | Episode/Fact/Boundary 核心、optional tag、legacy/P1 双 identity |
| T4 | P1 | v1.2 Context/Output、selected-new-batch 累计字符门禁、candidate-only Maintainer |
| T18-T19 | P6 | `memory-p1-v1.2:*` durable identity、历史 v1.1 namespace 兼容、恢复/late fence 不变 |
| T0 | Foundation / Observability | 只记录 trigger、阈值、累计数、ID/revision/digest；不复制 Prompt/Context/Transcript/provider 原文 |

## 范围

- 新增 immutable v1.2 docs、Context/Output Schema、fixtures、纯 semantic validator 与 tests；
- 新增 forward Prisma migration，使既有 `memory_type` 仅作为 nullable legacy/tag 字段；
- legacy rows 继续使用 `memory_type + canonical_key` identity；P1 rows 使用 `semantic_kind + canonical_key` identity；
- runtime/provider/reader/snapshot/Context seam 升级到 v1.2 nullable tag；tag 不参与 slot、target identity 或 CAS；
- 选批后累计 `new` segment 的有效字符，overlap/interviewer/consumed/non-conversation/cap 外内容均不计；
- fresh、latest-main upgrade、v1.1 exact state upgrade、repeat migration 与 adversarial runtime tests；
- 同步 P2-A PR #69 的 accepted/merge/main 事实，但不启动 P2-B。

## 明确不做

- 不实现 T5-T8/P2-B/C/D、P3/P4 新功能、Context V2、Long writer 或新的 focus state machine；
- P1 只理解当前 session，不新增 Long Memory write-side retrieval 或 Long Retrieval Agent；历史 Long 由后续 P3 检索并供 P4/Director 消费；
- 不接真实 provider、secret、真实数据、公网、记忆 UI 或生产试点；
- 不修改 v1/v1.1 Schema、fixtures、migration 或既有 review history；
- 不把 optional tag 变成第二套 value authority，也不新增第二张 Working value 表。

## 实现不变量

1. `semantic_kind=episode|fact` 是 MemoryClaim/Resolution 的 P1 语义身份；Boundary 继续由独立 candidate/revision authority 持有。
2. `memory_tag` 缺失或为 null 是合法 P1 输入/输出和数据库事实；有值时只保存 metadata，不改变 identity、dedupe、revision 或 target eligibility。
3. legacy `semantic_kind IS NULL` 的唯一性继续按既有 `memory_type + canonical_key`；P1 `semantic_kind IS NOT NULL` 按 `semantic_kind + canonical_key`，两者使用互斥 partial indexes。
4. 先稳定选择本次 `new` batch，再对 effective text 做统一 NFKC、移除空白并按 Unicode code point 计数；只有 `(batch OR time OR final_flush) AND cumulative >= minimum` 才能 freeze job。
5. 普通 batch/time 不满足门禁时 provider call、AiJob、snapshot、claim/resolution、consumption 均为 0；overlap 不帮助越过阈值。session final flush 累计仍不足时不得调用 Maintainer，但必须用既有 P6 seam 持久化唯一 deterministic `MEMORY_UNJUDGED` terminal system job，使 opening lane 可终结；该 row 不允许 provider/snapshot/claim/resolution/consumption。
6. 新 job 使用 `memory-p1-v1.2:*`；历史 v1.1 job 保留并可读取，non-maintainer 不得占用任一 Maintainer namespace。
7. 每个 normal 或 final-low-content v1.2 trigger 必须在 Decision Trace 保存 reference-only typed observation：source AiJob/trigger identity、trigger kind、selected-new segment IDs/order/revisions/digests、累计字符、阈值和 membership manifest。Reader 必须从当前 source authority 重算并失败关闭；不得复制 Transcript、Prompt、Context 或 provider payload。

## 验收

- Schema/semantic tests：无 tag Episode/Fact、可选 tag、Boundary 独立、tag 不参与 identity/CAS；
- trigger truth：多个单段均低于阈值但累计达到可触发；batch/time/final-flush 正例与阈值/时机负例；overlap/interviewer/consumed/non-conversation/cap 外/重复不计；NFKC、空白、Unicode code point golden；
- PostgreSQL：fresh、current-main 和 v1.1 state upgrade、legacy byte preservation、untagged P1 insert、legacy/P1 duplicate constraints、repeat deploy/status；
- runtime：普通 not-ready 的 job/provider/业务写入=0；final-flush low-content 的唯一 terminal system job + provider/业务写入=0；freeze/call/writeback drift、replay/recovery/late fence 回归；
- observability：normal/unjudged typed observation、原子 root+membership、missing-trace repair、Reader revision/digest/count/manifest drift 负例与 raw-content denial；
- format/lint/typecheck/build、unit、相关 integration/auth/smoke；
- 独立本地 code review 先于 push。所有 findings 在本地集中修正；只在形成完整 exact-head 候选后运行一次 CI。

## 审查状态

- 前置独立路线审查：`P0=0/P1=2/P2=0`，两项均由本任务的 v1.2 forward contract/runtime 处理。
- 首轮独立实现审查：`REQUEST_CHANGES / P0=0/P1=3/P2=3`。意见为 post-session v1.1 断言漂移、null namespace 未失败关闭、trigger observation 未进入 Decision Trace，以及 v1.1 historical reader、final-low-content 并发恢复、contracts README 三项测试/治理缺口。
- 第二次定向复审：`REQUEST_CHANGES / P0=0/P1=2/P2=0`。旧意见中的五项和 duplicate/concurrent 子项已关闭；仍需让 normal/final-low job 与 Trace 具备 crash durability，并让 final-low trigger suffix 绑定 durable source membership。
- 第三次独立聊天窗口复审仍为 `REQUEST_CHANGES / P0=0/P1=2/P2=0`：final-low scope/inputHash 未与同一 canonical manifest 机械绑定，且 fresh pending/running missing-trace orphan 会被等到 stale grace 后才处理。当时要求集中修复这两项；该轮不构成 PASS。
- 第四次独立聊天窗口复审确认上述两项已关闭，但发现 `P0=0/P1=1/P2=0`：final-low 只校验 `new` 子集，未拒绝 overlap/额外 input/额外 session scope。当时要求修复完整 source-set invariant；该轮不构成 PASS。

本轮本地修复完成后形成 PR #70 accepted exact head `cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66`。exact-head CI `32161806857` SUCCESS，独立正式复审 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/70#issuecomment-5331708714)（P0=P1=P2=0）。merge/main 为 `00953acadb8edabefe0e59a9c570af745d22100b`；accepted head 与 merge/main tree 均为 `033d3a9b2d905c8c758e6784063eae0da405b3bb`。

main CI `32165583907` attempt 1 **不是 SUCCESS**：此前 format、lint、typecheck、unit、migration、integration、auth、build、smoke 均 SUCCESS，E2E job skipped；workflow 在 `pnpm test:e2e:install` 达到 20 分钟上限后 cancelled，且未 rerun。PR exact-head 的 ordinary/auth E2E 均 SUCCESS。该 infra exception 与 tree-equivalence 只支持已接收 v1.2 范围的低风险 governance closeout，不得改写为 main CI 全绿。

DONE 仅覆盖本任务已接收的 v1.2 optional tag、累计 trigger、durable namespace/recovery 与 reference-only typed trigger trace。P2-A1/B/C/D、P3/P4、真实 provider/model/data、UI、授权、公网和生产均不由本结论完成。

## 基线与边界

- base：`main@d50e56886723de41f3fccf38a9d76b5b70541b32`；main CI `32042952178` SUCCESS；
- P2-A accepted：PR #69 exact head `042ec56f2b0362679bf240fcced95c61be77141f` / CI `32042589647` / independent PASS P0=P1=P2=0 / comment `5317377208`；merge/main 如上；
- branch：`codex/memory-t4-p1-semantic-trigger-001`；
- `.codex/iteration-learning.md` 属于用户，禁止修改、暂存或回退。

## 最终接收对象

- PR #70 accepted head：`cc2b82d83859a5bff0c4e796f8c4fa0a541e9b66`；exact-head CI `32161806857` SUCCESS；
- formal PASS：https://github.com/Li-Ming-G/elder_interview_ai/pull/70#issuecomment-5331708714；P0=P1=P2=0；
- merge/main：`00953acadb8edabefe0e59a9c570af745d22100b`；
- accepted/main tree：`033d3a9b2d905c8c758e6784063eae0da405b3bb`；
- main CI `32165583907` attempt 1 cancelled at 20-minute `pnpm test:e2e:install`; no rerun and no main-CI-SUCCESS claim。
