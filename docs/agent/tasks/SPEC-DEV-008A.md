# SPEC-DEV-008A｜倾听员网页工作区、最小回顾与本机副本契约

## 基本信息

- 状态：`REVIEW`
- 负责人：独立 SPEC-DEV-008A 执行任务
- 分支：`codex/spec-dev-008a-listener-workspace`
- 基线：`origin/main@a349f8947eabe2eb5444ed2cf3c20e386c75bdb5`
- 前置依赖：DEV-002/003/005 已完成的项目、授权、session、archive、manifest、transcript seam；不依赖 DEV-007 聚合验收
- 输入依据：`00/01/03/04/05/06/08/09/10`、ADR-017/023/024/034、CON-006/007/023、DEV-003C/005R2C/005R2/005R4/006 交接和当前 IndexedDB/API/Web 实现
- 允许修改：正式规范、治理、任务卡、交接、iteration journal、必要 machine-readable contract
- 禁止修改：业务代码、Prisma schema/migration、测试代码、密钥、部署、真实数据
- 审查权：仅项目负责人对非 Draft PR exact final head/CI 手动审查；执行 Agent 不得 PASS/DONE/merge

## 目标

把历史 `DEV-008` 的错误聚合拆为可执行边界，并冻结同一个响应式网页产品中的：

1. 统一 authenticated 倾听员 home/app shell；
2. 新建访谈的完整授权纵向入口；
3. 已结束访谈的最小回顾；
4. 当前 origin IndexedDB 录音副本的事实、播放和原子删除；
5. 正式服务器隐私删除 `DEV-008D` 的独立安全边界。

## 冻结范围

### A. 统一工作区

- `/` 是唯一 authenticated home/app shell，承载新建、项目/访谈列表、继续、回顾、空/loading/error/restricted 和退出；历史深链继续可恢复但不是长期入口；
- A1 拥有共享 HomeShell/ListRow/StatusBadge 等价语义、状态词汇和 routes；A2/A3 只嵌入，不另建平行导航；
- 项目列表复用 `GET /projects`；会话列表新增 `GET /projects/:id/sessions` 最小 read model，受 assignment 与 restricted/deleted 失败关闭约束且不返回正文。

### B. 新建访谈

- 固定纵向路径：登录 → 最低项目信息 → 服务说明 → 正式有效授权 → session/准备页 → device check → start；
- 创建 draft 只是第一步，不能显示“可开始”；
- 普通 UI 复用既有正式 API 和 MVP 口头授权证据；`electronic|written` 等 fixture 只限 local/test，不进入普通 UI；
- 不新增绕过授权的生产捷径，不改变既有 start 门禁。
- project/service term/consent/session 四个 create 均在首次请求前持久化稳定 request ID，并由同一 authoritative seam 绑定 actor/action/target-or-project-create-identity/canonical payload hash；响应未知只重放原 ID，同 ID 异绑定冲突；consent record ID 与 consent audio 各动作 ID 分离。

### C. 最小回顾

- 仅限已结束、原始录音已有权威 manifest 的 session；
- 本机完整 archive 播放；原始/已有修订转录只读；本机 archive 字节和 origin 级近似容量；本机副本删除；
- 不含题库、AI 问题历史、记忆/工作记录、文本编辑、说话人修正、复杂标记、服务端下载、导出或正式隐私删除。
- 首页逐 session 动作按 `03` §17.2/`05` §3.1 唯一投影：processing 不属于继续；failed 依 NO_AUDIO_CAPTURED、complete manifest 或其他失败确定是否只读回顾/播放，本机删除仍只限 processing/completed。

### D. 本机副本安全契约

