# 05｜API 与实时事件契约

## 1. 文档职责

本文件是 REST API、WebSocket 事件、幂等要求、接口权限和导出结构的正式契约。

数据库字段和状态枚举以 `04-数据模型规范.md` 为准。机器可读契约位于 `docs/contracts/`，在其状态从“占位”变为“正式”前，不得用于代码生成或自动校验。

任何接口路径、请求响应、事件名称、事件结构或版本变更，都必须先更新本文件，再修改代码和测试。

## 2. 通用约定

- REST API 统一前缀为 `/api/v1`；
- 时间使用 ISO 8601，并保留时区；
- 主键和事件 ID 使用 UUID；
- 写操作按本文件要求携带 `request_id`；
- WebSocket 事件必须携带 `schema_version`；
- 所有外部输入必须校验；
- 错误响应遵循项目统一错误码规范；
- 原始数据与修订数据不得混为同一字段。

## 3. REST API

统一前缀：

```text
/api/v1
```

### 3.0 认证

```http
POST /auth/login
POST /auth/logout
GET  /auth/me
GET  /auth/csrf
```

`POST /projects` 仅供 `interviewer` 创建自己负责的项目。请求和最小响应：

```json
{
  "display_name": "虚构长者称呼",
  "birth_year": null,
  "approximate_age": null,
  "native_place": null,
  "current_city": null
}
```

`display_name` 必填，其余字段可空；响应返回 `id`、上述字段、`status=draft`、`created_by` 和时间戳。服务端必须在同一事务创建项目及创建者的 `interviewer` assignment。项目访问只认未撤销 assignment，不能因 `created_by` 相同直接放行。列表和详情不返回未分配项目；不存在、软删除、隐私删除或未分配均不得泄露项目正文。

登录请求：

```json
{
  "email": "listener@example.test",
  "password": "<not-logged>"
}
```

成功返回 200：

```json
{
  "user": {
    "id": "uuid",
    "display_name": "虚构倾听员",
    "role": "interviewer",
    "status": "active"
  },
  "csrf_token": "opaque-random"
}
```

规则：

- `email` 为去除首尾空白后的 ASCII 字符串，最长 254 字节并按 `04` 规范化；`password` 为 12 至 128 UTF-8 字节，服务端不得记录原值；格式不合法返回 422 `VALIDATION_ERROR`；
- 登录成功后只通过 `HttpOnly` 会话 Cookie 返回不透明会话 ID，不在 JSON、URL 或浏览器存储中返回访问令牌；
- production Cookie 为 `__Host-elder_interview_session; Path=/; HttpOnly; Secure; SameSite=Strict` 且无 `Domain`；local/test HTTP Cookie 名为 `elder_interview_session`；
- 登录失败或限流统一返回 401 `INVALID_CREDENTIALS`，不得暴露账号是否存在；服务端按 `04` 的数据库限流规则处理；
- `/auth/logout` 必须撤销当前服务端会话；
- `/auth/me` 只返回当前用户 ID、显示名、角色和状态，不返回 `password_hash`、会话哈希或权限内部信息；
- 登录响应和 `/auth/csrf` 都可签发与当前会话绑定的 CSRF token；两者都设置 `Cache-Control: no-store`，后者需要有效会话且每次调用轮换 token；前端只在内存保存，并通过 `X-CSRF-Token` 发送；
- 所有状态变更浏览器请求（包括登录）必须校验配置白名单中的 `Origin`；安全 GET 在存在 `Origin` 时也必须校验；登录不要求既有会话或 CSRF token，其他写请求必须同时验证会话和与该会话绑定的 CSRF token；
- 状态变更请求缺少或不匹配 `Origin` 返回 403 `INVALID_ORIGIN`；会话有效但 CSRF token 缺少或错误返回 403 `INVALID_CSRF_TOKEN`；错误正文不得回显 header、Cookie 或允许来源配置；
- 会话默认空闲 30 分钟、绝对 12 小时；登录和权限变化轮换 CSRF token，登出、会话撤销或过期时一并失效；
- `/auth/logout` 成功或重复调用都清除 Cookie（`Max-Age=0; Path=/`，production 同时保留 `Secure` 等属性）；
- 未认证返回 401 `AUTH_REQUIRED`，已认证但角色或资源无权返回 403 `FORBIDDEN`；
- 账号停用后现存会话不得继续访问。

### 3.1 项目

```http
POST   /projects
GET    /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id
POST   /projects/:id/restore
```

`POST /projects` 仅供 `interviewer` 创建自己负责的项目。请求和最小响应：

```json
{
  "display_name": "虚构长者称呼",
  "birth_year": null,
  "approximate_age": null,
  "native_place": null,
  "current_city": null
}
```

`display_name` 必填，其余字段可空；响应返回 `id`、上述字段、`status=draft`、`created_by` 和时间戳。服务端必须在同一事务创建项目及创建者的 `interviewer` assignment。项目访问只认未撤销 assignment，不能因 `created_by` 相同直接放行。列表和详情不返回未分配项目；不存在、软删除、隐私删除或未分配均不得泄露项目正文。

`DELETE /projects/:id` 与 `/restore` 只用于普通、可恢复的软删除：前者设置 `deleted_at` 但不执行隐私物理清理，后者只清除该软删除标记。它们不得替代 deletion-request 流程；存在非终态删除申请或项目已因 completed project scope 请求进入 `status=deleted` 时，普通删除/恢复返回 409 `PROJECT_DELETION_LOCKED`，物理删除完成后的项目永远不得 restore。

### 3.2 项目分配

```http
GET    /projects/:id/assignments
POST   /projects/:id/assignments
DELETE /projects/:id/assignments/:assignmentId
```

MVP 的 `assignment_role` 固定为 `interviewer`。`POST` 至少包含 `user_id`；创建、重复创建、撤销和审计必须使用持久化 assignment 判断，不接受客户端提供的 owner/assignment 布尔值。普通倾听员不能为其他用户分配项目。

### 3.3 服务信息

```http
POST /projects/:id/service-terms
GET  /projects/:id/service-terms
```

`POST /projects/:id/service-terms` 请求：

