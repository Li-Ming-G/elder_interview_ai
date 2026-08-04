# DEV-003B｜服务端原始分片、幂等与 manifest

## 基本信息

- 状态：`REVIEW`
- 负责人：后端音频实现 Agent（dev003b_audio_backend）
- 前置依赖：DEV-002 会话 seam、DEV-003A 上传队列 seam
- 交接对象：总控 Agent、DEV-004 与 MVP-V01 集成 Agent

## 目标

按 `04` 至 `06` 保存不可变原始音频分片，实现 session 内 seq 幂等、checksum 校验、缺失检测和 manifest。

## 输入依据

`00`、`01`、`02`、`03`、`04` §4.8/§4.24、`05` §3.6/§4、`06`、`08`、`09`、`10`、ADR-013/015/016、CON-010、HO-010。

## 允许修改

- `apps/api` 中独立 audio 模块、本地私有存储适配器和必要配置；
- Prisma schema 与单一前向迁移中的 `audio_object`、`audio_chunk` 及 consent FK；
- `packages/contracts` 的正式 audio DTO；
- DEV-003B 单元/PostgreSQL 集成测试，以及仅含人工生成虚构字节的 fixture；
- DEV-002 consent service 的最小对象完整性校验接入；
- 本任务直接相关的协作文档。

## 禁止修改

- 不实现 ASR、AI、转录、工作台、导出、删除、照片或通用附件；
- 不接入真实云对象存储、真实密钥、公网或真实访谈录音；
- 不修改 DEV-001B 身份协议、捆绑授权语义或 session start 门禁；
- 不返回内部 object key，不在日志或测试仓库写入真实音频/转录/个人信息。

## 交付物

- `audio_object`/`audio_chunk` 前向迁移与 Prisma 模型；
- 本地私有存储 adapter：原子写入、checksum/size 复核、已存在对象不可覆盖、测试隔离目录；
- init、raw binary chunk upload、complete、manifest REST 与 snake_case contracts；
- assignment-only 访问，consent/interview 用途和 session 状态门禁；
- `recorded_verbal` 只接受同项目 complete consent object 的事务校验；
- 给 DEV-003A 的稳定上传 client seam 与 GitHub 审查交接。

## 验证方式与验收标准

- format、lint、typecheck、build、相关 unit/PostgreSQL integration、空库迁移和重复 deploy；
- 重复 request ID、不同 request ID 相同分片、checksum/不可变字段冲突、乱序、缺片、最后分片、complete 后写入、跨项目、无 assignment、非法 session 状态；
- 存储失败不 ACK、不写 uploaded；数据库失败后的新文件补偿或可检测 orphan；complete 重新读取存储 size/checksum；
- consent 对象可在 draft project 下保存，interview 对象必须绑定 recording session；两种用途不能互换；
- 原始对象和元数据在明确清理流程前不得覆盖或删除；响应/日志不泄露 object key；
- 本地验证完成后 commit/push GitHub，任务转 `REVIEW`。只有项目负责人返回明确通过意见并登记对应 commit/PR 后才可 `DONE`。

## GitHub 审查交接

- 仓库：`Li-Ming-G/elder_interview_ai`（private）；
- 分支：`codex/mvp-v01-vertical-slice`；
- PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/1`；
- 实现完成后记录 commit SHA、CI/本地结果和未解决意见，保持 `REVIEW` 等待项目负责人。

## 2026-08-04 实现候选

- 实现提交：`134be76`；
- 已实现 `audio_object`/`audio_chunk` Prisma 模型和单一前向迁移、本地私有不可变存储 adapter、init/raw PUT/complete/manifest、assignment/session 门禁和 snake_case DTO；
- 分片使用 temp + hard-link 原子创建，校验 SHA-256/size，不覆盖同 key；complete 重读存储并固化连续 manifest；普通响应不返回内部 object key；
- `recorded_verbal` 在同一 project lock 内重新验证同项目 complete consent object、分片存储和 canonical manifest；
- 已覆盖 request/actor/target 幂等绑定、同序号冲突、缺片/乱序、complete 后写入、assignment 撤销、存储失败不 ACK、匹配 orphan 恢复和篡改拒绝；
- 总控本地通过：Prisma generate/静态校验、typecheck、lint、unit 11 files/48 tests、build、format、diff check；production audit 最终未发现已知漏洞；
- 未完成本地 PostgreSQL migration deploy/status/重复 deploy、integration/auth/E2E-auth，原因是 Docker daemon 与 `127.0.0.1:5433` 不可用；已实际尝试，不声称通过；
- GitHub CI run `30872055084` 对 head `7e95bdf` PASS：migration deploy/status、PostgreSQL integration/auth、build/smoke、Chromium 与 auth Chromium 等全部根门禁通过；
- 状态保持 `REVIEW`，等待项目负责人按 commit/PR 返回意见；CI PASS 不等于人工审查通过。
