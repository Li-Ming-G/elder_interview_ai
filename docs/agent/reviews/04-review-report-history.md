# 独立审查报告

## 文件用途

本文件保存当前有效的独立审查结论，记录审查范围、发现的问题、测试证据和是否允许任务进入下一阶段。

当前尚未开始业务代码开发。`REV-001` 已完成，结论为 `PARTIAL`，不得据此放行 `DEC-001` 或开发任务；下方 P1 修复完成后必须重新独立审查。

## REV-001｜DEC-001 工程技术基线与跨规范冲突

- 审查提交：未提交工作区，基线 `a878f15`
- 审查范围：`AGENTS.md`、`00` 至 `10`、任务板、追踪矩阵、冲突日志、ADR、`DEV-001/A/B` 任务卡、交接和当前 Git diff
- 审查人：独立审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`PARTIAL`
- 允许进入的下一状态：仅允许总控修订正式契约并再次提交独立审查；`DEC-001`、`DOC-001` 保持 `VERIFY`，`DEV-001A/B` 保持 `BLOCKED`

已验证：

- 未发现静默扩大 MVP；
- Node 24、pnpm 11、Prisma 7、统一测试工具链及延后 Redis/BullMQ/Nginx 的工程方向内部一致；
- 三层 AI 边界、输入/输出过滤和失败时继续倾听的方向符合原始资料保全原则；
- `git diff --check` 通过，任务卡链接与状态一致，敏感模式扫描未发现疑似密钥；
- P0 为 0。

P1 阻塞：

1. `deletion_request` 缺少 session scope 的正式关系；
2. 删除处理中普通与受限导出行为冲突；
3. 登录、Cookie、CSRF、Origin、会话期限和防爆破契约不完整；
4. 用户状态、邮箱唯一规则和 production 身份安全来源未闭合；
5. `DEV-001B` 禁止业务资源却要求真实 A/B 资源隔离，验收不可执行；
6. 未拆分 `DEV-008` 缺少 `DEV-005` 依赖；
7. AI 边界候选缺少与正式 marker 分离的状态载体和处置契约。

非阻塞建议：补齐 `__Host-` Cookie 属性、哈希/Argon2id 参数、session 与 marker 归属校验，并把受限导出权限落到既有角色。

当前修订状态：上述 P1 已由总控写回待审工作区，尚未复审，不得视为关闭。

## REV-002｜DEC-001 P1 修复独立复审

- 审查提交：未提交工作区，基线 `a878f15`；15 个已跟踪修改文件、2 个未跟踪任务卡
- 审查范围：`AGENTS.md`、`00` 至 `10`、任务板、追踪矩阵、冲突日志、ADR、REV-001、`DEV-001/A/B`、交接与当前 Git diff
- 审查人：独立审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`PARTIAL`
- 允许进入的下一状态：仅允许总控修复 P1 并执行 REV-003；`DEC-001`、`DOC-001` 保持 `VERIFY`，`DEV-001A/B` 保持 `BLOCKED`

验证证据：

- `git diff --check` 通过；三个任务卡链接存在且 card/board 状态一致；
- 4 个 JSON 文件均可解析；
- 敏感模式扫描未发现私钥、AKIA、OpenAI/GitHub token 或疑似明文密码；
- 当前无业务代码，没有应用构建、迁移或测试可运行；P0 为 0；
- REV-001 的删除关系、导出主体规则、认证协议、DEV-001B 验收边界、DEV-008 依赖和候选载体问题已关闭；production 用户来源仅余启用遗漏。

P1 阻塞：

1. 删除 scope 对项目状态和 AI 停止范围在 `04`/`08` 与 `05`/删除流程之间不一致；
2. 删除申请只有创建 API，没有核验、拒绝、开始处理、完成和经核验撤回的生命周期契约；
3. `01` 要求账号启停，但正式规范与 `DEV-001B` 只有停用，没有启用路径和审计规则。

P2 建议：登录响应补 `no-store`；统一 `--operator-ref` 到 `actor_reference` 映射；Cookie 使用未确认“拾光”品牌应改中性名；任务卡补提交字段。

当前修订状态：三个 P1 和四个 P2 已写回待审工作区，尚未执行 REV-003，不得据此放行开发。

## REV-003｜DEC-001 最终独立复审

- 审查提交：未提交工作区，基线 `a878f15`；15 个已跟踪修改文件、2 个未跟踪任务卡
- 审查范围：`AGENTS.md`、`00` 至 `10`、任务板、追踪矩阵、冲突日志、ADR、REV-001/002、`DEV-001/A/B`、交接、占位契约说明与当前 Git diff
- 审查人：独立审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`PASS`
- P0：0
- P1：0
- 允许进入的下一状态：`DOC-001`、`DEC-001` 可 `DONE`；`CON-003/004/005` 可 `RESOLVED`；`DEV-001A` 可 `READY`；`DEV-001B` 与父 `DEV-001` 继续 `BLOCKED`

已关闭：

- REV-001 全部 7 项 P1；
- REV-002 全部 3 项 P1 和 4 项 P2；
- REV-003 检查中发现的 project 状态恢复、删除完成语义、普通软删/隐私删除恢复边界、AI 在途竞态、FK/tombstone 清理和 segment_range 范围冻结问题。

验证证据：

- `git diff --check` 通过；
- 4 个 JSON 均可解析；
- Markdown 相对链接全部有效；
- 敏感信息模式扫描无命中；
- 当前没有业务代码，因此没有应用构建、迁移或自动测试可执行。本 PASS 只证明文档与契约足以放行工程骨架，不代表任何代码已经验收。

P2（不阻塞 `DEV-001A`，已登记为后续阻塞）：

1. `DEV-008` 开工前补齐备份清理状态的完成、失败、重试与审计规则；
2. `DEV-008` 开工前补齐删除范围摘要 pepper 的密钥版本、轮换和历史摘要验证策略。

## REV-004｜DEV-001A 工程基线独立审查

- 审查提交：未提交工作区，基线 `2ff795a`
- 审查范围：DEV-001A 任务边界、工程配置、Web/API/DB smoke、Playwright、CI、日志与当前 diff
- 审查人：独立审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`FAIL`
- P0：0
- P1：1（Playwright Chromium 根门禁未建立，Web smoke 未实际请求构建资产）
- P2：2（logger 可原样输出消息/trace；缺少候选提交后的干净检出证据）
- 验证证据：冻结安装、format/lint/typecheck、单元 4/4、独立空库首次/重复迁移、集成 2/2、build、原 smoke、依赖审计和敏感模式扫描通过；Chromium 因未启动 Web 服务报 `ERR_CONNECTION_REFUSED`。
- 允许进入的下一状态：DEV-001A 保持 `REVIEW`；修复 P1 后复审，不解锁 DEV-001B。

## REV-005｜DEV-001A REV-004 修复独立复审

- 审查提交：未提交工作区，基线 `2ff795a`
- 审查范围：REV-004 三项修复、根脚本、Playwright webServer、CI、真实静态资产 smoke、logger 脱敏及测试
- 审查人：独立审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`PARTIAL`
- P0：0
- P1：0
- P2：1（候选尚未提交，缺少全新检出的冻结安装、全部根门禁和空库迁移可重复证据）
- 已关闭：Playwright 已接入根脚本和 CI；smoke 实际获取 2 个 JS/CSS 资产；logger 不再原样输出任意消息、`Error.message` 或 trace。
- 验证证据：format/lint/typecheck 通过；单元 4 files/6 tests；build 通过；smoke 通过且 3100/4173 无残留；独立沙箱外 `pnpm.cmd test:e2e` 为 `1 passed (5.3s)`；`git diff --check` 通过。
- 允许进入的下一状态：仅允许提交固定候选并执行干净检出复跑；DEV-001A 保持 `REVIEW`，DEV-001B 保持 `BLOCKED`。

## REV-006｜DEV-001A 候选提交与干净检出最终复审

- 审查提交：`fb99560d56988500c39ac996189e80313c173d9e`
- 审查范围：候选提交、原工作区与全新 clone、REV-005 唯一 P2 关闭证据
- 审查人：独立审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`PASS`
- P0：0
- P1：0
- P2：0
- 验证证据：两处 HEAD 精确一致且工作树干净；全新 clone 完成冻结安装、Prisma Client 生成、format/lint/typecheck、单元 6/6、空库首次/重复迁移、集成 2/2、build、真实资产 smoke、Chromium E2E 1/1；迁移后 public 仅 `_prisma_migrations`；3100/4173 无监听。
- 允许进入的下一状态：DEV-001A 可 `DONE`；DEV-001B 可 `READY` 并启动；父 DEV-001 和其余业务任务继续阻塞。

## REV-007｜DEV-001B 身份安全独立审查

- 审查提交：未提交工作区，基线 `6001a82`
- 审查范围：DEV-001B 身份、会话、登录限流、Web 会话、CLI、角色/资源授权、审计、迁移、测试和当前 diff
- 审查人：独立安全/工程审查 Agent（Ohm）
- 审查时间：2026-08-02
- 结论：`FAIL`
- P0：0
- P1：3
- P2：3
- 允许进入的下一状态：DEV-001B 保持 `REVIEW`；只允许修复下列问题并重新独立审查。CON-008 继续 `OPEN`，父 DEV-001 与 DEV-002 保持阻塞。

P1 阻塞：

1. 登录阻断裁定与失败计数不是单一原子协议；已存在 4 次失败时，并发猜测可能出现正确密码 200。必须使用短事务 reservation/attempt 状态完成原子裁定，不得在持锁事务内运行 Argon2。
2. Web 登出未检查响应，陈旧 CSRF、403 或网络错误时会错误清空本地已登录状态；必须安全轮换后重试或明确保留登录态。
3. 已知账号错误密码、disabled 登录失败与权限拒绝没有写入合规 audit；必须补审计且不得引入账号枚举侧信道。未知账号审计继续由 CON-008 阻塞，不得伪称完成。

P2：

1. CLI 四命令的数据变化与审计必须在同一事务，并用真实 PostgreSQL 覆盖 operator 映射、会话撤销和 enable 不恢复旧会话。
2. 需要实现并挂载最小 Nest 角色 Guard，以真实 403 路由证据证明角色门禁；不得创建 DEV-002 业务表。
3. Web 应在初始化时通过 `/auth/me` 与 `/auth/csrf` 恢复已有会话，并覆盖 401 与网络错误；auth 测试 `afterAll` 在初始化失败时不得制造次生异常。

修复后诊断补充：总控外部 Chromium 首轮发现正常登出后数据库会话已 `revoked_at` 且 reason=`logout`，但浏览器复用了 `/auth/me` 的旧 200。实现已为 `/auth/me` 补 `Cache-Control: no-store`，Web 身份 GET 显式使用 `cache: no-store`，API 测试断言 header，E2E 登出后用非缓存请求验证真实服务端 401；该修复仍须随 REV-007 其他项一起复审，不改变当前 FAIL 结论。

## REV-008｜DEV-002 领域基础与 DEV-003A 音频候选独立审查

- 审查基线：分支 `codex/mvp-v01-vertical-slice`；初审基线 `34d8b18` 的未提交实现；最终候选 `1085ae6`、`41d6104`
- 审查人：独立纵向基础审查 Agent（vertical_slice_foundation_review）
- 时间：2026-08-03
- 初审：`FAIL`，P0=0、P1=3、P2=2。P1 为创建者被静默当 owner、并发双 start、ACK 后 seq 复用；相邻复审另发现 ACK 后时间轴归零。P2 为真实浏览器 IndexedDB/MediaRecorder 证据和 start 失败 stop 挂起。
- 修复：访问上下文 `ownerUserId=null` 且只认 assignment；start 在首个 await 前同步加锁并双层禁用；IndexedDB v2 同事务持久化 session 序号与时间轴高水位；ACK 只删 chunk；start 失败清理停止 Promise；新增 fake-indexeddb 与回归测试。
- 最终结论：`PASS`，仅适用于 DEV-002 合同中立策略检查点、DEV-003A 内部候选提交并进入 `REVIEW`；P0=0、P1=0。
- 独立复跑：最终相关 4 个测试文件/20 tests 通过；未发现新增 P0/P1。
- 未覆盖：真实 Chromium MediaRecorder、原生 IndexedDB 页面刷新/崩溃、真实配额、多标签、60/180 分钟、服务端上传与 manifest。该 P2 阻塞 DEV-003A `DONE` 和真实试点，不阻塞候选提交。
- DEV-002 结论：CON-009 仍阻塞迁移/API；REV-008 不批准任何授权枚举、自动 assignment 或 DTO。
- 后续状态：项目负责人随后选择方案 A，并在 ADR-014、CON-009 与 HO-009 中形成正式决定；不改写 REV-008 审查当时的事实。

