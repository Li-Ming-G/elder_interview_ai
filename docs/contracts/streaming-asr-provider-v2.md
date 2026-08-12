# Streaming ASR Provider V2 正式契约候选

状态：`FORMAL / REVIEW`。本文件与同目录 JSON Schema 是 `StreamingAsrAdapter v2` 的唯一技术真相源；`06` 负责业务规则，腾讯 profile 负责供应商映射。项目负责人 exact-head 审查前不得宣称 PASS。

## 1. v1 → v2 迁移

`StreamingAsrAdapter` 保留供应商中立注入边界，但旧 `accept(frame) -> result[]`、`drainAndClose() -> void` 不再是生产契约。`DEV-ASR-PROVIDER-001` 必须原子切换生产 adapter、gateway、runtime、finalization 和测试到 v2；不得保留 v1/v2 两套生产 truth source。local/test fake 可实现 v2，但不得被真实 provider 验收使用。

v2 port 语义为：`connect` 在数据库锁和首个 250ms PCM accept 之外完成鉴权与 ready；`accept` 只确认 adapter 已接管有序 PCM；provider 结果通过异步 sink 回传；`stop` 先停止新发送再进入 drain；`drain` 返回匹配当前 attempt/namespace 的结构化证据；`cancel/timeout/error` 关闭并 fence sink。

业务 `session.ready` 只证明业务 WebSocket/权限/采集 runtime ready；provider `ready` 只证明腾讯握手 `code=0`。二者不得互相推导，也不新增用户可见公共状态。

## 2. 生命周期与 namespace

这里的权威顺序是 **attempt 级**：`connect -> ready -> streaming -> stopping -> draining -> drained`。鉴权前未启动为 `not_started`；流中可恢复错误进入新 attempt，旧 attempt 先 `degraded` 并 fence；不可恢复协议/配置错误为 `failed`。attempt 状态和 receipt 只描述一个 voice，不直接等于 session/capture 转录完整性；公共 finalization 仍只投影既有 `drained|degraded|not_started`，录音继续。

每次腾讯连接生成全新 `attempt_id`、`voice_id=provider_namespace_id` 和 `provider_request_id`。每个新 voice ID 必须关闭旧 `speaker_stream_id`、创建新 `speaker_stream_id`、清除可信校准并要求用户重新确认；即使同一 capture generation 也不继承 label 或角色。目标引擎保持 `16k_zh_en_speaker_2.0`；实际 query 必须包含 `speaker_diarization=1` 与 `enable_speaker_context=0`，并且必须省略整个 `speaker_context_id` key，不得发送 `speaker_context_id=` 空值。

有限重连只用于实时后续 PCM：初次连接后最多 2 次，退避 250ms/1000ms。首版不补故障区间；新 attempt 必须继承同一 session runtime 的 completeness 聚合，不得初始化为 clean。旧 voice 的 late/replay/duplicate/out-of-order 结果因四元组 `{attempt_id, provider_namespace_id, provider_request_id, speaker_stream_id}` 不匹配而丢弃并计数。若需要改变次数、用户校准体验或数据库权威事实，必须另做契约变更。

## 3. 音频、映射与幂等

输入固定 mono/16kHz/s16le，每帧 100ms/3200 bytes。backend 将两个连续帧聚合为 200ms/6400 bytes，按 1:1 实时节奏发送；stop 时发送未填充的精确尾部后再发 end，不伪造静音、不快于实时突发。`accepted` 只表示 adapter 有界队列接管，不表示腾讯已识别或计费；`sent` 单独计量。

腾讯 `sentence_type=0` 映射 interim，仅展示；`sentence_type=1` 映射 final，使用 namespace + sentence identity 构造稳定 `ingest_key` 后幂等持久化。start/end 映射到 session timeline；`speaker_id=-1`、缺失或非法 label 均映射 `speaker_provider_id=null`/角色 `unknown`，AI 不猜。provider label 永远不是 elder/interviewer；只有当前 speaker stream 内用户确认后才 trusted。校准控制句保留证据但从普通 AI 消费排除。

## 4. attempt drain、整场完整性与错误

### 4.1 attempt 级结构化 receipt

