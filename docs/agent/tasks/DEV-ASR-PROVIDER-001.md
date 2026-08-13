# DEV-ASR-PROVIDER-001｜腾讯实时 ASR V2 adapter v2 实现与真实验收

- 状态：`REVIEW`（真实 provider、同 PCM 三次 replay、桌面/目标 Android 正式链路与受控故障闭环已完成；等待实际账单核对、最新 exact-head CI 与项目负责人手动审查）
- 分支：`codex/dev-asr-provider-001`
- exact base：`9c00d892e722f9973990698c8a7a52e5810833d7`
- 审查边界：执行 Agent 只交付 non-Draft PR 与 exact-head 证据，不自宣 PASS/DONE、不合并

## 开工门禁

仅在 SPEC-ASR-PROVIDER-001 non-Draft PR exact head 获项目负责人手动 PASS 后开工；状态以任务板为准。测试账号目标引擎/并发、安全后端 secret 注入、显式开发预算/配额、虚构剧本、受控 PCM、桌面 Chromium 和目标 Android 必须就绪。

## 实现范围

原子迁移生产 `StreamingAsrAdapter` v1→v2；更新 gateway/runtime/finalization/config/metrics/test；实现腾讯签名、握手、pacing、异步 sink、连接级 namespace、有限重连、fencing、结构化 drain 和安全错误。不得保留 v1/v2 并行生产 truth source。

## 验收

严格执行 `09` §15 和正式 v2 contract：同 PCM 真实 replay 3 次、桌面/Android 正式链路、主动断线、archive/manifest、final-only 幂等、两个可校准 label、unknown fail-closed、控制句排除、当前 voice 明确 drain、预算/账单核对。

## 非目标

Prisma migration、第二 provider/diarizer、gap/backfill、真实 LLM、真实长者/PII、生产部署。若需要改变公共状态、数据库权威事实、校准体验或数据授权，先暂停并更新 SPEC。

## 当前 REVIEW 阻塞（2026-08-11）

- 工作树基于 exact base `9c00d892e722f9973990698c8a7a52e5810833d7`，已形成 v1→v2 单一生产 truth source 的未提交实现候选；尚无 exact final head、PR 或 CI，不得视为可审查终稿。
- 本地门禁已通过：format、lint、typecheck、build；unit 46 files / 301 tests；PostgreSQL integration 13 files / 77 tests；auth 4 files / 23 tests；smoke；Chromium 10/10；auth Chromium 4/4。并行全量 unit 曾出现一次既有 AI 80ms 计时抖动，隔离全量复跑通过；首次 auth Chromium 使用错误 API 端口导致 4 项未进入应用，改用正式固定代理端口后 4/4 通过，均保留为测试环境记录而非实现结论。
- 项目负责人完成安全后端注入后，只通过配置加载结果验证 required config 可用，未读取、打印、回传或提交 secret。前两次获授权的最小真实 provider synthetic probe 在握手阶段返回稳定映射 `ASR_QUOTA_EXHAUSTED`。只读核对确认正式契约有意合并腾讯 `4004` 资源包耗尽与 `4005` 账户欠费，但实现诊断层不应丢失可安全报告的官方数值码；现已在不改变稳定业务码的前提下保留 `providerCode`，定向 9 tests 与 typecheck 通过，不记录 provider message。项目负责人明确确认大模型2.0后付费已开启并第三次严格授权一次约 2 秒纯合成 probe 后，配置仍有效，但本次在收到腾讯 JSON 前以 `ASR_PROVIDER_UNAVAILABLE` / `network` 结束，无官方数值码、未上传 PCM。
- 按任务边界已停止全部新 connect，未自动重试、提额或购买。正式同 PCM 三次 replay、桌面正式 lane、主动断线 lane、账单 SKU/实际费用和目标 Android 新证据均未执行；双人可校准 label 硬门槛尚未验证，不能自宣 PASS/DONE。
- 上一轮 Codex usage limit 中断仅作为环境中断记录，不是实现或验收结论。第三次获授权的唯一 probe 在 transport/upgrade 层失败后已再次停止全部新 connect；当前证据不能再推断为负责人未开通，也没有官方证据证明后付费存在特定生效延迟。继续工作需要项目负责人决定是否向腾讯支持提交账号/时间窗口/安全请求标识等不含密钥的工单证据并另行授权；执行 Agent 不自行重试。CON-027 继续阻塞真实长者/PII。

