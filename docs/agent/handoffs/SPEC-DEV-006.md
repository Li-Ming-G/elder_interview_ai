# SPEC-DEV-006 交接

## 基本信息

- 任务：SPEC-DEV-006｜后台当前记忆、问题证据与跨会话消费契约
- 状态：DONE
- 分支：`codex/spec-dev-006-memory-consumer-contract`
- 基线：`main@92e12fc089c46758e76c73018af6ac241de950d8`（CI 31319680465 attempt 2 SUCCESS）
- PR：[GitHub #20](https://github.com/Li-Ming-G/elder_interview_ai/pull/20)（非 Draft）；exact final head / CI 由 PR Checks 与源总控任务消息绑定，避免提交自引用
- 审查权：项目负责人已对 final head 手动定向复审 PASS；PR 已合并

## 最终接收

- 项目负责人对 exact final head `4759633ed1e3d9031c8bbe32892d61293f9ec01c`、CI `31326717132` 给出 `PASS`，P0=0、P1=0；
- 三项旧 P1 均关闭：逐业务输出 derived 关联、三类 retention root/child 生命周期、SPEC-AI 前置状态；
- PR #20 以 merge commit `6289c87009d4377ff190de74ad582e72597ba55a` 合入 main；
- DEV-006 与 SPEC-AI-QUESTION-001 可进入 READY；CON-018/023 继续 OPEN，deletion runtime 仍 NOT IMPLEMENTED / NOT VERIFIED。

## 正式 REQUEST_CHANGES 历史

- 项目负责人对 PR #20 old exact head `2b6a5da1e67ef2b0e91457969a089ba79f09f465`、CI `31321844664` SUCCESS 给出正式 `REQUEST_CHANGES`，P0=0、P1=3；该事实永久保留，不由后续候选覆盖；
- P1-1：补齐逐业务输出 `ai_derived_output` 一对一关联、范围化失效和 question dependency；五条 claim 明确为五条资格记录，actual-question analysis 整版为一条 catalog 资格记录；
- P1-2：改为 `ai_job|question_display_snapshot|memory_retention_root` 三类 retention root，children 继承 root deadline；冻结先隐藏后清理、跨 root detach、CASCADE/显式幂等顺序、失败续跑和最小审计；
- P1-3：`SPEC-AI-QUESTION-001` 恢复 `BLOCKED`，前置固定为 `SPEC-FE-001 DONE + SPEC-DEV-006 项目负责人 PASS/merge`；只有未来 PASS/merge 后治理收口才可单独切回 READY；
- 本轮仍为 docs-only 定向修复；新 exact head/CI 在 push 后追加到本交接并交项目负责人只复审三项。

## 已完成

- 完成任务卡 A-F 的正式数据、API/内部 seam、AI、安全、测试与研发边界契约；
- 以逐 session scope（含 0 eligible）和实际 segment/memory membership 共同证明跨会话输入；
- 分离 append-only memory claim/evidence、current resolution/member 和动态 future eligibility；
- 分离 displayed snapshot、future eligibility、display visibility；
- 指定 `QuestionEvidenceModule` 为 generation/display/actual-question 唯一 owner，DEV-006/007 不再各建 history；
- 冻结 freeze-call-recheck、幂等/显式重试、legacy 失败安全默认、过程记录保留/访问/删除与完整验收矩阵；
- 冻结逐业务输出一条 derived row、三类 dependency expected count/manifest、actual catalog 整版失效，以及三类 retention root 的完整生命周期；
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

- 本次定向修复本地通过：`pnpm format:check`、lint、typecheck、build、unit 225/225、PostgreSQL integration 57/57、auth 13/13、migration deploy/status、改用未占用 4175 的 Chromium E2E 9/9；`git diff --check`、Markdown 相对链接、ADR/CON/REV 引用、术语与 docs-only diff 检查通过；
- 本机 4173 被另一工作区 Vite preview 占用，未终止不属于本 worktree 的进程，因此固定端口的 smoke/auth E2E 不在本地重复宣称；由 PR #20 隔离 GitHub CI 对 final head 完整执行；
- 本次 REQUEST_CHANGES 定向修复按 iteration-coach 恰好一次独立只读复核：Correction mode；其逐业务输出 cardinality、actual catalog 整版失效、question dependency、retention root/child 继承、缺依赖失败关闭和治理状态建议已吸收。

## 未完成与风险

- 项目负责人定向复审与 PR 合并已经完成；旧 REQUEST_CHANGES 作为历史事实继续有效，但不再阻塞当前任务；
- SPEC-AI-QUESTION-001 与 DEV-006 已按独立治理收口进入 READY；各自仍须完成实现/契约任务和项目负责人审查；
- CON-018 OPEN：replace/undo、节流、相似度、最终 suggestion REST/WS 由 SPEC-AI-QUESTION-001 冻结；
- CON-023 OPEN：deletion producer/read model、C2 回接与并发测试尚未实现，coverage 为 `NOT IMPLEMENTED / NOT VERIFIED`；
- `text_revision` 与新表均是后续 DEV-006 migration 目标，当前 runtime 不具备这些能力；
- 真实模型、真实数据、固定保留天数和质量百分比门槛均未授权。

## 下一位必须先读取

`AGENTS.md`、根目录 `00-10`、本交接、SPEC-DEV-006/DEV-006/SPEC-AI-QUESTION-001 任务卡、ADR-025/026/027、CON-018/023/024、DEV-004C1/C2 最新审查与交接。