```json
{
  "included_minutes": 60,
  "estimated_session_count": 2,
  "expected_current_minutes": 30,
  "overtime_unit_minutes": 30,
  "overtime_price_minor": 0,
  "currency": "CNY"
}
```

分钟、次数和金额使用非负整数；`currency` 为三位大写 ISO 4217 代码。服务端写入 `explained_at`、`explained_by`、`effective_from`；新记录生效时把上一条当前记录写 `superseded_at`，不覆盖历史。只有被分配倾听员可提交和读取；内部虚构数据允许价格为 0。

### 3.4 授权

```http
POST /projects/:id/consents
GET  /projects/:id/consents
POST /consents/:id/revoke
POST /projects/:id/deletion-requests
GET  /projects/:id/deletion-requests
GET  /deletion-requests/:id
POST /deletion-requests/:id/verify
POST /deletion-requests/:id/reject
POST /deletion-requests/:id/start-processing
POST /deletion-requests/:id/complete
POST /deletion-requests/:id/withdraw
```

MVP 只接受 `consent_type=recording_transcription_ai` 的捆绑授权。创建请求：

```json
{
  "consent_type": "recording_transcription_ai",
  "consent_text_version": "mvp-v1",
  "consent_method": "electronic",
  "consented_at": "2026-08-03T08:00:00.000Z",
  "consent_audio_object_id": null
}
```

创建成功时服务端追加一条 `status=valid` 记录，不修改历史。`recorded_verbal` 必须提供已属于本项目、`purpose=consent`、`status=complete` 且 manifest/分片均通过存储校验的授权音频对象 ID；校验与授权追加使用同一 project 资源锁。对象不存在、跨项目、用途不符、未完成、缺片或存储校验失败统一返回 409 `CONSENT_AUDIO_NOT_VERIFIED`，不得创建授权记录。`electronic`、`written` 必须为 `null`。探索期仅使用虚构数据时可以使用 `electronic` 或 `written`；真实试点仍按 `03` 的口头授权和 `09` 发布门禁验收。

撤回请求至少包含新的 `request_id`：

```json
{ "request_id": "uuid" }
```

撤回只允许本项目当前有效捆绑授权，必须在同一事务写 `status=revoked`、`revoked_at`、项目限制状态和审计；相同 `request_id` 重试返回首次结果。撤回后禁止启动新会话和继续 AI 分析。

删除申请请求至少包含：

```json
{
  "request_id": "uuid",
  "scope": "project",
  "session_id": null,
  "source_marker_id": null
}
```

`scope` 为 `project`、`session` 或 `segment_range`；`session` 必须提供本项目的 `session_id`，`segment_range` 必须提供 `source_marker_id`。创建成功表示申请已登记并进入限制处理，不表示物理删除已经完成。

`scope=session` 时 `session_id` 必填且 `source_marker_id` 为空；`scope=segment_range` 时 `source_marker_id` 必须属于本项目、类型为 `deletion_request` 且 `session_id` 为空；`scope=project` 时两者均为空。归属和类型不符返回 422 `INVALID_DELETION_SCOPE`。

创建 `segment_range` 请求时，服务端必须在同一事务读取 source marker 并冻结当时的 segment start/end ID；后续 marker PATCH/DELETE 不改变申请范围、AI 阻断或清理范围。scope 摘要必须覆盖 project/session 和冻结端点，处理接口不得重新读取 marker 的可变范围替代快照。

删除申请处理规则：

- 创建可由被分配的倾听员或 `data_admin` 执行；处理动作仅 `data_admin` 可执行；登记人只能查询自己登记申请的状态、scope 和范围 ID，`data_admin` 可查询处理所需的完整状态与最小审计信息；
- 所有处理 action 请求至少包含新的 `request_id`；`reject`、`complete`、`withdraw` 还必须提供不含正文的 `resolution_note`；
- `verify`：`pending_verification -> verified`；`reject`：`pending_verification -> rejected`；`start-processing`：`verified -> processing`；`complete`：`processing -> completed`；
- `processing` 阶段执行实际清理；`complete` 只有在范围内在线对象存储、数据库业务数据与临时导出清理成功，提交 SHA-256 `cleanup_manifest_hash`，并以 `backup_cleanup_status=scheduled` + `backup_cleanup_due_at` 或 `not_applicable` 登记备份处理后才允许。project scope 完成时项目置为不可恢复的 `deleted`；session/segment scope 只完成相应范围清理；
- `withdraw` 仅在数据管理员核验请求人撤回后允许 `pending_verification | verified -> withdrawn`；倾听员不能直接撤回或关闭；
- 状态更新、transition 记录和审计必须同事务提交；同一 action `request_id` 重试返回首次结果；非法前置状态返回 409 `INVALID_DELETION_TRANSITION`；
- project scope 请求进入限制时保留先前项目状态；`rejected`/`withdrawn` 仅在不存在授权撤回或其他正式限制原因时恢复先前状态；`completed` 表示在线清理已完成，不恢复且项目置为不可恢复的 `deleted`；
- 查询和错误响应不得返回待删除正文、内部存储位置或不必要身份核验信息。
- completed 后查询只返回 scope 类型、不可逆 `scope_reference_hash`、状态与最小审计时间；已清空的 session/marker FK 不得通过其他关系反查或恢复正文。

### 3.5 访谈

```http
POST /projects/:id/sessions
GET  /sessions/:id
POST /sessions/:id/device-check
POST /sessions/:id/start
POST /sessions/:id/capture/confirm-active
POST /sessions/:id/capture/interrupted
POST /sessions/:id/capture/abandon-empty
POST /sessions/:id/stop
POST /sessions/:id/recover
```

`POST /projects/:id/sessions` 只要求有效 assignment，可在项目仍为 `draft` 时创建 `status=created` 的会话；响应返回 `id`、`project_id`、递增 `sequence_no`、`status` 和时间戳。创建 draft session 不等于允许录音。

`POST /sessions/:id/device-check` 请求至少包含：

```json
{ "microphone_permission": "granted", "input_detected": true }
```