## 严格离线/基础链路诊断（2026-08-12）

- 全程未创建腾讯 WebSocket/识别会话、未携带 URL query、未上传 PCM、未加载 `.env.local`。系统 resolver 对 `asr.cloud.tencent.com` 返回 1 个 IPv4；Node c-ares `resolve4/resolve6` 均为 `ECONNREFUSED`，但当前 `ws`/`https.request` 使用的系统 lookup 路径正常。裸 TCP 443 约 35ms 成功；仅 TLS ClientHello/SNI 约 64ms 成功，证书授权通过、TLS 1.2、ALPN `http/1.1`。
- 环境只报告到变量名层：存在 `HTTP_PROXY`/`HTTPS_PROXY`，Windows Internet proxy enabled、无 PAC，WinHTTP direct；未读取或输出代理地址/凭据。`ws@8.21.2` 官方本地 README 要求显式 custom agent 才走代理，当前 `new WebSocket(url)` 未传 agent；带现有代理环境的本地 fake server 直连成功。因此系统/环境代理不是当前 Node `ws` 的已证拦截点，但外围防火墙或真实 upgrade 路径仍未被无会话诊断证明。
- 实现修复：安全保留 HTTP upgrade status、TLS/transport 固定错误类及 WebSocket close code，禁止 body/reason/URL/query；live probe/replay 只输出白名单诊断。修正 `final=1` 后 provider 正常 close 被误报 network 的竞态；final 先标记、仍等待 sink 完成后 drain。
- 签名/配置硬化：AppID 必须为数字；canonical query 使用明确 ASCII key order；Host/path、排除 signature 的 HMAC-SHA1 输入、5 分钟 expired、nonce/voice_id、最终 signature 的 `+`/`/`/`=` percent encoding、禁止 speaker context/diarization 均有逐项断言。未读取当前注入值。
- 本地 fake HTTP/WebSocket server 证明 403 upgrade 只保留 status 且不泄露 body/query，close 1013 只保留 code，DNS/TLS 类别固定，`final=1` 后 close 可正常 drain。最新 format/lint/typecheck/build、unit 46 files / 304 tests 通过；定向 config+adapter 16 tests 通过；无 PCM replay harness 的 fail-closed 输出保持安全。
- 结论：基础网络/TLS 可达，当前 Node `ws` 不消费系统/环境代理；实现确有诊断、正常 close 和配置/canonicalization 硬化缺口，现已本地关闭。第三次真实失败的根因仍无法离线定为本地网络或腾讯侧；下一次单 probe 的诊断已充分，现申请总控在愿意时另行授权严格一次最小 probe。授权前继续禁止真实 connect。

## 第四次严格单连接 probe（2026-08-12）

