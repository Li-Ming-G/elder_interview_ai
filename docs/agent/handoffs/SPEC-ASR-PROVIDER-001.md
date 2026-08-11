# SPEC-ASR-PROVIDER-001 交接

## 基本信息

- 状态：DONE（项目负责人 final exact-head PASS、merge 与 main CI 已完成）
- base：`78a64252f253fc09cf87e89c5efe317512ad1243`
- branch：`codex/spec-asr-provider-001`
- PR：[GitHub #28](https://github.com/Li-Ming-G/elder_interview_ai/pull/28)，已合并
- final head：`84a2173c2b95111d7432b5c3a026494a3f666a3f`；exact-head CI `31484868105` SUCCESS；merge `d7b318fd654d978b60799cd068cbbef33f9c4989`；main CI `31494227785` SUCCESS

## 正式审查历史

- 项目负责人对 PR #28 old exact head `8d9922bead9a7d70517bafe2245bc44a560b8dc5`、CI `31476068838` 给出正式 `REQUEST_CHANGES`，P0=0、P1=1。
- 唯一 P1：当前 voice/attempt 的 `final=1`、ingestion complete 与 drain success 不能掩盖此前已知未回补 gap。旧 head、旧 CI 与该结论永久保留；本轮只请求项目负责人定向复审此 P1。
- 项目负责人随后对 final head `84a2173c2b95111d7432b5c3a026494a3f666a3f`、CI `31484868105` 给出正式 `PASS`，P0=0、P1=0；该 P1 已关闭。PR #28 已合并，契约移交 DEV-ASR-PROVIDER-001。

## 已冻结

- adapter v1→v2 唯一迁移：connect/ready 独立、PCM accepted 仅接管、异步 result sink、连接级 namespace/fence、结构化 drain evidence；
- attempt lifecycle/receipt 与 session/capture completeness 分层；`no_known_gap -> known_unbackfilled_gap` 单向且跨新 voice 保留，后续 receipt success 不得 clear；
- voice A 未回补 gap → voice B 新 namespace/new speaker stream → B receipt success 后整体仍 `degraded/incomplete`；A 在首 PCM 前失败或 A/B 连续完整交接的无 gap lane 仍可整体 `drained`；
- runtime/coverage evidence 丢失时失败关闭为 `degraded`；当前无 clear/reset 路径，权威 gap ledger/backfill/重算留给 HARDEN-ASR-001；
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
- 权威 gap ledger/backfill/clear 仍归 HARDEN-ASR-001；当前仅冻结内存 sticky 聚合与既有 finalization 投影。进程重建可能保守误报 `degraded`，但不得假完整；真实 LLM 依赖 DEV-ASR-PROVIDER-001 正式 PASS。
- 当前未读取、索取、打印、写入或测试任何真实密钥，未调用真实 provider。

## 验证

- sticky completeness P1 定向修复：JSON parse、Draft 2020-12 Schema 自校验，以及 clean/gap/非法 clear 三组 fixture PASS；changed-Markdown local link scan、`git diff --check`、`format:check`、lint、typecheck、build PASS。
- unit：45 files / 290 tests PASS。全新专用空库 `elder_interview_spec_asr_001_p1`：13 migrations deploy/status/重复 deploy PASS；integration 13 files / 76 tests PASS；auth 4 files / 23 tests PASS。
- smoke 使用隔离端口 3111/4177 PASS；Chromium E2E 10/10 PASS；auth Chromium 4/4 PASS（API 3101、Web 4178）。本轮没有运行真实腾讯、真实密钥、目标 Android provider 或真实音频。
- 环境失败如实保留：integration 首次只注入 `DATABASE_URL`、缺 `TEST_DATABASE_URL`，13 suite 在 setup 前拒绝启动；补齐后旧隔离库存在前次测试残留，触发 FK/version 冲突。Prisma 安全保护拒绝 reset，未发生删除；随后新建空白专用库并完整通过，未修改代码或测试目标。

- `format:check`、`git diff --check`、JSON parse、local Markdown link scan、lint、typecheck、build、smoke：PASS；smoke 使用隔离端口 3111/4177，首次默认 4173 因已有进程占用失败并保留记录。
- unit：45 files / 290 tests PASS；首轮与并行 build/lint/typecheck 同跑时 deadline 测试 1 次未进入 retry，定向 2/2 与独立完整复跑均 PASS，未修改测试目标。
- 空白隔离数据库 `elder_interview_spec_asr_001`：13 migrations deploy/status/重复 deploy PASS；integration 13 files / 76 tests PASS；auth 4 files / 23 tests PASS。首次未注入 URL 和随后共享 public 库残留污染均保留为环境失败；未删除共享数据。
- Chromium E2E 10/10 PASS；auth Chromium 4/4 PASS。auth 首次把 API 置于 3112 时因 Vite proxy 固定 3101 而 4 项登录前失败，恢复契约端口 3101 后完整通过；未改代码/测试。
- 本 SPEC 未执行真实腾讯、目标 Android provider、同 PCM 三次 replay 或主动断线 provider lane；这些是 DEV-ASR-PROVIDER-001 的正式验收，不得从当前工程门禁推导 PASS。

## 下一位必须先读

AGENTS、00-10、任务板、本任务卡、正式 v2 contract/profile、ADR-032、CON-027、本交接和 iteration journal。
