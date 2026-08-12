# SPEC-ASR-WIRE-PARAM-001 交接

## 当前结论

腾讯官方一手证据已推翻 ADR-032 中“`speaker_diarization=1` V2 wire 参数未证明”的供应商事实前提。本分支以 Proposed ADR-033 部分取代该窄事实，同时永久保留 ADR-032、SPEC-ASR-PROVIDER-001、REV-039 与旧交接的历史正文。

当前任务保持 `REVIEW`。CI 通过只表示候选可审，不代表项目负责人 PASS；执行 Agent 不宣布 DONE、不合并。

## 分支

- base：`origin/main@9c00d892e722f9973990698c8a7a52e5810833d7`
- branch：`codex/spec-asr-wire-param-001`
- PR：[non-Draft #29](https://github.com/Li-Ming-G/elder_interview_ai/pull/29)

## 精确契约变更

- `speaker_diarization=1`：实际 query 必发，进入 canonical query 与签名。
- `enable_speaker_context=0`：保持必发，进入 canonical query 与签名。
- `speaker_context_id`：实际 query 与 canonical query 均省略，不发送 `speaker_context_id=`。
- canonical 顺序：实际 query map（不含 `signature`）→ key 字典序 → HMAC-SHA1/base64 → URL encode signature 后追加。
- `16k_zh_en_speaker_2.0`、新 voice→新 speaker stream→重新人工确认、unknown fail-closed、安全/授权/原始证据边界均不变。

## 官方证据

- [会议话者分离指南](https://cloud.tencent.com/document/product/1093/130881)：关键参数与示例均为 `speaker_diarization=1`。
- [实时语音识别 V2](https://cloud.tencent.com/document/product/1093/131127)：目标 engine 支持且默认话者分离；签名覆盖实际 query。
- [官方 Go SDK 固定 commit](https://github.com/TencentCloud/tencentcloud-speech-sdk-go/commit/257f9f56bcd592bff1faea9b4ce0f1ef90cea803)：通用 recognizer 默认 0、专用 speaker recognizer 默认 1；wire query 包含 diarization/context key 并排序签名。

## 受控 DEV 接收边界

项目负责人对本 PR exact head 手动 PASS 后，`DEV-ASR-PROVIDER-001` 可按 `09` §15 用同一虚构 TTS PCM、`reconnect=0` 做一次诊断连接。该运行只验证请求按修正契约能否被受理并给出可诊断响应，不证明 close 1005 因果；仍失败时记录最小安全证据并转腾讯支持。

## 验证与未完成事项

- 本轮不读取密钥、不连接腾讯、不执行真实音频验证。
- 本地 `git diff --check` 通过；腾讯 profile 可由 Node `JSON.parse` 解析；`pnpm format:check` 通过。
- exact-head CI 结果以 non-Draft [PR #29](https://github.com/Li-Ming-G/elder_interview_ai/pull/29) 的 GitHub checks 为准。
- 待项目负责人：手动 GitHub 审查 non-Draft PR exact head；任务在此之前保持 REVIEW。
