# SPEC-DEV-006｜后台当前记忆、问题证据与跨会话消费契约

## 基本信息

- 状态：`DONE`
- 负责人：独立契约任务 `019fe70b-103e-7ff2-b916-9a9bcb0ea1c0`
- 分支：`codex/spec-dev-006-memory-consumer-contract`
- 前置依赖：DEV-004C1/C2 DONE、DISC-006 DONE、ADR-026 Accepted、CON-024 RESOLVED
- 输入依据：`01`、`03`、`04`、`05`、`07`、`08`、`09`、`10`、SPEC-DEV-004C、DEV-004C1/C2、DISC-006 决定包、CON-018/023
- 允许修改：上述正式规范、ADR/冲突/任务/追踪/审查与交接文档；必要时可只读检查 Prisma、API、Web 和测试现状
- 禁止修改：业务代码、Prisma schema、migration、共享运行时 contracts、真实模型配置、生产设施
- 交接对象：DEV-006、SPEC-AI-QUESTION-001、DEV-007、会后实际问题整理实现任务、项目负责人 GitHub 审查

## 目标

把 DISC-006 的用户行为转为一套可执行、可迁移、可幂等、可删除、可审计的正式 consumer 契约，使后续 Agent 无需自行发明：

1. 后台 current memory 与跨会话 current view；
2. AI job 的逐 session role revision 水位和实际输入 segment provenance；
3. 记忆冲突、明确更正、unknown/范围值和未来资格；
4. 已展示问题快照与 future eligibility 的分离；
5. 会后实际问题整理和跨会话防重复；
6. AI 失败、显式重试和过程记录；
7. `restricted|do_not_ask|deletion|权限失效` 的即时撤下与 scope 传播；
8. DEV-006、DEV-007 及会后问题整理的唯一所有权边界。

## 必须冻结

### A. Job、输入和版本

- 一个 job 聚合多个 session 时，各 session 的 `speaker_role_revision` watermark；
- job 与实际输入 final segment 的持久 membership；trusted elder/interviewer 分流，unknown、校准控制内容、无权限、restricted 和 deletion scope 命中片段不得进入；
- 模型、提示词、Schema、上下文构建版本、触发原因、输入哈希、供应商请求 ID、延迟、成功/失败/未判断；
- 响应丢失、重复启动、并发修正/删除/生成的幂等和锁/事务顺序。

### B. Current memory

- 第一版最小类型：人物与关系、地点、事件、时间/时间范围、重要选择与原因线索、未讲完故事，以及后台 unknown/冲突；
- AI 自动记忆无需普通 UI 人工确认即可成为 current memory，但必须保存 evidence、generation job、版本、来源与状态；
- 冲突保留多份证据并使建议优先澄清；明确更正产生新的 current value，旧值只保留历史且失去 future eligibility；不确定时保存范围或 unknown；
- 项目级跨 session current view、查询过滤、并发 upsert/冲突合并和删除 scope 传播；
- 人工确认事实和边界只能进入 review-required 或等价状态，AI 不得自动覆盖或解除。

### C. 派生失效与显示快照

- memory、suggestion、actual-question、session note 等输出与 job/segment 的 provenance；
- 每个独立业务输出一条 `ai_derived_output`：五条 claim 即五条资格记录；actual-question analysis 整版只用一条 catalog 资格记录；冻结跨表一对一约束、最小失效范围和 segment/memory/question expected count/manifest，禁止缺依赖后空集误判有效；
- `current|invalidated|waiting_recompute|recompute_failed|review_required|superseded` 或等价状态和合法转换；
- correction operation membership 命中后的原子 future eligibility 失效、普通 current view/未来生成/跨会话立即排除，以及失败不恢复旧资格；
- 已展示 suggestion 作为不可变快照保存其问题、原因、证据、当时 memory/role/boundary/version 与显示时间；普通修正不自动撤下、不自动重算；
- `restricted`、`do_not_ask`、活动 deletion scope、授权/访问失效时，普通查询、WS replay、刷新 snapshot 即时停止返回正文，只返回中性状态且不自动生成替代问题；
- 受限审计只保存必要 ID/版本/时间/撤下原因，技术日志不复制正文。

### D. 会后实际问题整理

- 从可信 interviewer final 提取所有真实问题，包括倾听员自发问题；
- 与系统 suggestion 展示和换题历史形成 `actual_asked|explicitly_replaced|not_observed|unjudged` 或等价分类；
- 只有 actual asked 进入下一次访谈防重复；其他分类不降低未来资格，除非未来专项决定明确；
- ASR degraded/not_started、角色不可信、证据不足或 job 失败时保持 unjudged，不更新此前可靠目录；
- 任务触发、显式重试、幂等、输入 membership、结果 provenance、语义匹配版本和成本记录；
- 明确由 DEV-006、DEV-007 或独立子任务中的一个模块拥有写模型，其他模块只消费正式 seam。

### E. AI 请求、失败与过程记录

- 当前建议、继续倾听、AI 暂不可用的最小状态；
- “下一个问题”一次点击只启动一次带稳定 request ID 的新 attempt；响应未知复用，权威结束后下一动作轮换；不做后台无限重试或基础题自动替代；
- 会后分析失败不更新可靠结果，允许未来显式重试；
- 可还原“原始片段 → 当时记忆 → 问题 → 实际问法 → 回答/更正 → 跨会话继承 → 版本调整”的过程记录；
- 过程记录访问、保留、删除、审计和技术日志最小化。
- retention 只以 `ai_job|question_display_snapshot|memory_retention_root` 为 root；冻结 child 继承、最早到期、先隐藏后清理、CASCADE/显式幂等顺序、跨 root detach、失败续跑与不可逆最小审计。