- 项目负责人明确“授权再试一次”后，live harness 先离线强制 `ASR_RECONNECT_MAX_ATTEMPTS=0`，保证本轮恰好一个 provider connection；成功/失败输出缩减为用户批准的配置、握手、PCM、final/drain、白名单错误与估算费用字段。
- 唯一连接结果：`configValid=true`；腾讯 `code=0` 协议握手完成；随后在实际发送 PCM 前进入 `ASR_PROVIDER_UNAVAILABLE` / `network`；`pcmSentBytes=0`、无 provider numeric code、无 HTTP status/TLS class/close code、final 未证明、drain=false、估算 CNY 0。没有第二连接、没有 3 replay 或桌面 lane。
- 该证据证明本次签名/AppID/请求引擎入口与账号服务门禁被腾讯握手接受，不再支持“后付费未开通/资源包耗尽/欠费”解释；失败收窄到握手后、首 PCM 前的 WebSocket close/transport 窗口。由于 live catch 取得的是 failed drain 的旧通用错误，而 `onStatus` 当时未保存，close code 未随本次输出保留，不能回溯推断。
- 随后仅离线修复诊断传播：attempt 保存首次安全 failure，failed drain 原样传播；live harness 在主 error 缺字段时合并最后一个 `onStatus` 白名单诊断。local fake close 1013→failed drain 的回归通过；config+adapter 定向 17 tests、全量 unit 46 files / 305 tests、lint、typecheck、diff check 通过。没有再次连接腾讯。
- 当前需要总控决定下一步；不得自动再 probe。若未来另行授权，安全输出可保留该握手后 close code/transport class；任务仍为 REVIEW。

## 站立预算授权后的真实诊断与正式契约阻塞（2026-08-12）

- 项目负责人将本轮腾讯 ASR 外部费用硬上限设为 CNY 20、CNY 15 预警；正式运行配置仍保留更严格的 CNY 5/day 与 7200 seconds/day，不因临时授权改变 machine contract。累计真实连接为 11；均为零自动重连。连接 1-3 为早期 quota/transport 诊断，连接 4-11 均曾进入腾讯 `code=0` 握手；没有 final 或 drain 成功。
- 腾讯官方 Go/Python V2 SDK（2026-07-13 源码）证明其同样先同步读取 `code=0` 再允许 PCM，并以 6400 bytes/200ms 发送；当前 adapter 的握手顺序和正式 pacing 因此不是偏差。当时实现按固定 SDK 快照携带的 query 补齐了 `result_mod=1`、`sentence_strategy=1` 及默认 `needvad=1`、`convert_num_mode=1`、`reinforce_hotword=0`。这只证明该 SDK 快照的固定行为，不等同于 `result_mod` 是公共 V2 强制事实；后续工单建议及本轮纠正见下文，正式历史连接事实不改写。
- 参数修复后的连接 10 使用 2 秒双频合成波，连接 11 使用本机离线 `zh-CN` 语音合成器生成的 2 秒完全虚构普通话 PCM；两次均为 `configValid=true`、腾讯 `code=0`、随后 close `1005`、`ASR_PROVIDER_UNAVAILABLE/network`、0 confirmed sent bytes、无 final/drain。两次各记录 12800 attempted bytes；由此发现 failed pump 与 drain 竞态会对已关闭 socket 再尝试一次发送，现已修复为只尝试首个 6400-byte packet、原始 failure/gap/status 不重复，定向回归通过。
- 历史连接在加入 attempted metric 前无法证明首包绝对未进入 socket；保守上界按 8 个 code0 连接各 1 秒计为 8 attempted-equivalent seconds。腾讯官方计费页说明失败调用不计费、成功时最低按 1 秒且大模型2.0后付费为 CNY 1/hour，因此当前估算 billable seconds/CNY 均为 0，实际 SKU/账单仍待控制台日结核对；远未接近 CNY 15/20 门槛。
- 当前官方 SDK 与正式 profile 出现需要治理的差异：SDK 总是发送 `speaker_diarization=0` 与空 `speaker_context_id`，并说明要话者分离需显式启用；正式 profile/ADR-032 则要求内部 `diarization_required=true`、禁止发送未经正式文档证明的 `speaker_diarization` 且不发送 `speaker_context_id`。在腾讯连续 `code=0 -> 1005` 且排除基础 DNS/TCP/TLS、proxy、签名、握手顺序、官方 packet size、缺省句子参数与非语音输入后，剩余根因无法在不改变正式 wire contract 或取得腾讯支持证据的情况下继续隔离。
- 已停止全部新 connect，不执行 3 replay、桌面、fault 或 Android；不得以继续消耗预算试探。总控需决定先取得腾讯支持的非敏感账号/engine 证据，或另起正式契约变更审查是否允许受控 `speaker_diarization` wire 参数。当前无 final head、PR、CI，任务保持 REVIEW；CON-027 继续阻塞真实长者/PII。

