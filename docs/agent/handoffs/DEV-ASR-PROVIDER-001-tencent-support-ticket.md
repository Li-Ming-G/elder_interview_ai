# DEV-ASR-PROVIDER-001｜腾讯云技术支持工单模板

> 用途：由项目负责人复制到腾讯云技术支持工单。任务状态仍为 `REVIEW`；提交工单不代表真实 provider、双人标签或产品验收通过。
>
> **提交前安全检查：不得粘贴 SecretId、SecretKey、signature、完整 WebSocket URL、完整 query、代理地址/凭据、Cookie/token、设备序列号、音频文件、音频正文、转录正文或 provider 原始响应正文。** 若腾讯支持需要定位，只在腾讯云工单的受控私密字段中补充最小必要标识。

## 工单标题

实时语音识别 V2 大模型2.0 speaker engine 在 code=0 后首个 PCM 包发送失败（Windows Node.js WebSocket）

## 产品与期望

- 产品：腾讯云语音识别 / 实时语音识别 V2（WebSocket）/ 大模型2.0版。
- Engine：`16k_zh_en_speaker_2.0`。
- 数据地域：国内站、中国大陆链路。
- 期望：WebSocket 协议握手返回 `code=0` 后，按 1:1 实时速率上传 16kHz 单声道 s16le PCM，获得句子模式结果和最终 `final=1`。
- 测试数据：本机离线中文语音合成器生成的 2 秒完全虚构普通话；不含真实长者、真实个人信息或生产数据。音频与文本不随工单上传。

## 精确失败时间窗

- 北京时间（UTC+8）：`2026-08-12 11:37:07.898` 至 `2026-08-12 11:37:08.867`。
- UTC：`2026-08-12 03:37:07.898Z` 至 `2026-08-12 03:37:08.867Z`。
- 时间来源：本地 Codex 工具调用开始/安全结果返回时间戳；窗口约 969ms。
- 腾讯云账号/AppID：请由提交者在腾讯云工单受控字段中选择关联账号，本文不复制具体值。
- `voice_id`：当前安全 stdout 未输出具体值。如项目负责人能从本地私密诊断中取得，请仅在腾讯云工单受控字段复制；不要粘贴到协作聊天、Git、PR 或公开附件。
- provider request/message ID：当前安全 stdout 未输出具体值。如本地私密诊断确有记录，处理方式同上；不要提交完整响应正文。

## 实际非敏感请求选择

请求 endpoint 为腾讯官方 `wss://asr.cloud.tencent.com/asr/v2/{appid}`，不在工单中粘贴实际 AppID、完整 URL 或 query。静态/业务 query 选择如下，均参与按参数名 ASCII/词典序构造的 canonical query 和 HMAC-SHA1 签名（`signature` 本身除外）：

- `engine_model_type=16k_zh_en_speaker_2.0`
- `voice_format=1`（PCM）
- `needvad=1`
- `result_mod=1`
- `sentence_strategy=1`
- `speaker_diarization=1`
- `enable_speaker_context=0`
- `speaker_context_id`：整个 key 完全省略，不发送空值
- `convert_num_mode=1`
- `reinforce_hotword=0`

动态鉴权参数 `secretid`、`timestamp`、`expired`、`nonce`、`voice_id` 与 `signature` 均实际提供，但本工单正文不包含其值。签名覆盖 host/path 与除 `signature` 外的全部实际 query；HMAC-SHA1 后 base64，最终 signature 做 URL percent encoding。

## PCM 与发送行为

- 编码：signed PCM little-endian，16-bit（`pcm_s16le`）。
- 采样率：16000Hz。
- 声道：mono。
- 文件总长度：64000 bytes / 2 秒。
- provider packet：6400 bytes / 200ms，按 1:1 实时时序发送；与腾讯官方 Go V2 示例一致。
- 本次只建立一个连接，`reconnect=0`。
- 腾讯文本握手已返回 `code=0`。
- 首个 6400-byte binary packet 已进入本地发送尝试，但 WebSocket 发送回调没有确认成功：`pcmAttemptedBytes=6400`、`pcmSentBytes=0`。
- 随后没有收到 final；structured drain 未完成；没有自动第二次连接。

## 本地安全错误摘要

