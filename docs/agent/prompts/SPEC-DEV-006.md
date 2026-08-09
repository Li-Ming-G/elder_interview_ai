# SPEC-DEV-006 新任务提示词

你负责 `SPEC-DEV-006｜后台当前记忆、问题证据与跨会话消费契约`。这是高风险数据/API/AI/隐私契约任务，只修改正式规范和协作文档，不实现业务代码、Prisma schema、migration 或运行时 contracts。

项目总控任务 ID：`019fc195-5bd7-76a2-914b-65c65d37ce71`。完成候选后必须主动使用 `send_message_to_thread` 把 exact head、PR、CI、修改文件、关键决定、未决风险和审查包交回总控；不得自行宣布 PASS/DONE 或合并。

## 开始前

1. 完整读取 `AGENTS.md`、根目录 `00` 至 `10`、`docs/agent/README.md`、任务板；
2. 完整读取 `docs/agent/tasks/SPEC-DEV-006.md`、`DISC-006.md`、`DEV-006.md`；
3. 读取 ADR-025/026、CON-018/023/024、DEV-004C1/C2 最新审查与交接、iteration journal 相关决定；
4. 只读检查现有 Prisma、memory/AI placeholder、question suggestion、transcript query、deletion 与测试现状；禁止先改实现；
5. 按 `iteration-coach` 执行恰好一次独立只读复核，先让它挑战跨 session provenance、快照/eligibility、删除与模块所有权设计。

## 不得改变的产品决定

- 第一版后台记忆只服务当前下一问和第二次开场，不显示记忆/冲突/置信度管理 UI；
- 可信 elder 自动记忆可直接作为 current memory；unknown 和校准内容不得进入；
- 冲突生成澄清问题，明确更正只改变未来 current value，原始证据保留；
- 普通修正后已展示问题可继续停留且不自动重算，但立即失去未来资格；
- `restricted|do_not_ask|活动 deletion scope|授权/访问失效` 立即隐藏正文，不自动生成替代问题；
- 会后从可信 interviewer final 整理全部实际问题，只有 actual asked 进入跨会话防重复；
- AI 失败显示不可用，不返回基础题、不无限后台重试；每次换题只启动一次新 attempt；
- 首个内部试用不设质量百分比门槛，但必须有完整过程记录与安全不变量。

## 任务要求

严格完成任务卡 A-F 与全部交付物。重点：

1. 不用单值 session revision 冒充跨 session 水位；
2. 不让 DEV-006 与 DEV-007 各建一套 question history；
3. 区分 displayed snapshot、future eligibility、current memory、actual asked 与 unjudged；
4. 冻结 correction/deletion/生成并发、幂等、查询过滤、迁移默认值和失败重试；
5. 明确过程记录的访问、保留、删除与日志最小化；
6. CON-023 仍是运行时缺口，不得用 no-op guard 假装 deletion scope 已实现；
7. 必须给出可直接下发的 DEV-006 任务范围和与 SPEC-AI-QUESTION-001/DEV-007 的 seam。

## 交付流程

- 使用独立 worktree/分支 `codex/spec-dev-006-memory-consumer-contract`；
- 更新正式规范、任务/追踪/ADR/冲突/交接/journal；
- 运行 format、diff、链接/引用一致性检查和仓库完整 CI；
- commit、push，创建非 Draft PR；
- 状态只到 `REVIEW`，绑定 exact final head 和 CI；
- 主动通知总控转交项目负责人 GitHub 手动审查。
