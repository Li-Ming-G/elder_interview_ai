# DEV-007B｜结构化访谈导演与工作台集成

## 基本信息

- 状态：`REVIEW`
- 负责人：Codex DEV-007B v2 Agent
- 前置依赖：SPEC-QUESTION-DIRECTOR-001 项目负责人 PASS/merge、DEV-007A PASS、DEV-006 DONE、SPEC-AI-QUESTION-001 DONE
- 输入依据：`03` §9/§11、`04` §§4.36-4.39、`05` §3.9、`07` §§5-10、`09` §7.6-§7.7、ADR-027-031
- 交接对象：父 DEV-007、项目负责人 GitHub 审查

## 目标与范围

- 由确定性后端读取 DEV-006 current memory、可靠 actual asked、可信转录/角色/边界、current/recent displayed，以及 A 的 safe bank references/stage，冻结 `InterviewDirectorContextV1`；
- 用一个实时 Director 返回一个问题或继续倾听；题库是 0..N 可选参考，允许广泛改写或完全不用；transport/timeout 或第一次返回未过基础硬校验时最多一次完全同输入 retry。服务端验证唯一 Output Schema、引用 ID/subset、重复和安全边界；单问题、grounding/risk 贴切性由 Prompt、评测和人工实践评价；
- 通过既有 QuestionEvidence writer 发布 candidate/current/history，接入既有 REST、无正文 WS 和工作台；
- 保留自动替换、manual next、历史锚点、displayed != actual asked、hard withdrawal 和失败降级。
- prompt 使用仓库内可编辑、不可变版本化 bundle；job 保存 prompt/context/output/context-builder/model-config 版本与 digest，不保存完整真实模型输入。

## 明确不做

- 不直写 QuestionEvidence 表或复制 repository/history；
- 不让模型直连数据库或决定读写范围，不以 basic 题做 AI unavailable 兜底，不引入第二 planner agent，不选择真实生产供应商；
- 不实现题库管理 UI、记忆 UI、向量库、自动传记或 deletion producer；
- 未导入负责人题库时仍可用虚构可信上下文验证自由生成工程链路，但不得宣称正式题库内容或问题质量已经可用。

## 验收

逐项通过 `09` §7.6 与 §7.7 中属于 B 的矩阵；必须证明无题库引用可合法生成、seen 与 declared 分离、声明引用和 grounding ID 都来自 frozen Context、源事实只读、同输入 retry、prompt/schema 版本可复盘，并通过现有响应式/无障碍/权限/失败门禁。项目负责人 exact-head PASS 前不得 DONE。

## 当前交付

- 分支：`codex/dev-007b-v2-interview-director`
- 非 Draft PR：[PR #27](https://github.com/Li-Ming-G/elder_interview_ai/pull/27)
- 实现提交：`f9f4a22`；最终 exact head 与 exact-head CI 以 PR 审查包为准。
- 状态严格保持 REVIEW；旧 PR #25 继续为 REQUEST_CHANGES，不得合并。

## REV-038 定向修复候选

- 旧正式审查严格绑定 PR #27 head `542917229e1f68e60d434a74d6ef81b0cd7548f9`、CI `31458597516`，结论 `REQUEST_CHANGES`（P0=0、P1=4、P2=1）；历史永久保留。
- journey 的 response/engagement 信号只读取最近一次 interviewer 之后最多 3 条可信 elder 实质 final；`shouldContinueListening=true` 直接发布 `continue_listening`，不调用 Director、不创建 candidate。
- manual attempt 从持久 `created_at` 起共享 8 秒绝对 deadline；primary/retry 每次调用前重查 policy/deletion，writeback 事务内再次检查截止时间，迟到结果不得发布。
- automatic 在 provider 调用前执行 20 秒 gate，并采用 trailing latest segment；`question-select-v1` 由后端按 grounding freshness、latest-answer coverage、stage-purpose fit、risk fit 确定性评分，同阶段问题可比较且不引入第二 AI。
- Director Context 只接收 visible suggestion 且 retention active/unexpired 的 current；expired/hidden/withdrawn 一律投影 `current_presentation=null`，不再用不受限 snapshot fallback。
- `09` 的旧 DEV-007B 动态状态残留已清理；本候选仍等待新 exact head/CI 和项目负责人定向复审，不构成 PASS/DONE。
