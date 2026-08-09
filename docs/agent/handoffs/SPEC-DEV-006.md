# SPEC-DEV-006 交接

## 基本信息

- 任务：SPEC-DEV-006｜后台当前记忆、问题证据与跨会话消费契约
- 状态：REVIEW
- 分支：`codex/spec-dev-006-memory-consumer-contract`
- 基线：`main@92e12fc089c46758e76c73018af6ac241de950d8`（CI 31319680465 attempt 2 SUCCESS）
- PR / exact final head / CI：候选推送后在本文件与源总控任务消息绑定
- 审查权：项目负责人 GitHub 手动审查；本任务不自行 PASS/DONE/merge

## 已完成

- 完成任务卡 A-F 的正式数据、API/内部 seam、AI、安全、测试与研发边界契约；
- 以逐 session scope（含 0 eligible）和实际 segment/memory membership 共同证明跨会话输入；
- 分离 append-only memory claim/evidence、current resolution/member 和动态 future eligibility；
- 分离 displayed snapshot、future eligibility、display visibility；
- 指定 `QuestionEvidenceModule` 为 generation/display/actual-question 唯一 owner，DEV-006/007 不再各建 history；
- 冻结 freeze-call-recheck、幂等/显式重试、legacy 失败安全默认、过程记录保留/访问/删除与完整验收矩阵；
- 明确 CON-018 仍等待 replace/undo/相似度专项，CON-023 仍为 runtime 缺口。

## 关键设计

- trusted elder conversation final 可直接形成后台 current memory；unknown/calibration 不进入；conflict 生成澄清，明确更正只切未来 current；
- correction 后旧派生结果由 version/operation anti-join 立即失去资格，不依赖异步 status 回写；普通已展示问题不自动撤下/重算；
- restriction、do-not-ask、活动 deletion scope、授权或 assignment 失效立即隐藏正文，GET/恢复/未来 WS replay 均失败关闭且不自动替代；
- actual question 本体与 suggestion outcome 分开；unjudged 不产生否定结论且不覆盖可靠 catalog；
- 外部模型调用不持 DB 锁；写回前重检全部 scope/membership/policy，漂移即丢弃结果；
- provenance FK 不得阻塞 deletion；完成后只留不可逆 scope 摘要和最小审计。

## 修改文件

正式规范：`02`、`04`、`05`、`07`、`08`、`09`、`10`。

协作文档：任务板、追踪、ADR-027、CON-018/023 进展、审查索引、SPEC/DEV/SPEC-AI 任务卡、handoff、iteration journal。

没有修改业务代码、Prisma schema、migration 或运行时 contracts。

## 验证

- format、diff、引用/术语一致性和仓库完整 CI 结果在最终候选更新；
- iteration-coach 恰好一次独立只读复核：Learning mode；其零 eligible scope、text revision、两阶段并发、动态 eligibility、单一 QuestionEvidenceModule、删除清理和 legacy 失败安全建议已吸收。

## 未完成与风险

- 等待项目负责人对非 Draft PR exact final head 手动审查；状态只能到 REVIEW；
- CON-018 OPEN：replace/undo、节流、相似度、最终 suggestion REST/WS 由 SPEC-AI-QUESTION-001 冻结；
- CON-023 OPEN：deletion producer/read model、C2 回接与并发测试尚未实现，coverage 为 `NOT IMPLEMENTED / NOT VERIFIED`；
- `text_revision` 与新表均是后续 DEV-006 migration 目标，当前 runtime 不具备这些能力；
- 真实模型、真实数据、固定保留天数和质量百分比门槛均未授权。

## 下一位必须先读取

`AGENTS.md`、根目录 `00-10`、本交接、SPEC-DEV-006/DEV-006/SPEC-AI-QUESTION-001 任务卡、ADR-025/026/027、CON-018/023/024、DEV-004C1/C2 最新审查与交接。