## PR #29 wire 修正后的唯一受控 probe（2026-08-12）

- docs-only SPEC PR #29 exact head `650f856c918639a7b992294b805873d7052ab44e` 获项目负责人手动 PASS（P0/P1/P2=0），merge/main `1e18ea83cd5a1d4953bb92fd251637ed6107c322`。在不丢弃当前未提交实现的前提下，只将 `speaker_diarization=1` 加入实际 query map；它与 `enable_speaker_context=0` 一起按 key 字典序进入 canonical query/HMAC，`speaker_context_id` 整个 key 继续省略。
- 离线证据：adapter/config 18/18；format、lint、typecheck、build、`git diff --check` 通过。测试同时断言两个必发参数实际发送且参与签名、context ID key 缺失、signature 特殊字符 percent encode。
- 严格复用此前同一个 64000-byte、2 秒、16k mono s16le、本机离线 zh-CN TTS 完全虚构 PCM；harness 强制 reconnect=0。恰好一次连接结果：config valid、腾讯 code0 handshake complete；6400 bytes attempted、0 confirmed；无 final/drain；`ASR_PROVIDER_UNAVAILABLE/network`；transport `unknown_transport` / phase `tcp`；估算 billed 0 秒/CNY 0。
- 本轮后没有第二连接。累计真实连接 12；正式 speaker wire 修正未关闭握手后/首包发送失败，且本次未获得 close 1005。禁止继续重复未变化连接；3 replay、桌面、fault、账单与 Android 均未开始。建议下一步由总控使用非敏感时间窗/engine/code0→首包失败证据联系腾讯支持；任务保持 REVIEW，无 final head/PR/CI。
- 已形成可直接提交的[腾讯云技术支持工单模板](../handoffs/DEV-ASR-PROVIDER-001-tencent-support-ticket.md)：绑定北京时间/UTC 毫秒级窗口、环境/PCM/query 选择、排除项和明确问题；voice/request ID 只留本地私密补充占位。模板明确禁止 secret、签名、完整 URL/query、代理凭据、音频和转录正文。

## 外部支持阻塞（2026-08-12）

- 项目负责人已向腾讯云提交技术支持工单 `202608125900`。提交材料使用已审安全模板，只报告非敏感时间窗、engine、PCM/query 选择、环境、白名单错误与排查结论；没有授权把 secret、signature、完整 URL/query、代理凭据、音频或转录正文写入仓库/聊天。
- 当前任务按治理语义从 `REVIEW` 转为 `BLOCKED`：实现候选和本地工程门禁仍保留，但真实 provider 无法完成首包、final/drain、三次 replay、桌面、fault、账单或 Android 验收。外部支持回复前禁止建立任何 provider 连接，也不创建 PR、提交或合并。
- 恢复条件必须同时满足：腾讯工单提供可执行且非敏感的根因/账号或协议结论；总控与项目负责人完成回复复核并明确授权恢复；若回复要求改变正式 wire/engine/provider/验收语义，先完成对应 docs-only 契约 exact-head PASS 与 merge；随后才可在原工作树中按一个新离线假设执行 reconnect=0、相同虚构 TTS PCM 的单次受控 probe。
- 腾讯仅回复“重试”、未给新诊断依据，或要求在普通文本提供密钥/签名/完整请求时，不满足恢复条件；继续保持 `BLOCKED` 并请求安全升级路径。

## 腾讯工单 `result_mod` 单变量诊断（2026-08-12）

