# SPEC-ASR-WIRE-PARAM-001｜腾讯 V2 话者分离 wire 参数正式修正

## 目标

在不修改业务代码、不连接腾讯的前提下，以腾讯官方会议话者分离指南、V2 文档和固定版本 Go SDK 修正已过时的 `speaker_diarization` wire 事实，为 `DEV-ASR-PROVIDER-001` 解锁一次受控诊断连接。

## 状态

状态只以 `docs/agent/00-task-board.md` 为准。当前为 `REVIEW`；[PR #29](https://github.com/Li-Ming-G/elder_interview_ai/pull/29) 为 non-Draft，必须等待项目负责人对其 exact head 手动审查，执行 Agent 不得宣布 PASS、DONE、merge。

## 历史与修正方式

- ADR-032 与 SPEC-ASR-PROVIDER-001 在 2026-08-11 基于当时已核对资料，记录“`speaker_diarization=1` 未证明、禁止发送”；其 Accepted/PASS 历史永久保留。
- 新增 Proposed ADR-033，只部分取代 ADR-032 的上述供应商事实，不改变其余 adapter v2、namespace、drain、completeness、安全和验收决定。
- 未出现新的产品或数据治理冲突，不新增 CON；CON-027 继续 OPEN。

## 官方一手证据

1. [腾讯会议话者分离指南](https://cloud.tencent.com/document/product/1093/130881) 把 `speaker_diarization=1` 列为关键参数，并在 Go 示例显式赋值。
2. [腾讯实时语音识别 V2](https://cloud.tencent.com/document/product/1093/131127) 明确 `16k_zh_en_speaker_2.0` 支持且默认开启话者分离，并定义 speaker context 参数与签名原文规则。
3. [腾讯官方 Go SDK 固定 commit `257f9f56`](https://github.com/TencentCloud/tencentcloud-speech-sdk-go/commit/257f9f56bcd592bff1faea9b4ce0f1ef90cea803) 中通用 `RealtimeRecognizerV2` 默认 `SpeakerDiarization=0`，专用 `SpeakerRecognizer` 默认 `SpeakerDiarization=1`；构造 URL 时将 `speaker_diarization`、`enable_speaker_context` 放入 query，对 query key 排序后签名。

## 冻结契约

- 目标 engine 仍为 `16k_zh_en_speaker_2.0`，内部 `diarization_required=true` 不变。
- 实际 query 必须含 `speaker_diarization=1`、`enable_speaker_context=0`，两者必须进入签名 canonical query。
- `speaker_context_id` 必须从实际 query map 与 canonical query 中完全省略，不得发送空值。
- 先构造除 `signature` 外的实际 query map，按 parameter name 字典序形成 canonical query，再 HMAC-SHA1/base64，最后 URL encode 并追加 `signature`。
- 新 `voice_id` → 新 `speaker_stream_id` → 重新人工确认不变；unknown fail-closed、原始录音优先与全部数据治理门禁不变。

## 受控验证边界

只有本任务 exact head 获项目负责人手动 PASS 后，DEV 才可用同一份虚构 TTS PCM、同一账号/endpoint/engine/其余 query、单连接、`reconnect=0` 做恰好一次诊断连接。该运行不证明 close 1005 根因，也不替代双人 label、三次 replay、Android、主动断线、账单或完整 provider PASS。仍失败时只保留无敏感正文的 request ID、时间和安全错误分类，停止继续参数试错并走腾讯支持。

## 非目标

业务代码、Prisma、migration、provider 实现、密钥、部署、真实腾讯调用、第二 provider/diarizer、真实长者/PII、close 1005 根因结论。

## 交付

- `docs/contracts/streaming-asr-provider-v2.md`
- `docs/contracts/tencent-realtime-asr-v2.profile.json`
- ADR-033、任务板、追踪矩阵、交接与 iteration journal

## 开工基线

`origin/main@9c00d892e722f9973990698c8a7a52e5810833d7`，branch `codex/spec-asr-wire-param-001`。