attempt `drained` receipt 的必要且充分条件：本地停止新 PCM并成功发送 end；收到当前 voice 的 `final=1`；截至 `accepted_through_sequence` 的 PCM 均有 sent 或明确 terminal 结果；该 namespace 的所有已接收 final 完成幂等 ingestion；结构化 receipt 与当前 attempt 四元组匹配。WS close、最后一条 sentence、无结果或 void resolve 均不是 drain 证据。10 秒 deadline 后 cancel/fence，迟到 sink 不得写库。

receipt success 只证明该 attempt 已明确收束，不证明此前或整场没有缺口，也不得直接把 session finalization 写为 `drained`。

### 4.2 session/capture 级 sticky completeness

runtime 必须在所有 attempt 之外维护同一 session/capture 的单调聚合 `session_capture_completeness`：初始 `no_known_gap`，一旦检测到任何已知且尚未回补的 ASR gap，转为 `known_unbackfilled_gap`；本 v2 只允许该单向转移。新 voice 的 connect/ready/streaming、`final=1`、ingestion complete 或 attempt drain success 均不得 reset/clear。runtime/process 或 coverage evidence 丢失而无法证明此前完整时，也必须失败关闭为 `known_unbackfilled_gap`。这可能保守地产生 degraded，但不得产生假完整。

以下条件形成 sticky gap；错误是否 retryable 只决定是否创建新 attempt，不决定 gap 是否存在：

- WS close/error、ready/drain timeout、cancel、协议或 provider 故障，使已 accepted/sent PCM 在 fence 时仍无终态，或 `accepted_through_sequence > terminal_through_sequence`；
- 已接管 PCM 被旧 sink fence、丢弃、未发送，或没有可归属的明确 terminal；
- capture 时间轴继续前进但没有 ready attempt，期间 eligible PCM 未被有界保存并由新旧 attempt 连续覆盖，包括 reconnect/backoff 或不可恢复的鉴权、额度、引擎故障后形成的未转录区间；
- runtime/process/attempt coverage evidence 丢失，且无法证明此前 capture PCM 已由有效 receipt 连续覆盖；
- 任一旧 attempt 已留下上述缺口，即使当前 attempt 后续成功收束。

以下情况本身不形成 gap：attempt 在分配任何 capture PCM 前握手失败/取消，后继 attempt 从首个 PCM 连续接管；前一 attempt receipt 完整且后一 attempt 从紧邻 sequence/timeline 边界接管、交接期间无 frame 丢失；短时 transport 重连后有界缓存全部按序发送；被 fence 的 late/duplicate/out-of-order 结果所对应音频已经由有效 receipt 完整覆盖；多个零 PCM attempt 后所有实际 PCM 被最终 attempt 连续覆盖。换言之，新 voice 本身不是 gap，未覆盖 PCM/时间区间才是 gap。

stop 时只允许以下整体投影：整场从未建立可用 ASR、也没有可证明的转录覆盖为 `not_started`；存在 `known_unbackfilled_gap`，或 completeness/coverage evidence 丢失、无法证明完整，为 `degraded`；只有聚合始终为 `no_known_gap`、所有 attempt 边界连续且最后 attempt receipt 完整，才为 `drained`。后续 attempt 成功不得掩盖旧 gap。只有未来 `HARDEN-ASR-001` 引入权威 gap ledger/backfill 覆盖证据并明确关闭所有 gap 后，才可另行定义整场 completeness 重算；本 SPEC 不提供 clear/reset/reconcile 恢复路径。

稳定错误分类：鉴权/签名 `ASR_AUTH_FAILED`；未开通/引擎 `ASR_ENGINE_UNAVAILABLE`；额度/欠费 `ASR_QUOTA_EXHAUSTED`；并发/发送过快 `ASR_RATE_LIMITED`；音频 `ASR_AUDIO_INVALID`；网络/供应商 5xxx `ASR_PROVIDER_UNAVAILABLE`；ready/drain 超时 `ASR_TIMEOUT`；协议/身份不匹配 `ASR_PROTOCOL_INVALID`；撤权/访问失效 `ASR_CANCELLED`。只有网络、超时和明确可重试的 provider 错误进入有限重连；鉴权、额度、引擎和协议错误 fail closed。

## 5. 安全配置、日志与成本