## REV-009｜DEV-002 项目、捆绑授权与会话链路独立审查

- 审查基线：分支 `codex/mvp-v01-vertical-slice`；未提交实现树，随后固定为 `f16b82a`
- 审查范围：DEV-002 数据模型/迁移、项目与 assignment 原子创建、assignment-only 隔离、服务/授权追加、撤回限制、session/device-check/start 状态机、幂等、审计和测试
- 审查人：独立纵向基础审查 Agent（vertical_slice_foundation_review）
- 审查时间：2026-08-03
- 初审结论：`FAIL`，P0=0、P1=2、P2=2。P1 为不同 request ID 可并发重复 start/revoke，以及 request ID 未绑定 actor/target 导致跨项目返回实体且不能保留首次响应。
- 修复：新增全局唯一 `idempotency_record`，绑定 action/actor/target 与首次最小响应快照；统一 `request → project → consent/session` 锁顺序；append/revoke 共用 project 锁；重放前重新检查当前 assignment；补并发、跨绑定、assignment 撤销、竞态、序号和回滚证据。
- 最终结论：`PASS`，P0=0、P1=0、P2=0；允许 DEV-002 内部候选进入 VERIFY，经总控完整门禁复跑后关闭任务。
- 独立执行：Prisma deploy 无待应用迁移；DEV-002 PostgreSQL integration 1 file/5 tests、unit 2 files/22 tests、format/lint/typecheck 全通过。
- 总控执行：migration deploy/status、根 integration 2 files/7 tests、auth 3 files/13 tests、unit 10 files/45 tests、format/lint/typecheck/build、diff check 与 production dependency audit 全通过。
- 边界：CON-010 保持 OPEN；`recorded_verbal` 失败关闭，只批准 electronic/written 虚构数据内部链路，不批准真实试点或公网使用。

## REV-010｜DEV-003A/B GitHub 项目负责人审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/mvp-v01-vertical-slice`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/1`
- 候选实现提交：`134be76`；认证 E2E 稳定性修复 `7e95bdf`；协作交接提交以 PR 最新 head 为准
- 审查范围：DEV-003A 真实 Chromium MediaRecorder/IndexedDB 证据；DEV-003B audio object、不可变分片、manifest、授权音频存储复核和回归测试
- 审查人：项目负责人（GitHub 人工审查）
- 当前结论：`PASS`（2026-08-04）
- 本地证据：typecheck、lint、unit 48/48、build、format、diff check、Chromium 2/2 通过；PostgreSQL migration/integration/auth 因本地 Docker/5433 不可用而未通过环境验证
- GitHub 证据：CI run `30872251081` 对 PR 审查 head `936fd04` PASS，包含 migration deploy/status、PostgreSQL integration/auth、build/smoke、Chromium E2E 与 auth Chromium E2E
- 人工证据：项目负责人确认审查对象为 PR #1 最新 head `936fd0408023ba074d2670576626e226f859923e`，提交未漂移；PR 声明范围、实现和 CI 一致；未发现阻塞性 P0/P1
- 通过边界：仅代表 DEV-003A/B 任务卡声明的内部虚构数据原型；父 DEV-003、自动上传与重试、真实麦克风、长时录音、崩溃、多标签、真实配额、云存储和真实试点均未通过
- P2-1：`putImmutable` 在 write/sync 失败时可能遗留临时文件；后续扩大完整临时文件生命周期的 `try/finally` 并增加失败注入测试
- P2-2：数据库记录存在但存储文件缺失时，错误内容重试可能先留下冲突 orphan；后续先读取已有元数据，再决定是否恢复存储文件
- 产品待确认：真实试点前明确同一 consent audio object 能否关联不同 `consent_text_version` 的多条授权记录，见 CON-012
- 允许进入的下一状态：DEV-003A/B 转 `DONE`；父 DEV-003 保持 `IN_PROGRESS`，两项 P2 在下一实现批次处理
- 合并记录：PR #1 于 2026-08-04 合入 `main`，merge commit `fa7b3a2669321ecc3fda0e991e733b0f7b6fc0d9`；不改变本审查绑定实现 head `936fd0408023ba074d2670576626e226f859923e` 的事实

## REV-011｜DEV-003C GitHub 项目负责人审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/dev003c-reliable-upload`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/2`
- 候选实现提交：契约 `d47b56d`；存储恢复 `b3376d9`；上传作业 `d85311a`；E2E 状态修正 `2768ab1`；整数时间边界 `7d7785a`；锁定最终 head `1aa643a29a33fca00fb8e82d37ad3002b2a4fca5`
- 审查范围：DEV-003C 任务卡声明的内部虚构/合成数据范围；两项 REV-010 P2、浏览器持久化上传作业、稳定幂等 ID、严格 ACK、响应丢失/刷新恢复和 complete
- 审查人：项目负责人（GitHub 人工审查）
- 当前结论：`PASS`（2026-08-04），P0/P1 为 0
- 自动证据：本地 format/lint/typecheck/build、unit 56/56、Chromium 3/3；GitHub 最终 CI run `30875834803` 对审查 head `1aa643a` PASS，包含 migration deploy/status、PostgreSQL integration/auth、smoke 与两组 Chromium E2E
- 已知失败与修正：首次 CI 发现认证 E2E 状态断言错误；第二次 CI 进一步发现浏览器小数毫秒不符合正式整数 API 契约，改为采集端连续整数边界并补回归测试；未放宽服务端契约
- 审查边界：仅覆盖内部虚构/合成音频 MVP；不包含真实麦克风、长时录音、浏览器进程崩溃、多标签、真实配额、云存储、ASR、真实客户或生产部署；CON-012 仍在真实试点前决策
- 非阻塞意见：生产或真实试点前移除或严格限制通过查询参数启用的内部 audio harness，见 CON-013
- 允许进入的下一状态：DEV-003C 与父 DEV-003 转 `DONE`；DEV-004 解除录音依赖但须先补正式任务卡和迭代预审
- 合并记录：PR #2 于 2026-08-04 合入 `main`，merge commit `bdf29108d8a650fedeefbab70db4f8c37cb12c25`；不改变审查绑定 head `1aa643a` 的事实

## REV-012｜DEV-004A GitHub 项目负责人审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/dev004a-transcript-core`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/3`
- 审查提交：最终 head `917f88827b80c88bba8515f0fe9aa0d92bb430c2`，GitHub 返回值与交接 SHA 一致且未漂移
- 审查范围：DEV-004A 内部虚构数据的 final-only 转录证据核心、说话人映射、幂等/冲突、payload 隔离、权限/fixture 门禁及 PostgreSQL integration
- 审查人：项目负责人（GitHub 人工审查）
- 审查时间：2026-08-04
- 当前结论：`PASS`；PR 非 Draft、可合并，未发现阻塞性 P0/P1
- 自动证据：最终 GitHub CI `30887031030` 全门禁 PASS，覆盖 format/lint/typecheck/unit、migration deploy/status、PostgreSQL integration、auth、build、smoke、Chromium E2E 与 auth E2E
- 通过依据：interim 门禁后零落库；final 以 `(session_id, ingest_key)` 幂等；不可变证据差异稳定冲突；原文/原角色快照不覆盖；mapping append-only 且部分唯一；payload 64 KiB 应用/数据库双限制并从 DTO 排除；assignment/restricted 门禁；fixture 只限 local/test 且 fake 未注册 production；无 controller 或公开写入口
- 审查边界：只覆盖 DEV-004A；父 DEV-004、业务 WebSocket、实时 PCM、前端 interim/final 事件、校准/remap、真实供应商、故障区间、离线补录和真实试点均未通过
- P2-1：后续增加完全相同 ingest key 的并发 PostgreSQL 写入测试，直接覆盖唯一约束与 P2002 恢复分支返回同一 ID 或稳定冲突
- P2-2：补 provider payload 接近 64 KiB 的精确边界测试，验证 `JSON.stringify` 字节数与 PostgreSQL `jsonb::text` 二次约束在极限附近的组合行为
- 允许进入的下一状态：DEV-004A 转 `DONE` 并合并；父 DEV-004 保持 `IN_PROGRESS`，DEV-004B 开工前先完成实时协议正式契约与任务卡
- 合并记录：PR #3 于 2026-08-04 合入 `main`，merge commit `2098d9f41de92e61baa3079d7037e00022745899`；不改变审查绑定 head `917f888` 的事实

## REV-013｜DEV-004B1 GitHub 项目负责人审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/dev004b1-realtime-server`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/4`；最终 head `80ff1c7294ad984e6173967705dde4b422eac474`；merge `13350a487c3754272f01b67a9b060db54a27184b`
- 审查范围：DEV-004B1 内部虚构 PCM 的服务端 WebSocket 协议核心；pre-101 鉴权、join/逐帧门禁、严格 codec、帧序/背压、事件 ACK/短时恢复、deterministic fake、final 落库后发布及故障隔离
- 审查人：项目负责人
- 审查时间：2026-08-06
- 当前结论：`PASS`；P0/P1=0，PR 非 Draft、可合并且 head 未漂移
- 本地证据：总控复跑 format/lint/typecheck/build、unit `18 files / 87 tests`、production dependency audit 与 diff check 均通过；Node `24.18.0`、pnpm `11.15.1`
- 自动证据：GitHub CI `30969408276` 对最终 head 全门禁通过 frozen install、format、lint、typecheck、unit 87、migration、PostgreSQL integration、auth、build、smoke、两组 Chromium E2E
- 本地未验证：无 Docker daemon/`127.0.0.1:5433` PostgreSQL，真实 WS + PostgreSQL integration 未在本机执行；GitHub CI 已补齐该证据
- P2-1：runtime `frames` 与 `publishedFinalSegmentIds` 未随 5 分钟/512 事件窗口清理；长时访谈前处理
- P2-2：heartbeat/event ACK 只重验登录 session，未重验 assignment；撤权旧连接可能继续占用 producer；B2/长连接加固前处理
- P2-3：未识别数据库/内部异常统一映射 `FORBIDDEN`；B2 错误状态展示前补不泄密的内部失败分类
- 审查边界：仅覆盖 DEV-004B1 服务端内部合成 PCM；不覆盖 DEV-004B2、浏览器字幕、真实麦克风/ASR、AudioWorklet、校准/remap、持久 outbox、跨进程恢复、长时性能或生产部署
- 允许进入的下一状态：DEV-004B1 转 `DONE` 并合入 main；父 DEV-004 保持 `IN_PROGRESS`，DEV-004B2 开工前补任务卡和迭代预审

