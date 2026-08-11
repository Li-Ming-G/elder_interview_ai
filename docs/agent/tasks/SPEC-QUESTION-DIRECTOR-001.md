# SPEC-QUESTION-DIRECTOR-001｜自由生成下一问、模型 Context 与 Prompt 契约纠偏

## 基本信息

- 状态：`DONE`
- 负责人：总控 Agent
- 前置依赖：DEV-006 DONE、DEV-007A DONE、项目负责人已明确题库仅为参考并授权纠偏
- 输入依据：`01/03/04/05/07/08/09/10`、ADR-027-030、DEV-006/007A、PR #25 REQUEST_CHANGES
- 输出：正式规范、ADR-031、DEV-007/007B v2 门禁与提示词、治理和交接
- PR：[#26](https://github.com/Li-Ming-G/elder_interview_ai/pull/26)
- 最终审查：head `8938d525d66f138e7c7b7e3049fe56cbea6bcbb1`、CI `31454260127`、项目负责人 `PASS`、P0/P1=0、merge `d320f642a30ee8cc71090ad0d1662b4fc2d08ad6`

## 目标

把实时下一问从“题库白名单内选择/轻调”纠正为“确定性后端冻结可信 Context，一个实时 Director 参考但不受题库束缚地完成一次逻辑生成，服务端再做基础硬校验并追加展示历史”。

## 必须冻结

1. 题库是 0..N 可选参考，不是候选合法性来源；无题库引用可合法生成。
2. source facts 只读，suggestion facts append-only；QuestionEvidence/actual asked/current/history 所有权不变。
3. provider-neutral `InterviewDirectorContextV1` JSON Schema 是 AI 实际输入的唯一技术结构；Markdown 只解释语义、排序、裁剪和空集合行为。
4. `InterviewDirectorOutputV1` JSON Schema 是 AI 实际输出的唯一技术结构；Markdown 只解释建议、grounding 和可选 attribution 的职责。
5. 仓库内可编辑、不可变版本化 prompt bundle；数据库记录使用版本/digest，不建设在线管理 UI。
6. 一个实时 Director + 确定性后端编排；同一逻辑生成遇 transport/timeout 或第一次返回未过基础硬校验时最多一次完全同输入 retry，不引入 repair prompt、第二 planner/critic 或复杂自然语言事实验证器。
7. frozen Context seen membership、candidate declared attribution、事实 grounding 与发布资格四者分离；`declared_bank_references=[]` 合法。
8. 权限、授权、trusted role、restricted/do_not_ask/deletion、retention、重复、幂等、freeze-call-recheck 和 REST/WS/history 规则继续有效。

## 明确不做

- 不修改 Prisma、runtime contracts、业务代码、页面或测试实现；
- 不选择真实 LLM/embedding 供应商，不建设多 Agent、向量库或在线 prompt 管理面板；
- 不覆盖 ADR-030 历史，只由 ADR-031 部分取代；
- 不合并或继续修 PR #25；该 PR 保留 REQUEST_CHANGES 历史，后续以 DEV-007B v2 重新实现。

## 验收

- docs-only 一致性、链接、格式和仓库门禁通过；
- 创建非 Draft PR，状态保持 `REVIEW`；
- 只有项目负责人绑定 exact head 手动 GitHub 审查 PASS 并合并后，才能转 DONE、接受 ADR-031、关闭 CON-026 并解锁 DEV-007B v2。
