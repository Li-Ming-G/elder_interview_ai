# DEV-005C 新任务对话启动提示词

请在本项目中执行 `DEV-005C｜服务端会话安全结束编排`。这是一个新的实现任务对话，不是当前总控对话中的子 Agent。

## 工作方式

1. 使用独立 Git worktree 和分支 `codex/dev005c-session-finalization`，基线取启动时最新 `origin/main`；不得在总控的主工作区直接开发。
2. 修改前依次完整读取 `AGENTS.md`、根目录 `00` 至 `10`、`docs/agent/README.md`、任务板、`docs/agent/tasks/DEV-005C.md`、SPEC-SESSION-END-001、ADR-019/021/022、CON-019、REV-017 和 HO-032。
3. 本任务属于状态机、权限、核心数据模型与跨模块编排的重大迭代。按全局规则先执行 `iteration-coach`，只启动它要求的恰好一次独立只读预审；预审不能修改文件。
4. 开工后把 DEV-005C 从 `READY` 更新为 `IN_PROGRESS`。实现完成只能转 `REVIEW`，不得自行宣布 `PASS` 或 `DONE`。
5. 完成后推送分支并创建非 Draft PR，向总控报告最终 head、PR、CI、验证结果、风险和交接；最终 PASS 由项目负责人从 GitHub 给出。

## 目标

严格按已经通过 REV-017 的 SPEC-SESSION-END-001 实现会话 `stop/recover` 与持久 finalization，使结束状态、实际时长、原始音频收束和转录降级成为可查询的服务端事实。不要实现前端页面。

## 允许修改

- `packages/contracts` 中已经获批的会话结束请求、响应和公共 snapshot 类型；
- `apps/api/src/project-foundation/**` 中 stop/recover controller、validation、service 及直接测试；
- 仅为完成契约所需的 `apps/api/src/audio/**`、`apps/api/src/realtime-transcription/**` 最小编排 seam；
- 契约确需时，在 `apps/api/prisma` 增加一份前向 migration；现有结构足够时不得创建空 migration；
- PostgreSQL integration、auth/权限、并发与故障注入测试；
- 本任务直接相关的协作文档、任务交接和 iteration journal。

## 禁止修改

- `apps/web/**`、DEV-005B/D 页面、AI/长期记忆/问题建议；
- 真实麦克风、真实 ASR/LLM、云对象存储、持久队列、生产部署能力；
- 覆盖原始音频、原始转录或授权历史；
- 让客户端提交或推算 `completed`、`ended_at`、时长、manifest 或转录成功事实；
- 自行改变已冻结的状态、字段、错误码、权限、完成条件或引入新依赖。确有必要时停止并向总控登记冲突。

## 必须实现与验证的关键边界

- 每个 session 只有一个 `purpose=interview` audio object；stop 用稳定 request ID、expected chunk count 与逐片不可变 commitment 冻结证据边界。
- `session_finalization` 是 `stopping → processing → completed|failed`、manifest、ASR terminal、错误与 recover 的持久事实源；WebSocket 的短时 replay 不能替代它。
- raw audio complete 且 transcript 为 `drained|degraded|not_started` 才允许完成；AI 永远不是完成门禁。
- 首次 stop 与尚无 finalization 的 `finalize_interrupted` 必须在同一资源锁内重新验证当前 auth、actor、有效 assignment、资源归属、最新授权仍有效且项目未受限。
- 必须自动化以下 REV-017 回归：授权在首次 snapshot 前撤回、assignment 仍有效时，stop/`finalize_interrupted` 返回 403 `FORBIDDEN`，不创建 finalization、commitments 或补传例外，只保留服务端已可靠收到的数据并将/保持 session 为 `interrupted`。
- 只有撤权前已经持久化 snapshot，才允许原 actor 重新认证后补传 commitment 范围内的缺失分片；不得增加 object、sequence、count 或 metadata。
- stop/recover 的重放、不同 request 并发、非法状态、进程重启重驱、缺片、ASR 故障和普通/restricted 读取权限必须符合 `05` §3.5、`08` §4.5、`09` §10.1。

## 交付与验收

- 运行并如实记录 format、lint、typecheck、unit、migration deploy/status、PostgreSQL integration、auth、build、smoke 和适用 E2E；未执行或环境阻塞的项目必须明确说明。
- 更新任务板、需求追踪、冲突/ADR（仅有新事实时）、审查候选、交接记录和 `.codex/iteration-learning.md`。
- PR 交接必须列出修改文件、migration、实际命令与结果、未解决问题、风险、最终 Git commit 和 PR 地址。
- DEV-005D 保持 `BLOCKED`，直到项目负责人对 DEV-005C 最终 head 明确给出 PASS。
