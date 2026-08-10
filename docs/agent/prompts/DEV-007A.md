# DEV-007A 新任务提示词

你负责 `DEV-007A｜题库基础设施、旅程阶段与确定性选择 seam`。开始前完整读取 `AGENTS.md` 指定的全部文件、`01/03/04/05/07/08/09/10`、SPEC-QUESTION-JOURNEY-001、DEV-006/SPEC-AI-QUESTION-001 最新交接、CON-023/025、ADR-027-030 和本任务卡。

只有项目负责人已对 SPEC-QUESTION-JOURNEY-001 非 Draft PR exact final head 明确 PASS 时才可开工；否则停止并保持 BLOCKED。

实现范围严格限于：

- 固定 14 列 UTF-8 CSV validator（含必填受控 purpose）、原子 draft import、不可变 bank version、activate/retire；
- `question_condition_v1` 的 applicable all-of、inapplicable any-of、排除优先及全部非法输入拒绝；fixture 必须走相同 validator；
- 来源/许可与 synthetic fixture 环境门禁；
- QuestionBank import/reader（eligible 投影含 purpose）、按 `journey_policy_v1` 固定优先级和受控 reason codes 的 QuestionJourney evaluator、deterministic selector/fake；
- `09` §7.7 属于 A 的 migration/unit/PostgreSQL/auth/管理入口/fixture 测试。

禁止调用 LLM、生成/发布 suggestion、修改工作台、另建 question history、题库管理 UI、自由生成或把 fixture 计作产品内容。任何需要改变正式字段/API/状态的发现先登记冲突并回到契约，不得边实现边解释。

完成后提交非 Draft PR，状态 REVIEW；不得自行 PASS/DONE/合并。