### F. API、状态机与迁移

- 正式表/字段/枚举/约束/索引、前向迁移和 legacy 数据安全默认值；
- current memory、job/输出、actual-question 与过程记录的服务端内部 seam 或 REST/WS DTO；
- 刷新、replay、分页、稳定排序和 canonical response；
- 删除、授权撤回、assignment 撤销与修正并发的失败关闭；
- 与 `SPEC-AI-QUESTION-001` 的字段/事件/所有权对接，避免两套 suggestion history。

## 明确不做

- 不实现 DEV-006/007 业务代码、UI、migration 或真实模型；
- 不建设记忆列表、冲突列表、人工确认页、完整回顾、向量库、知识图谱或自动传记；
- 不选择真实 LLM 供应商、语义阈值或提示词正文；
- 不用 `ai_job.session_id` 加一个单值 revision 冒充跨 session 水位；
- 不把 C2 revision/membership 写成 AI 重算已完成；
- 不降低 CON-023 的 deletion scope 最终门禁，也不造 no-op guard 或孤立删除半模型；
- 不把首轮定性试用误写成真实试点质量通过。

## 交付物

1. `04/05/07/08/09/10` 的完整正式契约；必要时同步 `01/03` 但不得改变已批准产品行为；
2. 可执行的数据模型、状态机、API/内部 seam、幂等、并发、删除与迁移设计；
3. DEV-006、SPEC-AI-QUESTION-001/DEV-007 和会后实际问题整理的任务所有权/依赖拆分；
4. PostgreSQL、API、服务、并发、失败注入与两次访谈验收矩阵；
5. 更新任务板、追踪、ADR/冲突、审查索引、交接和 iteration journal；
6. 非 Draft GitHub PR，绑定 exact final head、完整 CI 和项目负责人手动审查包。

## 验证方式

- `pnpm format:check`；
- `git diff --check`；
- Markdown 内链与任务/ADR/CON/REV 引用存在性检查；
- 契约术语一致性检查：current memory、displayed snapshot、future eligibility、actual asked、unjudged、hard boundary；
- 审查 diff 不得包含业务代码、migration 或运行时 contract 实现；
- GitHub CI 对 exact final head 完整通过。

## 验收标准

- 后续实现 Agent 不需要自行决定产品状态、字段语义、跨 session 水位、失效/查询过滤、实际问题归属或硬撤下规则；
- 普通修正保留快照与硬安全边界即时撤下在数据、API、AI、安全、测试中一致；
- current memory、实际问题目录和过程记录均有 provenance、版本、权限与删除闭环；
- AI 失败不会影响录音/转录，也不会伪造基础题或后台重试成功；
- 项目负责人绑定 GitHub exact final head 明确 PASS 后，本任务才可 `DONE`，随后 DEV-006 才能进入 `READY`。

## 审查候选摘要

项目负责人已对 PR #20 旧 exact head `2b6a5da1e67ef2b0e91457969a089ba79f09f465`（CI `31321844664` SUCCESS）正式给出 `REQUEST_CHANGES`，P0=0、P1=3：derived-output 关联基数、retention root/child 生命周期、SPEC-AI 前置状态需要定向修复。该审查历史永久保留；本任务继续为 REVIEW，修复候选不构成 PASS/DONE。

- A：以 `ai_job_session_scope` 保存全部评估 session（含零 eligible），以 `ai_job_input_segment/memory` 保存实际 membership；冻结 text/role revision、authority、content kind 与 digest，采用 freeze-call-recheck 两阶段并发协议；
- B：用 append-only claim/evidence、versioned resolution/member 和权威 eligibility 分离历史、current 与未来资格；冲突不覆盖，明确更正只切未来 current；
- C：display snapshot、future eligibility、display visibility 三分；逐业务输出一对一 derived association，actual-question analysis 整版一条 catalog 资格；expected dependency count/manifest 防止缺行空集放行；普通修正保留正文但禁止未来消费，硬边界即时中性撤下；
- D：`QuestionEvidenceModule` 单一拥有 generation/display/actual-question 证据，DEV-006 发布可靠 actual-question catalog，DEV-007 只通过 seam 写展示/换题；
- E：失败显示不可用、一次动作一个 attempt、每 job 至多一次 Schema repair、显式重试保留链路；过程记录引用业务证据而不复制完整正文；三类 retention root 统一到期隐藏/清理/重试；
- F：冻结索引、legacy 失败安全默认、幂等、锁序、动态查询、删除传播与两次访谈验收矩阵。

项目负责人已对定向修复 final head `4759633ed1e3d9031c8bbe32892d61293f9ec01c`、CI `31326717132` 给出 `PASS`，P0/P1=0；PR #20 以 merge commit `6289c87009d4377ff190de74ad582e72597ba55a` 合入 main。旧 head REQUEST_CHANGES 历史继续保留；DEV-006 与 SPEC-AI-QUESTION-001 可在本次治理收口后进入 `READY`，CON-018/023 不因本结论关闭。

审查入口：[非 Draft PR #20](https://github.com/Li-Ming-G/elder_interview_ai/pull/20)。