仅两项均满足时把 `created -> device_check`；失败保持 `created` 并返回可操作错误。

`POST /sessions/:id/start` 请求为 `{ "request_id": "uuid", "mime_type": "audio/webm;codecs=opus", "audio_stream_id": "uuid" }`。服务端在固定资源锁内重新读取 assignment、项目状态、当前已说明服务条款、最新有效捆绑授权和 session 状态；只有项目为 `ready|active`、session 为 `device_check` 且门禁全部满足时，才在同一事务创建并绑定该 session 唯一 `purpose=interview` audio object、创建 generation 0 `preparing`、转为 `recording` 并写 `started_at`，然后返回统一 snapshot。不得另行调用 audio init 创建 interview object。相同 `request_id`、actor、session 和 payload 返回首次结果；同 key 不同 MIME/stream 返回 `IDEMPOTENCY_PAYLOAD_MISMATCH`。门禁失败不得创建对象、generation、ASR 或 AI 任务。

`POST /sessions/:id/capture/confirm-active` 请求为 `{ "request_id", "generation_no", "audio_stream_id" }`。仅当前 generation `preparing`、session `recording|reconnecting` 且完整门禁仍有效时幂等转为 `active`。页面必须在 MediaRecorder 已 recording、本地 active checkpoint 已持久化后调用；成功响应前不得宣布正在采集。

`POST /sessions/:id/capture/interrupted` 请求为 `{ "request_id", "generation_no", "audio_stream_id", "reason" }`。它是减权动作：当前 generation 为 `preparing|active` 且尚无 finalization 时，幂等写 `interrupted`、使 session 进入/保持 `interrupted` 并释放 producer。重新认证的原 actor 在 assignment 已失效后仍可报告；账号 disabled 不可。stop 已冻结或 session 已终态时只返回当前稳定 snapshot，不允许回退。普通网络/WS 故障不得调用本动作。

`POST /sessions/:id/capture/abandon-empty` 请求为 `{ "request_id", "generation_no", "audio_stream_id", "local_archive_chunk_count": 0 }`。服务端在锁内确认 session/capture interrupted、无 finalization、audio object 无服务端分片、无已接受 PCM，且客户端只声明零 archive；成功后把 generation 置 `abandoned_empty`、audio object 置 `failed`、session 置终态 `failed`，保持 `finalization=null` 并返回顶层 `capture_failure_code=NO_AUDIO_CAPTURED`。任一证据存在都必须 409，改走 resume 或 `finalize_interrupted`；服务端不得据此删除浏览器文件。

#### 3.5.1 公共会话结束 snapshot