可信配置来自服务端 `APP_ENV` 与受控部署配置：provider、mainland region、allowlisted endpoint、engine、`diarization_required=true`、音频格式、pacing、timeout、reconnect、并发、日预算。腾讯 profile 把内部 diarization policy 映射为必发 wire 参数 `speaker_diarization=1`；`enable_speaker_context=0` 同样必发，`speaker_context_id` 必须省略。SecretId/SecretKey/AppId 仅由后端 secret manager/environment 注入，不进前端、仓库、URL 日志、fixture 或错误详情；签名在后端按腾讯 V2 HMAC-SHA1 规则生成，timestamp/expired/nonce/voice_id 每连接产生。

授权生效前不得 connect/upload；撤权、assignment 失效或访问失效后停止新发送并关闭连接，仅允许既有 finalization 收束 stop 前 accepted PCM。可选训练/优化/测试授权固定 false。日志只记录 hash/ID、字节/时长、状态、延迟、错误分类和计费核对，不复制完整音频、完整转录、签名或密钥。

可信配置名和值冻结如下；生产/测试配置加载失败、值越界、endpoint 不在 allowlist 或预算缺失均 fail closed，不回落 deterministic fake：

| 配置 | 冻结值/责任 |
|---|---|
| `APP_ENV` | 可信服务端环境；只有 `local|test` 可显式使用 v2 fake |
| `ASR_PROVIDER` | `tencent_realtime_asr_v2` |
| `ASR_REGION` | `cn_mainland`；首版唯一批准数据处理 region |
| `TENCENT_ASR_ENDPOINT` | `wss://asr.cloud.tencent.com/asr/v2/{appid}` allowlist |
| `TENCENT_ASR_ENGINE_MODEL_TYPE` | `16k_zh_en_speaker_2.0` |
| `ASR_DIARIZATION_REQUIRED` | `true`；腾讯 profile 必须映射为 query `speaker_diarization=1` |
| 腾讯 speaker context | query 必须发送 `enable_speaker_context=0`；整个 `speaker_context_id` key 必须省略，不得发送空值 |
| `ASR_PROVIDER_PACKET_MS` / `ASR_PACING` | `200` / `one_to_one_realtime` |
| `ASR_CONNECT_TIMEOUT_MS` / `ASR_READY_TIMEOUT_MS` / `ASR_DRAIN_TIMEOUT_MS` | `5000` / `5000` / `10000` |
| `ASR_RECONNECT_MAX_ATTEMPTS` | 初次连接之外 `2` |
| `ASR_MAX_CONCURRENCY` | 开发验收最大 `2` |
| `ASR_DEV_DAILY_BUDGET_CNY` / `ASR_DEV_MAX_BILLED_SECONDS` | `5` / `7200`；任一达到即停止新 connect |
| `TENCENT_ASR_APP_ID` / `TENCENT_ASR_SECRET_ID` / `TENCENT_ASR_SECRET_KEY` | backend secret injection；无默认值、无日志、无前端暴露 |
| `ASR_OPTIONAL_OPTIMIZATION_AUTHORIZED` | 固定 `false` |

腾讯签名流程固定为：先构造实际请求 query map，其中包含 `speaker_diarization=1`、`enable_speaker_context=0`，不包含 `speaker_context_id` 或 `signature`；再按参数名词典序生成 canonical query，与 host/path 一起构成签名原文；使用 SecretKey HMAC-SHA1 后 base64、URL encode signature 并追加到请求 URL。参数不得只签不发或只发不签。`timestamp` 为服务端秒级当前时间，`expired>timestamp` 且有效期固定 5 分钟，`nonce` 和 `voice_id` 每连接新建。签名 URL 只在内存中使用并整体 redaction，不能进入 access log/metric/error。

指标：connect/reconnect；PCM accepted/sent bytes/duration；interim/final；first interim/final latency；final persistence latency；drain latency/outcome；unknown speaker ratio；label switch/merge；provider error；provider request ID；billed duration。每个验收日将 provider request ID、billed duration、并发/额度变化与腾讯账单逐项核对；实际 speaker 引擎计费 SKU 在真实账单核对前为 unknown。

## 6. 腾讯事实分级与未决门禁

