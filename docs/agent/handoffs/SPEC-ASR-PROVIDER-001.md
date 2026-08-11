# SPEC-ASR-PROVIDER-001 交接

## 基本信息

- 状态：REVIEW；不得自宣 PASS/DONE
- base：`78a64252f253fc09cf87e89c5efe317512ad1243`
- branch：`codex/spec-asr-provider-001`
- final head / PR / CI：提交后补充并绑定 exact head

## 已冻结

- adapter v1→v2 唯一迁移：connect/ready 独立、PCM accepted 仅接管、异步 result sink、连接级 namespace/fence、结构化 drain evidence；
- 每个新腾讯 voice 新 `speaker_stream_id` 并重新校准；`enable_speaker_context=0`；unknown fail-closed；
- mono/16k/s16le/100ms 输入、200ms/6400-byte 1:1 pacing、interim display/final-only persist、稳定错误和有限重连；
- secret/授权/redaction/预算/指标/计费核对；训练/优化/测试授权 false；
- 约 8 分钟虚构标准普通话双人剧本、同 PCM 3 次 replay、桌面 Chromium、目标 Android、主动断线 lane。

## 官方事实分级

- verified：[V2](https://cloud.tencent.com/document/product/1093/131127) 的 handshake、voice_id、PCM、sentence_type、speaker_id=-1、final=1、签名/错误；[能力](https://cloud.tencent.com/document/product/1093/35682) 的目标引擎能力；[优化授权](https://cloud.tencent.com/document/product/1093/115535) 可关闭。
- inference：100ms→200ms backend 聚合/pacing、中国大陆项目授权边界。
- unknown：`speaker_diarization=1` wire 参数、真实双人 label 稳定性、speaker engine 实际计费 SKU、真实长者试点 retention/diagnostic/DPA。

## 风险和未决

- CON-027 阻塞真实长者/PII 试点，不阻塞完全虚构 DEV 验收。
- gap/backfill 仍归 HARDEN-ASR-001；真实 LLM 依赖 DEV-ASR-PROVIDER-001 正式 PASS。
- 当前未读取、索取、打印、写入或测试任何真实密钥，未调用真实 provider。

## 验证

- `format:check`、`git diff --check`、JSON parse、local Markdown link scan、lint、typecheck、build、smoke：PASS；smoke 使用隔离端口 3111/4177，首次默认 4173 因已有进程占用失败并保留记录。
- unit：45 files / 290 tests PASS；首轮与并行 build/lint/typecheck 同跑时 deadline 测试 1 次未进入 retry，定向 2/2 与独立完整复跑均 PASS，未修改测试目标。
- 空白隔离数据库 `elder_interview_spec_asr_001`：13 migrations deploy/status/重复 deploy PASS；integration 13 files / 76 tests PASS；auth 4 files / 23 tests PASS。首次未注入 URL 和随后共享 public 库残留污染均保留为环境失败；未删除共享数据。
- Chromium E2E 10/10 PASS；auth Chromium 4/4 PASS。auth 首次把 API 置于 3112 时因 Vite proxy 固定 3101 而 4 项登录前失败，恢复契约端口 3101 后完整通过；未改代码/测试。
- 本 SPEC 未执行真实腾讯、目标 Android provider、同 PCM 三次 replay 或主动断线 provider lane；这些是 DEV-ASR-PROVIDER-001 的正式验收，不得从当前工程门禁推导 PASS。

## 下一位必须先读

AGENTS、00-10、任务板、本任务卡、正式 v2 contract/profile、ADR-032、CON-027、本交接和 iteration journal。
