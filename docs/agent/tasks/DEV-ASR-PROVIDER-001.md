# DEV-ASR-PROVIDER-001｜腾讯实时 ASR V2 adapter v2 实现与真实验收

## 开工门禁

仅在 SPEC-ASR-PROVIDER-001 non-Draft PR exact head 获项目负责人手动 PASS 后开工；状态以任务板为准。测试账号目标引擎/并发、安全后端 secret 注入、显式开发预算/配额、虚构剧本、受控 PCM、桌面 Chromium 和目标 Android 必须就绪。

## 实现范围

原子迁移生产 `StreamingAsrAdapter` v1→v2；更新 gateway/runtime/finalization/config/metrics/test；实现腾讯签名、握手、pacing、异步 sink、连接级 namespace、有限重连、fencing、结构化 drain 和安全错误。不得保留 v1/v2 并行生产 truth source。

## 验收

严格执行 `09` §15 和正式 v2 contract：同 PCM 真实 replay 3 次、桌面/Android 正式链路、主动断线、archive/manifest、final-only 幂等、两个可校准 label、unknown fail-closed、控制句排除、当前 voice 明确 drain、预算/账单核对。

## 非目标

Prisma migration、第二 provider/diarizer、gap/backfill、真实 LLM、真实长者/PII、生产部署。若需要改变公共状态、数据库权威事实、校准体验或数据授权，先暂停并更新 SPEC。
