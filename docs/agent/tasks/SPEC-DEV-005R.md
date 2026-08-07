# SPEC-DEV-005R｜首次访谈真实采集纵向链路重构契约

## 基本信息

- 任务类型：产品、数据、API、浏览器音频和交互跨模块契约
- 状态：`REVIEW`
- 负责人：总控 Agent
- 输入依据：DISC-005-R0、A-R、B-R、C-R、D-R 已批准决定；`03` 至 `06`、`08`、`09`；DEV-003、DEV-004B2、DEV-005A/B/C 历史实现与审查
- 前置依赖：项目负责人已确认四阶段讨论无异议
- 交接对象：DEV-005R1、DEV-005R2、DEV-005R3、DEV-005R4 实现任务

## 目标

把现有“准备页、合成 PCM 工作台、独立录音 harness、服务端结束编排”连接为一条正式路由上的真实浏览器纵向链路：同一次主动开始只建立一个 session、一个 interview audio object、一个本地归档作业和一组可恢复的采集 generation；原始录音优先可靠保存，实时转录独立降级，意外中断可恢复或安全收束，正常结束只依据服务端事实展示。

## 已冻结决定

### 1. 开始与所有权

1. 页面加载不请求麦克风、不创建录音对象、不自动开始或恢复。
2. “检测麦克风”只获取临时流做输入检测；随后创建或复用唯一 session、提交 device check，并释放临时流。
3. “开始访谈”重新获取唯一正式麦克风流，检查 MediaRecorder、MIME、IndexedDB 与内部容量门槛。
4. 客户端在发送请求前持久化唯一 local job、稳定 request ID、audio stream ID 和高水位。
5. `POST /sessions/:id/start` 必须携带客户端选择的 `mime_type`；服务端在一个原子动作中把 session 置为 `recording`、创建并绑定唯一 interview audio object、创建 generation 0 `preparing`，并返回 capture snapshot。不得另行调用 interview audio init。
6. MediaRecorder 已进入 recording 且本地 active checkpoint 持久化后，客户端调用幂等 `confirm_capture_active`；只有服务端确认后页面才能宣布访谈正在进行。
7. session 级 `InterviewCaptureController` 位于准备页、工作台和结束状态之上，独占正式流、MediaRecorder、本地归档、上传交付、实时 transport 和稳定 ID；页面只发命令并订阅状态。

### 2. 浏览器原始录音、上传与实时转录

1. 同一正式 MediaStream 同时供 MediaRecorder 和 AudioWorklet 使用；不得二次获取麦克风。
2. MediaRecorder 原始录音是首要链路；AudioWorklet 输出 mono/16 kHz/s16le/100 ms PCM，实时链路失败不停止原始录音。
3. 每个原始 Blob 只写一次本地 archive；delivery queue 只引用 archive。服务端 ACK 只删除待交付状态，不删除 archive Blob。
4. 分片必须先持久化 archive，再进入单一顺序上传泵。每个 init/chunk/complete/stop request ID 必须在请求前持久化并稳定重放。
5. 网络中断暂停上传但继续本地归档；实时 PCM 仍保持 20 帧有界背压。WebSocket 五分钟/512 事件 replay 不是 PCM 或录音恢复。
6. 浏览器锁保证同一 session 同时只有一个 tab 持有 controller；当前范围不承诺跨浏览器或跨设备接管。
7. IndexedDB canary 必须成功；可获得 estimate 时建议至少 64 MiB 可用。剩余估算不高于 16 MiB、会话内部上限或实际写失败触发安全中断。这些数值是内部可配置保护，不是永久产品限制。

### 3. 中断、恢复与空录音

1. 新增持久 `session_capture_generation`，保存 generation、audio stream ID、原始时间轴偏移、状态、原因和时间；一次 session 始终只有一个 interview audio object。
2. generation 状态为 `preparing|active|interrupted|stopped|abandoned_empty`。
3. `report_interrupted` 是幂等减权动作：当前 generation 才能报告；它把 capture/session 置为 interrupted、释放 producer，不创建 finalization 或第二个对象。普通网络或 WebSocket 故障不等于采集中断。
4. 固定原因：`capture_start_failed|page_recovery_detected|microphone_ended|recorder_error|local_archive_failed|auth_lost|unknown`。
5. 崩溃或刷新后不自动请求麦克风；若本地 dirty checkpoint 或服务端 active capture 无当前 controller，先报告 interrupted，再让用户选择继续或安全结束。
6. `resume_capture` 仅在无 finalization、session/capture 为 interrupted 且完整门禁有效时允许；复用同一 session、audio object 和 local job，创建下一 generation 与新 audio stream ID。原始 archive sequence/timeline 继续高水位；新 PCM sequence 从 0 开始并携带服务端冻结的 `timeline_offset_ms`。
7. 只有 session interrupted、无 finalization、服务端无原始分片、无已接受 PCM 且客户端报告 archive 为零时，才允许 `abandon_empty_capture`；结果为 audio object `failed`、generation `abandoned_empty`、session 终态 `failed`、顶层 `capture_failure_code=NO_AUDIO_CAPTURED` 且 finalization 仍为空，不得伪造 completed 或删除可能存在的本地文件。
8. 正常 stop 等待最终 `dataavailable`、archive 写入和正数 commitments 后使用既有 finalization；中断且有正数 commitments 使用 `finalize_interrupted`。

