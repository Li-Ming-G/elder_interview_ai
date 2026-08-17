# Memory Core V1 Candidate

状态：`CANDIDATE / REVIEW`，不是正式机器权威。

本候选契约只服务 `MEMORY-T2-T4-CORE-001` 的 synthetic/local MVP，不改变已接收的 `interview-director-context-v1`。正式 Context V2、Prisma 持久化投影和真实 provider 接入必须另立契约与独立审查。

## 架构映射

- `T2 / Foundation + Memory Contract`：Episode/Fact/Boundary 的引用形状、Working/Mid/Long layer、Thread、Evidence、revision/status。
- `T3 / Foundation + P6 Provider Runtime`：复用现有 provider-neutral `StructuredAiProvider` seam；本候选不安装 SDK、不绑定 endpoint/model/secret。
- `T4 / P1 Working Memory`：`WorkingMemoryMaintainerService` 只产生 candidate operations；程序调用方负责校验、执行和持久化。
- `P3 / T9-T10`：`MemoryRetrievalService` 只返回 candidate references、source、score、rank 和 exclusion reason。
- `P4 / T11-T12`：`MemoryContextAssemblyService` 机械组装 candidate Context，不重新总结、不调用第二个模型。
- `T0 / Foundation-Observability`：membership digest、evidence reference 和后续 Decision Trace typed references 继续作为可追溯边界；本切片不保存完整 prompt/context/transcript/provider payload。

## 不变量

1. 每个 Working candidate operation 至少包含一个 finalized transcript evidence reference；证据不在 batch 内时拒绝。
2. Maintainer 不能直接写库、不能决定下一问；`NEW`、`DUPLICATE`、`SUPPLEMENT`、`CONTINUE`、`UNCERTAIN` 只是候选操作。
3. `current_working_memory`、`memory_candidates`、`actual_asked`、`recently_displayed` 语义分离；candidate 不能冒充 current fact，displayed 不能冒充 asked。
4. `mid/long` 尚未具备权威时使用空集合/`unavailable`，不伪造 revision 或 digest。
5. Boundary 只有在长者明确表达且有 evidence 时生成；`active/revoked/superseded` 由程序状态机管理。
6. provider unavailable 或 Maintainer 失败不得影响 transcript ingestion；本候选只提供可失败的后台/测试 seam。
7. `interview-director-context-v2-candidate` 不得被正式 runtime loader 读取；V1 runtime 保持不变，直到 V2 正式接收。

## 最小闭环

```text
finalized transcript batch
  -> P1 candidate operations + boundary candidates
  -> P3 deterministic candidate references
  -> P4 candidate Context + membership digest
  -> synthetic Director seam
  -> grounded question / continue_listening
```

这证明的是 Memory Core 与薄 P3/P4 消费链可用，不代表真实 provider、真实长者数据、正式 consent、生产部署或完整产品流程已通过。
