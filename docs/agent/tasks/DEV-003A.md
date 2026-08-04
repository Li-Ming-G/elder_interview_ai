# DEV-003A｜浏览器采集与本地可靠分片暂存

## 基本信息

- 状态：`REVIEW`
- 负责人：音频前端 Agent（dev003a_browser_audio_buffer）
- 前置依赖：DEV-001A
- 分支：`codex/mvp-v01-vertical-slice`
- 交接对象：总控 Agent、DEV-003B

## 目标

建立可独立验证的浏览器短时音频采集和本地可靠分片暂存层，使网络/API 未就绪或上传失败时原始分片不静默丢失，并输出稳定的上传队列 seam。

## 输入依据

`00`、`01`、`02`、`03`、`05`、`06`、`08`、`09`、`10`、ADR-002/013。

## 允许修改

- `apps/web` 内独立 audio capture/buffer 模块、组件级验证入口与测试；
- 仅前端内部使用的类型和测试 fixture；
- 本任务直接相关的协作文档。

## 禁止修改

- Prisma、数据库迁移、API 路径、服务端业务模块和公共跨模块契约；
- ASR、AI、项目/授权/会话、导出或生产对象存储实现；
- 真实访谈录音、真实个人信息、自动上传到外部服务；
- 在没有授权状态输入时自行判定允许录音。采集入口必须接受外部 `canRecord`/session context，默认拒绝。

## 交付物

- MediaRecorder 能力检测、权限拒绝/设备错误、开始/停止与最后分片收束；
- IndexedDB（或经任务证据证明同等可靠的浏览器持久层）保存不可变分片与元数据；
- 每片至少包含 session 占位标识、seq、时间范围、MIME、字节数、checksum、状态；
- 重启/刷新后可恢复待上传队列，ACK 前不得删除；重复入队幂等；容量/写入失败明确阻止继续并提示风险；
- 面向 DEV-003B 的上传队列接口和交接说明。

## 验证方式与验收标准

- format、lint、typecheck、前端单元/组件测试；
- 使用人工生成或明确测试音频验证权限拒绝、重复分片、刷新恢复、写入失败、停止尾片；
- 未连接服务端时也能证明分片持久化与恢复；
- 不把内存队列冒充可靠保存，不在 ACK 前清理原始分片；
- 当前仅为内部原型，可进入 `REVIEW`；真实长时录音与跨浏览器兼容仍由 DEV-003/QA 门禁验证。

## 2026-08-03 内部候选状态

- 提交：`41d6104`；
- 已实现同步启动锁、外部 `canRecord` 默认拒绝、分片 SHA-256/不可变幂等、本地容量失败停止、IndexedDB 可靠暂存、ACK 前保留、序号与时间轴高水位、刷新恢复 seam、尾片收束；
- 自动证据：音频 4 files/15 tests，根 10 files/45 tests；fake-indexeddb 覆盖事务、ACK 后重开和高水位；format/lint/typecheck/build/diff check 通过；
- REV-008 最终结论仅对“内部候选提交并进入 REVIEW” PASS，P0/P1=0；
- 未验证真实 Chromium 的 MediaRecorder、原生 IndexedDB、页面刷新/崩溃、多标签、真实配额、60/180 分钟；因此不得标 `DONE`、不得用于真实访谈。

## 2026-08-04 GitHub 审查候选增量

- 实现提交：`134be76`；
- 新增仅由 `?audio_harness=1&session_id=...` 显式开启的内部 Chromium harness，使用 Web Audio 合成流，不采集真实麦克风或个人信息；正常 `/` 入口不变；
- Playwright Chromium 2/2 通过：原生 `MediaRecorder` 生成非空 WebM；原生 IndexedDB 在刷新和同源新页面后恢复；ACK 删除 Blob 后仍保留 seq/timeline 高水位，后续录制不复用序号、不重置时间轴；
- 总控复验：音频相关测试包含在根 unit 11 files/48 tests 中并通过；format、lint、typecheck、build、diff check 通过；
- 未覆盖：真实麦克风、浏览器进程崩溃、多标签、真实配额、60/180 分钟以及浏览器队列到服务端的自动上传/重试编排；
- 状态保持 `REVIEW`，候选随 GitHub PR #1 交项目负责人审查；push/CI 不等于通过。