### 4. 结束与工作台体验

1. 不新增独立结束路由；同一工作台 URL 表达 recording、interrupted、stopping、processing、completed 和 failed，刷新后从服务端/local snapshot 恢复。
2. 结束确认文案固定为“确定结束本次访谈？”和“确认后将停止继续录音，并安全保存已经录下的内容。本次会话不能继续追加。”；动作是“继续访谈”和“确认结束”。默认焦点在继续访谈，Escape 取消且无副作用。
3. 确认后先显示“正在整理最后一段录音”，完成本地最终写入后才提交 stop；不得提前显示 stopping 或安全保存。
4. 工作台进入只读：保留当前内存转录，隐藏建议、录制和结束动作；持久状态对话框解释事实。正常 stop 一经确认不得恢复采集。
5. 页面分别展示采集、本浏览器备份、服务端录音/manifest、转录和 session 五类事实，并标明“本浏览器”与“管理服务”；只有本地 archive 完整且服务端 manifest 完整时才能说“双重保护”。
6. `stopping` 不提供应用内离开；仅当本浏览器仍有冻结待传分片时注册 beforeunload 提示，但不得声称浏览器一定能阻止关闭。`processing` 可以安全离开。
7. `completed` 分别表达 `drained|degraded|not_started`；`failed` 必须区分 manifest 完整与不完整；`NO_AUDIO_CAPTURED` 明确没有可保存录音或转录。
8. interrupted 按事实提供：继续访谈、安全结束已有音频、结束无音频，或仅展示不可恢复/撤权事实。不得自动请求麦克风、创建新 session 或新 audio object。
9. “查看保存明细”只在当前页展开；“完成并离开”回到已登录根路径 `/`；“重新准备一次访谈”回到项目准备页但不自动创建 session。
10. 当前切片不提供本地 archive 下载、播放、打开目录或删除 UI；真实试点前这些管理/删除能力仍是门禁。

## 实现任务拆分

1. `DEV-005R1`：服务端 capture lifecycle、原子 start、generation、confirm/report/resume/abandon、公共 snapshot、锁与数据库迁移。
2. `DEV-005R2C`：可与 R1 并行的纯浏览器采集/归档核心，不修改共享 DTO、正式路由或工作台。
3. `DEV-005R2`：在 R1 与 R2C 通过后完成 session controller、API 绑定、上传、锁与正式恢复集成。
4. `DEV-005R3`：正式工作台接入真实 controller，完成中断/结束交互和状态事实展示；UI 必须使用 `impeccable`。
5. `DEV-005R4`：跨模块真实 Chromium 虚构音频纵向验收、5–10 分钟内部试录、故障注入、文档与审查收口。

R1 与严格限界的 R2C 可以从同一 SPEC 基线并行；共享 DTO 只归 R1。R1/R2C 通过后由 R2 集成，R2 完成后 R3 才能接管页面，避免两个 worktree 同时重写路由、controller 和样式。R4 最后执行。生产队列、云对象存储、跨设备接管、真实 ASR 供应商和真实长者数据均不在本轮。

## 验收

- 正式 project/session 路由完成真实麦克风开始、原始归档、上传、实时转录、刷新/网络/权限/设备/容量故障和安全结束；
- 5–10 分钟虚构内容试录无不可解释分片缺失；ACK 后浏览器 archive 仍存在；
- 同一 start/stop/recover 请求并发和响应丢失保持稳定业务结果；
- 同一 session 始终只有一个 interview audio object；generation、stream 和两个时间轴按契约推进；
- 所有状态文案来自对应事实源，不把 ASR/AI 成功当成录音成功；
- 桌面与窄屏、键盘、焦点、screen reader live region、reduced motion 通过；
- 无真实录音、正文、对象键、token 或内部错误写入日志和测试制品。

## 审查边界

本任务冻结契约，不代表任何 DEV-005R 实现完成。旧 DEV-005A/B/C 的 PR、CI 和 PASS 继续作为历史证据，不撤销也不覆盖。CON-020 只有在 DEV-005R4 真实浏览器纵向证据和项目负责人 PASS 后才能关闭。