- stable safe code：`ASR_PROVIDER_UNAVAILABLE`
- category：`network`
- transport error class：`unknown_transport`
- phase：`tcp`
- handshake complete：`true`
- provider non-zero numeric code：无
- HTTP upgrade rejection status：无
- TLS error class：无
- WebSocket close code：本次未取得
- final：未观察到
- drain：未完成
- 本次估算 billed seconds / CNY：`0 / 0`；实际以腾讯日结账单为准

以上仅是白名单诊断字段；不附带 provider message、close reason、HTTP body、URL/query 或签名。

## 客户端环境

- OS：Microsoft Windows 11 家庭版 中文版，64-bit。
- Windows version/build：`10.0.26200` / `26200`。
- Node.js：`v24.18.0`。
- WebSocket library：`ws 8.21.2`。
- WebSocket compression：显式 `perMessageDeflate=false`。
- 未配置自定义 proxy agent；未将系统代理地址或凭据传入 `ws`。

## 已完成的排查

1. 系统 DNS lookup 可解析 `asr.cloud.tencent.com`；当前 `ws` 使用的系统 lookup 路径可工作。
2. IPv4 TCP 443 可建立连接。
3. TLS SNI 握手成功；证书授权通过，协商 TLS 1.2 / ALPN `http/1.1`。
4. WebSocket HTTP upgrade 成功，且腾讯协议文本握手返回 `code=0`；因此不是本次 HTTP upgrade 403、TLS 证书或签名拒绝。
5. 已按腾讯文档和官方 SDK 逐项验证 canonical query：Host/path、ASCII key 排序、HMAC-SHA1/base64、signature 的 `+`/`/`/`=` percent encoding。
6. 已补齐句子模式/default 参数，并按已审正式契约发送 `speaker_diarization=1`、`enable_speaker_context=0`，省略 `speaker_context_id`。
7. 已使用本地 fake HTTP/WebSocket server 验证：binary frame、正常 `final=1`/close、close code、upgrade status、安全错误传播均可工作；敏感 body/query/reason 不进入错误。
8. 已禁用 per-message deflate；结果不变。
9. 已分别使用非语音合成波和严格格式的离线虚构普通话 TTS PCM；均在 code=0 后首包阶段失败，因此不是只由纯音调输入导致。
10. 官方 Go/Python V2 SDK 均先同步读取 `code=0` 后再发送 binary；当前顺序一致。官方 V2 示例使用 6400 bytes/200ms；当前 pacing 一致。
11. 账号此前返回过资源/欠费类错误，但充值/后付费处理后当前请求已获得 `code=0`，本次不再映射 quota、欠费或未开通错误。

## 希望腾讯技术支持明确回答

1. 请按关联账号/AppID、上述 UTC/北京时间窗口和（如私密补充的）`voice_id` 查询服务端日志：为什么返回 `code=0` 后，在首个 binary PCM frame 前后连接即不可用？
2. `code=0` 是否仅表示签名/参数通过，还是也表示 `16k_zh_en_speaker_2.0` 实例已成功分配并可接收音频？该窗口是否存在未下发给客户端的内部错误码或关闭原因？
3. 请确认该账号是否已具备“实时语音识别（大模型2.0版）”及 `16k_zh_en_speaker_2.0` 的完整调用权限、正确产品映射和计费 SKU；是否还需要白名单、灰度资格或额外开通动作？
4. 请确认以下组合是当前正式有效的 speaker V2 wire 组合：`speaker_diarization=1`、`enable_speaker_context=0`、完全省略 `speaker_context_id`。是否还存在未公开但必需的 query 参数？
5. 请确认 PCM 首包 6400 bytes/200ms、后续 1:1 pacing 对该 engine 有效。文档另有 1280 bytes/40ms 建议时，二者是否都受支持，是否会影响首包连接存活？
6. 本次客户端没有收到 WebSocket close code。服务端是否记录了 close frame、TCP reset、网关主动断开、引擎分配失败或 WAF/接入层策略命中？请提供可公开的错误类别或 numeric code，不要要求我们在普通文本发送密钥/签名。
7. 国内站该 endpoint 是否存在源 IP、IPv4/IPv6、TLS、User-Agent、Origin、WebSocket subprotocol 或企业网络出口限制？官方 SDK 是否设置了当前文档未说明的必需 header/option？
8. 如果需要下一次最小复现，请给出一次连接即可验证的、安全且非破坏性的具体差异项；我们不会在没有新假设时重复连接或盲目消耗额度。