`GET /sessions/:id`、stop 和 recover 返回同一 `InterviewSessionResponse` snapshot。结束前 `finalization=null`；结束收束存在后至少返回：

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "sequence_no": 1,
  "status": "stopping",
  "started_at": "2026-08-07T08:00:00.000Z",
  "ended_at": "2026-08-07T08:30:12.000Z",
  "duration_seconds": 1812,
  "capture_failure_code": null,
  "created_by": "uuid",
  "created_at": "2026-08-07T08:00:00.000Z",
  "updated_at": "2026-08-07T08:30:12.000Z",
  "capture": {
    "audio_object_id": "uuid",
    "generation_no": 0,
    "audio_stream_id": "uuid",
    "status": "active",
    "timeline_offset_ms": 0,
    "uploaded_chunk_count": 3,
    "interruption_reason": null,
    "interrupted_at": null
  },
  "finalization": {
    "audio_object_id": "uuid",
    "expected_chunk_count": 363,
    "recording_status": "stopped",
    "upload_status": "awaiting_upload",
    "uploaded_chunk_count": 360,
    "manifest_checksum": null,
    "transcript_status": "pending",
    "transcript_error_code": null,
    "failure_code": null,
    "processing_started_at": null,
    "completed_at": null
  }
}
```

公共枚举：

- `recording_status`: `recording|stopped|interrupted`；
- `upload_status`: `awaiting_upload|verifying|complete|unrecoverable`；
- `transcript_status`: `pending|draining|drained|degraded|not_started`；
- `transcript_error_code`: `null|ASR_UNAVAILABLE|ASR_DRAIN_TIMEOUT|ASR_DRAIN_INCOMPLETE`；
- `failure_code`: `null|AUDIO_COMMITMENT_CONFLICT|AUDIO_MANIFEST_UNRECOVERABLE|FINALIZATION_INTERNAL_FAILURE`（仅位于 finalization）。

`capture.status` 为 `preparing|active|interrupted|stopped|abandoned_empty`。capture snapshot 只返回 audio object ID、generation、stream ID、status、timeline offset、服务端已上传分片数、中断原因/时间；不返回 local job ID、commitment、对象键、下载地址、正文或内部错误。尚未 start 时 `capture=null`。

顶层 `capture_failure_code` 为 `null|NO_AUDIO_CAPTURED`，只表达无 finalization 的采集阶段终结。它与 `finalization.failure_code` 互斥；不得为了承载 `NO_AUDIO_CAPTURED` 创建空 finalization，也不得把 manifest/ASR/runner 错误提升到顶层。

响应不返回 chunk commitment、对象键、下载地址、转录正文、provider payload、SQL、堆栈或内部重试详情。`manifest_checksum` 只在 upload complete 时返回。前端可以展示每条链路事实，不得把非空 `transcript_error_code` 映射为录音失败。

#### 3.5.2 stop

客户端必须先停止新 PCM、停止 MediaRecorder并收到最终 `dataavailable`，再冻结并持久化以下请求及稳定 `request_id`：

```json
{
  "request_id": "uuid",
  "audio_object_id": "uuid",
  "expected_chunk_count": 2,
  "chunks": [
    {
      "sequence_no": 0,
      "start_ms": 0,
      "end_ms": 5000,
      "size_bytes": 12345,
      "checksum": "64-char-lowercase-hex",
      "mime_type": "audio/webm;codecs=opus"
    },
    {
      "sequence_no": 1,
      "start_ms": 5000,
      "end_ms": 9200,
      "size_bytes": 10321,
      "checksum": "64-char-lowercase-hex",
      "mime_type": "audio/webm;codecs=opus"
    }
  ]
}
```

规则：

- `recording|reconnecting` 是首次 stop 的合法前置状态；服务端按 session 串行，重新验证当前 auth session、actor、有效 assignment、资源归属、最新捆绑授权仍有效，并确认项目未处于 `restricted|deleted`；这些门禁必须与创建 finalization/commitments 在同一资源锁内判定；
- 若授权已撤回或项目已受限，而服务端此前尚未接受 stop snapshot，首次 stop 返回 403 `FORBIDDEN`，不得创建 `session_finalization`、chunk commitments 或 evidence-finalization 例外，不得扩大证据边界；服务端只保留此前已经可靠收到的分片，并将/保持 session 为 `interrupted` 供后续有权人工处置；
- audio object 必须是该 session 唯一的 `purpose=interview` 对象；`expected_chunk_count` 为正整数，`chunks.length` 与其相等，sequence 连续为 `0..N-1`，时间不重叠且递增，所有字段通过与 audio API 相同的边界校验；
- 首次接受时，服务端以 `started_at + 最后一片 end_ms` 推导/校验 `ended_at`，以 `ceil(last end_ms/1000)` 计算时长，并固化 stop snapshot、chunk commitments、幂等记录后原子转为 `stopping`。从该提交点起拒绝新 PCM、新 interview audio object、扩大 count 和 commitment 外上传；
- 成功接受返回 202 和公共 snapshot。若提交时所有分片/manifest 已完整，服务端可在同一请求内推进到 `processing` 或 `completed`，响应始终返回提交完成时的真实 snapshot；
- 相同 `request_id`、actor、session 和完全相同 payload 重放，返回首次响应快照，不重复写状态/审计；payload 不同返回 409 `IDEMPOTENCY_PAYLOAD_MISMATCH`；跨 action/actor/target 复用返回 409 `IDEMPOTENCY_KEY_REUSED`；
- 不同 `request_id` 并发 stop 只有一个能创建 finalization；胜者提交后，完全相同冻结快照的后来请求返回当前 snapshot 和 200，不创建第二个动作；任一冻结字段不同返回 409 `SESSION_STOP_CONFLICT`；
- `stopping|processing` 收到与已冻结快照一致的新 stop request ID，返回当前 snapshot 和 200；`completed|failed` 返回终态 snapshot 和 200；`created|device_check|interrupted` 没有完整 finalize payload 时返回 409 `SESSION_NOT_STOPPABLE`；
- stop 响应丢失时必须复用原 `request_id`。不得生成新 audio object 或从剩余本地 Blob 推导 count。

#### 3.5.3 受限 evidence-finalization 补传

stop 接受前，audio init/upload/complete/manifest 继续要求当前有效 assignment。stop 接受后：

- 禁止初始化第二个 interview audio object；
- 已认证且账号有效的原操作者即使 assignment 后续撤销或授权撤回，仍可只对冻结 audio object 执行 commitment 内缺片上传、complete 和最小 finalization 查询；
- 该例外不允许读取录音/转录正文，不允许下载、修改已上传分片、增加 sequence、扩大 count、继续 PCM、继续 AI 或执行其他项目操作；每次使用写入最小审计；
- auth session 过期/登出时不得匿名继续。用户重新认证且账号仍 active 后，服务端按原 actor 与冻结 finalization 授予上述受限能力；账号停用或无法重新认证时只保留服务端已保存事实并进入 `interrupted` 或最终 `failed`，不得签发长期浏览器 bearer token；
- 授权撤回同时停止新采集、新 ASR/AI 任务和普通查询/导出；已经开始的 final drain 只可收束 stop 前已接受 PCM、不得扩大内容范围。撤回不能删除或覆盖 stop 前已产生的原始证据；物理删除仍走 deletion request。

#### 3.5.4 recover

请求：

```json
{
  "request_id": "uuid",
  "action": "reconcile"
}
```

`action`：

- `reconcile`：适用于 `stopping|processing|completed|failed`，重新读取持久 finalization、audio manifest 和 ASR 终态，安全重驱进程内 runner并返回公共 snapshot；
- `resume_capture`：只适用于尚无 finalization、当前 capture 与 session 均为 `interrupted`，且当前 assignment、项目、授权、auth session 和账号全部有效；请求必须携带新的 `audio_stream_id` 和客户端已核验的同一 local job archive high-water。服务端确认与现有对象/分片不冲突后，原子创建下一 generation `preparing`、返回服务端确定的 `timeline_offset_ms` 并转为 `reconnecting`；不得创建第二个 audio object。客户端重新建立 MediaRecorder/active checkpoint 后仍须调用 `confirm_capture_active`；
- `finalize_interrupted`：只适用于尚无 finalization 的 `interrupted`，请求除 `action` 外必须携带与 stop 相同的 `audio_object_id/expected_chunk_count/chunks`；它与首次 stop 使用相同的当前 assignment、最新授权、项目限制和资源归属门禁，全部通过后才可冻结已有证据并进入 `stopping`。授权已撤回或项目已受限时返回 403 `FORBIDDEN`，不得新建 finalization 或 commitments；

规则：

- 相同 request ID 重放返回首次快照；不同 request ID 并发按 session 串行并返回提交后的当前事实；不产生第二个 finalization；
- `reconcile` 不依赖 `event_stream_id/server_sequence`，不承诺恢复 interim 或 WebSocket 历史，也不把 5 分钟/512 事件 replay 当成 session recover；
- `recording|reconnecting` 的 reconcile 返回 409 `SESSION_RECOVERY_NOT_REQUIRED`；无 finalization 的 `created|device_check` 返回 409 `SESSION_NOT_RECOVERABLE`；
- `completed|failed` 的 reconcile 返回 200 终态 snapshot，不改变终态；进程重启后的 `stopping|processing` 必须能仅凭持久事实重驱；
- recover 的普通授权与受限 evidence-finalization 授权遵循上一节。只有撤权前已成功冻结 stop snapshot，原操作者重新认证后才可 reconcile/补传 commitment 范围内证据；尚无 finalization 时，失去 assignment、授权失效或项目受限均不能 `resume_capture|finalize_interrupted`。

#### 3.5.5 状态推进与错误

- `stopping -> processing`：冻结范围内分片全部可靠保存，audio complete 对存储重新复核且 manifest 完整；
- `processing -> completed`：transcript 进入 `drained|degraded|not_started`；AI/记忆/建议/工作记录不是条件；
- stop 接受时服务端持久化当时最高已接受 ASR audio sequence；`drained` 必须来自 adapter 对该 stream 的明确 drain 终止并写完成时间，不得从最后一条 final 或 WebSocket close 推断；stream 不存在、进程重启丢失或无法确认时只能进入 `not_started|degraded`；
- 意外断线且尚无 stop snapshot 可进入 `interrupted`；缺片或 runner 进程故障保持 `stopping|processing` 可 recover；
- start/confirm/report/resume/stop 共享 `request -> project -> session -> audio` 锁序。stop 先提交时晚到 interrupted report 不得回退；report 先提交时正常 stop 必须改走 `finalize_interrupted`；revoke 先提交时 resume/finalize 拒绝；resume 后 revoke 时新 generation 被置为 interrupted；任何竞态不得产生第二个 object、current generation 或 finalization；
- 只有 audio commitment 冲突、manifest 已确认不可恢复或重复内部收束失败达到配置上限并需人工处置时进入 `failed`；`failed` 不覆盖已保存音频、manifest、final 转录或授权记录；
- 未识别内部错误返回 503 `SESSION_FINALIZATION_UNAVAILABLE`，响应只含公共 error envelope。校验失败 422 `INVALID_SESSION_FINALIZATION`；前置/并发冲突使用上述 409；401/403 继续遵循统一认证语义。

本节结束编排由 SPEC-SESSION-END-001 冻结并经 DEV-005C 实现；项目负责人已绑定 PR #10 final head `36f534a45367eb19d19d19d05f0edcda317dbde9`、CI `31174226564` 给出 REV-019 PASS。DEV-005R 新增的 capture snapshot/actions 仍是待 GitHub 审查与实现的正式候选；后续 R2/R3 只能消费公共 snapshot，不得重新解释或本地推算完成状态。

### 3.6 音频

```http
POST /projects/:id/audio-objects
PUT  /audio-objects/:id/chunks/:sequenceNo
POST /audio-objects/:id/complete
GET  /audio-objects/:id/manifest
```

初始化请求：

```json
{
  "request_id": "uuid",
  "purpose": "consent",
  "session_id": null,
  "mime_type": "audio/webm;codecs=opus"
}
```

`purpose=consent` 时 `session_id` 必须为空，只要求当前倾听员拥有有效 project assignment，不要求项目已经取得有效授权或 session 已 start。`purpose=interview` 时 `session_id` 必填、必须属于同一项目，且 session 必须为 `recording|reconnecting|stopping`；不得用 consent 对象冒充访谈录音。响应返回 audio object ID、project/session、purpose、status、mime type 和时间戳。

分片上传使用原始二进制请求体，且至少包含以下 header：

```text
Content-Type: audio/webm;codecs=opus
X-Request-Id: uuid
X-Chunk-Start-Ms: 0
X-Chunk-End-Ms: 5000
X-Chunk-SHA256: 64-char-lowercase-hex
```

`sequenceNo` 为从 0 开始的非负整数。服务端先校验 body 大小、时间范围和 SHA-256，再写入私有存储与数据库。相同 request ID 按 §4 重放；不同 request ID 重试同一 `(audio_object_id, sequenceNo)` 时，只有二进制、checksum、时间、size 和 MIME 全部一致才返回原分片结果，任一不同返回 409 `AUDIO_CHUNK_CONFLICT`。对象已 complete 后上传返回 409 `AUDIO_OBJECT_COMPLETE`。存储失败返回 503 `AUDIO_STORAGE_UNAVAILABLE`，不得写成 uploaded 或 ACK；响应和日志不返回 `object_key`。

浏览器可靠补传必须为 init、每个 sequence 的 chunk upload 和 complete 分别生成并跨刷新持久化稳定 request ID；网络失败或响应丢失后的重试复用原 ID，不得因刷新重新创建 audio object。客户端只有在 ACK 的 audio object、sequence、时间范围、size、checksum、MIME 和 `upload_status=uploaded` 全部与本地不可变分片一致时才可删除本地 Blob。

complete 请求：

```json
{ "request_id": "uuid", "expected_chunk_count": 3 }
```

服务端按 audio object 资源串行，核对 `0..expected_chunk_count-1` 连续、全部为 uploaded，并重新读取私有存储中的 size/checksum。缺片或不一致返回 409 `AUDIO_MANIFEST_INCOMPLETE`，对象不进入 complete。成功时固化 chunk count、total bytes、canonical manifest SHA-256 和 completed time；相同请求重放返回首次快照。

客户端必须在录制停止时冻结 `expected_chunk_count` 并持久化 complete request ID；不得根据 ACK 后仍残留的 Blob 数量推导总分片数。complete 成功响应至少核对 audio object ID、`status=complete`、chunk count 和非空 manifest checksum。

manifest 响应返回对象状态、purpose、project/session、chunk count、total bytes、manifest checksum、completed time，以及按 sequence 排序的 `sequence_no/start_ms/end_ms/size_bytes/checksum/mime_type/uploaded_at`；不返回内部对象键或长期下载地址。通常只有有效 assignment 可以初始化、上传、完成和查询；session stop 已接受后的唯一例外是 §3.5.3 冻结范围内的 evidence-finalization 补传与最小查询，不得把该例外扩展为普通项目访问。

### 3.7 转录

```http
GET   /sessions/:id/transcripts
PATCH /transcripts/:id
POST  /sessions/:id/speaker-remap
```

DEV-004A 只建立服务端确定态转录存储与内部查询 seam，不开放上述 REST 路由，也不得新增公开“注入测试转录”接口。`GET` 的分页响应、`PATCH` 的并发修订语义以及 speaker-remap 的范围、幂等和审计契约，分别在对应子任务开工前补齐；未补齐前这些路径不得按占位描述实现。

### 3.8 标记

```http
POST   /sessions/:id/markers
PATCH  /markers/:id
DELETE /markers/:id
POST   /sessions/:id/boundary-candidates/:candidate_id/actions
```

创建和修改规则：

- `marker_type=do_not_ask` 时 `note` 必填，必须是人工确认的短小抽象禁区描述，不得复制原始受限正文；
- AI 可以返回候选标记，但只能写入正式 `boundary_candidate` 载体，不能直接调用最终标记写接口或解除标记；候选响应至少含不透明 `candidate_id`、`marker_type`、片段范围、最小抽象说明、`status` 和 `expires_at`；
- 候选不是 `content_marker`；服务端从最新 `pending` 候选重建当前会话临时保守阻断，只有人工确认事务才创建正式 marker 并把候选置为 `confirmed`；驳回、过期或会话结束必须解除临时阻断；
- 候选 action 只接受 `confirm` 或 `reject`；`confirm` 必须提供人工确认后的 marker 数据，`do_not_ask` 还必须提供合规 `note`，重复 action 返回原业务结果；
- `marker_type=deletion_request` 的候选确认必须同时提供 `request_id` 和 `scope`，并按 3.4 的删除申请契约在同一事务登记 `deletion_request`；不得只创建 marker 后声称已经发起删除；
- 解除 `restricted`、`do_not_ask` 必须记录原因并写入审计；
- 无权查看受限正文时，接口不得通过 marker 的 `note`、关联片段或错误详情泄露内容。

### 3.9 AI 建议

首次访谈最小纵向闭环只需要“获取/生成一个当前建议或继续倾听”和“没用，换一个”。替换必须幂等，并在当前会话排除当前及高度相似问题。精确请求、响应、节流和持久化契约由 `SPEC-AI-QUESTION-001` 冻结后才成为正式实现依据。

```http
GET  /sessions/:id/suggestions
POST /sessions/:id/suggestions/request
```

原规划的通用 `POST /suggestions/:id/actions` 已冻结，不属于首轮实现范围；DEV-007 不得据此实现采用、已问、忽略、稍后或改写动作。

### 3.10 记忆

```http
GET   /projects/:id/memory
PATCH /memory/:id
POST  /memory/:id/confirm
POST  /memory/:id/reject
```

### 3.11 工作记录

```http
GET   /sessions/:id/note
PATCH /sessions/:id/note
```

### 3.12 导出

```http
POST /projects/:id/exports
GET  /exports/:id
```

创建导出请求至少包含：

```json
{
  "request_id": "uuid",
  "export_profile": "ordinary",
  "reason": null
}
```

`export_profile`：

- `ordinary`：默认；被分配的倾听员可请求，不包含敏感正文、`restricted` 正文或待删除内容；
- `restricted`：MVP 仅 `data_admin` 可请求，`reason` 必填并二次确认，访问和下载必须审计；不得自行增加“额外权限”角色。

存在非终态删除申请（`pending_verification`、`verified`、`processing`）时：

- `ordinary` 返回 409 `DELETION_REQUEST_PENDING`，不创建导出记录或资料包；
- `restricted` 只允许 `data_admin` 以删除处理为 `reason` 创建删除处理证据包；该包排除申请范围内全部正文、派生记忆和媒体，只包含请求状态、范围标识和最小必要审计证据；
- 删除请求 `completed` 后，新导出仍不得恢复已删除内容；`rejected` 或 `withdrawn` 后按其他有效 marker 和授权重新判断。

## 4. 幂等要求

以下写操作必须接受 `request_id`：

- 开始访谈；
- 结束访谈（待 `SPEC-SESSION-END-001` 冻结具体动作绑定和响应快照）；
- 上传音频分片；
- 初始化和完成音频对象；
- 创建内容标记；
- 保存建议操作；
- 创建导出任务；
- 撤回授权；
- 创建删除申请；
- 推进删除申请状态。

认证写操作中，登出必须防重复执行；重复登出返回相同的已退出结果，不重新创建会话或错误审计事件。

`request_id` 在需要幂等的业务写操作间全局唯一。首次成功请求必须把 action、操作者、目标资源和最小响应快照持久化；相同 `request_id` 且绑定信息一致时返回首次响应快照，不得产生重复状态变化、业务记录或审计。相同 `request_id` 被不同 action、操作者或目标资源复用时返回 409 `IDEMPOTENCY_KEY_REUSED`，不得返回其他资源结果。

幂等键锁只负责相同请求重放；开始访谈、撤回授权等状态变化还必须按 session、consent 或 project 业务资源串行化，或使用带前置状态的原子更新。不同 `request_id` 并发命中同一资源时只能有一个请求完成该次合法状态变化。

删除申请处于非终态（`pending_verification`、`verified`、`processing`）时：

- `scope=project` 时项目进入或保持 `restricted` 并停止整个项目新的 AI 任务；
- `scope=session` 时只停止该会话内容及派生记忆的新 AI 任务；`scope=segment_range` 时只停止 marker 范围及派生记忆的新 AI 任务；
- AI job 在入队/调用前和任何结果持久化或展示前都必须重新读取当前非终态 deletion scope；segment_range 以创建时冻结的 start/end 快照匹配，不读取可变 marker 范围；命中 scope 的在途 job 取消，无法取消供应商调用时丢弃结果；不得更新 memory、question suggestion、boundary candidate 或 session note，也不得展示；
- 阻止普通导出；
- 查询接口只向有权处理者返回必要状态，不返回无权查看的正文。

## 5. WebSocket

DEV-004B1 服务端协议入口：

```text
/ws/interviews
```

会话 ID 不放在 upgrade 路径中，也不得仅凭 URL 参数授权。浏览器 upgrade 成功后必须在 5 秒内发送唯一的首个 `session.join`，由该消息携带 `session_id`、内存中的 CSRF token、音频流 ID 和可选恢复游标。静态路径允许直接使用 Nest 官方原生 WebSocket adapter；不为内部 MVP 自建动态 upgrade router。

DEV-004B 拆为：

- DEV-004B1：服务端 WebSocket 协议核心、合成 PCM、确定性 streaming fake、短时进程内事件恢复；
- DEV-004B2：真实 Chromium 客户端、合成 PCM、interim/final 展示、背压与短时重连纵向验证。

B1 契约与共享类型提交前不得并行实现 B2。AudioWorklet、真实麦克风、真实 ASR 供应商、持久 outbox、故障区间和离线补录均不在 B1/B2 当前范围。

### 5.1 客户端上行信封

```json
{
  "type": "session.join",
  "event_id": "uuid",
  "session_id": "uuid",
  "schema_version": "1.0",
  "payload": {}
}
```

客户端 `event_id` 只用于连接内诊断和去重，不得代替业务幂等键。`session.join` 前不得发送其他业务消息。

B1 所有上行和下行消息均采用 UTF-8 JSON，单条消息序列化后不得超过 8192 bytes；只接受契约声明的字段，未知字段、重复 JSON key、非文本帧和无法解析的 JSON 均按 `INVALID_WS_MESSAGE` 拒绝。服务端时间戳统一使用带时区的 RFC 3339/ISO 8601 字符串。

### 5.2 服务端下行信封

```json
{
  "type": "asr.final",
  "event_id": "uuid",
  "event_stream_id": "uuid",
  "server_sequence": 12,
  "session_id": "uuid",
  "timestamp": "2026-08-01T13:22:00+08:00",
  "schema_version": "1.0",
  "payload": {}
}
```

同一 `event_stream_id` 内 `server_sequence` 从 0 开始严格递增。`event_id` 全局唯一。客户端按 `(event_stream_id, server_sequence)` 恢复顺序，并始终按稳定 `segment_id` 幂等展示 final。

### 5.3 DEV-004B1 客户端上行事件

- `session.join`
- `audio.frame`
- `event.ack`
- `heartbeat`

`speaker.calibration`、`suggestion.request`、`marker.create` 和 `session.stop` 保留为后续方向，B1 不实现。

### 5.4 DEV-004B1 服务端下行事件

- `session.ready`
- `audio.ack`
- `asr.interim`
- `asr.final`
- `asr.status`
- `heartbeat.ack`
- `error`

其他下行事件保留为后续方向，B1 不实现。

### 5.5 握手、join 与权限

1. upgrade 必须携带允许列表内的 `Origin` 和有效不透明 session Cookie；缺失或错误时在 upgrade 前以 HTTP 401/403 拒绝，不返回 Cookie、token、Origin 白名单或业务正文；
2. 浏览器 WebSocket API 不能设置任意请求头，因此 CSRF token 由首个 `session.join.payload.csrf_token` 携带；该 token 只能停留在内存，日志和错误不得记录；
3. `session.join.payload` 必须包含 `audio_stream_id`；首次加入不带恢复字段，重连可带 `event_stream_id` 与 `resume_after_server_sequence`，二者必须同时出现；
4. join 时验证 CSRF 与当前 auth session 绑定、当前有效 assignment、项目为 `active`、最新捆绑授权有效、会话存在且未删除；
5. `recording|reconnecting` 可成为主动 PCM producer；`stopping|processing` 只允许恢复已有下行事件，不接受新帧；其他状态返回 `SESSION_NOT_STREAMABLE`；
6. 同一 session 同时只允许一个主动 PCM producer；第二条生产连接返回 `SESSION_STREAM_ALREADY_ACTIVE`；断线后相同 `audio_stream_id` 可在事件保留窗口内恢复；
7. join 前不得创建 ASR stream、接收 PCM 或返回转录正文。

首次 join payload：

```json
{
  "csrf_token": "opaque-in-memory-token",
  "audio_stream_id": "uuid"
}
```

恢复 join payload：

```json
{
  "csrf_token": "opaque-in-memory-token",
  "audio_stream_id": "uuid",
  "event_stream_id": "uuid",
  "resume_after_server_sequence": 11
}
```

连接建立后客户端每 15 秒发送一次 `heartbeat`；服务端返回 `heartbeat.ack`。连续 45 秒未收到任何有效客户端消息时，服务端以 `JOIN_TIMEOUT`（尚未 join）或 `HEARTBEAT_TIMEOUT` 关闭连接。首个 `session.join` 的 5 秒限制优先适用。

已 join 连接处理 `heartbeat` 或 `event.ack` 前，必须重新验证当前 auth session、有效 assignment、项目状态、最新授权和 session 当前允许的 produce/resume-only 模式。`stopping|processing` 的 resume-only 连接仍可 ACK/replay；权限撤销或资源门禁失效时即使没有继续发送音频，也必须失败关闭并释放 producer。

`session.ready.payload` 至少包含：

```json
{
  "audio_stream_id": "uuid",
  "resumed": false,
  "highest_audio_sequence_acked": -1,
  "resume_window_seconds": 300,
  "resume_window_events": 512
}
```

### 5.6 PCM 帧与背压

B1/B2 内部原型使用 JSON + base64 PCM，不提前冻结二进制 header：

- 编码：`pcm_s16le`；采样率：16000 Hz；声道：1；
- 每帧 100 ms、1600 samples、3200 raw bytes；
- `sequence_no` 从 0 连续递增；`start_ms = sequence_no * 100`，`end_ms = start_ms + 100`；
- `pcm_sha256` 为 raw bytes 的小写 64 位 SHA-256；`pcm_base64` 解码后必须正好 3200 bytes；
- `audio_stream_id` 必须等于 join 时绑定的值。

`audio.frame.payload`：

```json
{
  "audio_stream_id": "uuid",
  "sequence_no": 0,
  "start_ms": 0,
  "end_ms": 100,
  "encoding": "pcm_s16le",
  "sample_rate_hz": 16000,
  "channels": 1,
  "sample_count": 1600,
  "pcm_sha256": "64-char-lowercase-hex",
  "pcm_base64": "..."
}
```

相同期望帧首次有效接收后返回 `audio.ack`。相同 sequence/checksum/时间/格式重放返回原最高连续 ACK；任一不可变字段不同返回 `AUDIO_FRAME_CONFLICT`；跳号返回 `AUDIO_FRAME_GAP`。客户端最多保留 20 个未 ACK 帧或 64000 raw bytes；达到任一阈值后停止发送 ASR 帧但不得停止 MediaRecorder 原始录音。服务端同样强制该上限，忽略背压的客户端返回 `BACKPRESSURE_LIMIT`。

### 5.7 事件 ACK、短时恢复与重复 final

- 客户端 `event.ack.payload.server_sequence` 确认已连续处理的最高服务端序号，只能单调增加；
- B1 每个 session 只提供进程内短时事件缓存：最近 512 个事件或 5 分钟，先到者淘汰；不承诺跨进程恢复；
- 有效恢复游标按原 `server_sequence` 顺序 replay，随后发送新的 `session.ready`；
- stream ID 不匹配、服务重启或游标过期返回 `RESUME_WINDOW_EXPIRED` 和 `reset_required=true`，不得伪装恢复；
- `asr.interim` 使用稳定 `hypothesis_id` 和递增 `revision`，只替换临时显示且不落库；
- final 必须先经 DEV-004A 成功落库，再发布 `asr.final`；adapter 重复 final 返回同一稳定 `segment_id`，同一 runtime event stream 不发布第二个相同 final；
- 持久 outbox、跨进程事件恢复和 transcript REST snapshot 另行立项，不阻塞内部原型。

### 5.8 错误与关闭

upgrade 前错误使用 HTTP；upgrade 后先发不含敏感正文的 `error`，再使用私有 close code：

| close code | error code | 说明 |
|---:|---|---|
| 4400 | `INVALID_WS_MESSAGE` / `INVALID_PCM_FRAME` | 消息或 PCM 不符合契约 |
| 4401 | `AUTH_REQUIRED` / `INVALID_CSRF_TOKEN` | 身份或 CSRF 无效 |
| 4403 | `FORBIDDEN` / `INVALID_ORIGIN` | assignment、限制或 Origin 拒绝 |
| 4408 | `JOIN_TIMEOUT` / `HEARTBEAT_TIMEOUT` / `SESSION_NOT_STREAMABLE` / `SESSION_STREAM_ALREADY_ACTIVE` | 超时、会话或单生产者门禁 |
| 4409 | `AUDIO_FRAME_GAP` / `AUDIO_FRAME_CONFLICT` | 帧序号冲突 |
| 4429 | `BACKPRESSURE_LIMIT` | 客户端忽略背压 |
| 4450 | `RESUME_WINDOW_EXPIRED` | 短时恢复不可用 |
| 4500 | `REALTIME_UNAVAILABLE` | 未识别的内部或持久化故障；不得泄露内部详情 |
| 4503 | `ASR_UNAVAILABLE` | streaming adapter 不可用 |

日志不得包含 PCM/base64、转录正文、Cookie、CSRF、provider payload 或完整消息信封。

未识别的数据库或内部异常不得映射为 `FORBIDDEN`。服务端统一返回 `REALTIME_UNAVAILABLE/4500`，只向客户端表达实时转录暂时不可用；错误正文和日志不得返回 SQL、堆栈、数据库名称、供应商原文或访谈正文。权限错误继续使用 `FORBIDDEN/4403`。

### 5.9 `asr.final` 示例

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "timestamp": "2026-08-01T13:22:00+08:00",
  "schema_version": "1.0",
  "payload": {
    "segment_id": "uuid",
    "speaker_provider_id": "speaker_1",
    "speaker_role": "elder",
    "start_ms": 12000,
    "end_ms": 18400,
    "text": "后来我就去了洛阳。",
    "finality": "final"
  }
}
```

