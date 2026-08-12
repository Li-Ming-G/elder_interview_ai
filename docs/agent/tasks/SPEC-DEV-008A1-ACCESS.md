# SPEC-DEV-008A1-ACCESS｜restricted 首页投影与 evidence-finalization 读取边界修正

## 基本信息

- 状态：`REVIEW`
- 负责人：独立 docs-only 契约 Agent
- 分支：`codex/spec-dev-008a1-access-projection`
- PR：[非 Draft PR #33](https://github.com/Li-Ming-G/elder_interview_ai/pull/33)
- 基线：`origin/main@29bdce17c0b9b81c965078fd12600b340b564194`
- 前置：SPEC-DEV-008A DONE；DEV-008A1 开工前唯一 iteration-coach Correction 已完成；总控已正式裁决产品/安全方向
- 输入：`03/04/05/08/09/10` 相关条款、ADR-034、REV-041、SPEC-DEV-008A 与 DEV-008A1 任务/交接、DEV-008A1 实现窗口 `019ff4ed-ed98-7e00-a592-6c6036a53a62`
- 允许修改：正式规范、`packages/contracts` shared DTO、任务/追踪/冲突/ADR/审查/交接/journal
- 禁止修改：业务代码、Prisma、migration、页面、测试实现、部署、密钥和真实数据
- 审查权：项目负责人已授权总控对本目标承担 exact-head 手动审查；执行 Agent 只提交 `REVIEW`，不得自行 PASS/DONE/merge

## 目标

关闭 DEV-008A1 开工前发现的 restricted 首页机器契约缺口，使 A1 可在审查合并后按单一、最小泄露规则恢复实现；不新增产品流程或数据库事实。

## 正式方向

1. 仅当 actor 仍有有效 assignment，`restricted` 项目在 authenticated 首页显示一条中性受限投影；
2. `ProjectListRestrictedProjection` 只含 opaque `project_id`、固定 `projection/status` 和固定中性显示标签；无项目正文、创建来源、授权/服务、会话事实、统计或主动作；
3. `status=deleted`、`deleted_at!=null`、assignment 失效/不存在完全不可见；
4. session page cursor 签名绑定 `project_id + created_at + id` 及方向/page size/过滤版本，跨项目、篡改、过期和当前权限失效失败关闭；
5. 普通 project/service-term/consent/session reader 与 Home/prepare/workbench/review 必须继续要求有效 assignment 和 ordinary project visibility；`created_by` 不产生读取权；
6. 限制前已冻结 stop snapshot 的原操作者只能走专属 `EvidenceFinalizationResponse` 收束原始证据，不得借该 seam 取得普通 session snapshot 或页面访问。

## 机器契约

- `ProjectListProjection`：ordinary/restricted 判别联合；restricted 分支字段闭合；
- `ProjectSessionListResponse`：冻结 A1 已有 Markdown 最小字段与服务端 action projection；
- `EvidenceFinalizationResponse`：只含收束冻结 audio commitments 必要的 session/audio/finalization 状态；
- 不新增表、枚举持久事实、migration 或运行时实现。

## iteration-coach

不启动第二次复核。唯一 Correction 发生在 DEV-008A1 实现窗口：独立只读子 Agent `019ff55e-3879-77e3-b539-b924d3fc330d` 发现 `ProjectResponse` 必带姓名/出生年龄/地域/created_by，与“restricted 首页中性投影”冲突，并指出 session `created_by` 绕权和 restricted prepare 深链泄漏。实现窗口保持零改动暂停；总控随后正式选择最小受限占位路线。

## 验收

- 正式文档、shared DTO、任务状态、追踪、CON-028、ADR-035、REV-042、交接和 journal 一致；
- TypeScript 能机械区分 ordinary/restricted project list，restricted 分支不存在正文/主动作字段；
- 文档明确 cursor、普通读取和 evidence-finalization 的成功/失败边界；
- `git diff --check`、format/lint/typecheck、完整仓库 CI 通过；
- 非 Draft PR exact-head CI SUCCESS 后保持 `REVIEW`，主动回传总控审查包。

只有总控对 exact head 明确 PASS 且 PR 合并后，本任务才可由治理 closeout 转 `DONE`，CON-028 转 `RESOLVED`，ADR-035 转 `Accepted`，DEV-008A1 恢复 `READY`。
