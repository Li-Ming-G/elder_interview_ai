# SPEC-AI-QUESTION-001｜单问题建议与替换契约

## 基本信息

- 状态：`READY`
- 负责人：待分配的 AI/后端契约 Agent
- 前置依赖：SPEC-FE-001 产品行为已批准；SPEC-DEV-006 项目负责人 PASS
- 交接对象：总控 Agent、DEV-007A 实现任务对话

## 目标

在不恢复旧采用生命周期的前提下，冻结“一个当前最佳问题或继续倾听”、“没用，换一个”与“一层撤销上次更换”的最小数据、API、幂等、节流和相似问题排除契约。

## 输入依据

`01` §5-6/§8-10、`03` §9/§17.3、`04` §4.11-4.12/§§4.36-4.42、`05` §3.9/§5.10、`07` §5-9、`08` AI 边界、`09` §7.5/场景 A、ADR-011/020/027、CON-017/018。

## 必须回答

1. 建议证据如何持久化并回链 final segment；
2. 替换请求如何绑定 session、suggestion、actor 和稳定 request ID；
3. 同一请求重放、并发替换和过期建议如何返回；
4. 当前问题、已替换问题和真实转录中倾听员问题如何参与去重；
5. “高度相似”的确定性验证 seam 与生产替换点；
6. 建议不可用、边界过滤失败和模型失败如何返回“继续倾听”或明确降级；
7. 是否保留 `suggestion_action`，若不保留应如何修订正式模型。
8. 撤销如何只绑定最近一次成功更换，稳定重放并恢复上一条问题、原因与该次排除集合；
9. 后续谈话触发自动建议更新或 session 状态变化时，撤销如何确定性失效；并发 replace/undo 如何避免恢复过期建议。

## 已冻结 seam，不得重定义

- `QuestionEvidenceModule` 单一拥有 generation attempt、candidate、display snapshot/state/event、actual-question analysis/catalog 和 suggestion outcome；
- DEV-006 提供该共享基座、current-memory reader 和 current published actual-asked reader；本 SPEC/DEV-007 只能经 service seam 写 generation/display/replace，不能创建第二套 question history；
- displayed snapshot、future eligibility、display visibility 三分；普通修正不自动撤下，硬边界动态隐藏正文且不自动生成替代问题；
- outcome 分类不等于 actual-question 状态，只有 actual question 进入跨会话防重复；unjudged 不覆盖可靠目录；
- 本任务只继续冻结问题 Schema、触发、replace/undo、节流、相似度、最终 REST/WS 投影与错误映射。

## 允许修改

- `04`、`05`、`07`、`08`、`09` 中问题建议直接相关契约；
- ADR、冲突、追踪、任务卡和交接；
- 只做契约与测试设计，不实现业务代码。

## 禁止修改

- 不恢复采用、已问、忽略、稍后、改写操作；
- 不实现 LLM、页面、数据库 migration 或公开服务；
- 不改变授权、权限、原始证据或删除边界；
- 不选择真实模型供应商。

## 验证与验收

- 所有受影响正式文档对单问题、替换、幂等和边界语义一致；
- DEV-007A 可据此形成不需自行猜测的数据/API/测试任务卡；
- 至少覆盖相同替换/撤销重放、并发 replace/undo、只撤销最近一次、自动更新后撤销失效、排除集合恢复、跨会话 suggestion、相似问题、真实已问问题、边界失败和 AI 失败场景；
- 属于跨模块契约，项目负责人或独立审查明确 PASS 后才能 `DONE`。
