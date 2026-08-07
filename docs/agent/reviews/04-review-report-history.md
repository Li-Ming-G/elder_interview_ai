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
- 环境缺口：修复后 PostgreSQL/migration/auth/smoke/auth Chromium 仍须由新 head GitHub CI 重跑；旧 CI 不能替代新 head 证据。
- 审查边界：不覆盖真实麦克风/ASR、AudioWorklet、校准/remap、长时、浏览器刷新/进程/跨进程恢复、持久 outbox、正式工作台或生产部署
- 允许进入的下一状态：推送含 `6fd228f` 的新 head、全 CI PASS 后交项目负责人定向复审；明确 PASS 前 DEV-004B2 保持 REVIEW，父 DEV-004 继续 IN_PROGRESS

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
