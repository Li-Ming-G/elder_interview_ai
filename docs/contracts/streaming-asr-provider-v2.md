# Streaming ASR Provider V2 正式契约候选

状态：`FORMAL / REVIEW`。本文件与同目录 JSON Schema 是 `StreamingAsrAdapter v2` 的唯一技术真相源；`06` 负责业务规则，腾讯 profile 负责供应商映射。项目负责人 exact-head 审查前不得宣称 PASS。

## 1. v1 → v2 迁移

`StreamingAsrAdapter` 保留供应商中立注入边界，但旧 `accept(frame) -> result[]`、`drainAndClose() -> void` 不再是生产契约。`DEV-ASR-PROVIDER-001` 必须原子切换生产 adapter、gateway、runtime、finalization 和测试到 v2；不得保留 v1/v2 两套生产 truth source。local/test fake 可实现 v2，但不得被真实 provider 验收使用。

v2 port 语义为：`connect` 在数据库锁和首个 250ms PCM accept 之外完成鉴权与 ready；`accept` 只确认 adapter 已接管有序 PCM；provider 结果通过异步 sink 回传；`stop` 先停止新发送再进入 drain；`drain` 返回匹配当前 attempt/namespace 的结构化证据；`cancel/timeout/error` 关闭并 fence sink。

业务 `session.ready` 只证明业务 WebSocket/权限/采集 runtime ready；provider `ready` 只证明腾讯握手 `code=0`。二者不得互相推导，也不新增用户可见公共状态。

## 2. 生命周期与 namespace

权威顺序：`connect -> ready -> streaming -> stopping -> draining -> drained`。鉴权前未启动为 `not_started`；流中可恢复错误进入新 attempt，旧 attempt 先 `degraded` 并 fence；不可恢复协议/配置错误为 `failed`，对 session finalization 仍投影为既有 `degraded|not_started`，录音继续。

每次腾讯连接生成全新 `attempt_id`、`voice_id=provider_namespace_id` 和 `provider_request_id`。每个新 voice ID 必须关闭旧 `speaker_stream_id`、创建新 `speaker_stream_id`、清除可信校准并要求用户重新确认；即使同一 capture generation 也不继承 label 或角色。`enable_speaker_context=0` 且不发送 `speaker_context_id`。

有限重连只用于实时后续 PCM：初次连接后最多 2 次，退避 250ms/1000ms。首版不补故障区间；旧 voice 的 late/replay/duplicate/out-of-order 结果因四元组 `{attempt_id, provider_namespace_id, provider_request_id, speaker_stream_id}` 不匹配而丢弃并计数。若需要改变次数、用户校准体验或数据库权威事实，必须另做契约变更。

## 3. 音频、映射与幂等

输入固定 mono/16kHz/s16le，每帧 100ms/3200 bytes。backend 将两个连续帧聚合为 200ms/6400 bytes，按 1:1 实时节奏发送；stop 时发送未填充的精确尾部后再发 end，不伪造静音、不快于实时突发。`accepted` 只表示 adapter 有界队列接管，不表示腾讯已识别或计费；`sent` 单独计量。

腾讯 `sentence_type=0` 映射 interim，仅展示；`sentence_type=1` 映射 final，使用 namespace + sentence identity 构造稳定 `ingest_key` 后幂等持久化。start/end 映射到 session timeline；`speaker_id=-1`、缺失或非法 label 均映射 `speaker_provider_id=null`/角色 `unknown`，AI 不猜。provider label 永远不是 elder/interviewer；只有当前 speaker stream 内用户确认后才 trusted。校准控制句保留证据但从普通 AI 消费排除。

## 4. stop、drain 与错误

