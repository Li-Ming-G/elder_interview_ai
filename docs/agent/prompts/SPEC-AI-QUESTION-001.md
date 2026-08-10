# SPEC-AI-QUESTION-001 新任务提示词

你负责 `SPEC-AI-QUESTION-001｜单问题自动更新、手动下一问与展示历史契约`。这是高风险跨模块契约任务，不是业务实现任务。

## 开始前必须完整读取

1. `AGENTS.md`、根目录 `00` 至 `10`；
2. `docs/agent/README.md`、任务板、追踪、冲突、ADR、审查和最新交接；
3. `docs/agent/tasks/SPEC-AI-QUESTION-001.md`；
4. ADR-020/024/026/027/028、CON-018；
5. SPEC-DEV-006 最终任务卡、交接和 REV-031；
6. `.codex/iteration-learning.md` 中 DISC-006、SPEC-DEV-006 和本次单问题修订。

本任务属于 material iteration，必须先完整执行 `iteration-coach`，并按其规则恰好进行一次独立只读复核。该复核不能代替项目负责人最终 GitHub 审查。

## 已冻结产品决定，不得重开

- 同时只显示一个 canonical current question 及一句原因，或继续倾听；
- 更合适且仍具 future eligibility 的问题可以自动替换当前问题；
- 每个真正展示过的问题形成不可变、稳定排序的会话展示历史；
- “上一个问题”只读浏览历史，“回到当前问题”返回最新 current；
- “换一个”已改名为“下一个问题”，每次点击只发起一次新的 AI 请求；
- 一层撤销不再实现；历史浏览不恢复旧问题为 current；
- “曾展示”不等于“实际问过”；actual-question 仍由可信倾听员 final 的会后分析证明；
- 硬边界命中后，当前与历史都不得重新投影已撤下正文。

## 必须交付

1. 同步 `04/05/07/08/09/10`，冻结自动替换 eligibility、稳定排序与防抖/滞回或等价机制；
2. 冻结自动替换、手动“下一个问题”、展示历史和 current projection 的状态/事件/DTO；
3. 冻结“下一个问题”的稳定 request ID、幂等重放、单飞、并发和响应未知恢复；
4. 冻结历史 cursor/分页/刷新恢复/回到当前，明确导航零 AI 调用和零业务副作用；
5. 冻结相似度、当前问题、recent displayed、可靠 actual-question、memory 与人工边界的排除顺序；
6. 冻结 AI unavailable、无合格问题、节流、超时、解析失败和不泄密错误；
7. 冻结 REST/WS 选择、鉴权授权、动态安全投影、event replay 和硬撤下；
8. 补齐桌面、390×844、320×568 的可访问性与交互验收矩阵；
9. 更新 ADR/CON-018/追踪/任务卡/交接/journal，形成 DEV-007 无需猜测的任务边界。

## 禁止事项

- 不实现业务代码、Prisma migration、页面或真实模型；
- 不恢复 adopted/asked/ignored/saved-for-later/改写操作；
- 不新建第二套 question history；
- 不重定义 SPEC-DEV-006 已冻结的 current memory、actual-question、derived-output 或 retention；
- 不把历史浏览做成撤销，不恢复旧排除，不把曾展示冒充实际问过；
- 不选择真实供应商，不宣称 deletion runtime 已实现。

## Git 与交付

- 从最新 `main` 创建 `codex/spec-ai-question-001`；
- 只提交与本契约直接相关的文档和治理变更；
- 执行适用的 format、link/reference、lint、typecheck、build 与现有完整 CI；
- 创建非 Draft PR，任务状态保持 `REVIEW`；
- 主动回传总控：base、exact final head、PR、exact-head CI、修改文件、逐项契约、验证、风险和未决项；
- 明确请求项目负责人在 GitHub 手动审查。不得自行宣布 PASS/DONE 或合并。
