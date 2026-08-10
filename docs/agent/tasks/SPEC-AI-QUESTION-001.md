# SPEC-AI-QUESTION-001｜单问题自动更新、手动下一问与展示历史契约

## 基本信息

- 状态：`DONE`
- 负责人：AI/后端契约 Agent（独立 worktree：`codex/spec-ai-question-001`）
- 前置依赖：`SPEC-FE-001 DONE`、`SPEC-DEV-006 DONE`、`DISC-AI-QUESTION-001 DONE`
- 输入依据：`01`、`03`、`04`、`05`、`07`、`08`、`09`、`10`、ADR-020/024/026/027/028、CON-018
- 交接对象：总控 Agent、DEV-007 实现任务、项目负责人 GitHub 审查
- 基线：`main@1d2b4daf207f21d25ab8df4d1f5d9b1f22ced299`
- PR：[GitHub #21](https://github.com/Li-Ming-G/elder_interview_ai/pull/21)（非 Draft）；exact final head/CI 由 PR Checks 与交接消息绑定，避免提交自引用

## 目标

在不恢复旧采用生命周期、不建立第二套 question history 的前提下，冻结以下可执行契约：一个 canonical current question 或继续倾听；更合适问题的自动替换；“下一个问题”的单次手动请求；“上一个问题 / 回到当前问题”的只读展示历史；安全投影、幂等、并发、节流和相似度。

## 必须冻结

1. candidate 何时具备 future eligibility，以及服务端如何确定“更合适”；不得把具体模型分数直接当公共产品事实。
2. 自动替换的稳定排序、防抖/滞回或等价防抖动规则；同一证据重放不得重复展示或造成来回闪换。
3. 每次自动替换如何原子写入 generation attempt、display snapshot/state/event，并更新唯一 canonical current。
4. “下一个问题”如何绑定 session、actor、当前 snapshot、稳定 request ID；网络未知重试复用同 ID，并发点击只产生一次业务 attempt。
5. 当前或高度相似问题、可靠 actual-question catalog、有效边界和当前 memory 如何参与排除；AI unavailable 时不回退基础题、不无限自动重试。
6. 展示历史如何使用稳定 cursor/排序读取；刷新恢复后能继续浏览；不得另建一套 history 表。
7. 历史导航只改变客户端/投影视图位置，不触发模型、不更新 current、不恢复排除、不改变 eligibility、不产生 actual-question 或 suggestion outcome。
8. 当前视图与历史视图的 DTO/安全 projection；普通修正可保留已展示事实，硬边界命中时当前和历史正文都必须动态撤下。
9. REST/WS 的最终路径、DTO、事件、replay、版本、错误分类、鉴权、授权、restricted/deletion 门禁与不泄密行为。
10. 页面文案和交互：当前视图“上一个问题 / 下一个问题”；历史视图“更早的问题 / 更新的问题 / 回到当前问题”；无历史时的 disabled/隐藏规则。
11. 移动端触控不小于 44×44px，键盘、焦点、live region、reduced motion；自动替换时不得抢走用户正在操作的焦点。
12. 与 QuestionEvidenceModule、DEV-006 actual-question reader、DEV-007 的唯一所有权和交接边界。

## 允许修改

- `01/03/04/05/07/08/09/10` 中与本契约直接相关的章节；
- ADR、冲突、追踪、任务卡、交接和 `.codex/iteration-learning.md`；
- 仅做契约与测试设计，不实现业务代码、Prisma migration、页面或真实模型调用。

## 禁止事项

- 不恢复 adopted/asked/ignored/saved_for_later/改写按钮；
- 不把历史浏览解释为撤销，不让旧问题重新成为 canonical current；
- 不把“曾展示”冒充“实际问过”；
- 不重定义 current memory、actual-question catalog、derived-output cardinality、retention roots 或另建 question history；
- 不选择真实模型供应商，不实现 DEV-006/007，不伪报 deletion runtime 已覆盖。

## 验证与验收

契约测试矩阵至少覆盖：

- 更合适问题自动替换、相同证据重放、临界分数防抖和连续候选竞态；
- 自动替换与手动“下一个问题”并发；请求/响应丢失和稳定 request ID 重试；
- 展示历史稳定排序、cursor 分页、刷新恢复、回到当前、无历史边界；
- 历史导航零 AI 调用、零 current/eligibility/排除/actual-question 副作用；
- “曾展示”与 actual-question 分离；
- 普通修正保留历史事实、硬边界在当前/历史/replay 一致撤下正文；
- AI unavailable、无合格新问题、节流、相似问题和跨会话实际已问排除；
- 390×844、320×568 的 44px、焦点、live region、无溢出与 reduced motion。

属于跨模块 AI/数据/API/安全契约，必须提交非 Draft PR，并由项目负责人绑定 exact final head 明确 PASS 后才能 `DONE`；CON-018 在此之前保持 OPEN，DEV-007 保持 BLOCKED。

## REVIEW 候选摘要

- `QuestionEvidenceModule` 继续单一拥有 generation/display/actual-question 证据；DEV-007 只通过正式 seam 编排，不新增表或复制 history repository；
- canonical current 以 `presentation_revision` 做 CAS，展示历史以严格递增 `display_sequence` 排序，manual next 以 `manual_intent_sequence` 阻止旧 automatic 写回；
- 自动替换采用版本化内部 comparator：默认最小分差 0.12、current dwell 15 秒、debounce 1500 ms；`question-sim-v1` 默认阈值 0.88，具体供应商未选择；
- manual next 绑定 actor/session/expected current/stable request ID，同 session 单飞，默认 3 秒最短间隔与 60 秒最多 6 次；请求接受不等于换题成功，只有 `manual_next_committed` 可证明 `explicitly_replaced`；
- history 使用 `(display_sequence,snapshot_id)` 签名 cursor 与稳定 anchor；浏览位置仅在客户端，GET 零 AI/job/event/current/eligibility/actual-question 副作用；
- REST current/history/next/request-status 是正文权威面；WS 1.2 只发送无正文 revision notification。current/history/anchor/replay 均动态重检 auth、consent、boundary、deletion、retention 与 policy；
- 旧 `suggestion_action`、`attempt_kind=replace`、采用/已问/忽略/稍后/改写与一层撤销均明确废弃；曾展示仍不等于实际问过。

## 最终审查与合并

- 项目负责人严格绑定 final head `af088ed6165c979e8de2e469900ee6519fafe183` 手动审查 `PASS`，P0=0、P1=0；
- CI `31352681061` attempt 2 完整 verify SUCCESS；attempt 1 的既有 1 秒时序波动保留为非阻塞 flake 记录；
- PR #21 以 merge commit `10fcc5c6580fa8285f54866f6252e5806b0f932a` 合入 main；
- ADR-029 转 Accepted，CON-018 RESOLVED；DEV-007 的本契约前置完成，但仍等待 DEV-006 PASS。

## 审查边界

- 本次只修改正式规范与治理文档；未实现业务代码、Prisma schema/migration、页面或真实模型；
- iteration-coach 已恰好执行一次独立只读 Learning mode 复核，已吸收 publication order、manual intent fence、cursor 总序、无正文 replay 和浏览不抢焦点建议；
- 本次 PASS 只代表契约完成，不代表 DEV-006/007 已实现，不代表真实 LLM/embedding、生产阈值、CON-023 deletion runtime 或真实试点通过。
