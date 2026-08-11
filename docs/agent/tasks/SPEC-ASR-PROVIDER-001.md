# SPEC-ASR-PROVIDER-001｜腾讯实时 ASR V2 供应商接入契约冻结

## 目标

在不实现业务代码、Prisma、provider、密钥或部署的前提下，冻结供应商中立 `StreamingAsrAdapter v2`、腾讯 V2 profile、安全/成本/指标和真实 provider 验收。

## 状态

状态只以 `docs/agent/00-task-board.md` 为准。当前候选必须保持 REVIEW，等待 non-Draft PR exact-head CI SUCCESS 和项目负责人手动 GitHub 审查。

## 范围

- 标准普通话；唯一腾讯实时 ASR V2；`16k_zh_en_speaker_2.0`；内部 `diarization_required=true`。
- connect/ready、异步 sink、连接级 namespace、新 speaker stream、有限重连、fencing、结构化 drain、错误、secret/config、授权、指标/预算/账单。
- attempt-level lifecycle/receipt 与 session/capture-level sticky completeness；任一未回补 gap 不得被后续 voice success 清除。
- 桌面 Chromium、目标 Android、同 PCM 3 次真实 replay、主动断线 lane 的验收契约。
- 更新 `01/03-10`、正式 machine contract、治理/追踪/ADR/conflict/handoff/journal。

## 非目标

业务代码、migration、真实调用/密钥、第二 provider/diarizer、权威 gap ledger/backfill/clear、真实 LLM、真实长者/PII、部署与真实试点。

## 审查重点

1. v1→v2 是否只有一个生产真相源；
2. `session.ready` 与 provider ready 是否分离；
3. 新 voice 是否强制新 speaker stream 与重新校准；
4. drain 是否由当前 voice `final=1` + PCM 终态 + ingestion receipt 明确证明；
5. attempt receipt 是否与整场 completeness 分离，voice A 未回补 gap 是否在 voice B success 后仍 sticky degraded，同时无 gap 多-attempt 是否仍可 drained；
6. 未证实 `speaker_diarization=1` 是否保持 unknown；
7. archive/manifest、unknown fail-closed、secret/授权/日志和真实验收是否完整。

## 正式首轮审查

- PR #28 old exact head：`8d9922bead9a7d70517bafe2245bc44a560b8dc5`
- exact-head CI：`31476068838` SUCCESS
- 项目负责人正式结论：`REQUEST_CHANGES`，P0=0、P1=1
- 唯一 P1：当前 attempt 成功收束不得掩盖先前已知且未回补的 ASR gap；须冻结 session/capture 级 sticky degradation 聚合。该历史永久保留，定向修复候选仍为 REVIEW。

## 交付

- `docs/contracts/streaming-asr-provider-v2.md`
- `docs/contracts/streaming-asr-provider-v2.schema.json`
- `docs/contracts/tencent-realtime-asr-v2.profile.json`
- `docs/agent/handoffs/SPEC-ASR-PROVIDER-001.md`

## 开工基线

`origin/main@78a64252f253fc09cf87e89c5efe317512ad1243`，branch `codex/spec-asr-provider-001`。
