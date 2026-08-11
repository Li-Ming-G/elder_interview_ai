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