- 腾讯工单 `202608125900` 回复建议：对实时语音识别 V2（话者分离）删除 `result_mod=1`，使用既有 `sentence_strategy`；该回复是供应商支持针对本次故障给出的单变量诊断假设，不冒充官方公共文档或新正式契约。
- Accepted ADR-033/profile 没有要求 `result_mod`。当前未提交实现已在离线层从实际 query map、canonical/HMAC 输入及 allowlist 断言中完全省略该 key；不是传 `0` 或空值。`sentence_strategy=1`、`speaker_diarization=1`、`enable_speaker_context=0` 保持，`speaker_context_id` 继续完全省略；engine、PCM、6400 bytes/200ms pacing 与 reconnect 逻辑未变。
- 离线证据：adapter+config 定向 2 files / 18 tests；format、lint、typecheck、build、`git diff --check` 均通过。生产 adapter 的 `result_mod` 命中为 0，测试保留 1 个显式 absence 断言；排除 `.env.local` 与受跟踪模板后的 credential/private-key/secret-assignment 模式扫描为 0。
- 本节只记录离线候选；未建立腾讯连接、未上传 PCM、未读取 `.env.local`，任务继续 `BLOCKED`。未来必须由总控/项目负责人明确授权后，才可复用同一虚构 TTS PCM、同账号/endpoint/engine、reconnect=0、恰好一个连接执行唯一 probe；唯一有意变量是完全省略 `result_mod`，无论成功或失败都不得自动追加第二连接。

## `result_mod` 唯一 probe 的 PCM 等同性预检阻塞（2026-08-13）

- 项目负责人已明确授权一次 ASR probe。执行前先完成不连接 provider 的等同性检查：当前 build 通过；实际 query 继续完全省略 `result_mod`，保留 `sentence_strategy=1`、`speaker_diarization=1`、`enable_speaker_context=0` 并省略 `speaker_context_id`；probe 继续强制 reconnect=0。
- 预检只读取非凭据变量 `ASR_LIVE_SYNTHETIC_PCM_PATH` 的存在性，不读取或输出任何 secret、路径、URL/query/signature 或正文。当前安全注入进程没有该变量，稳定预检类别为 `fixture_path_missing`。脚本在缺少该变量时会回退到双频合成波，不能证明复用上一轮同一 64000-byte、2 秒虚构 zh-CN TTS PCM，也就不能证明唯一有意变量仅为省略 `result_mod`。
- 按授权边界在 `adapter.open` 前停止：本轮 provider connection count=0、未获得 code0、attempted/confirmed PCM 均为 0、无 provider numeric code/category、无 close/transport、final/drain 均未尝试、估算 billed seconds/CNY 均为 0。没有消耗唯一连接，也没有第二连接。
- 任务继续 `BLOCKED/REVIEW`。恢复前须在本地安全环境重新提供上一轮同一 TTS fixture 的绝对路径，并在不输出路径/内容的条件下证明文件仍为同一 64000-byte PCM；随后由总控明确恢复本次唯一 probe，执行 Agent 不自行沿用授权连接。

## omit-`result_mod` 唯一真实 probe（2026-08-13）

- 总控在系统临时目录安全 roots、Depth≤4 的只读查找中提供上一轮 TTS 资产的非敏感身份。执行 Agent 独立复核 3 个去重安全 temp roots：64,000-byte `.pcm/.raw/.bin` 候选恰好 1 个，其 basename、UTC mtime 与 SHA-256 均与给定事实完全一致；绝对路径未输出、未写入 `.env.local`，只注入唯一 probe 子进程。
- 连接前重新 build 并运行 adapter+config 2 files / 18 tests；source/dist 均零 `result_mod` 命中，保留 `sentence_strategy=1`、`speaker_diarization=1`、`enable_speaker_context=0`、omit `speaker_context_id`，harness 强制 reconnect=0。由此证明本次相对上一轮的唯一有意 wire 变量是完全省略 `result_mod`。
- 唯一 provider 时间窗：UTC `2026-08-12T16:06:16.880Z–16:06:17.601Z`；北京时间 `2026-08-13 00:06:16.880–00:06:17.601`。connection count=1；腾讯 `code=0` handshake complete；PCM 6400 bytes attempted、0 confirmed；无 provider numeric code；stable `ASR_PROVIDER_UNAVAILABLE` / category `network`；无 close code，transport `unknown_transport` / phase `tcp`；final 未观察、drain=false；估算 billed seconds=0、CNY 0。
- 本轮没有第二连接，也没有 3 replay、桌面、fault 或 Android。Verified observation 是完全省略 `result_mod` 后仍复现 code0→首包未确认/transport failure；因此该单变量不足以恢复当前 lane，但不能据此推断腾讯服务端根因或实际账单。累计真实连接更新为 13；任务保持 `BLOCKED/REVIEW`，等待腾讯支持/总控提供新的可执行结论，不创建 commit/PR/CI。

