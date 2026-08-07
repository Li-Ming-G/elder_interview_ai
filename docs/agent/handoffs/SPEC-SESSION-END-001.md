# HO-032｜SPEC-SESSION-END-001 正式契约审查候选

## 基本信息

- 任务：`SPEC-SESSION-END-001`、REQ-004、ADR-022、CON-019
- 分支：`codex/spec-session-end-001`
- 基线：`origin/main@b61db7d`
- 候选提交：`3cf41a8`
- PR：[#8](https://github.com/Li-Ming-G/elder_interview_ai/pull/8)（非 Draft）
- 状态：`REVIEW`；最终审查 head 与 CI 等待项目负责人审查时绑定
- 接收对象：项目负责人（GitHub 审查）、后续 DEV-005C/005D

## 已完成

- 完整读取正式依据、任务卡、CON-019、ADR-019/020/021、DEV-003C/004A/B1/B2 与 HO-030/031；
- 按 iteration-coach 启动恰好一次独立只读预审。预审采用 Correction mode，指出撤权补传、唯一录音对象、chunk commitment 和持久 ASR drain 事实缺口；
- 冻结 stop/recover 请求响应、稳定 request ID、合法状态、相同重放、不同 key 并发、响应丢失和终态重放；
- 冻结“两阶段结束”、唯一 interview audio object、逐片 commitment、`session_finalization`、受限 evidence-finalization 权限与统一公共 snapshot；
- 冻结 `stopping -> processing -> completed` 完成条件，ASR `degraded|not_started` 可合法完成，AI 永不作为完成门禁；
- 给出 DEV-005C/005D 可直接转成测试的状态、权限、错误和故障矩阵。

## 修改范围

- 正式契约：`03`、`04`、`05`、`06`、`08`、`09`；
- 治理：任务板、追踪、CON-019 进展、ADR-022、SPEC/DEV-005C/005D 任务卡、交接和 iteration journal；
- 未修改 `apps/**`、`packages/contracts/**`、Prisma、migration、controller、service、页面、测试或 CI；未触碰 DEV-005A 文件。

## 关键边界

- 当前是文档契约候选，不代表 stop/recover 已实现；
- CON-019 保持 `OPEN`，DEV-005C/005D 保持 `BLOCKED`；项目负责人绑定最终 head 明确 PASS 后才可更新；
- WebSocket 5 分钟/512 事件 replay 不等于 session recover；
- 内部 MVP 可用进程内 runner，未来 queue/outbox 只替换调度 seam；真实麦克风/ASR/LLM/云存储/生产部署均未引入；
- 受限补传只允许 stop 冻结范围内的原操作者重新认证，不是普通 assignment 绕过或匿名上传。

## 验证

- `pnpm format:check`：PASS；
- 修改 Markdown 本地链接检查：17 个文件，PASS；
- 安全结束矩阵关键场景检查：18/18，PASS；
- 允许路径检查：PASS，无 `apps/**`、`packages/contracts/**`、Prisma、测试或 CI 改动；
- 状态检查：SPEC `REVIEW`、DEV-005C/D `BLOCKED`、CON-019 `OPEN`，PASS；
- `git diff --check`：PASS；
- 未运行应用/数据库/Chromium，因为本任务禁止实现代码；GitHub CI 仍应运行仓库常规门禁，但不能代替项目负责人审查。

## 下一步

1. 推送分支并创建非 Draft PR；
2. 等待 CI 后由项目负责人锁定最终 GitHub head 审查；
3. PASS 后总控关闭 CON-019、把 SPEC 标记 DONE 并解锁 DEV-005C；
4. DEV-005C 按 `04`/`05` 实现 migration/contracts/service/tests，DEV-005D 只消费公共 snapshot。
