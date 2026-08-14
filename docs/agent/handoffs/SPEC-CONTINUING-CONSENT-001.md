# SPEC-CONTINUING-CONSENT-001 人工审查交接

## 状态与基线

- 状态：`REVIEW`；执行 Agent 未给出 PASS/DONE，未合并。
- 分支：`codex/spec-continuing-consent-001`。
- PR：[non-Draft PR #49](https://github.com/Li-Ming-G/elder_interview_ai/pull/49)；最终 exact head 与 CI 以 GitHub 当前提交为准。
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
7. ServiceTerm 保持 dormant；CON-012 为 `DECIDED` 待接收，ADR-039 为 Proposed，B1/B2 为 BLOCKED。

## Shared contract

- `ConsentContinuationProjection`：covered / reauthorization_required / unavailable、精确 reason、basis/required version 与 required action。
- `RepeatInterviewProjectActionProjection.primary_action` additive 支持 `record_formal_consent`；restricted 不暴露该动作。
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
- exact-head CI：等待 PR #49 最终候选 head 执行完整 workflow；本地结果不替代远端门禁。

## 项目负责人审查重点

1. 持续授权是否严格限定同 project、已审查 future-planned scope 和当前处理范围子集；
2. 轻提醒/start 是否在 DTO、API、审计和验收中始终不是 consent；
3. reauthorization reason、restricted 不泄露、版本/用途/访问/provider region/public-training drift 是否全部失败关闭；
4. `mvp-v1` 未知 scope 是否保持明确门禁，CON-012 是否只在正式接收后关闭；
5. B1/B2 是否在本 SPEC exact-head PASS/merge/治理收口前持续 BLOCKED；
6. 是否完全没有 runtime/Prisma/UI/ASR/LLM/deletion/ServiceTerm 范围扩张。

## 未完成与接收动作

- 项目负责人需绑定 PR exact head 与 CI 给出 PASS 或 REQUEST_CHANGES；push/CI 绿不等于审查通过。
- PASS 后仍需 merge 与独立治理收口，才能把 ADR-039 转 Accepted、CON-012 转 RESOLVED、SPEC 转 DONE，并重新评估 B1/B2 是否机械解锁。
- 真实授权正文、scope metadata、runtime、数据库约束、页面和完整 `09` §§17-18 实现验收仍未完成。
