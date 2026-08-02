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

### 3.1 项目

```http
POST   /projects
GET    /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id
POST   /projects/:id/restore
```

### 3.2 项目分配

```http
GET    /projects/:id/assignments
POST   /projects/:id/assignments
DELETE /projects/:id/assignments/:assignmentId
```

### 3.3 服务信息

```http
POST /projects/:id/service-terms
GET  /projects/:id/service-terms
```

### 3.4 授权

```http
POST /projects/:id/consents
GET  /projects/:id/consents
POST /consents/:id/revoke
POST /projects/:id/deletion-requests
```

### 3.5 访谈

```http
POST /projects/:id/sessions
GET  /sessions/:id
POST /sessions/:id/device-check
POST /sessions/:id/start
POST /sessions/:id/stop
POST /sessions/:id/recover
```

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
```

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

## 4. 幂等要求

以下写操作必须接受 `request_id`：

- 开始访谈；
- 结束访谈；
- 上传音频分片；
- 创建内容标记；
- 保存建议操作；
- 创建导出任务；
- 撤回授权；
- 创建删除申请。

重复请求必须返回同一业务结果，不得产生重复记录。

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

- 普通内容与受限内容分离；
- 删除请求未完成时明确标记；
- 下载使用短期签名地址；
- 导出写入审计日志；
- 临时导出文件到期清理。

## 8. 契约变更规则

1. 新增字段优先保持向后兼容。
2. 删除或改名必须升级 API 或事件版本。
3. 状态枚举变更必须同步前后端和测试。
4. 数据迁移必须提供回滚或恢复方案。
5. 任何契约变更都必须更新测试样例。