- 当前 origin IndexedDB archive 不是文件、跨设备权威档案或永久备份；服务端 complete audio object/manifest 是长期权威副本；
- 播放要求 `0..N-1` 连续、Blob 可读、逐片元数据与 fresh manifest 对应；缺片不可播放部分录音冒充完整；
- 删除共用 `elder-interview:capture:{session_id}` exclusive Web Lock，锁不可用/占用即失败关闭；
- 锁内 fresh 读取 session+manifest，并重读 pending/job/checkpoint；精确门禁见 `05` §3.6.1；
- 单个 IndexedDB `readwrite` transaction 覆盖 archive/delivery/session-state/formal job/all interruption reports/checkpoint/legacy chunks，并原子写最小回执；失败 abort、零部分清理；
- replay 为稳定 `already_deleted`；清站导致回执消失后只投影 `missing_unknown`；
- `archive_bytes` 精确，storage estimate 只为 origin-wide approximate；
- projection 按 active/dirty > pending > server unverified > receipt/empty > verified completeness 唯一计算；Schema 条件锁定 state/count/pending/playback，delete success/replay 必有稳定 `deleted_at`，blocked/abort 必为 null；
- 确认和成功文案明确服务器录音、转录、记忆仍保留。

### E. 产品与平台边界

- 只做响应式网页和 Android Chrome 等现代浏览器；不做 PWA、Service Worker 安装体验、Capacitor/WebView 或 Android App；
- 倾听员端不导出。未来其他角色需要导出时另立受控任务；
- local deletion 不创建/推进 deletion request，不关闭 CON-023；`DEV-008D` 继续负责正式服务器删除与统一 scope guard；
- DEV-007 当前暂停且不是 A1/A2/A3 前置。

## 实现拆分与状态

1. `DEV-008A`：父聚合，`BLOCKED`；只汇总 A1/A2/A3，不单独实现；
2. `DEV-008A1`：`BLOCKED`，等待本 SPEC exact-head PASS/merge；
3. `DEV-008A2`：`BLOCKED`，等待本 SPEC 与 A1 PASS/merge；
4. `DEV-008A3`：`BLOCKED`，等待本 SPEC 与 A1 PASS/merge；
5. `DEV-008D`：`BLOCKED`，正式删除独立安全任务；不由本 SPEC 解锁。

本 SPEC PASS/merge 后只解锁 A1；A1 PASS/merge 后 A2/A3 才可由独立任务并行。

## UI 一致性门禁

- 复用 `apps/web/src/styles.css` 现有 OKLCH tokens、排版、context-label、primary/secondary/danger、focus-visible、44px 和 reduced-motion；
- 只有一套共享 shell、list row、status badge、empty/loading/error/restricted 语义与词汇；
- 不创建第二套 token、按钮、卡片、导航或状态颜色；
- 1440×900、390×844、320×568 验证无横向/页面级意外溢出、44×44、键盘焦点、live region 和 reduced motion；
- 新建和回顾使用同一首页、导航与状态语言。

## 交付与验证

- 同步 `00/01/03/04/05/06/08/09/10`、任务板、追踪、冲突、ADR、交接和 journal；
- 正式 machine contract：`docs/contracts/local-audio-archive-v1.schema.json`；
- `pnpm format:check`、`git diff --check`、JSON Schema parse/structure、Markdown 内链/ID/状态/术语/docs-only diff 检查；
- 仓库完整 CI 对 exact final head SUCCESS；
- 非 Draft PR，最终停在 `REVIEW`，仅请求项目负责人手动审查。

## iteration-coach

本任务恰好一次独立只读复核采用 Learning mode，结论 `NO-PAUSE`。已吸收：现有正式授权语义足够冻结 A2；新增 assignment-safe session read model；A1 后 A2/A3 并行；删除共用 capture lock；单事务覆盖 legacy/all reports 并写最小回执；容量与清站投影分层。

## 当前审查候选

REV-041 已对 PR #31 old exact head `19604291e751f1403272183d314d367c0de593b0` / CI `31571463898` 给出 `REQUEST_CHANGES`，P0=0、P1=3。旧结论永久保留；当前只形成三项定向修复候选，尚未获得项目负责人定向复审。push、PR 与 CI 成功均不构成 PASS；任务保持 `REVIEW`，A1/A2/A3/008D 保持 `BLOCKED`。
