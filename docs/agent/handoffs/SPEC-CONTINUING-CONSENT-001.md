# SPEC-CONTINUING-CONSENT-001 最终交接

## 状态与基线

- 状态：`DONE`；项目负责人已给出 exact-head PASS，PR 已 merge，main CI 成功，治理收口完成。
- 分支：实现/契约 `codex/spec-continuing-consent-001`；治理收口 `codex/spec-continuing-consent-001-closeout`。
- PR：[PR #49](https://github.com/Li-Ming-G/elder_interview_ai/pull/49)；accepted exact head `1d241a4b8c40827a93eefe1c9825021b6859df74` / CI [31764584701](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31764584701) SUCCESS；项目负责人 [PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/49#issuecomment-5288833214)，P0/P1/P2=0。
- merge：`712b4ff46acbff5168453c79b2d02375a84fa017`；main CI [31764903272](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31764903272) SUCCESS。
- 基线：`origin/main@2f7bb9632293694a0e22ed7e64adefff5fc5a57d`；main CI [31758380540](https://github.com/Li-Ming-G/elder_interview_ai/actions/runs/31758380540) completed / SUCCESS。
- iteration-coach：总控已在产品决定前恰好完成一次独立只读 `Correction / NO-PAUSE`；本任务没有启动第二次，也没有写 legacy learning log。
- 范围：只改正式文档、additive shared TypeScript contract 与直接治理记录；无 runtime、Prisma/migration、页面、ASR/LLM、删除或部署改动。

## 候选冻结内容

1. 一位长者一个 project、多次 session；首次 mic 后录制版本匹配的完整 `recorded_verbal` 授权，真实文本必须明确覆盖同 project 当前及未来计划内访谈与随时暂停/停止/撤回。
2. 普通后续 session 在 current consent scope/version covered 时复用原 consent record；不重复授权音频、记录或完整页面。时间间隔和有效 assignment 内换倾听员不触发重授权；换设备只重做 mic/device。
3. 每次 formal start 前显示服务端版本化固定提醒，并由倾听员显式点击“开始访谈”。提醒/start 不是新 consent，零 consent row/audio 副作用。
4. next-session/start 动态重查 consent、assignment、restriction/deletion；start 额外核对 reminder version。刷新/未知响应/双击复用稳定 start ID/payload，旧 snapshot 不恢复权限。
5. revoked/expired、文本不兼容、purpose/access subjects/provider region/public-or-training 扩大、future interviews 未覆盖均要求完整重授权；新版本必须新录匹配音频，禁止跨版本复用。
6. 示例 `mvp-v1` 未被猜成覆盖未来访谈。正式正文与 `future_planned_interviews_covered` scope metadata 未审查接收前失败关闭。
7. ServiceTerm 保持 dormant；CON-012 已 RESOLVED，ADR-039 已 Accepted。B1 仅解除契约实现前置，真实 covered 仍受 policy SPEC 阻塞；B2 等待 B1 runtime。

## Shared contract

- `ConsentContinuationProjection`：discriminated union 机械绑定 covered / reauthorization_required / unavailable 与各自 reason、basis/required version、required action；missing 与 existing-record reauthorization 的 basis 可空性不同。
- `RepeatInterviewProjectActionProjection`：交叉 discriminated union 绑定 primary action/reason/session basis/continuation；外层 rollout seam 可缺失，但对象一旦出现就必须完整。非终态 session + reauthorization 只能 `session_in_progress/null action`。
- `RecordingStartReminderProjection` 与 `RECORDING_START_REMINDER_VERSION/TEXT`：服务端拥有固定文案和版本，`creates_consent_record=false`。
- `InterviewSessionResponse.recording_start_reminder?`、`StartSessionRequest.recording_reminder_version?` 为 contract-first optional seam；B1 runtime 完成时必须显式返回/要求，缺失失败关闭。

## 本地验证

- `pnpm format:check`：PASS。
- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS。
- contracts 定向 typecheck/build：PASS。
- `pnpm test:unit`：首次 55/56 files、338/339 tests，一条未改动的 workbench 401 online-verification 时序测试失败；定向重跑 39/39 PASS，随后全量重跑 56/56 files、339/339 tests PASS。未修改 runtime 或测试目标。
- `git diff --check`：PASS。
- changed Markdown 相对链接与受影响治理表列数：PASS。
- exact-head CI：`31764584701` 对 accepted head 全链路 SUCCESS；merge main CI `31764903272` SUCCESS。

## 项目负责人审查结论

项目负责人严格绑定 accepted exact head 与 CI 给出 PASS（P0/P1/P2=0），确认三项 P1 已关闭；old head 的 REQUEST_CHANGES 不被覆盖。接收只覆盖正式 docs/shared contracts 与治理，不接收 runtime、Prisma/UI、真实正文/provider 或真实试点。

## REV-049 定向修复包

- 固定优先级：不可披露 → access/project unavailable → session in progress → no completed → consent unavailable → reauthorization → eligible；GET 与 next-session 使用同一顺序。
- 组合反例：session+reauthorization、no-completed+reauthorization 均由 session 条件获胜；所有不可操作分支 session basis/next 为 null。
- 编译期测试：`packages/contracts/src/continuing-consent.contract-test.ts` 覆盖合法三分支、basis 可空性、action/continuation 交叉组合及上述冲突。
- 真实交付前置：新建 SPEC-CONSENT-TEXT-POLICY-001，等待有权主体与项目负责人/数据治理接收真实正文、版本/digest 和 machine scope。未接收前真实路径失败关闭；Agent 不代写/批准法律文本。

## 审查历史与治理转换

- old exact head `4095e570d17d8ecae94d630d62bca9ab0205917d` / CI `31762375878` 获 [REQUEST_CHANGES](https://github.com/Li-Ming-G/elder_interview_ai/pull/49#issuecomment-5288715503)（P0=0/P1=3/P2=0）；该历史永久保留。
- accepted head 的定向修复关闭三项 P1，随后 PASS、merge 与 main CI 完成；SPEC `REVIEW→DONE`、ADR-039 `Proposed→Accepted`、CON-012 `DECIDED→RESOLVED`。
- 历史转换：本 SPEC 收口时 DEV-008B1 `BLOCKED→READY` 只表示可开始 fail-closed runtime 实现；这不曾解除 SPEC-CONSENT-TEXT-POLICY-001 对真实 covered 的独立门禁。
- DEV-008B1 已在 fail-closed runtime 范围 PASS/merge/治理收口为 `DONE`；DEV-008B2 因此前置完成仅转为 implementation-ready 的 `READY`，当前未启动。真实 covered 仍由 SPEC-CONSENT-TEXT-POLICY-001 阻塞。

## 仍未完成

- SPEC-CONSENT-TEXT-POLICY-001、真实授权正文/scope metadata、B2 runtime 与完整 `09` §17 post-analysis 实现验收均未完成；B1 只在已接收的 fail-closed runtime 范围完成，不含真实 covered。
- 本次联合治理 closeout 不启动 B2，不处理正式授权正文，也不改变真实 provider、删除、retention、ServiceTerm 或真实试点门禁。