drained 的必要且充分条件：本地停止新 PCM并成功发送 end；收到当前 voice 的 `final=1`；截至 `accepted_through_sequence` 的 PCM 均有 sent 或明确 terminal 结果；该 namespace 的所有已接收 final 完成幂等 ingestion；结构化 receipt 与当前 attempt 四元组匹配。WS close、最后一条 sentence、无结果或 void resolve 均不是 drain 证据。10 秒 deadline 后 cancel/fence，迟到 sink 不得写库，finalization 为 `degraded`。

稳定错误分类：鉴权/签名 `ASR_AUTH_FAILED`；未开通/引擎 `ASR_ENGINE_UNAVAILABLE`；额度/欠费 `ASR_QUOTA_EXHAUSTED`；并发/发送过快 `ASR_RATE_LIMITED`；音频 `ASR_AUDIO_INVALID`；网络/供应商 5xxx `ASR_PROVIDER_UNAVAILABLE`；ready/drain 超时 `ASR_TIMEOUT`；协议/身份不匹配 `ASR_PROTOCOL_INVALID`；撤权/访问失效 `ASR_CANCELLED`。只有网络、超时和明确可重试的 provider 错误进入有限重连；鉴权、额度、引擎和协议错误 fail closed。

## 5. 安全配置、日志与成本

可信配置来自服务端 `APP_ENV` 与受控部署配置：provider、mainland region、allowlisted endpoint、engine、`diarization_required=true`、音频格式、pacing、timeout、reconnect、并发、日预算。SecretId/SecretKey/AppId 仅由后端 secret manager/environment 注入，不进前端、仓库、URL 日志、fixture 或错误详情；签名在后端按腾讯 V2 HMAC-SHA1 规则生成，timestamp/expired/nonce/voice_id 每连接产生。

授权生效前不得 connect/upload；撤权、assignment 失效或访问失效后停止新发送并关闭连接，仅允许既有 finalization 收束 stop 前 accepted PCM。可选训练/优化/测试授权固定 false。日志只记录 hash/ID、字节/时长、状态、延迟、错误分类和计费核对，不复制完整音频、完整转录、签名或密钥。

可信配置名和值冻结如下；生产/测试配置加载失败、值越界、endpoint 不在 allowlist 或预算缺失均 fail closed，不回落 deterministic fake：

| 配置 | 冻结值/责任 |
|---|---|
| `APP_ENV` | 可信服务端环境；只有 `local|test` 可显式使用 v2 fake |
| `ASR_PROVIDER` | `tencent_realtime_asr_v2` |
| `ASR_REGION` | `cn_mainland`；首版唯一批准数据处理 region |
| `TENCENT_ASR_ENDPOINT` | `wss://asr.cloud.tencent.com/asr/v2/{appid}` allowlist |
| `TENCENT_ASR_ENGINE_MODEL_TYPE` | `16k_zh_en_speaker_2.0` |
| `ASR_DIARIZATION_REQUIRED` | `true`，内部 policy；不生成未证实 wire 参数 |
| `ASR_PROVIDER_PACKET_MS` / `ASR_PACING` | `200` / `one_to_one_realtime` |
| `ASR_CONNECT_TIMEOUT_MS` / `ASR_READY_TIMEOUT_MS` / `ASR_DRAIN_TIMEOUT_MS` | `5000` / `5000` / `10000` |
| `ASR_RECONNECT_MAX_ATTEMPTS` | 初次连接之外 `2` |
| `ASR_MAX_CONCURRENCY` | 开发验收最大 `2` |
| `ASR_DEV_DAILY_BUDGET_CNY` / `ASR_DEV_MAX_BILLED_SECONDS` | `5` / `7200`；任一达到即停止新 connect |
| `TENCENT_ASR_APP_ID` / `TENCENT_ASR_SECRET_ID` / `TENCENT_ASR_SECRET_KEY` | backend secret injection；无默认值、无日志、无前端暴露 |
| `ASR_OPTIONAL_OPTIMIZATION_AUTHORIZED` | 固定 `false` |

