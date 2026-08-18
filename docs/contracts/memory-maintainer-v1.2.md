# Memory Maintainer V1.2 前向语义与触发契约

状态：`REVIEW / FORWARD RUNTIME CANDIDATE`。本契约只新增 v1.2；v1/v1.1 的 docs、Schema、fixtures、migration、accepted head、CI、审查与数据历史保持不可变。只有本任务 exact head 经独立审查 `PASS` 并 merge 后，runtime 才能加载 v1.2。

## 1. 架构映射与范围

| T 任务 | P 层 | v1.2 冻结内容 |
|---|---|---|
| T2 | Foundation / Memory Contract | `Episode / Fact / Boundary` 核心、optional `memory_tag`、legacy/P1 identity 分离 |
| T4 | P1 | v1.2 Context/Output、selected-new-batch 累计字符门禁、candidate-only Maintainer |
| T18-T19 | P6 | v1.2 durable namespace、final-flush 低内容终态、v1.1 历史兼容 |
| T0 | Foundation / Observability | trigger/count/threshold 与 ID/revision/digest；禁止复制 Prompt/Context/Transcript/provider 原文 |

本 contract slice 只交付 Markdown、两份 JSON Schema、fixtures、纯 validator 与 tests。Prisma、migration、repository、provider、scanner、reader、snapshot 和 runtime orchestration 由同任务的后续实现块负责。

## 2. P0 记忆语义

P0 核心只有：

- `episode`：一段可继续展开、具有上下文或时间进程的经历；
- `fact`：会改变下一问的结构化事实；
- `boundary`：长者明确表达的禁止或限制范围，由独立 boundary candidate/revision/evidence authority 持有。

`MemoryClaim/MemoryResolution.semantic_kind` 对 P1 必须为 `episode|fact`。Boundary 不得写成第三种 `semantic_kind`、`resolution_kind` 或普通 memory value。

既有 `person|relationship|place|event|time|time_range|important_choice|reason_clue|unfinished_story` 只成为可选 metadata `memory_tag`：

- wire 字段可省略、可为 `null`，有值时只允许上述枚举；
- 缺 tag 的 Episode/Fact 与带 tag 的 Episode/Fact 同等合法；
- tag 不参与 semantic identity、同批 duplicate、target identity、revision、thread CAS、current eligibility 或 evidence ownership；
- tag 变化不创建新语义槽，不允许用 `event` 等占位值填补缺失；
- tag 只允许辅助检索、分析与离线观察，不能成为第二套 value authority。

P1 semantic slot 唯一为：

```text
project_id + semantic_kind + canonical_key
```

Provider 仍只能提交 candidate operations；Schema 和 pure validator 通过不授权它直接写库、解除 Boundary 或改变 lifecycle status。

## 3. v1.2 Context 与 Output

正式 artifacts：

- [`memory-maintainer-context-v1.2.schema.json`](memory-maintainer-context-v1.2.schema.json)
- [`memory-maintainer-output-v1.2.schema.json`](memory-maintainer-output-v1.2.schema.json)
- [`fixtures/memory-maintainer-v1.2.fixtures.json`](fixtures/memory-maintainer-v1.2.fixtures.json)

Context/Output version 分别固定为 `memory-maintainer-context-v1.2` 与 `memory-maintainer-output-v1.2`。两份 Schema 都是 closed object；旧 wire 字段 `memory_type` 在 v1.2 中属于未知字段并必须拒绝。

`memory_tag` 只可出现在：

- Context 的 `current_working_memory[]`；
- Context 的 `session_mid_index[]`；
- Output operation 的 `proposed_state`。

`semantic_kind` 在以上所有 memory state/reference 中仍为必填。`active_boundaries[]` 和 `boundary_candidates[]` 保持独立，二者不使用 `memory_tag`。

v1.1 的 text revision、semantic/lifecycle 分离、disputed conflict set、target/thread CAS、evidence membership、candidate-only output 和 transcript-owned consumption 规则全部继续有效。v1.2 pure validator只移除 tag 对 identity/CAS 的错误影响，不降低其余门禁。

## 4. selected-new-batch 累计字符

Runtime 必须先按稳定顺序和既有 cap 选择本次冻结的 transcript membership，再只从其中同时满足以下条件的项目计算 selected-new batch：

```text
membership_kind = new
trusted_role = elder
content_kind = conversation
属于本次实际冻结 membership
```

overlap、interviewer、已消费、非 conversation、重复 segment ID 和 cap 外 segment 都不得帮助通过 minimum gate。Context 的 `trigger` 必须保存：

- `selected_new_segment_count`；
- `cumulative_useful_characters`；
- `minimum_useful_characters`；
- `kind` 与 `memory-p1-v1.2:*` stable identity。

每个 selected-new effective text 使用完全相同的算法：

1. Unicode NFKC；
2. 移除全部 Unicode `White_Space`；
3. 按 Unicode code point 计数；
4. 对 batch 内各段求和。

不得按 UTF-16 code unit、UTF-8 byte、原始未规范化长度或“任一单段达到阈值”判断。pure validator 从 Context membership 重新计算 count/cumulative，并与 trigger facts 逐值比较；任何不一致使整个 Context 失败关闭。任何交给 Maintainer 的 v1.2 Context 都必须满足：

```text
(batch_threshold OR time_threshold OR session_final_flush)
AND cumulative_useful_characters >= minimum_useful_characters
```

