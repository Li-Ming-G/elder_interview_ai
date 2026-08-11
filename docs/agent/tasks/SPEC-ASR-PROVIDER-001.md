# SPEC-ASR-PROVIDER-001｜腾讯实时 ASR V2 供应商接入契约冻结

## 目标

在不实现业务代码、Prisma、provider、密钥或部署的前提下，冻结供应商中立 `StreamingAsrAdapter v2`、腾讯 V2 profile、安全/成本/指标和真实 provider 验收。

## 状态

状态只以 `docs/agent/00-task-board.md` 为准。当前候选必须保持 REVIEW，等待 non-Draft PR exact-head CI SUCCESS 和项目负责人手动 GitHub 审查。

## 范围

- 标准普通话；唯一腾讯实时 ASR V2；`16k_zh_en_speaker_2.0`；内部 `diarization_required=true`。
- connect/ready、异步 sink、连接级 namespace、新 speaker stream、有限重连、fencing、结构化 drain、错误、secret/config、授权、指标/预算/账单。
- 桌面 Chromium、目标 Android、同 PCM 3 次真实 replay、主动断线 lane 的验收契约。
- 更新 `01/03-10`、正式 machine contract、治理/追踪/ADR/conflict/handoff/journal。

## 非目标

业务代码、migration、真实调用/密钥、第二 provider/diarizer、gap/backfill、真实 LLM、真实长者/PII、部署与真实试点。

## 审查重点

1. v1→v2 是否只有一个生产真相源；
2. `session.ready` 与 provider ready 是否分离；
3. 新 voice 是否强制新 speaker stream 与重新校准；
4. drain 是否由当前 voice `final=1` + PCM 终态 + ingestion receipt 明确证明；
5. 未证实 `speaker_diarization=1` 是否保持 unknown；
6. archive/manifest、unknown fail-closed、secret/授权/日志和真实验收是否完整。

## 交付

- `docs/contracts/streaming-asr-provider-v2.md`
- `docs/contracts/streaming-asr-provider-v2.schema.json`
- `docs/contracts/tencent-realtime-asr-v2.profile.json`
- `docs/agent/handoffs/SPEC-ASR-PROVIDER-001.md`

## 开工基线

`origin/main@78a64252f253fc09cf87e89c5efe317512ad1243`，branch `codex/spec-asr-provider-001`。
