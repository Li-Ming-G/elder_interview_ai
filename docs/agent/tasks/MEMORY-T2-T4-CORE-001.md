# MEMORY-T2-T4-CORE-001｜Memory Core 与最薄下一问消费链

状态：`REVIEW`

## 目标

沿《LLM记忆改造.md》实现能直接验证“记忆是否让下一问更好”的最小核心闭环，不以页面、部署或完整生产流程为前置。

## 架构映射

| T 任务 | P 层 | 本任务实现 |
|---|---|---|
| T2 | Foundation + Memory Contract | Memory layer、Thread、Evidence、revision/status、Boundary candidate 形状 |
| T3 | Foundation + P6 | provider-neutral synthetic seam，复用现有 timeout/structured provider 边界，不接真实 provider |
| T4 | P1 | finalized transcript batch → candidate operations 的 Working Memory Maintainer |
| T9-T10（薄切片） | P3 | deterministic candidate references，不引入 embedding/graph/reranker |
| T11-T12（薄切片） | P4 | candidate Context assembler、membership digest、budget 记录 |
| T0 | Foundation/Observability | evidence/reference-only 追踪边界，继续禁止 raw payload |

## 已实现范围

- `memory-core.contract.ts`：Working/Mid/Long、Thread、Evidence、Boundary、candidate operation 和候选 Context 的 typed shape。
- `working-memory-maintainer.service.ts`：batch/time/minimum-useful-content gate；只产生 `NEW/CONTINUE/DUPLICATE/SUPPLEMENT/UNCERTAIN` 候选和带 evidence 的 Boundary candidate。
- `memory-context-assembly.service.ts`：P3 deterministic candidate retrieval 与 P4 mechanical assembly。
- `memory-next-question.pipeline.ts`：local/test-only 的 transcript → P1 → P3 → P4 → grounded question/continue seam。
- `memory-core.spec.ts`：触发门禁、同批去重、补充/不确定/Branch/Boundary、candidate 排序、grounding、digest 和 applier ownership 固定测试。

## 明确后置

- 正式 `InterviewDirectorContextV2` schema 与 runtime switch；当前 V1 runtime 不变。
- Prisma Working/Thread/Boundary projection migration；需先接收 T2 正式数据契约，避免第二套 truth source。
- P2 Mid/Long evolution、embedding/graph retrieval、P5 Evidence drill-down、真实 provider/secret/真实数据。
- 页面、部署、生产 consent、备份/监控和完整试点验收。

## 验收门槛

- candidate operation 无 evidence 一律拒绝；candidate 不得直接写库或决定下一问。
- synthetic pipeline 能生成 grounded question，且 grounding 只引用 Context 中存在的 segment/memory。
- Boundary candidate 会使 pipeline `continue_listening`，不会继续追问已明确拒绝的范围。
- mid/long 缺失保持空/不可用，不伪造事实。
- `pnpm --filter @elder-interview/api typecheck`、lint/build 与 memory-core/full unit tests 通过。