## 腾讯“客户端断开”回复后的离线根因审计（2026-08-13）

- 腾讯工单 `202608125900` 新回复确认：引擎和账号正常、参数无明显异常、无额外限制；腾讯日志将现象归为客户端断开，并要求核对超时/自动断连。该结论与本地最小复现共同把根因收敛到客户端 transport callback。
- 已证最小根因：Node `v24.18.0` / `ws 8.21.2` 的 `WebSocket.send(data, callback)` 在成功时以 `null` 调用 callback；当前 `WsTencentProtocolConnection.send` 只接受 `undefined` 为成功，故把 `null` 交给 transport classifier，伪造 `ASR_PROVIDER_UNAVAILABLE/network/unknown_transport/tcp`，随后 failure handler 主动 `close()`。这精确解释历史 `code0`、6400 attempted、0 confirmed、腾讯看到客户端断开的组合。
- 修复严格限定为成功 callback 同时接受 `undefined | null`；真正的 `Error`、非 OPEN、close code、安全诊断、retry/gap/drain/fence 均保持原语义。没有放宽正式 drain、sticky completeness、late fence、授权、安全、speaker contract，也没有增加 provider。

### Timeout / auto-close 审计表

| 位置 | 时长 | 触发条件/动作 | 根因结论 |
|---|---:|---|---|
| adapter connect deadline | 默认 5000ms | TCP/TLS/upgrade 未完成则 reject/abort；open 后 timer 清除 | 不是；live 已 code0，且失败窗约721ms |
| adapter ready deadline | 默认 5000ms | upgrade 后未收到 code0；code0 resolve 后 timer 清除、controller置空 | 不是；本地把门槛压到20ms并在 code0 后等待60ms仍保持 OPEN |
| adapter drain deadline | 默认10000ms | flush、end 后等待 final=1/PCM终态/sink完成 | 不是首包根因；只在 frames accepted 后进入 |
| capture accept deadline | 250ms | gateway 的 bounded accept 超时会 abort 单帧 | 不是本次 live；probe 直接调用 adapter，不经过 gateway/DB seam |
| non-OPEN diagnostic wait | 250ms | `send` 开始时 socket 已非 OPEN，等待 close code 后 reject | 被动诊断，不会主动 close |
| reconnect=0 | 无 timer | 首 attempt failure 后禁止重连 | 不制造初始 failure；只保证没有第二连接 |
| budget ledger | 无 timer | connect 前做并发/日时长/费用门禁 | 不 close；失败后按 attempted bytes 保守记账 |
| Abort/cancel | 无隐式 deadline | open scope 撤销、显式 cancel 或 failure cleanup | live open 未传 signal；accept signals 未 abort；catch cancel 发生在失败之后 |
| ping/idle | 不存在 | adapter/factory/harness 未实现 ping/idle timer | 不是根因 |
| runtime marker/causal deadline | 仅 speaker marker | marker queue 排队超时 | 与 provider PCM/live probe 无关 |