腾讯签名输入包含除 `signature` 外的排序 query、host/path，使用 SecretKey HMAC-SHA1 后 base64 与 URL encode；`timestamp` 为服务端秒级当前时间，`expired>timestamp` 且有效期固定 5 分钟，`nonce` 和 `voice_id` 每连接新建。签名 URL 只在内存中使用并整体 redaction，不能进入 access log/metric/error。

指标：connect/reconnect；PCM accepted/sent bytes/duration；interim/final；first interim/final latency；final persistence latency；drain latency/outcome；unknown speaker ratio；label switch/merge；provider error；provider request ID；billed duration。每个验收日将 provider request ID、billed duration、并发/额度变化与腾讯账单逐项核对；实际 speaker 引擎计费 SKU 在真实账单核对前为 unknown。

## 6. 腾讯事实分级与未决门禁

Verified：V2 handshake 后上传、每连接唯一 voice_id、16k mono 16-bit PCM、sentence_type interim/final、`speaker_id=-1` 未分离、`final=1` 全部完成，以及 `16k_zh_en_speaker_2.0` 官方说明默认话者分离，均来自[腾讯实时 ASR V2](https://cloud.tencent.com/document/product/1093/131127)和[能力说明](https://cloud.tencent.com/document/product/1093/35682)。[计费说明](https://cloud.tencent.com/document/product/1093/35686)证明存在实时 2.0 计费，但不能证明本项目实际 speaker SKU。

Inference：100ms 帧聚合为官方建议 200ms/6400 bytes及 backend pacing 是本项目可逆技术选择；中国大陆处理边界来自项目已批准授权范围，不等于腾讯数据保留证明。

Unknown/corrected：官方 V2 当前未列 `speaker_diarization` query 参数，旧候选 `speaker_diarization=1` wire 假设已纠正为 unknown；只冻结内部 `diarization_required=true`。双人 label 稳定性必须真实三次 replay 验证，营销能力不等于 PASS。腾讯[服务条款](https://cloud.tencent.com/document/product/301/94121)、[优化授权](https://cloud.tencent.com/document/product/1093/115535)和[FAQ](https://cloud.tencent.com/document/product/1093/35802)仍不足以关闭真实长者试点所需的诊断日志、音频/文本保留、DPA/处理者义务门禁。

## 7. 真实 provider 验收

使用约 8 分钟、完全虚构的标准普通话双人剧本：固定两人校准句；虚构姓名、年份、地点、关系和事件；五个问题；短应答、快速轮换、轻微重叠、较轻音量；正常 stop/drain/reopen。只用明确同意的非长者测试者、合成音频或完全虚构音频；不得用真实长者或 PII。

同一受控 PCM 对腾讯 replay 3 次，并分别跑桌面 Chromium 和目标 Android 正式链路；另跑主动断线 fault lane。三次中任一次不能得到两个可由固定校准句区分并经用户确认的临时 label，即产品完整可用 FAIL；不得加第二 diarizer。任一不确定片段必须 unknown，禁止错继承 trusted role。

PASS 候选还必须同时证明：archive/manifest 完整；interim 不落库、final-only 幂等且有序；duplicate/replay/out-of-order 被 fence；控制句不进普通 AI；当前 voice `final=1` 形成结构化 drain；reopen/重连新 speaker stream 并重校准；Android 使用正式采集链路；断线时 `degraded|not_started` 且录音/安全结束继续。fake、单测、宣传或单次供应商运行均不得冒充真实 provider PASS。

`DEV-ASR-PROVIDER-001` 开工条件：本 SPEC exact-head 获项目负责人手动 PASS；测试环境的后端安全注入和预算/配额由负责人就绪但不进入仓库；腾讯账号具备目标引擎/并发；虚构剧本、受控 PCM、桌面/Android 与账单核对方案就绪；真实长者试点的 retention/DPA 门禁仍可保持阻塞。真实 LLM provider 只能在 DEV-ASR-PROVIDER-001 正式 PASS 后启动。