Verified：V2 handshake 后上传、每连接唯一 voice_id、16k mono 16-bit PCM、sentence_type interim/final、`speaker_id=-1` 未分离、`final=1` 全部完成，以及 `16k_zh_en_speaker_2.0` 官方说明默认话者分离，均来自[腾讯实时 ASR V2](https://cloud.tencent.com/document/product/1093/131127)和[能力说明](https://cloud.tencent.com/document/product/1093/35682)。[腾讯会议话者分离指南](https://cloud.tencent.com/document/product/1093/130881)明确使用 `speaker_diarization=1`；[官方 Go SDK 固定 commit](https://github.com/TencentCloud/tencentcloud-speech-sdk-go/commit/257f9f56bcd592bff1faea9b4ce0f1ef90cea803)显示通用 `RealtimeRecognizerV2` 默认值为 0、专用 `SpeakerRecognizer` 默认值为 1，并把该参数与 `enable_speaker_context` 一起写入排序 query 后签名。因此本项目腾讯 profile 固定必发 `speaker_diarization=1`，不是依赖引擎默认行为。[计费说明](https://cloud.tencent.com/document/product/1093/35686)证明存在实时 2.0 计费，但不能证明本项目实际 speaker SKU。

Inference：100ms 帧聚合为官方建议 200ms/6400 bytes及 backend pacing 是本项目可逆技术选择；中国大陆处理边界来自项目已批准授权范围，不等于腾讯数据保留证明。

Evidence correction：SPEC-ASR-PROVIDER-001/ADR-032 当时因官方 V2 参数表未列出该字段，把 `speaker_diarization=1` 归为 unknown 并禁止发送；后续官方指南和固定 SDK commit 已提供 wire key、值、query 与签名行为的一手依据。ADR-033 只在项目负责人接收后部分取代这一条供应商事实；ADR-032 的 v2 seam、namespace、人工确认、drain/completeness 和全部安全边界不变。

Unknown：双人 label 稳定性必须真实三次 replay 验证，营销能力或一次受控连接均不等于 PASS；实际 speaker SKU 仍待账单核对。腾讯[服务条款](https://cloud.tencent.com/document/product/301/94121)、[优化授权](https://cloud.tencent.com/document/product/1093/115535)和[FAQ](https://cloud.tencent.com/document/product/1093/35802)仍不足以关闭真实长者试点所需的诊断日志、音频/文本保留、DPA/处理者义务门禁。

## 7. 真实 provider 验收

使用约 8 分钟、完全虚构的标准普通话双人剧本：固定两人校准句；虚构姓名、年份、地点、关系和事件；五个问题；短应答、快速轮换、轻微重叠、较轻音量；正常 stop/drain/reopen。只用明确同意的非长者测试者、合成音频或完全虚构音频；不得用真实长者或 PII。

同一受控 PCM 对腾讯 replay 3 次，并分别跑桌面 Chromium 和目标 Android 正式链路；另跑主动断线 fault lane。三次中任一次不能得到两个可由固定校准句区分并经用户确认的临时 label，即产品完整可用 FAIL；不得加第二 diarizer。任一不确定片段必须 unknown，禁止错继承 trusted role。

PASS 候选还必须同时证明：archive/manifest 完整；interim 不落库、final-only 幂等且有序；duplicate/replay/out-of-order 被 fence；控制句不进普通 AI；当前 voice `final=1` 形成 attempt 级结构化 receipt；reopen/重连新 speaker stream 并重校准；Android 使用正式采集链路；断线时录音/安全结束继续。主动断线回归必须是：voice A 在 accepted PCM 后断线并形成未回补 gap；voice B 使用新 namespace/new speaker stream，成功 `final=1`、ingestion complete、attempt drain success；session/capture 仍为 `degraded/incomplete`。另须证明无 gap 多-attempt lane（A 在首个 PCM 前失败，或 A receipt 完整且 B 紧邻边界连续接管）可在 B receipt 完整后达到整场 `drained`。runtime/coverage evidence 丢失后即使新 voice 成功也保持 `degraded`，且本 SPEC 无 clear sticky 的入口。fake、单测、宣传或单次供应商运行均不得冒充真实 provider PASS。

`DEV-ASR-PROVIDER-001` 开工条件：本 SPEC exact-head 获项目负责人手动 PASS；测试环境的后端安全注入和预算/配额由负责人就绪但不进入仓库；腾讯账号具备目标引擎/并发；虚构剧本、受控 PCM、桌面/Android 与账单核对方案就绪；真实长者试点的 retention/DPA 门禁仍可保持阻塞。真实 LLM provider 只能在 DEV-ASR-PROVIDER-001 正式 PASS 后启动。
