# Memory System V1｜架构映射与 Decision Trace 追溯补充

## 统一映射

所有任务卡、PR 标题/正文、handoff、traceability 和 review 必须同时写任务编号与架构层：

| 任务 | 架构层 | 已确认架构项 |
|---|---|---|
| T0–T1 | Foundation/Observability | Decision Trace、错误可见性、结果诊断 |
| T2 | Foundation/Memory Contract | Episode/Fact/Boundary、Working/Mid/Long、Thread、Evidence membership |
| T3 | Foundation/Provider Runtime | provider-neutral timeout/structured output/retry/provenance seam；不代表真实 provider 放行 |
| T4 | P1 | Working Memory Maintainer、active thread、候选操作 |
| T5–T8 | P2 | Mid/Long 演化、Park/Resume、Checkpoint、Final Flush |
| T9–T10 | P3 | 程序化 Embedding + Graph Neighbor Retrieval |
| T11–T12 | P4 | Context V2、priority/budget、membership freeze |
| T13–T17 | P5 | Evidence Drill-down、Evidence Gate、Non-destructive Correction |
| T18–T25 | P6 | Runtime orchestration、Director、generation fence、deadline、Prompt decision semantics |
| T26–T27 | Foundation/Observability | 人工评价、固定测试集、跨 P1–P6 的归因 |

## T0 可重建引用要求

Decision Trace 不保存完整 prompt、Context、transcript 或 provider 原文，但必须保存足够的 typed references 重建当次输入集合：

- Transcript：segment/range ID、text revision、speaker-role revision、effective-text digest、input order；
- P1：working revision、active thread ID/revision；
- P2：Mid/Long memory ID、layer、revision、status、membership order；
- P3：candidate ID、source layer、embedding/graph source、score、graph distance、rank、included/excluded reason；
- P4：section、source type/ID、revision、membership digest、input order、included/drop reason；
- P5：tool、call number、target ID、request/result reference IDs or hashes、outcome；
- provenance：AiJob/attempt/provider receipt/config digest、context revision/digest、generation ID。

集合未接入时只能写空集合与 `unavailable`/`not_started`，不得伪造成功 membership。Trace 不能复制正文，也不能通过引用绕过 retention。

## Retention、权限与终态

- Trace 是独立 retention root，拥有 project/session scope、owner actor、expiry、retention state 和 cleanup audit；no-provider/continue/error 不能因没有 AiJob 而失去治理。
- hide→detach→purge 必须与现有 retention service 一致；source root hidden/expired/deleted 后，Trace 查询 fail closed，不能恢复正文或改变业务事实。
- 查询必须校验 actor、project、session、assignment/consent 和 retention；Trace 只读，不具备修改 Memory、QuestionEvidence 或 Transcript 的权限。
- Trace 终态使用独立 CAS/immutable fence；重复 request/generation 唯一键幂等；late provider/writeback 不能改写终态 Trace 或业务状态。

## 当前实现状态

- 本文件与 `decision-trace-v1.schema.json` 在 T0 提案中；typed references 已进入 schema/fixtures。
- P1–P5 的真实 membership 表/运行时尚未实现，当前允许 `unavailable/not_started`，不把空集合当作已完成。
- 真实 LLM、真实长者数据、真实授权、公网和生产试点门禁保持不变。