## REV-014｜DEV-004B2 GitHub 项目负责人审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/dev004b2-browser-realtime`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/5`
- 被审提交：`70b8f2dc764a992f9760e308a6b24fd1aa6c12e9`；CI `31140269703` 全部门禁 PASS
- 审查范围：DEV-004B2 内部虚构/合成 PCM 浏览器纵向链路；heartbeat/event ACK 撤权复核、内部错误分类、独立 transport/state machine、薄 harness、背压、interim/final、短时重连和真实 API Chromium 证据
- 审查人：项目负责人
- 当前结论：`NEEDS_CHANGES`
- P1-1：join 权限/状态错误发生时服务端尚未绑定请求 session，错误信封使用 NIL UUID；客户端忽略后按普通断线重连，最终误报 `REALTIME_UNAVAILABLE/internal`，违反 4401/4403/4408 分类和失败关闭要求。
- P1-2：跨 audio stream ready/ACK 或 event sequence gap 触发 terminal failure 后，客户端仍推进 event cursor、发送 ACK、重发 PCM，socket/heartbeat 也未终止。
- 修复提交：`6fd228f`。服务端在格式有效的 join 进入鉴权前绑定请求 session；客户端只有事件成功应用后才推进游标/ACK/重发，terminal/reset 会关闭 socket、停止 heartbeat/reconnect 并拒绝后续帧；close code 在错误信封丢失时仍按 4401/4403/4408/4450/4500/4503 分类。
- 修复本地证据：定向 API/Web transport `2 files / 33 tests` PASS；format、lint、typecheck、build PASS；全仓 unit `19 files / 109 tests` PASS；普通 Chromium `4/4` PASS；`git diff --check` PASS。
- 修复 CI 证据：head `656933b` 的 GitHub CI `31142873253` 全部 PASS，覆盖 frozen install、format、lint、typecheck、109 项 unit、migration deploy/status、PostgreSQL integration、auth、build、smoke、普通 Chromium 和 auth Chromium。
- 审查边界：不覆盖真实麦克风/ASR、AudioWorklet、校准/remap、长时、浏览器刷新/进程/跨进程恢复、持久 outbox、正式工作台或生产部署
- 允许进入的下一状态：推送含 `6fd228f` 的新 head、全 CI PASS 后交项目负责人定向复审；明确 PASS 前 DEV-004B2 保持 REVIEW，父 DEV-004 继续 IN_PROGRESS
- 定向复审提交：`73a07cb676a9787ca0fa25d1b1c3297c44cffa0a`
- 定向复审 CI：`31143035668` 全部门禁 PASS
- 最终结论：`PASS`
- 通过依据：join 错误信封绑定已校验请求 session，错误信封丢失时按 close code 后备分类并停止重连；事件只在成功 apply 后推进 cursor/ACK/重发；跨 stream ready/ACK、event gap 和 error 均真正失败关闭；terminal/reset 清理 socket、heartbeat、reconnect 并拒绝后续帧；完整 transport 回归覆盖所有上述副作用。
- 未发现新的 P0/P1；DEV-004B2 可转 DONE 并合并。范围仍不含真实麦克风/ASR、AudioWorklet、校准/remap、持久/跨进程恢复、长时、正式工作台和生产部署；父 DEV-004 保持 IN_PROGRESS。

## REV-015｜SPEC-FE-001 GitHub 项目负责人首轮审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/frontend-mvp-plan`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/6`
- 被审提交：`e93db161cc7d922fee6333bea29f6d255c86c3a8`；CI `31151615335` 全部门禁 PASS
- 审查范围：首次访谈页面与内容规划、DEV-005A/B 可执行性、单问题建议与后置范围
- 审查人：项目负责人（GitHub 人工审查）
- 审查时间：2026-08-07
- 当前结论：`NEEDS_CHANGES`
- 已认可范围：准备页 → 转录优先工作台 → 安全结束页、单问题建议、项目列表/完整回顾后置，以及“换一个”交由 SPEC-AI-QUESTION-001 的路线成立。
- P1：原 DEV-005A 只允许修改 `apps/web`，却要求安全结束页显示与服务端事实一致的 `stopping/processing/failed/completed`；实际 ProjectFoundation controller/service 只有 create/get/device-check/start，没有 stop/recover 或 finalization。`05` 只列 stop/recover 路径，未冻结请求响应、状态转换、幂等、失败或完成条件。
- 影响：当前任务卡不可执行，不能在 PR 合并后把原 DEV-005A 整体解锁为 READY；否则前端只能猜测或模拟完成事实。
- 修复方向：明确 stop/recover 当前为占位；新增 SPEC-SESSION-END-001 与服务端 DEV-005C；DEV-005A 缩为准备页/路由外壳，DEV-005B 保持工作台，新增 DEV-005D 消费真实服务端事实实现结束页；更新契约、依赖、冲突、ADR、追踪和交接。
- 定向复审条件：锁定新 head，确认上述拆分和依赖一致、无前端模拟完成入口、所有引用和 CI 通过；无需推翻已认可的页面内容方向。
- 定向复审提交：`47f7b35b71a1621dd731c5e79384752b20c5121e`
- 定向复审 CI：`31153878655` 全部门禁 PASS
- 最终结论：`PASS`
- 通过依据：DEV-005A 已缩为准备页/路由外壳并禁止 stop/recover 与完成模拟；SPEC-SESSION-END-001 冻结状态机前置；DEV-005C/D 按真实服务端事实串联；DEV-005B 只保留挂载位置；`05` 明确路径占位；CON-019 保持 OPEN，父 DEV-005 与 C/D 不提前解锁。
- 合并记录：PR #6 以 merge commit `474c647307b1ed3e949da31c4e490ee0b0b192c7` 合入 `main`；SPEC-FE-001 可转 DONE，DEV-005A 可转 READY，其他安全结束边界保持不变。

## REV-016｜DEV-005A GitHub 项目负责人审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/dev005a-prep-shell`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/7`
- 最终审查提交：`ea6c20f5cf88de6ab017ef2262217dd3eb423a1e`；GitHub head 与提交信息一致且未漂移
- 自动证据：CI `31161076538` 全部门禁 PASS，覆盖 unit、migration、integration、auth、build、smoke、普通 Chromium 和 auth Chromium E2E
- 审查范围：DEV-005A 正式 project/session 深链、准备页、服务/授权/设备状态、惰性 session 创建、device-check/start 门禁、防重复提交及 DEV-005B 工作台占位壳
- 审查人：项目负责人（GitHub 人工审查）
- 审查时间：2026-08-07
- 最终结论：`PASS`；P0=0、P1=0、P2=2
- 通过依据：页面挂载不创建 session；设备检测不创建 MediaRecorder、分片或上传作业；create/device-check/start 有本地 in-flight 防重复且 start request ID 稳定；客户端只作预判，服务端 start 最终裁决；session 深链校验项目归属；未混入 stop/recover、安全结束、AI 或完整工作台。
- P2-1：当前工作台占位壳仅凭合法 URL 显示“访谈已开始/录音会话已启动”；DEV-005B 必须改为真实 session/WebSocket 服务端事实驱动，不得信任 pathname。
- P2-2：准备页当前从任意历史 `valid` 授权记录显示有效，而服务端 start 使用最新授权记录；DEV-005B 接续前端时统一为“最新记录有效”，避免撤回后历史记录造成误导。服务端仍会拒绝 start，因此当前不存在授权绕过。
- 审查边界：仅代表内部虚构数据的准备页和正式路由外壳；不覆盖完整工作台、安全结束、真实麦克风、真实授权资料、真实 ASR/LLM、真实试点或生产部署。
- 合并记录：PR #7 以 merge commit `066c424113c76da8ec15654a7216ac57aac2affe` 合入 `main`；DEV-005A 转 `DONE`，DEV-005B 页面外壳前置成立并转 `READY`；父 DEV-005 继续 `BLOCKED`。

## REV-017｜SPEC-SESSION-END-001 GitHub 项目负责人首轮审查

- 审查仓库：private `Li-Ming-G/elder_interview_ai`
- 审查分支：`codex/spec-session-end-001`
- 审查 PR：`https://github.com/Li-Ming-G/elder_interview_ai/pull/8`
- 首审提交：`e8fa20f39903aaf9f84a4dc4672d10ff25058933`；GitHub head 已核对一致
- 自动证据：CI `31162831225` 全部门禁 PASS，覆盖 migration、integration、auth、build、smoke 和 Chromium E2E
- 审查人：项目负责人（GitHub 人工审查）
- 审查时间：2026-08-07
- 首轮结论：`REQUEST_CHANGES`；P0=0、P1=1；其余重点均通过
- P1：`08` 已规定授权在 stop snapshot 前撤回后不能由客户端新建补传例外，但 `05` 首次 stop 只复核 auth、actor、assignment 和资源归属，未明确复核最新授权和项目 restricted；`finalize_interrupted` 继承同一歧义。
- 影响：录制中撤回授权但 assignment 仍有效时，DEV-005C 可能接受首次 stop 并事后创建 finalization/commitments，与安全治理契约相反。
- 修正要求：首次 stop 与尚无 finalization 的 `finalize_interrupted` 必须复核最新授权有效且项目未受限；撤权后不得新建 finalization/commitments，只保留服务端已可靠接收分片并进入/保持 `interrupted`；只有撤权前已经冻结的 snapshot 才允许受限补传。
- 定向复审条件：`05` 与 `08` 一致，并在 `09` §10.1 覆盖“授权在首次 snapshot 前撤回且 assignment 仍有效”的负向场景；CON-019 保持 OPEN、SPEC 保持 REVIEW、DEV-005C/D 保持 BLOCKED。
- 定向复审提交：`9c471d81d783c902ae389c50500cafac0b187202`；GitHub head 已核对一致。
- 定向复审 CI：`31163777417` 全部门禁 PASS，覆盖 migration、integration、auth、build、smoke 和 Chromium E2E。
- 最终结论：`PASS`；上轮唯一 P1 已闭环，未发现新的 P0/P1。
- 通过依据：首次 stop 与无 finalization 的 `finalize_interrupted` 在同一资源锁内重新验证 assignment、归属、最新授权与项目限制；撤权前没有 snapshot 时返回 403 且不创建 finalization/commitments，撤权前已冻结时才允许 commitment 范围内的受限补传；`09` §10.1 已覆盖 assignment 仍有效但授权先撤回的负向场景。
- 合并记录：PR #8 以 merge commit `9af96c1be61936e7eef7665d313e44a6f0c6c2bf` 合入 `main`；SPEC-SESSION-END-001 转 `DONE`，ADR-022 Accepted，CON-019 RESOLVED，DEV-005C READY；DEV-005D 继续等待 DEV-005C PASS。

## REV-018｜DEV-005B GitHub 项目负责人审查