## 可提供但不在正文附带的材料

- 本地离线生成的 canonical-query 单元测试结果（只展示参数名/固定测试值，不含真实凭据）。
- 本地网络/TLS 白名单诊断摘要。
- 本地 fake WebSocket 回归结果。
- 由提交者在腾讯工单受控私密字段补充的 `voice_id` / provider request ID（仅当本地确有记录）。

明确不提供：SecretId、SecretKey、signature、完整 URL/query、代理凭据、音频文件、音频/转录正文、provider 原始响应正文。

## 腾讯支持回复与单变量诊断补充（2026-08-12）

- 工单 `202608125900` 的原始提交快照如上，历史 query 选择中的 `result_mod=1` 不被静默改写。
- 腾讯支持建议下一次针对实时语音识别 V2（话者分离）的诊断完全省略 `result_mod`，并保留更常用于该 lane 的 `sentence_strategy=1`。这是本工单的供应商支持建议，不表述为官方公共文档事实。
- 离线候选 query 已完全移除 `result_mod` key（不是 `0` 或空值）；`speaker_diarization=1`、`enable_speaker_context=0`、`sentence_strategy=1` 保持，`speaker_context_id` key 继续完全省略。engine、PCM、6400 bytes/200ms、账号/endpoint 与 reconnect=0 均不改变。
- 尚未获 live probe 明确授权，因此没有建立新连接或上传 PCM。若获授权，只执行一次相同虚构 TTS PCM 的单连接 probe；唯一有意变量为省略 `result_mod`，不得自动追加第二连接。

## 单变量建议的受控复现结果（2026-08-13）

- 已离线证明复用上一轮同一 64,000-byte 虚构 zh-CN TTS PCM；同账号/endpoint/engine、6400 bytes/200ms、1:1 pacing、reconnect=0 均不变。唯一有意 wire 变量为完全省略 `result_mod`。
- UTC `2026-08-12T16:06:16.880Z–16:06:17.601Z` / 北京时间 `2026-08-13 00:06:16.880–00:06:17.601` 恰好一次连接：腾讯 `code=0` 后，首个 6400-byte packet attempted、0 confirmed；无 provider numeric code/close code/final/drain，客户端安全类别仍为 network、`unknown_transport`/tcp；估算费用0。
- 没有第二连接。该结果只证明省略 `result_mod` 未恢复本次客户端 lane，不推断服务端根因。请腾讯支持按新时间窗和工单私密关联信息继续定位；SecretId/SecretKey/signature/完整 URL/query/路径/音频/正文仍不得进入普通工单正文。

## 对腾讯“客户端断开”回复的拟答复（尚未再次连接）

您好，感谢确认该 engine/账号正常、参数无明显异常且无额外限制。该情况在充值/开通后的连接4–13连续10次均稳定表现为 `code=0` 后首包阶段失败；早期连接1–3含quota/握手前transport，不计入同一症状。

我们已离线定位到客户端确定性缺陷：当前环境 Node `v24.18.0`、`ws 8.21.2` 中，`WebSocket.send(..., callback)` 成功时 callback 参数为 `null`；客户端此前只把 `undefined` 视为成功，因此把已进入本地服务端的首个binary误判为transport error并主动close。这与贵方日志中的“客户端连接端开”一致。我们已将成功判定修正为 `undefined | null`，本地真实WebSocket server按code0→等待→10个6400-byte包→end→final=1→close/drain链路验证通过；connect/ready/drain/accept、Abort/cancel、reconnect、budget、listener顺序及ping/idle均已排除为该根因。

目前未再次连接腾讯。如获项目内部授权，我们将使用同一虚构TTS PCM、同账号/endpoint/engine/query、6400 bytes/200ms、reconnect=0做恰好一次post-fix复现，并回传新的UTC/北京时间窗及非敏感结果。若仍失败，请贵方按该新窗口提供：服务端收到的首个binary时间/字节数、服务端记录的close发起方与close code、引擎request/voice关联状态、网关或引擎内部numeric error。请勿要求在普通文本提供secret、signature、完整URL/query、音频或转录正文。