### 5.10 `suggestion.created` 示例

首轮事件同时只允许一个 `primary`，`alternatives` 必须为空；后续 `SPEC-AI-QUESTION-001` 可在不改变该产品行为的前提下收敛字段。

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "timestamp": "2026-08-01T13:22:08+08:00",
  "schema_version": "1.0",
  "payload": {
    "primary": {
      "id": "uuid",
      "question": "当时为什么决定离开家乡？",
      "reason": "长者刚刚提到前往洛阳，但尚未说明原因。",
      "purpose": "cause",
      "risk": "low",
      "confidence": 0.87,
      "evidence_segment_ids": ["uuid"]
    },
    "alternatives": [],
    "should_wait": false,
    "wait_reason": null
  }
}
```

## 6. 权限规则

### 倾听员

- 只能查看被分配项目；
- 可以创建和操作自己的访谈；
- 可以修正转录和说话人；
- 可以创建标记和导出；
- 不得修改全局供应商配置；
- 不得查看他人未分配项目。

### 管理员

- 管理账号和供应商配置；
- 查看系统运行状态；
- 不默认查看访谈正文。

### 数据管理员

- 处理导出和删除请求；
- 所有访问必须写入审计。

## 7. 导出结构

```text
/project-info.json
/service-terms.json
/consent-summary.json
/audio/
/audio-manifest.json
/transcript.md
/transcript.json
/transcript.csv
/memory.json
/questions.json
/markers.json
/session-notes/
/restricted-content/
```

规则：

- 普通内容与受限内容分离；普通资料包不包含敏感正文、`restricted` 正文或待删除内容；
- `do_not_ask` 的抽象边界标签可以进入工作记录的“边界”区域，但不进入叙事正文；既有内容是否导出由其其他 marker 决定；
- 受限资料包不自动生成 AI 摘要，只包含授权范围内必要的原始证据和 marker 清单；
- 普通资料包不得在删除请求处于 `pending_verification`、`verified`、`processing` 时生成；删除处理证据包只在 manifest 中标记请求状态和范围标识，不包含申请范围正文；
- 下载使用短期签名地址；
- 导出写入审计日志；
- 临时导出文件到期清理。

## 8. 契约变更规则

1. 新增字段优先保持向后兼容。
2. 删除或改名必须升级 API 或事件版本。
3. 状态枚举变更必须同步前后端和测试。
4. 数据迁移必须提供回滚或恢复方案。
5. 任何契约变更都必须更新测试样例。
