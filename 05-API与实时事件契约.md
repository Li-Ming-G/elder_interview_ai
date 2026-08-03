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

创建成功时服务端追加一条 `status=valid` 记录，不修改历史。`recorded_verbal` 必须提供已属于本项目且已可靠保存的授权音频对象 ID；`electronic`、`written` 必须为 `null`。探索期仅使用虚构数据时可以使用 `electronic` 或 `written`；真实试点仍按 `03` 的口头授权和 `09` 发布门禁验收。

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
POST /sessions/:id/stop
POST /sessions/:id/recover
```

`POST /projects/:id/sessions` 只要求有效 assignment，可在项目仍为 `draft` 时创建 `status=created` 的会话；响应返回 `id`、`project_id`、递增 `sequence_no`、`status` 和时间戳。创建 draft session 不等于允许录音。

`POST /sessions/:id/device-check` 请求至少包含：

```json
{ "microphone_permission": "granted", "input_detected": true }
```

仅两项均满足时把 `created -> device_check`；失败保持 `created` 并返回可操作错误。

`POST /sessions/:id/start` 至少包含新的 `request_id`。服务端在同一事务重新读取 assignment、项目状态、当前已说明服务条款、最新有效捆绑授权和 session 状态；只有项目为 `ready|active`、session 为 `device_check` 且门禁全部满足时转 `recording` 并写 `started_at`。不得信任客户端提供的 `can_record`、授权状态或项目归属。相同 `request_id` 重试返回首次结果；门禁失败不得创建录音或 ASR/AI 任务。

### 3.6 音频

```http
POST /sessions/:id/audio-chunks/init
PUT  /sessions/:id/audio-chunks/:sequenceNo
POST /sessions/:id/audio-chunks/complete
GET  /sessions/:id/audio-manifest
```

### 3.7 转录

```http
GET   /sessions/:id/transcripts
PATCH /transcripts/:id
POST  /sessions/:id/speaker-remap
```

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

```http
GET  /sessions/:id/suggestions
POST /sessions/:id/suggestions/request
POST /suggestions/:id/actions
```

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
- 结束访谈；
- 上传音频分片；
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

地址：

```text
/ws/interviews/:sessionId
```

### 5.1 公共事件结构

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "timestamp": "2026-08-01T13:22:00+08:00",
  "schema_version": "1.0",
  "payload": {}
}
```

### 5.2 客户端上行事件

- `session.join`
- `audio.frame`
- `speaker.calibration`
- `suggestion.request`
- `marker.create`
- `session.stop`
- `heartbeat`

### 5.3 服务端下行事件

- `session.ready`
- `asr.interim`
- `asr.final`
- `asr.status`
- `speaker.mapping`
- `ai.analysis_started`
- `suggestion.created`
- `suggestion.failed`
- `timer.updated`
- `upload.status`
- `session.completed`
- `error`

### 5.4 `asr.final` 示例

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

### 5.5 `suggestion.created` 示例

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