- 审查 PR：[#9](https://github.com/Li-Ming-G/elder_interview_ai/pull/9)
- 最终提交：`c73e7ad0499c02af532670f350e62b34bf73cd87`；非 Draft、可合并且 head 未漂移。
- 自动证据：CI `31166457093` 全部门禁 PASS。
- 最终结论：`PASS`；P0=0、P1=0。
- 通过依据：工作台从 project/session/latest consent 服务端事实启动 transport；session/project 不匹配失败关闭；最新授权排序修复 REV-016 P2；final 按 segment ID 去重；回看、暂停跟随、新 final 计数和回到最新成立；ASR 与原始录音状态分离；没有接 stop/recover 或模拟 completed。
- 合并记录：PR #9 以 merge commit `647a6b4ffb1ca5f95fcfb7ff537390d109b84acf` 合入 `main`；DEV-005B 转 `DONE`，父 DEV-005 继续 `BLOCKED`。
- 范围边界：不覆盖安全结束、真实麦克风/ASR/LLM、建议持久化、真实试点或生产部署。

## REV-019｜DEV-005C GitHub 项目负责人首轮审查

- 审查 PR：[#10](https://github.com/Li-Ming-G/elder_interview_ai/pull/10)
- 审查提交：`738898a9d18dbb77d5fefec78d5daef90fcd5a48`；非 Draft、可合并且 head 未漂移。
- 自动证据：CI `31167044756` 全部门禁 PASS。
- 当前结论：`REQUEST_CHANGES`；P0=0、P1=4。
- P1-1：stop/`finalize_interrupted`、revoke 和 audio upload/complete 使用不同资源锁，撤权后仍可能提交 snapshot，stop 检查后也可能并发写入 commitment 外新字节。必须统一固定锁序、锁内重读并补 barrier 并发测试；complete 防御性核对冻结 commitments。
- P1-2：当前没有 ASR final drain/close seam，runtime 存在时直接 `degraded` 并完成。必须覆盖 drain 成功、不可用、超时及最后 final 先落库。
- P1-3：进程重启丢 runtime 后忽略持久 `asr_last_audio_sequence_accepted`，把曾启动 ASR 误报为 `not_started`；已有接收证据但无法证明 drain 应为 `degraded`。
- P1-4：advance 会重写终态/`completed_at`，且新 stop request ID 没有持久自己的首次响应，响应丢失后重试结果会漂移。`completed|failed` 必须稳定，每个 request ID 重放首次响应。
- P2：stop 202/200、malformed finalization 422 错误码和非原 actor complete 权限语义为非阻塞偏差；不纳入本轮四项 P1 定向修复。
- 定向复审条件：只关闭上述四项 P1并补对应自动化；提交新的 final head 和完整 CI 后复审。DEV-005C 保持 `REVIEW`，DEV-005D 保持 `BLOCKED`。
- 第二轮定向复审提交：`33c9a33cc1b7ff54af30ac8eb205ad0e20ddc063`；CI `31172641955` 全部门禁 PASS；结论仍为 `REQUEST_CHANGES`。
- 已关闭：首轮四项 P1 4/4 通过，包括共享锁与 barrier 并发、ASR final drain、runtime loss 持久事实及终态/首次响应幂等。
- 新增唯一 P1：`advance()` 将状态写为 `draining` 并在事务外等待 adapter 时，没有按 finalization 建立 single-flight；并发 recover/reconcile/匹配 stop 可重复调用真实 `drainAndClose()`，同 request ID 在首次响应落库前也不能阻止第二 runner。
- 修正要求：使用进程内 `Map<finalizationId, Promise<void>>` 复用同一 advance Promise，在 `finally` 清理；用阻塞 fake 覆盖相同/不同 request ID recover、reconcile 和匹配 stop，断言 drain 调用一次且最终/幂等响应稳定。进程重启后的 persisted `draining` 仍应可重驱。
- 范围：不新增 migration、Redis、BullMQ、真实 ASR、云存储或队列；三个原 P2 继续不处理。DEV-005C 保持 `REVIEW`，DEV-005D 保持 `BLOCKED`。
- 第三次定向复审提交：`36f534a45367eb19d19d19d05f0edcda317dbde9`；CI `31174226564` 全部门禁 PASS。
- 最终结论：`PASS`；P0=0、P1=0。旧四项 P1 和第二轮 single-flight P1 均关闭。
- 通过依据：同一 finalization 复用 `Map<id, Promise<void>>`；`finally` 防止旧 runner 删除后继；失败后清理并可重驱。阻塞 adapter 测试覆盖相同 request ID recover、不同 ID reconcile、匹配 snapshot stop，期间 drain 调用一次，释放后状态和幂等响应稳定。
- 非阻塞边界：stop 202/200、malformed finalization 422 和非原 actor complete 权限语义三个 P2 继续保留；不阻塞 DEV-005C 当前内部 MVP 范围。
- 合并记录：PR #10 以 merge commit `9691dadb7117aadea81eeb9516a40d5f8cb81ba0` 合入 `main`；DEV-005C DONE，DEV-005D READY，父 DEV-005 继续 BLOCKED。

## REV-020｜DEV-005R1 GitHub 项目负责人最终审查

- 审查 PR：[#13](https://github.com/Li-Ming-G/elder_interview_ai/pull/13)
- 审查提交：`6847dc2048bb2c7b4edd01c20637f8740021bedc`；PR open、非 Draft、可合并，head 未漂移，base 为 `codex/dev-005r-contract-baseline`。
- 自动证据：CI `31239385749` 完整 verify PASS；PR 记录 unit 136、PostgreSQL integration 40、auth 13，以及 migration、build、smoke 全通过。
- 最终结论：`PASS`；P0=0、P1=0。
- 通过依据：首 PCM adapter 接受有 250ms deadline 与 `AbortSignal`，且只有接受和 `first_pcm_accepted_at` 持久化均成功后才可能 ACK；首证据后正常帧不再持有 Prisma transaction/advisory lock；gateway 在 adapter、ingestion 和最终 ACK 前复核 producer lease；stop/revoke/report 可使旧 lease 失效；revoke/report replay 按 session 与原 `audio_stream_id` 条件清理，不误杀合法 resume 的新 generation；migration 与应用层共同保证 atomic start、单 interview audio object、generation 唯一/状态约束和 `NO_AUDIO_CAPTURED` 零证据语义。
- 非阻塞边界：真实 provider 必须实际响应 `AbortSignal`；producer lease 当前只保证单 API 进程；Android Chrome 真机和长时采集由 R4 验收。
- 状态限制：这是 DEV-005R1 implementation PASS，不代表 SPEC-DEV-005R 或父 DEV-005R 完成。由于 PR 为 stacked candidate，在 SPEC baseline PASS 前，DEV-005R1 保持 `REVIEW`，不得标记 `DONE` 或合入 `main`。

## REV-021｜SPEC-DEV-005R GitHub 项目负责人首轮审查

- 审查 PR：[#11](https://github.com/Li-Ming-G/elder_interview_ai/pull/11)
- 审查提交：`dc6a9537277180ff6ebdf104ad1238cdcf08ced0`；PR open、非 Draft、可合并，head 未漂移，base 为 `main`。
- 自动证据：CI `31243186240` 完整 verify PASS。
- 当前结论：`REQUEST_CHANGES`；P0=0、P1=4。
- P1-1：`05`/`06` 旧 audio init 仍允许或暗示独立创建 interview object，与 atomic start 唯一创建冲突。必须把独立 init 限制为 consent 等非 interview 用途，并同步旧 ADR。
- P1-2：`05` 仍允许 ACK 后删除本地 Blob，与 archive/delivery 分离冲突。ACK 只能清 delivery pending/reference，archive Blob 保留。
- P1-3：空录音判断必须检查该 session 所有 capture generations 的 `first_pcm_accepted_at`，不能只检查当前 generation；该项同时影响 PR #13 实现，需定向修复与 PostgreSQL 回归。
- P1-4：正式冻结 `resume_capture` 的 request ID、action、新 stream、同一 local job 累计 archive count 与 timeline high-water 完整 payload。
- 非阻塞收尾：SPEC 最终 PASS 后把 ADR-023/024 转 Accepted；R4 明确同时负责关闭 CON-020/021。
- 定向复审条件：只复核上述四项及相邻正式来源一致性；R1 仅复审全 generation PCM 修复；R2C 不重开。SPEC-DEV-005R 与 DEV-005R1 均保持 `REVIEW`。
- 定向复审提交：`80ab84f8970dcb68fb85d39e71c22f9aa6ec61bf`；CI `31244954185` 完整 verify PASS。
- 最终结论：`PASS`；P0=0、P1=0。旧 interview init、ACK 删除 archive Blob、全 generation PCM 判定与 resume payload 四项 4/4 关闭；ADR-017 的历史与 ADR-023 现行关系明确，R4 同时负责 CON-020/021。
- 合并记录：PR #11 以 merge commit `c572490b29dc7f3f1ce1191a7ea4a2e38c459dc3` 合入 `main`；SPEC-DEV-005R DONE，ADR-023/024 Accepted，stacked 契约基线门禁解除。R1 仍等待全 generation PCM 实现定向复审，R2C 不重开。

### REV-020 补充｜DEV-005R1 全 generation PCM 定向复审

- 最终审查提交：`c19a295015efaa4a27dfa6c8bf1e48b3e90ebf17`；PR #13 base `main`、非 Draft、可合并且 head 未漂移。
- 自动证据：CI `31245403822` 完整 verify PASS，包括 unit、migration、PostgreSQL integration、auth、build、smoke 与 Chromium E2E。
- 最终结论：`PASS`；P0=0、P1=0。
- 关闭依据：`abandonEmpty()` 在既有资源锁内查询整个 session 所有 generations；任一 `firstPcmAcceptedAt` 即拒绝 `NO_AUDIO_CAPTURED`。PostgreSQL 覆盖 gen0 有 PCM、resume gen1 无 PCM 后 abandon 返回 `CAPTURE_EVIDENCE_EXISTS`，并验证 session 仍 interrupted、audio 不变、finalization 为空且两代 generation 事实不变。
- 合并记录：PR #13 以 merge commit `656db200f7313abdf54c1492d32d594c6390f9b6` 合入 `main`；DEV-005R1 DONE。R2 的 R1 前置已满足，但仍等待 R2C PASS。

## REV-022｜DEV-005R2C GitHub 项目负责人定向复审

- 审查 PR：[#12](https://github.com/Li-Ming-G/elder_interview_ai/pull/12)
- 最终审查提交：`ae0774763e36c13d3e4d99b666039adf15ef0c2e`；base `main@4784080343fa2175dccf997fd79815884ce58069`，PR open、非 Draft、可合并且 head 未漂移。
- 自动证据：CI `31246011913` 完整 verify PASS，包括 format、lint、typecheck、unit、migration、integration、auth、build、smoke、E2E 与 auth Chromium；专用音频 Chromium repeat-each=3 为 9/9。
- 最终结论：`PASS`；P0=0、P1=0。
- 关闭依据：archive-first 停止顺序等待最终 Blob 持久化后才做非阻塞 realtime teardown；checkpoint 当前写失败可见而内部尾链可恢复且保留首因；Web Locks callback 前 rejection 稳定收束；producer generation 隔离旧异步 resolve/reject，不能污染新代状态。四项定向修复 4/4 关闭。
- 范围边界：只覆盖浏览器采集与归档核心积木；未提前实现 API、Prisma、共享 DTO、正式工作台或 DEV-005R2/R3。Android Chrome 页面生命周期与长时真机证据继续由 DEV-005R2/R4 负责。
- 合并记录：PR #12 以 merge commit `e455c13f34a61de699d6e6015c055bec6b83be28` 合入 `main`；DEV-005R2C DONE，DEV-005R2 READY。

## REV-023｜DEV-005R2 定向代码复审与环境门禁

- 审查 PR：[#14](https://github.com/Li-Ming-G/elder_interview_ai/pull/14)
- 审查对象：final head `829adf85479c22172308641fc201ac295744b47b`；base `main@efde30648158339fa336d13bcfc970e295e09eb0`，PR open、非 Draft、CLEAN 且 head 未漂移。
- 自动证据：CI `31251923003` 完整 verify SUCCESS；总控独立重跑 controller、workbench、IndexedDB、upload runner 四个定向测试文件，`4 files / 40 tests` PASS；`git diff --check` PASS，候选 worktree clean。
- 定向代码结论：`PASS`；P0=0、P1=0。start 前置失败首因与 browser lock、resume 新 generation 麦克风失败、local job missing 的稳定 orphan report 三项 P1 均关闭；workbench `recover()` rejection 已闭合。
- REV-023 当时任务整体验收为 `BLOCKED`：任务卡要求目标 Android Chrome 真机证据，而当时无设备、`adb` 不可用，不能用桌面 Chromium 替代。该环境门禁随后由 REV-024 supersede；本条保留历史结论。
- 合并记录：代码候选经用户授权，以 merge commit `5527af289d8e1321e01d7a137eb2c964c8ebbe12` 合入 `main`；合并不等于 DEV-005R2 DONE。

## REV-024｜DEV-005R2 Android Chrome 真机生命周期验收

- 审查对象：已合入 main 的 PR #14 final head `829adf85479c22172308641fc201ac295744b47b`、merge `5527af289d8e1321e01d7a137eb2c964c8ebbe12`；本轮不修改业务代码。
- 设备：OnePlus GM1900，Android 12 / SDK 31，Chrome `150.0.7871.188`；通过 USB ADB reverse 访问本地正式 Web/API，使用虚构项目与授权。
- 长时证据：正式路由连续采集约 6 分 20 秒，本浏览器 archive `0..371` 共 372 片、无序号缺口，服务端 `uploaded_chunk_count=372`。旋转、约 20 秒切后台和约 20 秒锁屏均保持同一 session、audio object、audio stream 和 generation 0，未刷新、未重新请求麦克风、未创建新 capture。
- 刷新证据：同一 local job/archive/request ID 与高水位保留；服务端 session/capture 进入 `interrupted`，reason=`page_recovery_detected`；未自动请求麦克风。
- 麦克风中断证据：第二条正式会话撤销 Chrome 麦克风权限后，本地 archive `0..70` 共 71 片、无缺口；服务端收到 70 片并把 session/capture 置为 `interrupted`，reason=`microphone_ended`。
- 独立复核：iteration-coach 独立只读验收采用 Correction mode，确认 R2 已满足 controller 事实层门禁；要求 R2 先实现恢复/安全结束 UI 会与 R3 依赖形成循环。P0=0、P1=0。
- 非阻塞：当前旧 workbench 在服务端已 interrupted 时仍显示“服务端进行中”，且无显式恢复/安全结束动作，明确转 DEV-005R3；准备页低音量输入容易误判为无声，登记 CON-022 P2。
- 结论：`PASS`。DEV-005R2 `DONE`，DEV-005R3 `READY`。CON-021 只完成 R2 行为冻结，继续 `OPEN`；R4 必须完成下一 generation resume、同一 session/object/job、累计 archive 时间轴、安全结束与 manifest 后才可关闭。

## REV-025｜DEV-005R3 GitHub 项目负责人正式复核

- 审查 PR：[#15](https://github.com/Li-Ming-G/elder_interview_ai/pull/15)
- 审查对象：final head `481ee2593f27c62e3d137842edfd15fe11ad157c`；base `main@bc7ea83fe042b3d12a90b3787323166f0f0308e2`，PR open、非 Draft、可合并且 head 未漂移。
- 审查归属：项目负责人手动 GitHub 复核。总控此前对 `db9579c4` 的交付完整性/内部预检只作为修复输入，不是正式审查、不登记独立 REV。
- 自动证据：CI `31289795181` 完整 verify PASS，包括 format、lint、typecheck、unit、migration、integration、auth、build、smoke、Chromium E2E 与 auth Chromium。
- 关闭依据：reconcile request ID 按业务 attempt 在未知结果时复用、权威成功后轮换；401 经 controller 失败关闭并真正返回登录；normal/interrupted/empty 三入口取消与 Escape 精确恢复焦点；只有 completed 使用完成语义；delivery failure 与本地 archive 事实分离；普通错误提示使用完整轻边框与软背景。六项定向复核全部关闭。
- 最终结论：`PASS`；P0=0、P1=0。
- 范围边界：只覆盖 DEV-005R3 工作台与安全结束实现。Android 完整恢复、长时采集、安全结束 manifest 与普通音量验证仍归 DEV-005R4；CON-020/021/022 保持 `OPEN`，父 DEV-005 继续执行中。
- 合并记录：PR #15 以 merge commit `8d5c4c5fda34a7e80e9c170aba289c3568332a07` 合入 `main`；DEV-005R3 `DONE`，DEV-005R4 `READY`。

## REV-026｜DEV-005R4 与父 DEV-005 GitHub 项目负责人正式复核

- 审查 PR：[#16](https://github.com/Li-Ming-G/elder_interview_ai/pull/16)
- 审查对象：final head `2fab0ead66e6b52d1b95dec0ef3708a78a5d5d26`；base `main@57e26a04fda7a7a393f27689aae97dbb8e20814c`，PR open、非 Draft、可合并且 head 未漂移。
- 自动证据：CI `31294084873` 完整 verify SUCCESS，包括 format、lint、typecheck、unit、migration、integration、auth、build、smoke、普通 Chromium E2E 与 auth Chromium。
- 复核结论：`PASS`；P0=0、P1=0。确认恢复代 `timeline_offset_ms` 只作用于服务端 ASR 结果映射，wire PCM 仍为 generation-relative；刷新后 session/object/job 不变，generation/stream 合法更新；archive 累计、PCM 重置、安全结束顺序、ACK/archive 分离与唯一 audio object 均成立。
- 纵向证据：桌面 Chromium 151 正式路由 5 分钟；OnePlus GM1900 / Android 12 / Chrome 150 正式路由约 8分21秒，刷新显式恢复后 491/491 manifest、ASR drained、session completed。普通近距离音量多次通过，安静输入失败且可重试。
- 状态决定：DEV-005R4 `DONE`、父 DEV-005 `DONE`、CON-020/021/022 `RESOLVED`。
- 范围边界：当前只覆盖单台目标 Android、内部虚构内容、test ASR/no-cloud storage；iPhone Safari、真实供应商、云存储、跨设备恢复和生产部署不在本结论内。
- 合并记录：PR #16 以 merge commit `7477dcaf6268aaf06834e2a02408cff5d490e5a6` 合入 `main`。

## REV-027｜SPEC-DEV-004C GitHub 项目负责人首轮审查

- 审查对象：PR #17 head `6983ee042c573bd833cc26f91f92751d19eb4b9c`，base `main@eda0b49e7291f6a7fe8a211a85766fb8da00ab6f`。
- CI：`31297150204` 完整 verify PASS；compare 仅 22 个文档/治理文件，无业务代码、Prisma、migration 或运行时实现。
- 结论：`REQUEST_CHANGES`；P0=0、P1=3。
- P1-1：final 到达时是否 collecting 不能定义校准控制内容；必须由服务端冻结不可变 PCM sequence/session-timeline 边界，并以重叠判断 delayed final。
- P1-2：`speaker_role_revision` 已定义，但下游没有 consumed watermark、provenance 或 stale 状态；必须冻结最小 consumer seam，或以独立下游 SPEC 阻塞 DEV-006。
- P1-3：WS 1.1 `speaker.calibration.updated` 与 begin/resolve 缺 canonical response payload；必须统一 snapshot 与 replay/GET 时点语义。
- 非阻塞补充：批量 start/end ID 明确为稳定 `(start_ms,id)` 总序闭区间。
- 治理边界：不得合并；SPEC 保持 REVIEW、CON-014 OPEN、DEV-004C1/C2 BLOCKED。修复后三项定向复审，不重审完整 DISC-004C。

### REV-027 定向复审

- 审查对象：PR #17 final head `2a65b1f19c65cdeacdef21658fded789640e6710`，base `main@eda0b49e7291f6a7fe8a211a85766fb8da00ab6f`。
- CI：`31298277051` completed / success，完整 verify 门禁通过。
- 结论：`PASS`，P0=0、P1=0；原三项 P1 3/3 CLOSED，批量稳定总序闭区间歧义同步关闭。
- 通过依据：PCM 串行 marker 冻结不可变校准半开区间；独立 `SPEC-DEV-006` 冻结未来跨 session consumer seam；REST、`session.ready` 与 WS 1.1 统一使用 `SpeakerCalibrationSnapshot`。
- 治理结果：PR #17 以 merge commit `0b6c3575104425b3907d94df894dd5d1f02006d1` 合入 main；SPEC-DEV-004C DONE、ADR-025 Accepted、CON-014 RESOLVED、DEV-004C1 READY。DEV-004C2、SPEC-DEV-006、DEV-006 不提前解锁。

## REV-028｜DEV-004C1 PR #18 项目负责人首轮审查

- 审查仓库/PR：`Li-Ming-G/elder_interview_ai`，非 Draft PR #18，分支 `codex/dev-004c1-speaker-calibration`。
- 被审 exact head：`4d18bcf5826aacad97494342d965b9a28d538497`。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=3。
- P1-1：缺正式 stable `(start_ms,id)` transcript GET 与 GET/WS 共用 trusted-role projection，WS/DTO effective/trusted 字段及权限/授权/restricted 反例证据不完整。
- P1-2：begin/resolve 的 canonical snapshot event 在 marker queue 外发布，membership 未推进 snapshot `updated_at`，缺 marker→PCM/final→label event 的真实并发、sequence、replay/current snapshot 证据。
- P1-3：旧 Chromium workbench matrix 没有实际 calibration snapshot，不能证明新面板在 390×844、320×568 的 collecting+双 label、confirmed、failed/skipped→retry、44px、focus/live region、无溢出与 mic 不增加。
- 治理：状态保持 REVIEW；不补 Android 真机，不扩 C2/DEV-006/真实 provider；修复后生成新 exact head 与 CI，再由项目负责人手动定向复审。开发 Agent 不合并、不宣告 PASS/DONE。

### 定向修复候选（待项目负责人复审）

- 修复 commit：`87d725c`；仍在 PR #18 原分支，最终 exact head 由其后的治理提交与 PR 动态 head 锁定。
- P1-1：stable transcript GET、唯一 trusted-role projection、REST/WS effective/trusted 字段与权限/授权/restricted 证据已补齐。
- P1-2：marker commit→canonical event→后方 PCM 已在同一 causal queue 线性化；subscriber 写失败保留 replay event；membership 推进 snapshot `updated_at`，并发/replay/current 事实已由真实 PostgreSQL 覆盖。
- P1-3：snapshot-driven 390×844、320×568 真实面板覆盖 collecting+双 label、confirmed、failed/skipped→retry；无溢出、44px、focus/live region、录音态与 mic count 回归通过。
- 本地全门禁：unit 219、PostgreSQL integration 49、auth 13、普通 Chromium 9、auth Chromium 4，format/lint/typecheck/build/smoke/migration status 均通过。此处仅登记修复候选，不构成新的审查结论；REV-028 的 `REQUEST_CHANGES` 历史保持有效，直至项目负责人手动复审。

### REV-028 定向复审

- 审查对象：PR #18 final head `a984587e86ba7824c789dad2fe0e2fa847abbd3d`，base `main@f4ca690f9bbdc63bdf9e2502cfe5c88b50f38ffd`；CI `31305357363` completed / success。
- 审查归属：用户在本轮明确把 GitHub 手动复审临时委派给总控；总控按 evidence-driven re-review + visual 模式执行，不将开发 Agent 自检视为审查结论。
- 结论：`PASS`，P0=0、P1=0。旧三项 P1 3/3 CLOSED：正式 transcript/trusted-role 投影、canonical snapshot 因果/时间语义、真实小屏 calibration panel 证据均成立。
- 独立证据：相关 unit 4 files / 27 tests PASS；Chromium calibration 小屏用例 1/1 PASS，并人工核对 320×568、390×844 collecting/failed/skipped 图。PostgreSQL 本机因未注入 `TEST_DATABASE_URL` 未复跑；exact-head CI 已以真实 PostgreSQL 完整通过 integration 9 files / 49 tests。
- 合并与状态：PR #18 merge `99b090dd10b12e4ae72537e9d32c89aed7576663`；DEV-004C1 DONE、DEV-004C2 READY。父 DEV-004 继续 IN_PROGRESS；SPEC-DEV-006/DEV-006 仍等待专项产品讨论与契约 PASS。
- 范围边界：Android 真机、C2 修正、真实 provider、跨 session AI provenance/stale/recompute 与生产设施不在本次 PASS 范围。

## REV-029｜DEV-004C2 PR #19 定向复审

- 审查仓库/PR：`Li-Ming-G/elder_interview_ai`，非 Draft PR #19，分支 `codex/dev-004c2-speaker-corrections`。
- 首轮审查对象：exact head `7f2934b8f5276d1ce18bfcac57c55d9574c245af`，base `main@2eeacacd19e247db92d3c0859f32455e6f879a25`；CI `31310356069` SUCCESS。
- 首轮结论：`REQUEST_CHANGES`，P0=0、P1=1。服务端幂等记录成立，但真实工作台每次点击保存都生成新 UUID；首次请求提交而响应未知时，重试无法复用原 request ID，会被当作新写入并转成版本冲突。现有测试只覆盖正常保存和明确冲突重读。
- 定向修复：mounted 页面内的 correction attempt 绑定 segment、所选角色、expected revision 与 request ID；网络/响应未知后的同一业务重试复用原 ID，权威成功后轮换，改角色或取消后清除旧 attempt。
- 最终审查对象：exact final head `757bf52e39400aa8e84a37c10124deedce8a291b`，base 未漂移；CI `31310993567` completed / success，完整 verify 门禁通过。
- 独立证据：总控复跑 `workbench-shell.spec.tsx` 1 file / 34 tests PASS、`git diff --check` PASS；实现侧完整 unit 225、PostgreSQL integration 57、auth 13、Chromium 9 与 migration/build/smoke 等由 exact-head CI 通过。新增测试直接覆盖未知响应 ID 复用、成功后轮换、改角色/取消后不复用。
- 审查归属：用户明确临时委派总控代行手动复审；实现任务始终保持 REVIEW，未自行宣布 PASS/DONE。
- 最终结论：`PASS`，P0=0、P1=0；PR #19 以 merge commit `83cdfef12347a41c38530b6c723a379352171459` 合入 main，DEV-004C2 `DONE`。
- 范围边界：结论仅覆盖当前没有 deletion producer 的内部 MVP 角色修正核心。session/segment deletion scope 为 `NOT IMPLEMENTED / NOT VERIFIED`，CON-023 保持 `OPEN`；未来 DEV-008 必须接入统一 scope guard，并处理 correction preview/operation 外键及并发顺序。复杂批量 UI、AI stale/recompute consumer、真实 provider 与生产设施不在本次 PASS 范围。
- 后续状态：父 DEV-004 因缺失区间/补转录验收尚未收口而继续 `IN_PROGRESS`；SPEC-DEV-006/DEV-006 继续 `BLOCKED`，等待专项产品讨论和契约 PASS。

## REV-030｜DEV-004 父任务内部 MVP 范围收口

- 审查对象：main `004dacc75dc59e32e0472b04396acbc18082e7b1`；CI `31311278529` completed / success。该 head 已包含 DEV-004A/B1/B2/C1/C2 的全部已审实现与 REV-029 治理收口。
- 范围决定：项目负责人明确“现阶段无需考虑补转录，先尽快把能用的产品做出来”。该决定解释为延期而非取消：故障区间持久化、真实供应商重连和离线补转录移至 `HARDEN-ASR-001`，不再作为当前内部 MVP/DEV-004 的关闭门槛。
- 独立预审：iteration-coach 只读复核采用 Correction mode，确认后置补转录符合“核心假设优先”的正式阶段顺序；要求保留原始录音、manifest、安全结束、降级可见和不伪造 final 的硬门禁，并把未来义务保留为明确任务。
- 聚合证据：DEV-004A REV-012、B1 REV-013、B2 REV-014、SPEC-DEV-004C REV-027、C1 REV-028、C2 REV-029 均已 PASS；当前代码可通过确定性 fake/虚构数据完成实时 interim/final、确定态幂等落库、流级可信角色、校准控制内容排除、单段/批量修正 producer seam，并在 ASR 故障时保持原始录音与安全结束。
- 结论：`PASS`，DEV-004 在“内部可用 MVP、无离线补转录”边界下 `DONE`。这不是完整 MVP、真实供应商或真实试点 PASS。
- 未关闭边界：真实 ASR、持久故障区间、离线补转录与对应回顾/导出一致性由 `HARDEN-ASR-001` 后置；CON-013、CON-023 及真实试点门禁不因本结论关闭。
- 后续：立即进入 DISC-006；SPEC-DEV-006 仍须讨论定稿和项目负责人审查，DEV-006/007 不因本次父任务关闭而自动开始实现。

## REV-031｜SPEC-DEV-006 PR #20 项目负责人首轮审查

- 审查仓库/PR：`Li-Ming-G/elder_interview_ai`，非 Draft PR #20，分支 `codex/spec-dev-006-memory-consumer-contract`。
- 被审 exact head：`2b6a5da1e67ef2b0e91457969a089ba79f09f465`；CI `31321844664` completed / success。绿色 CI 只证明门禁执行成功，不替代契约审查结论。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=3。SPEC-DEV-006 保持 `REVIEW`，不得合并或自行宣布 PASS/DONE。
- P1-1：`ai_derived_output` 与 memory claim、generated session note、需要资格判断的 context snapshot 等业务输出缺确定关联和 cardinality；实现无法判断一个 job 的五条 claim 应是一条还是五条资格记录，也缺范围化失效/删除语义。
- P1-2：规范要求“每条记录 expires_at”，但物理模型仅部分记录持有期限；缺 retention root、child 生命周期继承、先隐藏后清理、CASCADE/显式幂等顺序与失败重试契约。
- P1-3：任务板把 `SPEC-AI-QUESTION-001` 提前置为 READY，与其自身等待 SPEC-DEV-006 PASS 的前置冲突。项目负责人对 PR #20 PASS 并合并前必须保持 BLOCKED，前置固定为 `SPEC-FE-001 DONE + SPEC-DEV-006 项目负责人 PASS/merge`。
- 定向修复边界：仅同步正式规范与治理文档；不改业务代码、Prisma、migration 或 runtime contracts，不实现 CON-018/023，不选供应商，不扩产品功能。修复候选必须生成新 exact head 与完整 CI，再由项目负责人只复审这三项。
- 历史保留：本记录的 old head、CI SUCCESS 与 REQUEST_CHANGES 永久保留；后续修复候选或 PASS 不覆盖本次事实。

### REV-031 定向复审与最终接收

- 定向复审 exact head：`4759633ed1e3d9031c8bbe32892d61293f9ec01c`；CI `31326717132` completed / success；PR OPEN、非 Draft、mergeable 且 head 无漂移。
- 正式结论：`PASS`；P0=0、P1=0。逐业务输出 `ai_derived_output`、三类 retention root/child 生命周期和 SPEC-AI 前置状态三项旧 P1 全部关闭。
- 合并：PR #20 以 merge commit `6289c87009d4377ff190de74ad582e72597ba55a` 合入 main；SPEC-DEV-006 DONE、ADR-027 Accepted，DEV-006 与 SPEC-AI-QUESTION-001 READY。
- 边界：CON-018/023 继续 OPEN；deletion runtime 仍 NOT IMPLEMENTED / NOT VERIFIED；真实供应商、真实数据、固定保留期限和质量百分比门槛未通过。

## 审查模板

```text
审查编号：REV-XXX
审查任务：
审查提交：
审查范围：
依据文档：
执行测试：
主要发现：
阻塞问题：
非阻塞建议：
结论：PASS / FAIL / PARTIAL
允许进入的下一状态：
审查人：
审查时间：
```
### REV-032｜SPEC-AI-QUESTION-001 项目负责人手动审查 PASS

- 审查对象：PR #21 final head `af088ed6165c979e8de2e469900ee6519fafe183`，base `main@1d2b4daf207f21d25ab8df4d1f5d9b1f22ced299`。
- CI：`31352681061` attempt 2 completed / success；attempt 1 的既有 workbench 1 秒时序波动保留为非阻塞 flake，未修改测试目标或业务代码。
- 正式结论：`PASS`；P0=0、P1=0。自动替换参数、manual intent fence、请求与 committed 分离、零副作用历史、REST 正文/WS 无正文通知、硬撤下和 displayed/actual-asked 分离均通过。
- 合并：PR #21 以 merge commit `10fcc5c6580fa8285f54866f6252e5806b0f932a` 合入 main；SPEC-AI-QUESTION-001 DONE、ADR-029 Accepted、CON-018 RESOLVED。
- 边界：DEV-007 仍等待 DEV-006；CON-023、真实供应商、生产阈值、真实数据和试点质量门槛未通过。

## REV-033｜DEV-006 PR #22 项目负责人首轮审查

- 审查仓库/PR：`Li-Ming-G/elder_interview_ai`，非 Draft PR #22，分支 `codex/dev-006-memory`。
- 被审 exact head：`d5073501b170c7e11f2bc3e00395fb8fdf794480`；CI `31357613683` completed / success。绿色 CI 不替代业务、数据与安全契约审查。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=8。DEV-006 保持 `REVIEW`，不得合并或自行宣布 PASS/DONE。
- P1-1：session scope 未按每个被评估 session 保存 final 高水位，无法区分没有 final 与有 final 但零 eligible。
- P1-2：job 仅依赖唯一冲突，缺 request 权威重放、trigger dedupe、retry identity 与 input/process evidence。
- P1-3：provider 返回后的 policy/text/role/memory drift 未持久化 cancelled，可能遗留 provider succeeded + job running。
- P1-4：restricted/do-not-ask reader 固定空集合 fail-open；producer/read model 缺失时必须明确 fail-closed。
- P1-5：actual-question 仅 digest 精确相等，不符合 `question-sim-v1` NFKC/标点/全半角和语义相近匹配及负例要求。
- P1-6：context actual-question membership 未与 memory 同事务冻结/计数/manifest/写回重检，存在 supersede race。
- P1-7：未正式导出按 `beginGenerationAttempt/publishAttemptResult/withdrawPresentation` 命名与所有权冻结的 QuestionEvidence 写 seam。
- P1-8：display snapshot/event dependency 未闭合 root active + `expires_at>now`，cleanup HMAC 还复用登录限流 pepper。
- 定向修复边界：不重写主体，不扩 DEV-007 UI/编排；production boundary producer/read model 缺失时 `AI_POLICY_UNAVAILABLE`，local/test 只用显式 fixture；不新增 `content_marker`/deletion 半模型，不以 no-op/空集合冒充覆盖。CON-023 继续 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`。
- 修复候选证据：新增第 11 个 forward migration 与真实 PostgreSQL 约束反例；unit 232/232、integration 65/65、auth 13/13、E2E 9/9、auth E2E 4/4、build/smoke、空库 11 与 legacy 9→11 均本地通过。新 exact head/CI 待 PR #22 push 后绑定。
- 历史保留：本记录的 old head、CI SUCCESS、REQUEST_CHANGES 与 P1=8 永久有效；后续修复候选或复审结论不得覆盖本次事实。

### REV-033 定向复审与最终接收

- 定向复审对象：PR #22 exact final head `07d5ce1c75ce31e2265e78559545373ce216edb1`；CI `31363920049` completed / success；PR OPEN、非 Draft、mergeable 且 head 无漂移。
- 正式结论：`PASS`；P0=0、P1=0。跨 session final 水位、request/trigger/retry identity、漂移 cancelled、boundary fail-closed、`question-sim-v1`、context actual-question 事务冻结、正式 QuestionEvidence writer seam 与 retention 八项旧 P1 全部关闭。
- 合并：PR #22 以 merge commit `28fb22dede07d5d64589a30b67128f16c311f360` 合入 main；DEV-006 DONE。
- 边界：CON-023 继续 `OPEN / NOT IMPLEMENTED / NOT VERIFIED`；生产 boundary/deletion producer/read model 缺失时 AI 失败关闭。项目负责人随后要求先处理 CON-025 产品差异，DEV-007 保持 BLOCKED，未创建实现任务。

## REV-034｜SPEC-QUESTION-JOURNEY-001 PR #23 项目负责人首轮审查

- 审查仓库/PR：`Li-Ming-G/elder_interview_ai`，非 Draft PR #23，分支 `codex/spec-question-journey-001`。
- 被审 exact head：`0f3034d27975cd0695e9963d5e29535d7d574dda`；CI `31371643597` completed / success。绿色 CI 只证明旧候选门禁执行成功，不替代契约审查结论。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=3。SPEC-QUESTION-JOURNEY-001 保持 `REVIEW`，CON-025 保持 `OPEN`，DEV-007/007A/007B 保持 `BLOCKED`；不得合并或自行宣布 PASS/DONE。
- P1-1：CSV 条件逻辑未冻结 applicable 多条件 all-of/AND、inapplicable 多条件 any-of/OR、排除优先，以及空值、未知码、重复、适用/排除同码、fixture 与正式导入的一致校验责任。
- P1-2：`journey_policy_v1` 缺完整受控 `journey_reason_codes`、信号冲突优先级和确定性转移顺序；至少必须保证 safety/reluctance 等保守信号高于具体事件/可深入信号，且相同 frozen input + policy version 得到相同 stage/reason codes，不得引入固定题数/时间硬切。
- P1-3：CSV 与 `question_bank_item` 缺 `purpose`，模板须从 13 列升级为 14 列并复用既有受控 purpose；导入、运行时投影和轻调必须保持。同时须冻结 `adaptation_reason_code_v1` 枚举及边界，避免 DEV-007B 自行猜测。
- 定向修复边界：只更新文档、题库模板/fixture、任务拆分与治理；不修改 Prisma、migration、业务代码、runtime contracts 或页面，不重做三阶段、双题库、A/B 拆分或 existing current/history/next 体验。
- 修复候选：三项均已按 `07` 的唯一算法定义形成逐项响应；新 exact head/CI 只作为待项目负责人定向复审的候选，不能写成正式 CLOSED/PASS。
- 历史保留：本记录的 old exact head、CI SUCCESS、REQUEST_CHANGES 与 P1=3 永久保留；后续候选、复审或最终结论不得覆盖、改写或删除本次事实。

### REV-034 定向复审与最终接收

- 定向复审对象：PR #23 exact final head `5963af98b4a807e5fa1d00ff33f8ef6b6a0e6323`；CI `31380903831` completed / success；PR 在审查时 OPEN、非 Draft、mergeable 且 head 无漂移。
- 正式结论：`PASS`；P0=0、P1=0。条件逻辑 v1、`journey_policy_v1` 的 reason/优先级/稳定输出，以及 14 列 `purpose` / `adaptation_reason_code_v1` 三项旧 P1 全部关闭。
- 合并：PR #23 以 merge commit `f0bff3f029716804175000fab0d4441ec6585bf4` 合入 main；SPEC-QUESTION-JOURNEY-001 DONE，ADR-030 Accepted，CON-025 RESOLVED，DEV-007A READY。
- 边界：DEV-007B 继续等待 DEV-007A PASS；synthetic fixture 只用于 test/internal demo，正式内部试用前必须导入项目负责人题库；CON-023 与真实模型/试点边界不变。

## REV-035｜DEV-007A PR #24 项目负责人首轮审查

- 审查仓库/PR：`Li-Ming-G/elder_interview_ai`，非 Draft PR #24，分支 `codex/dev-007a-question-bank`。
- 被审 exact head：`5cea9726994656c6a95babdcb6bc8f3f7ce4014e`；CI `31385629751` completed / success。绿色 CI 只证明旧候选门禁执行成功，不替代数据不变量与环境门禁审查。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=2。DEV-007A 保持 `REVIEW`，DEV-007B 保持 `BLOCKED`；不得合并或自行宣布 PASS/DONE。
- P1-1：item immutable trigger 只拦 UPDATE/DELETE，import 完成后的 draft、active、retired release 仍可直接 INSERT item；数据库没有 seal、actual count 与 content digest 一致性不变量，可能改变 runtime membership 或绕过 fixture/license 校验。
- P1-2：受控 CLI 的 `--environment` 被 service 直接作为 fixture import/activate/retire 门禁事实，production/正式内部环境可伪装 test/internal_demo；必须改用可信部署配置并在 service/reader 继续失败关闭。
- 定向修复边界：只补 release membership seal、数据库 count/digest/scope/license 不变量与可信 `APP_ENV` 门禁；不重写 request replay、激活事务、CSV condition/journey 逻辑，不实现 LLM、QuestionEvidence publication、current/history/manual-next、UI 或 DEV-007B。
- 修复候选：采用同事务未提交 draft 构建窗口、数据库 canonical digest/count seal 与 deferred commit integrity；seal 后所有状态 item INSERT/UPDATE/DELETE 均拒绝。CLI 移除环境覆盖权，`APP_ENV=staging` 映射正式内部环境，`internal_demo` 只保留 release scope。本地 12 migrations、unit 265、PostgreSQL integration 73、auth 23、smoke、Chromium 9+4 与静态门禁全绿；新 exact head/CI 待推送后绑定，仍仅请求项目负责人定向复审。
- 历史保留：本记录的 old exact head、CI SUCCESS、REQUEST_CHANGES 与 P1=2 永久有效；后续修复候选或复审结论不得覆盖、改写或删除本次事实。

### REV-035 定向复审与最终接收

- 定向复审对象：PR #24 exact final head `6b8e69e1b3170a86699338c7037374029a163978`；CI `31395799408` completed / success；PR 在审查时 OPEN、非 Draft、mergeable 且 head 无漂移。
- 正式结论：`PASS`；P0=0、P1=0。数据库 membership seal/count/digest/deferred commit integrity 与可信 `APP_ENV` fixture 门禁两项旧 P1 全部关闭。
- 合并：PR #24 以 merge commit `7f9a17326f3d388333b63bd889ec09c5de5e5f91` 合入 main；DEV-007A DONE，DEV-007B READY。
- 边界：当前只证明 synthetic fixture internal demo；项目负责人正式 14 列题库尚未导入，正式内部试用内容、来源/许可和质量仍未验收；CON-023 不变。
## REV-036｜DEV-007B / PR #25 总控代行审查：REQUEST_CHANGES

- 授权：项目负责人明确要求睡眠期间由总控接管审查，遇到需要产品决策的问题前持续推进。
- 绑定：PR #25 head `55bf9fba9f721a5f02b9e3224768c644324f1293`，base `e8f3055d757426da063d4216ffb4d789dbc56c14`，CI `31412038872` SUCCESS。
- 结论：`REQUEST_CHANGES`；不得合并或标记 PASS/DONE。
- 已验证实现问题：manual admission 在冻结 job 后才校验 stale current、request replay 未绑定 expected payload、deadline 后 late completion 仍可发布、commit gate 漏验完整 eligibility/actual-asked、阶段变化仍受旧阶段 score 阻断、runtime journey signal builder 使多个阶段分支不可达；前端 history 只读首 50 条且不使用 cursor/anchor，刷新不能恢复历史，移动端隐藏推荐原因等。
- 产品 stop condition：项目负责人随后明确题库只是参考，模型可以大幅改写或完全生成题库外问题；这与 PR #25 和 ADR-030 的白名单/轻调核心假设冲突。原“机械证明轻调”的审查项不再按旧契约修复，而由 SPEC-QUESTION-DIRECTOR-001 / ADR-031 先行纠偏。
- 后续：保留本 head/CI/REQUEST_CHANGES 历史。新契约 PASS/merge 后，新建 DEV-007B v2 分支/PR，选择性移植契约中立的 API/WS/history/UI/幂等部分，重写 director/Context/candidate persistence 和相应测试。

## REV-037｜SPEC-QUESTION-DIRECTOR-001 / PR #26 项目负责人定向修订要求

- 审查对象：PR #26 old exact head `0a75b170f9a6bb8dddd04298b74987a420c3f954`；CI `31449510877` SUCCESS。绿色 CI 不替代文档、Schema 与 Prompt 的一致性审查。
- 正式结论：`REQUEST_CHANGES`；P1=4。SPEC 保持 `REVIEW`，ADR-031 保持 `Proposed`，CON-026 保持 `OPEN`，DEV-007/007B 保持 `BLOCKED`，PR #25 继续 `REQUEST_CHANGES`。
- P1-1：`05/07` 仍复制与两份 JSON Schema 平行且不一致的 Context/Output shape；必须由 `InterviewDirectorContextV1` 和 `InterviewDirectorOutputV1` 分别成为 AI 实际输入/输出的唯一技术结构。
- P1-2：第一版只采用“可信 Context → Director → 基础硬校验 → 发布”；后端不得声称能确定性证明复杂自然语言事实蕴含、真正单问或 risk/purpose 贴切，也不引入第二个 AI/critic。
- P1-3：首次基础校验失败后的第二次调用必须使用完全相同 Prompt、frozen Context、Output Schema 与 model config；不得传旧输出、错误或修复提示。第二次失败不创建 candidate、不改变 current/history。
- P1-4：frozen Context membership 保存模型实际看过的 `bank_references`；candidate reference 只保存模型声明实际使用的 seen 子集，空集合合法，禁止把全部 seen 自动记为 inspiration。
- 修订边界：只改正式文档、两份 Schema、Prompt 与直接治理记录；不实现 DEV-007B v2、UI、新题库机制、供应商、复杂语义验证或第二个 AI。新 exact head/CI 后只请求项目负责人定向复审，不自行 PASS/DONE/merge。

### REV-037 定向复审与最终接收

- 定向复审对象：PR #26 final head `8938d525d66f138e7c7b7e3049fe56cbea6bcbb1`；CI `31454260127` SUCCESS；审查锁定时 PR OPEN、非 Draft、可合并且 head 无漂移。
- 正式结论：`PASS`；P0=0、P1=0、P2=1。唯一 Director Schema、MVP 基础硬校验、完全同输入 retry、seen/declared 分离四项旧 P1 全部关闭。
- P2：`09` 末尾残留 SPEC-QUESTION-JOURNEY/DEV-007A/B 的旧动态状态，不阻塞 PASS；已在 merge 后治理提交中改为引用任务板当前事实。
- 合并：PR #26 以 merge commit `d320f642a30ee8cc71090ad0d1662b4fc2d08ad6` 合入 main；SPEC-QUESTION-DIRECTOR-001 DONE、ADR-031 Accepted、CON-026 RESOLVED、DEV-007B READY。
- 边界：本结论只接受 Director 契约，不实现 DEV-007B、真实 LLM、题库内容质量、生产设施或真实试点；PR #25 旧白名单实现继续 REQUEST_CHANGES，不得合并。

## REV-038｜DEV-007B v2 / PR #27 项目负责人首轮审查

- 审查对象：PR #27 exact head `542917229e1f68e60d434a74d6ef81b0cd7548f9`；CI `31458597516` completed / success；PR 当时 OPEN、非 Draft、mergeable，head 未漂移。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=4、P2=1。DEV-007B 保持 `REVIEW`，父 DEV-007 保持 `BLOCKED`；不得合并或自行宣布 PASS/DONE。
- P1-1：journey response/engagement 信号错误消费整场 elder 文本，且 `shouldContinueListening=true` 未阻止 Director 调用；必须只看当前/最近实质回答并直接发布 `continue_listening`。
- P1-2：primary 与 retry 各自拥有 8 秒、retry 前未重查安全状态，可能在前端已显示不可用后迟到发布；必须共享单一 8 秒绝对截止时间，每次供应商调用前重查 policy/deletion，截止后永久失去发布资格。
- P1-3：automatic 的 20 秒限制位于 provider 调用之后，且旧 score 无法区分同阶段问题；必须在 provider 前节流，并冻结无需第二 AI 的 deterministic `question-select-v1` comparator。
- P1-4：current snapshot 未命中安全历史查询时会用不检查 retention/expiry 的读取回填正文；expired/hidden/withdrawn current 必须在 Director Context 投影为 null。
- P2：`09` 末尾残留 DEV-007B `READY/尚未实现` 旧动态状态，定向修复时清理。
- 已确认主干：自由生成、seen/declared 分离、QuestionEvidence 单一 owner、displayed != actual asked、历史 cursor/anchor/刷新恢复不重开。
- 当前进展：上述 4 个 P1 与 1 个 P2 已形成定向修复工作区并通过定向 unit/PostgreSQL 证据；此记录仅永久保存旧正式审查，不构成新 head 的复审结论。

### REV-038 定向复审与最终接收

- 定向复审对象：PR #27 final exact head `0f03c270b7022ce8dbbce75028afe7e9f3e12cf3`；CI `31465809589` completed / success；最终锁定时 PR OPEN、非 Draft、未合并且 head 无漂移。
- 正式结论：项目负责人手动定向复审 `PASS`；P0=0、P1=0、P2=0。journey 最近实质回答/continue bypass、共享 8 秒绝对 deadline 与 retry 前安全重查、provider 前 automatic gate 与 deterministic `question-select-v1`、安全 current projection 四项 P1，以及 `09` 动态状态残留 P2 全部关闭。
- 审查载体边界：项目负责人尝试将 GitHub APPROVE 精确绑定该 SHA，但 integration 返回 `403 Resource not accessible by integration`，GitHub UI Review 未写入；项目负责人明确声明其当前手动回复即本次 exact-head 正式 PASS。
- 合并：PR #27 以 merge commit `3bb80df36d484779761cf6bb6d45c302fa8d32d7` 合入 main；该 main 集成点 CI `31468031796` completed / success；DEV-007B DONE，父 DEV-007 转入聚合验收。
- 历史保留：本节不覆盖同一 REV-038 old head `542917229e1f68e60d434a74d6ef81b0cd7548f9`、CI `31458597516`、REQUEST_CHANGES/P1=4/P2=1；旧 PR #25 继续 OPEN / REQUEST_CHANGES / 不得合并。
- 边界：正式题库、真实 LLM、生产 boundary/deletion reader、生产部署、问题质量与真实试点仍未验收；CON-023 继续 OPEN。子任务 PASS 不自动构成父 DEV-007 聚合 PASS。

## REV-039｜SPEC-ASR-PROVIDER-001 / PR #28 项目负责人首轮审查

- 审查对象：PR #28 exact head `8d9922bead9a7d70517bafe2245bc44a560b8dc5`；CI `31476068838` SUCCESS；PR 为 OPEN、non-Draft、未合并。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=1。SPEC-ASR-PROVIDER-001 保持 `REVIEW`，DEV-ASR-PROVIDER-001 保持 `BLOCKED`；不得合并或自行宣布 PASS/DONE。
- 唯一 P1：重连后当前 voice/attempt 成功 `final=1`、ingestion complete 与 drain success，不能掩盖此前已知且尚未回补的 ASR gap。必须区分 attempt receipt/state 与 session/capture transcription completeness；任一未回补 gap 对整场 sticky degraded/incomplete，只有未来 HARDEN-ASR-001 的权威 backfill 可另行定义有证据重算。
- 必要回归：voice A accepted PCM 后断线并产生 gap → voice B 新 namespace/new speaker stream → B receipt success → 整场仍 degraded/incomplete；同时覆盖 A 在首个 PCM 前失败或 A/B 连续完整交接的无 gap lane，防止把所有新 voice 永久降级。
- 当前进展：定向修复候选已在正式 contract/Schema、`04/05/06/09`、ADR、追踪与交接中冻结 attempt/session 分层、sticky 单向聚合、precise gap/no-gap 条件、runtime evidence loss 失败关闭及无 clear 路径；该描述仅记录候选，不构成新 exact-head 复审结论。
- 历史保留：old head `8d9922bead9a7d70517bafe2245bc44a560b8dc5`、CI `31476068838`、正式 REQUEST_CHANGES/P1=1 永久保留，不得被后续定向复审覆盖。

### REV-039 定向复审与最终接收

- 定向复审对象：PR #28 final exact head `84a2173c2b95111d7432b5c3a026494a3f666a3f`；CI `31484868105` SUCCESS；锁定时 PR OPEN、非 Draft、未合并且 head 无漂移。
- 正式结论：项目负责人手动定向复审 `PASS`；P0=0、P1=0。attempt drain 与整场 completeness 分层、未回补 gap 跨 attempt sticky、machine Schema 和最终数据库投影全部关闭；无 gap 的连续多-attempt 仍可 drained。
- 合并：PR #28 以 merge commit `d7b318fd654d978b60799cd068cbbef33f9c4989` 合入 main；main CI `31494227785` completed / success。
- 治理：SPEC-ASR-PROVIDER-001 DONE、ADR-032 Accepted、DEV-ASR-PROVIDER-001 READY；CON-027 继续 OPEN并阻塞真实长者/PII 试点。
- 历史保留：本节不覆盖 old head `8d9922b`、CI `31476068838`、REQUEST_CHANGES/P1=1；真实腾讯、目标 Android provider、同 PCM 三次 replay、fault lane 与账单仍归 DEV。

## REV-040｜SPEC-ASR-WIRE-PARAM-001 / PR #29 项目负责人最终接收

- 审查前状态：docs-only 修正候选保持 `REVIEW`；执行 Agent 只提交 non-Draft PR 与 exact-head CI，不自宣 PASS/DONE、不合并。该候选把旧供应商事实纠正为 `speaker_diarization=1` 与 `enable_speaker_context=0` 必须实发并进入 canonical query，`speaker_context_id` 必须省略。
- 审查对象：[PR #29](https://github.com/Li-Ming-G/elder_interview_ai/pull/29) final exact head `650f856c918639a7b992294b805873d7052ab44e`；CI `31556525476` completed / success；审查绑定 head 无漂移。
- 正式结论：项目负责人手动 `PASS`；P0=0、P1=0、P2=0。required/omit/empty 的 machine profile、实际 query 与签名 canonical 覆盖、一次受控诊断边界，以及 ADR-033 对 ADR-032 的窄 partial supersede 全部接收。
- 合并：总控按 accepted exact head 合并 PR #29，merge commit/main 集成点为 `1e18ea83cd5a1d4953bb92fd251637ed6107c322`，main CI `31560488220` completed / success。SPEC-ASR-WIRE-PARAM-001 DONE，ADR-033 Accepted，DEV-ASR-PROVIDER-001 的一次同虚构 TTS PCM/`reconnect=0` 诊断门禁已满足。
- 历史保留：ADR-032、SPEC-ASR-PROVIDER-001、REV-039 及其旧 wire-unknown 事实按当时证据永久保留；本 REV-040 不改写旧结论，只记录后续官方一手证据促成的正式修正。
- 边界：未修改业务代码、Prisma、migration、provider、密钥或部署，未连接腾讯。PASS 不证明 close 1005 根因，也不证明双人 label、三次 replay、桌面/Android、主动断线、账单、数据治理或 DEV provider 验收通过；CON-027 继续 OPEN。

## REV-041｜SPEC-DEV-008A / PR #31 项目负责人首轮审查

- 审查对象：[PR #31](https://github.com/Li-Ming-G/elder_interview_ai/pull/31) exact head `19604291e751f1403272183d314d367c0de593b0`；CI `31571463898` completed / success；PR 为 OPEN、non-Draft、未合并。
- 正式结论：`REQUEST_CHANGES`；P0=0、P1=3。SPEC-DEV-008A 保持 `REVIEW`，DEV-008A/A1/A2/A3/008D 保持 `BLOCKED`；不得合并或自行宣布 PASS/DONE。
- P1-1：`09` 要求 project/service term/consent/session create 在响应未知或刷新后不重复，但四个 POST 缺 request ID 和权威 replay；GET 无法唯一识别一次未知创建，可能重复业务记录、历史和审计。project 尚无 target ID 时也必须冻结 create binding identity；consent record 的 ID 不得与 consent audio init/chunk/complete 混用。
- P1-2：首页把所有未完成会话映射“继续访谈”、只让 completed 回顾，与 stopping/processing/failed 生命周期冲突。必须逐 session/finalization 冻结唯一主动作、可见状态、只读回顾、播放和本机删除边界，processing 不得误标为继续。
- P1-3：formal `local-audio-archive-v1` 缺 state discriminator 交叉约束，允许 complete+不可播放/pending、deleted+本机 payload/playback，且 delete success/replay 可无 `deleted_at`。必须先冻结唯一 projection 优先级，再由 Schema 机械拒绝矛盾组合，并补正反 fixture。
- 其余主体通过：网页-only、A1→A2/A3 拆分、正式口头 consent、统一 UI、本机删除 capture lock+fresh manifest+单 IDB 事务、无倾听员导出、local deletion≠server deletion、DEV-007 无依赖均无新 P0/P1。
- 定向修复候选：四 create 统一首次请求前持久 ID 与 actor/action/target-or-create-identity/payload hash authoritative replay；server read model 输出完整 session 动作矩阵；local projection 固定 active/dirty > pending > server unverified > receipt/empty > verified completeness，并增加条件 Schema 与正反 fixture。该描述只记录候选，不构成新 head 复审结论。
- 历史保留：本记录 old exact head、CI SUCCESS、REQUEST_CHANGES/P1=3 永久有效；后续定向复审不得覆盖、改写或删除本次事实。

### REV-041 定向复审与最终接收

- 授权与审查对象：项目负责人明确授权总控承担本目标手动审查；定向复审严格绑定 [PR #31](https://github.com/Li-Ming-G/elder_interview_ai/pull/31) final exact head `0308aa9ef37be457aa41f23ea6113666ff2c1f97` 与 exact-head CI `31573583324` completed / success；正式 GitHub 记录为 [issuecomment-5263644971](https://github.com/Li-Ming-G/elder_interview_ai/pull/31#issuecomment-5263644971)。
- 正式结论：`PASS`；P0=0、P1=0。P1-1 四 create 稳定 request identity/authoritative replay、P1-2 session lifecycle 唯一首页动作、P1-3 local archive 确定性优先级/条件 Schema/12 个正反例全部 CLOSED。
- 合并与集成：PR #31 以 merge commit `91e5e7ed042f598359827ae63daf464e12e2ef76` 合入 main；main CI `31573985661` completed / success。
- 治理：SPEC-DEV-008A DONE、ADR-034 Accepted、仅 DEV-008A1 READY；父 DEV-008A、A2、A3、008D 保持 BLOCKED，A2/A3 等 A1 PASS/merge，CON-023 继续 OPEN。
- 历史与范围：old head `19604291e751f1403272183d314d367c0de593b0` / CI `31571463898` / REQUEST_CHANGES/P1=3 永久保留。本次只接收 docs/machine-contract/governance，不代表 session list、UI、IndexedDB upgrade、播放、本机删除或服务端隐私删除已经实现，也不改变 DEV-007 状态。

## REV-042｜SPEC-DEV-008A1-ACCESS restricted 读取契约候选

- 审查对象：[PR #33](https://github.com/Li-Ming-G/elder_interview_ai/pull/33) / `codex/spec-dev-008a1-access-projection` 相对 `origin/main@29bdce17c0b9b81c965078fd12600b340b564194` 的 docs/shared-contract 候选；final exact head 与 exact-head CI 由最终审查包绑定。
- 当前结论：`PENDING`。任务保持 `REVIEW`，CON-028 为 `DECIDED`，ADR-035 为 `Proposed`，DEV-008A1 保持 `BLOCKED`；执行 Agent不得自行给出 PASS/DONE/merge。
- 复核来源：DEV-008A1 实现窗口 `019ff4ed-ed98-7e00-a592-6c6036a53a62` 在零改动阶段按 iteration-coach 完成恰好一次独立只读 Correction；总控随后正式裁决最小受限占位路线。本 docs-only 候选复用该证据，不启动第二次复核。
- 待审重点：restricted+有效 assignment 是否只返回闭合最小 DTO；deleted/软删除/assignment 失效是否完全不可见；session cursor 是否绑定 project/keyset anchor 并能拒绝跨项目/篡改/失效；普通 session/project/service/consent reader 是否拒绝 `created_by`/深链旁路；evidence-finalization 是否只保留冻结证据收束所需字段且不能驱动普通页面。
- 范围：只修改正式文档、shared TypeScript machine contract 与治理记录；无业务代码、Prisma、migration、页面、测试实现、部署、密钥或真实数据改动。CI SUCCESS 只能证明门禁通过，不自动构成契约审查 PASS。

### REV-042 final exact-head 审查与接收

- 审查对象：[PR #33](https://github.com/Li-Ming-G/elder_interview_ai/pull/33) final exact head `81f0bba3d30139e458e919da969d40386231cc62`；CI `31586889712` completed / success；正式记录为 [issuecomment-5265462316](https://github.com/Li-Ming-G/elder_interview_ai/pull/33#issuecomment-5265462316)。
- 正式结论：项目负责人 `PASS`；P0=0、P1=0、P2=0。restricted+有效 assignment 的闭合最小投影、deleted/软删除/assignment 失效无行、session cursor 绑定与失败关闭、`created_by` 非授权、专属 `EvidenceFinalizationResponse` 全部接收。
- 合并与集成：PR #33 以 merge commit `18ba7381f7ba747c2fb3beefe28297c6d063a174` 合入 main；main CI `31587442461` completed / success。
- 治理：SPEC-DEV-008A1-ACCESS DONE、ADR-035 Accepted、CON-028 RESOLVED、DEV-008A1 READY；父 DEV-008A、A2、A3、008D 保持 BLOCKED，CON-023 继续 OPEN。
- 历史与范围：上方 `PENDING` 候选与唯一 Correction 历史永久保留。本次只接收 docs/shared-contract 安全接缝，不代表 A1 handler/repository/cursor/routes/UI、Prisma/migration 或运行时安全测试已实现。

## REV-043｜DEV-008A1 runtime 实现候选

- 审查对象：`codex/dev-008a1-listener-home` 相对 `origin/main@d82e14da6796ae8ead9a33a85083abd3c53ed803` 的 A1 runtime/UI/test/governance 候选；PR、final exact head 与 exact-head CI 由最终审查包绑定。
- 当前结论：`PENDING`。DEV-008A1 保持 `REVIEW`，父 DEV-008A 与 A2/A3/008D 保持 `BLOCKED`；执行 Agent 不得自行给出 PASS/DONE、不得合并。
- iteration-coach：严格复用 A1 开工前恰好一次独立只读 Correction；该 Correction 促成 SPEC-DEV-008A1-ACCESS、ADR-035 和 CON-028 的已审安全契约。本恢复实现未启动第二次复核。
- 候选内容：唯一 authenticated Home、formal project/session read model、签名绑定 cursor、服务端唯一动作矩阵、restricted 中性最小投影、普通深链失败关闭、created_by 非授权、专属 evidence-finalization seam、A2/A3 明确未实现路由壳与共享三视口 UI。
- 本地证据：fresh PostgreSQL 13 migrations deploy/status、integration 79/79、auth 23/23；unit 309/309；普通 Chromium 13/13、auth Chromium 4/4；build/smoke/format/lint/typecheck/diff 通过；1440×900、390×844、320×568 真实 Chromium 无横向溢出且满足 focus/live region/reduced motion/44px。
- 待审重点：restricted/hidden rows 字段闭合；cursor tamper/cross-project/permission drift；session/finalization `created_by` 与 idempotency replay 降权；ordinary reader 和 evidence DTO 隔离；typed review/save-facts 深链不能绕过服务端 action；A2/A3/删除/导出/ASR/LLM/QuestionEvidence 不越界。
- 范围：无 Prisma schema/migration，未实现 A2/A3/008D、服务器删除、导出、PWA/App、ASR/LLM 或 QuestionEvidence/题库/AI history。绿色本地或 GitHub CI 不自动构成项目负责人审查 PASS。
