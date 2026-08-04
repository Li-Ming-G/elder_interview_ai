# DEV-004A｜确定态转录证据核心与供应商中立适配器

## 基本信息

- 状态：`DONE`
- 负责人：后端转录实现 Agent（`dev004a_backend_impl`）
- 前置依赖：DEV-003、ADR-018、CON-015/016
- 分支：`codex/dev004a-transcript-core`
- 交接对象：父 DEV-004、DEV-004B、DEV-006、项目负责人（GitHub 审查）

## 目标

用虚构文本和确定性内部 fake adapter 建立 final-only、幂等、不可覆盖、可回链的转录存储核心，使后续记忆模块能使用稳定 segment ID，同时不提前实现实时传输和完整说话人交互。

## 输入依据

`00` 至 `10`、MVP-V01、ADR-002/006/013/018、HO-016、CON-014 至 CON-016。

## 前置依赖与假设

- session/project/assignment 与可靠 audio seam 复用现有实现；
- 供应商未选择，内部 adapter 输入必须供应商中立；
- fixture 仅由 local/test 组合根注入，不建立公开写入口；
- CON-014 只阻塞校准/start 门禁和 DEV-004C，不阻塞本任务以 `unknown` 安全回退。

## 允许修改

- `04` 至 `06` 中本任务相关正式契约；
- Prisma schema 与单一前向 migration 中的 transcript/speaker mapping 数据结构；
- `apps/api/src/transcription/**`、API module 注册和必要的内部共享类型；
- transcript 相关 unit、PostgreSQL integration、配置测试；
- 本任务的任务板、追溯、冲突、ADR、交接和迭代记录。

## 禁止修改

- 不实现业务 WebSocket、AudioWorklet、实时 UI、公开测试注入 REST、PATCH transcript 或 speaker-remap REST；
- 不实现校准 start 门禁、批量 remap、故障区间、离线补转录、AI/记忆、完整工作台；
- 不引入真实 ASR SDK、账号、密钥、计费或真实音频/转录；
- 不修改原始 audio object/chunk 内容或把 ASR 失败传播为录音失败；
- 不在日志、错误、普通响应或审计 metadata 中输出完整转录/provider payload。

## 交付物

- `transcript_segment` final-only 模型：稳定 ingest identity、不可变原文/原角色、独立修正字段、source 和受限 provider payload；
- 追加式 `speaker_mapping` 模型及会话内当前映射查询，未映射安全回退 `unknown`；
- 供应商中立 adapter result 类型和确定性 local/test fake；
- ingestion service：interim 不落库；final 幂等重放；冲突失败关闭；session 状态门禁；
- 后端内部按 session 顺序查询 final segment 的 service/repository seam，供 DEV-006 使用；
- migration、unit 与 PostgreSQL integration 证据。

## 验证方式

- format、lint、typecheck、build、unit；
- migration deploy/status 与重复 deploy；
- PostgreSQL integration 覆盖 final 首次写入/相同重放/冲突、interim 不落库、unknown 映射、原文与原角色不覆盖、assignment 查询隔离和 session 状态门禁；
- fake adapter 故障后 audio object/chunk/manifest 不变，会话不被错误标记为录音失败；
- 日志与公共错误不包含完整转录或 provider payload；
- GitHub CI 全门禁通过。

## 验收标准

- 同一 `(session_id, ingest_key)` 完全相同 final 只形成一条记录并返回稳定 ID；任一不可变字段不同稳定冲突；
- interim 调用后数据库没有 transcript row；
- original text、original speaker role 不可被任何重放或修正路径覆盖；
- 当前映射不存在时写 `unknown`，映射变化不回写既有片段原角色；
- provider payload 超过 64 KiB 被拒绝，且不出日志和普通查询；
- 非允许 session 状态拒绝 ingestion；查询按有效 assignment 隔离；
- 完成后提交 GitHub PR 并转 `REVIEW`；只有项目负责人按最终 head 明确 PASS 后才可 `DONE`。

## 审查收口

- 项目负责人于 2026-08-04 锁定 PR #3 最终 head `917f88827b80c88bba8515f0fe9aa0d92bb430c2` 并给出 `PASS`；GitHub CI `30887031030` 全门禁通过。
- PR #3 已合入 `main`，merge commit `2098d9f41de92e61baa3079d7037e00022745899`；详见 REV-012、HO-020。
- 非阻塞 P2：补同 ingest key 并发写 PostgreSQL 测试；补 provider payload 接近 64 KiB 的应用层/数据库双边界精确测试。
- 本任务通过不代表父 DEV-004、实时传输、校准/remap、真实供应商、故障区间、离线补录或真实试点通过。