- Listener/close 顺序 verified：`WsTencentProtocolConnection` 在 factory resolve 前已注册 socket message/close/error，并缓存早到事件；adapter attach 后 replay。code0 前后没有调用 drain/end/close/terminate。harness 连续 await 20 次有界 accept 后才调用 `drainAndClose`；accept 启动异步 pump，drain 会先 await pump/flush，再发 end。没有未 await pump 被 finally 提前 cancel 的路径。
- 本地真实 `ws` deterministic server 先发送 code0，等待超过压缩后的 connect/ready deadline，再接收与 live harness 同构的20×3200-byte frames。修复前稳定观察：server 已收首个6400-byte binary，但 adapter 误报 `unknown_transport/tcp` 并由客户端 close，server close=1005；修复后收到10×6400 bytes、随后 end、回 final=1，drain receipt成功，attempted/sent均64000。
- 稳定复现答复：累计真实连接13，其中连接4–13连续10次均取得 code0；已记录的后段均在首包 callback 窗口呈 attempted>0、confirmed=0、无final/drain。早期连接1–3包含quota/握手前transport，不属于同一症状。客户端 bug 对每次成功 `ws.send` callback 都是确定性的，因此与腾讯日志“客户端断开”一致。
- 离线门禁：adapter+config 2 files/19 tests；全量 unit 46 files/307 tests；format、lint、typecheck、build、diff通过。`postgres-test` 独立库13 migrations deploy/status up to date；ASR runtime/finalization integration 3 files/26 tests、auth 4 files/23 tests通过。没有读取 `.env.local` 或建立腾讯连接。
- 技术判断：一次 post-fix、同TTS/同账号/endpoint/engine/参数/6400 bytes/200ms/reconnect0的单连接 live probe 已有充分依据，唯一有意实现变量是 `null` callback 修复。但当前未获 live 授权，任务继续 `BLOCKED/REVIEW`；不得自行连接、commit、PR或CI。

## Post-fix 真实 provider、桌面与故障验收候选（2026-08-13）