## 5. not-ready 与 final flush

普通 batch/time 扫描不满足 timing 或 minimum 时：

- 不创建 AiJob；
- provider call、Context snapshot、claim/resolution/thread/boundary、snapshot membership 和 consumption 全部为 0；
- pending transcript 留待后续扫描，录音/ASR/transcript ingestion 不受影响。

`session_final_flush` 必须使 post-session P1 lane 达到持久 terminal，不能永久 `not_started`。当 final flush timing 已成立但累计仍低于 minimum 时：

- 不构造 v1.2 Maintainer Context，不调用 Maintainer；
- 允许且要求创建同一 P1 lane 的 deterministic system AiJob，并终结为 `MEMORY_UNJUDGED`；
- 该 job 仍须保存本次 gate 实际检查的 reference-only `AiJobInputSegment + MemoryMaintenanceInputSegment(kind=new)`、真实 session scope count/manifest 与 input hash；这些 source rows 不是 provider 输入、成功 snapshot 或 consumption；
- Context snapshot、provider call、claim/resolution/thread/boundary 和 consumption 仍全部为 0；
- opening/recovery 只消费这个诚实 terminal outcome，不把它伪装为模型成功或空记忆结论。

纯函数 `decideMemoryMaintainerTriggerV12` 固定上述三种 disposition：`freeze_maintainer_context|defer_without_job|terminalize_unjudged_system_job`。

无论是正常 Maintainer 还是 low-content final flush，v1.2 都必须对同一 source AiJob 持久化 `decision-trace-memory-trigger-v1` typed observation：

- root 保存 observation/useful-character-policy version、trigger identity/kind、selected-new count、cumulative/minimum useful characters 与 membership manifest hash；
- ordered members 只保存 transcript segment ID、text/speaker revision、effective-text digest、useful-character count 与 input order；
- normal freeze 必须在 AiJob/source membership 同一事务建立 running Trace；final-low 必须在 terminal AiJob/source membership 同一事务建立 terminal Trace。任一 Trace/observation 失败必须回滚整组 job/source/trace，replay/concurrent begin 校验完整 identity 并返回同一 winner；
- final-low trigger identity 固定为 `memory-p1-v1.2:<session>:final-unjudged:<manifest-prefix>`，其中 `manifest-prefix` 是同一 canonical selected-new membership manifest SHA-256 的前 32 个十六进制字符；不得维护第二套 hash 算法；
- Reader 必须从 source AiJob 与当前 source segment 重算 revision/digest/useful count/count/manifest，任一漂移或 source hidden/expired/deleted 时失败关闭；
- 不得在 observation/member 中保存正文、Prompt、Context 或 provider payload。

原子规则使新 v1.2 路径不能产生 job-without-trace。startup/periodic 只为 pre-fix historical orphan 做失败关闭修复：pending/running job 确定性终结，terminal job 不改写既有业务结果，二者只建立 `unavailable/recovered` Trace 和已有 typed transcript refs；若旧 row 没有冻结 threshold/trigger kind/source membership，不得用当前 config、当前 Transcript 或空 membership 伪造可读 observation，Reader 必须保持 unavailable。

## 6. 数据与 namespace 兼容

后续 forward migration 只允许：

- 将 claim/resolution 既有 `memory_type` enum 列改为 nullable storage seam；不删 enum、不重命名旧列、不回填 sentinel；
- legacy `semantic_kind IS NULL` 继续按 `project_id + memory_type + canonical_key` 唯一；
- P1 `semantic_kind IS NOT NULL` 按 `project_id + semantic_kind + canonical_key` 唯一；
- 两类约束使用互斥 partial indexes，P1 tag 不进入 index key；
- 新 job 使用 `memory-p1-v1.2:*`，既有 `memory-p1-v1.1:*` rows 原样保留并可读；non-maintainer 禁止使用任一 Maintainer namespace。

`validateMemoryMaintainerNamespacesV12` 机械验证历史/新 namespace，`validateMemoryProducerCutoverV12` 要求 P1 启用时已加载 v1.2、旧 producer 关闭、post-session lane 委托 P1 且 pending authority 仍属于 P1。二者不修改 v1.1 immutable helper。

## 7. 接收门禁

Contract tests 至少机械覆盖：

- v1.1 三个 machine artifacts SHA-256 不变；
- 无 tag、null tag、合法 tag 的 Episode/Fact；
- Boundary 独立；拒绝缺 semantic kind、`semantic_kind=boundary`、未知 tag 与旧 `memory_type` wire；
- target tag 漂移仍指向同一 slot，两个不同 tag 的同 `semantic_kind+canonical_key` 在同批仍冲突；
- 多个单段分别低于阈值但累计恰好达到阈值；NFKC、Unicode whitespace、astral code point golden；
- trigger count/cumulative/minimum 漂移、重复 membership 与非 new/elder 项不计；
- batch/time/final 三个 ready 分支、普通 defer 和 final-flush low-content `MEMORY_UNJUDGED` 分支；
- v1.1/v1.2 namespace、non-maintainer 反例与 v1.2 cutover。

执行阶段只跑定向本地测试和格式检查；contract、migration、runtime、governance 与独立本地 review 合成一个完整候选后才运行一次远端 CI。本 contract 的本地通过不代表 task `PASS/DONE`、P2-B 已启动、真实 provider/data 或生产试点可用。
