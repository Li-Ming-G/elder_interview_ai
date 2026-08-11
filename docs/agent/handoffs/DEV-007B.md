# DEV-007B v2 实现交接

## 身份与状态

- branch：`codex/dev-007b-v2-interview-director`
- PR：[PR #27](https://github.com/Li-Ming-G/elder_interview_ai/pull/27)（非 Draft）
- base：`main@a9cf1c5`
- implementation commit：`f9f4a22`
- 状态：`REVIEW`；不得在项目负责人 exact-head 审查前标记 PASS/DONE 或合并。
- old PR #25：继续 REQUEST_CHANGES，不得合并；本分支只选择性继承其契约中立的 API/历史/UI 骨架。

## 交付结果

1. 后端按正式 `InterviewDirectorContextV1` 冻结可信 elder/interviewer final、current memory、可靠 actual asked、current/recent displayed、journey 和 0..N safe bank references；模型不直连数据库。
2. local/test deterministic Director 可完全不使用题库自由生成；题库 seen input membership 与模型 declared attribution 独立持久，空 declared 合法。
3. 正式 Output Schema、引用子集、长度、相似度、权限/授权/boundary/deletion/retention 与 writeback 水位由后端硬校验；不实现第二 critic 或自然语言事实蕴含验证。
4. 第一次技术/Schema 硬失败只在同 attempt 内进行一次完全同 Context/Prompt/Schema/model-config retry；首错/首输出不进入第二次输入，迟到输出永久无写回资格。
5. QuestionEvidenceModule 继续唯一拥有 attempt/candidate/current/history/event；模型只追加建议事实，源转录/记忆/actual asked/题库只读，displayed 始终不等于 actual asked。
6. manual next 在 DB admission 时绑定 expected revision/snapshot、request ID、single-flight、节流与 manual intent fence；automatic 仅同 journey stage 比较 dwell/score，阶段切换不被旧分数阻断。
7. REST 是正文 canonical，WS 仅 revision 通知；前端支持“上一个问题/下一个问题”、cursor 翻页、snapshot anchor 跨刷新恢复，浏览历史不改变 current、不请求麦克风、不抢焦点。

## 验证

- format/lint/typecheck/build/diff：PASS。
- unit：43 files / 285 tests PASS。
- fresh PostgreSQL：13 migrations deploy；integration 13 files / 74 tests PASS。
- auth：4 files / 23 tests PASS。
- smoke：Web/API/PostgreSQL PASS。
- Chromium：普通 10/10（含独立 suggestion current/history/refresh/320/390 场景）；真实 Web/API auth Chromium 4/4。
- GitHub exact-head CI：等待最终治理提交推送后记录。

## 边界与审查重点

- 正式 14 列题库、真实 LLM/embedding、生产 boundary/deletion reader、生产部署均未交付；CON-023 继续 OPEN / NOT IMPLEMENTED / NOT VERIFIED。
- staging/production provider 继续 unavailable/fail-closed；本结论只能申请 internal-demo 工程链路 REVIEW。
- 请重点审查：同输入 retry/late-result fence、manual admission/replay、free generation 与 seen/declared 分离、commit 前动态资格、history cursor/anchor、移动端原因与 44px 触控。

## REV-038 REQUEST_CHANGES 定向修复

- 旧审查身份：head `542917229e1f68e60d434a74d6ef81b0cd7548f9`、CI `31458597516`，项目负责人结论 `REQUEST_CHANGES`（P0=0、P1=4、P2=1）；任务持续 `REVIEW`。
- 最近回答与 continue bypass：只以最近 interviewer 之后最多 3 条可信 elder 实质 final 形成 response/engagement signal；journey 要求继续倾听时 provider call=0、candidate=0，直接发布 canonical `continue_listening`。
- deadline/retry：attempt `created_at + 8s` 是 primary、一次同输入 retry、policy/deletion 重查和 publication 的共同绝对截止时间；每次 provider 前重新鉴权，writeback 在事务中 fail closed，迟到 Promise 无写回资格。
- automatic/comparator：20 秒 gate 前移到 provider 前并以 trailing latest segment 重排；后端 `question-select-v1` 使用固定四因子公式重评 current 与 candidate，可让最新 grounding 的同阶段问题跨过 0.12 delta，不使用第二 AI 或模型 score。
- Context 安全投影：`generationContext` 的 current/recent 均限定 active 且 unexpired，另要求 state visible+suggestion；不存在 unrestricted `findUnique` fallback。
- 新证据：unit 覆盖共享 deadline、retry 前 policy/deletion 重查、最近回答与 comparator；PostgreSQL 覆盖 continue bypass、expired current=null、同阶段 fresher grounding 自动替换与紧接 final 的 provider 前 gate。
- 全量本地回归：format/lint/typecheck/build/diff PASS；unit 45 files / 290 tests；fresh PostgreSQL 13 migrations deploy/status、integration 13 files / 76 tests、auth 4 files / 23 tests；smoke PASS；普通 Chromium 10/10、auth Chromium 4/4。首次在复用的已污染 test DB 上全量 integration/auth 因既有 AI scope FK 与题库版本残留失败，随后使用专用空库完整重跑通过，未改测试目标。
- 独立只读 iteration-coach 恰好一次，Correction mode；其关于 deterministic comparator、绝对 deadline、逐调用安全重查与 trailing automatic 的意见已吸收。
- 新 exact head/CI/PR 元数据将在最终推送和 GitHub verify 后回填；在项目负责人复审前不得合并或标 PASS/DONE。
- 定向实现提交：`67e17e1`；最终 exact head 由随后治理提交形成，并在 PR #27 body/comment 与总控回传中精确记录。