- 外部阻塞已解除：腾讯工单 `202608125900` 所见“客户端断开”由 `ws@8.21.2` 成功回调传 `null` 而实现误判为错误所致。修复后，26.4 秒完全虚构普通话单连接取得 `code=0`、844800/844800 bytes、`final=1`、drain receipt；2 个 final、99 字符、known speaker finals=2、unknown=0。随后补充 V2 正式 top-level `sentences.sentence_list` 解析；不记录或披露正文。
- 同一受控 473.9 秒完全虚构普通话 PCM 以 reconnect=0 独立 replay 3 次：每次 15,164,800 bytes、474 billed seconds、46 finals、1798 characters、859 interim、两个 speaker labels、unknown=0、final/drain=true、无 gap。三次文本/标签安全哈希一致，文本相似度与标签一致率均为 1；合计 1422 billed seconds，按 CNY 1/hour 估算约 CNY 0.395。
- 桌面 Chromium 正式无 query 路由：真实 Chrome、完全虚构 fixture，正常 lane 约 456 秒；456 archive chunks/manifest complete，stop=202、audio-complete=201、provider close=1000；43 finals/849 interim，两个 label 分别 20/23，均经用户确认映射；数据库终态为 session completed、audio complete、transcript drained、无 gap。interim 仅展示，final-only 持久化；控制句不进入后续 AI memory/asked/suggestion/summary 的既有门禁未被放宽。
- 受控故障 lane：API/transport 中断时 WebSocket 1006，archive 从 35 chunks 持续增长到 76，UI 明示转录不可用但录音继续；恢复后创建新 capture generation/new provider namespace/new speaker stream，旧 stream 关闭并清空可信映射，UI 要求重新校准。复跑还发现 provider-ready promise 在 await 前 reject 会在 Node 24 形成 orphan rejection 并退出进程；现已立即挂接 containment catch，同时保留稍后 await 的原始拒绝，并隔离 `onStatus` callback failure。
- 故障闭环终态：恢复后的新 namespace 再次得到两个 known labels 并完成用户确认；最终 302 archive chunks、manifest present、audio complete，captures=2（1 interrupted/1 stopped），speaker mappings current user-confirmed=2，finals=9、unknown=0。此前 accepted PCM coverage loss 跨 runtime 丢失仍以持久 `firstPcmAcceptedAt` 证据 fail-closed，故 session transcript sticky `degraded`、`ASR_DRAIN_INCOMPLETE`、drain=false；后续 voice 成功没有错误清除旧 gap。
- 实现候选仍是单一 production v2 truth source；没有 v1/v2 并行 seam、Prisma migration、第二 provider/diarizer、gap backfill、真实 LLM 或公共状态/校准/授权语义改动。`speaker_diarization=1`、`enable_speaker_context=0`、omit `speaker_context_id`、omit `result_mod` 与 `sentence_strategy=1` 保持正式 wire 语义。
- 合并最新 main 后门禁：format、lint、typecheck、build；unit 57 files/364 tests；新独立 PostgreSQL 库 14 migrations current、integration 14 files/84 tests、auth 4 files/23 tests；smoke；Chromium 24/24；auth Chromium 5/5；R4 formal route 1/1（默认 300 秒）。R4 deterministic fake 的 sequence-2 已知 gap 按正式 sticky completeness 预期 `degraded`，清理顺序补齐 calibration/speaker 关联记录。main 将首页标题和 IndexedDB schema 升至 v5 后，R4 helper 的旧标题/v4硬编码先失败，最小改为正式首页标题和不指定版本的只读打开后完整通过；一次准备按钮偶发禁用未稳定复现，原样复跑通过，保留为环境波动记录。
- 已知成功用量下界约 2019 seconds、估算约 CNY 0.561，远低于 CNY 15 预警/CNY 20 外部硬上限；腾讯控制台实际 SKU/日结费用仍为 `unknown_requires_console_confirmation`，不得用估算冒充账单事实。
- Git 交付已进入审查：安全 merge main `2f29cc7e`，non-Draft [PR #45](https://github.com/Li-Ming-G/elder_interview_ai/pull/45) 已创建；实现候选 head `ac44b4a9` 的 CI run `31700867211` SUCCESS。写入本条治理事实后的 final metadata head/CI 以 PR 最新 head 为准，由项目负责人绑定该 exact head 手动审查。
- 目标 Android 新证据：OnePlus GM1900 / Android 12 / Chrome 150，真实 384×710 viewport、正式无 query route、真实手机麦克风 MediaStream 接收同一受控虚构普通话音频。382 秒 session、PCM accepted through sequence 3835；373/373 archive chunks、pending delivery=0、manifest present、audio complete、transcript drained、session completed，finalization 约15秒。13 final segments、两个 known provider labels、unknown=0、两个 current `user_confirmed` mappings、单一 speaker stream；UI 全程未显示转录不可用。麦克风检测阶段无 MediaRecorder/PCM/provider connect，开始后只有一个访谈 MediaRecorder。纯录音旋转/后台/锁屏生命周期复用此前与本次改动无关的同机 DEV-005 证据，不机械重复。
- Android 验收使用临时 Google 官方 Platform-Tools、ADB reverse 与浏览器 CDP；不改 PATH、不记录设备序列号。新增 helper 只输出安全计数/布尔状态，不输出 cookie、token、secret、URL query、音频或转录正文。本轮结束后 API/Web 与端口映射全部关闭。
- 已知成功用量更新为约 2403 seconds、按 CNY1/hour 估算约 CNY0.668；仍远低于预算门槛。腾讯控制台实际 SKU/日结费用继续为 `unknown_requires_console_confirmation`，估算不冒充账单。
- 剩余交付：实际账单/SKU需控制台证据；项目负责人 GitHub exact-head 手动审查。任务只到 `REVIEW`，不得自宣 PASS/DONE 或 merge；CON-027 持续禁止真实长者/PII。
