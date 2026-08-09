# SPEC-DEV-004C 交接｜正式流说话人校准、修正与可信角色契约

## 当前状态

- 状态：`REVIEW`
- 分支：`codex/spec-dev-004c-speaker-calibration`
- 基线：`main@eda0b49e7291f6a7fe8a211a85766fb8da00ab6f`
- 输入讨论：`DISC-004C`，任务 `019fe4e1-8537-7a13-9831-8ef10df1e7df`，项目负责人已明确“定稿”
- 接收对象：项目负责人 GitHub 手动审查；通过后依次交给 DEV-004C1、DEV-004C2

## 完成内容

1. 将校准时点统一为原子 start 后的同一正式录音/ASR 链路，失败或跳过不阻塞原始录音。
2. 新增独立持久 `speaker_stream_id`，禁止用 capture generation、`audio_stream_id` 或 `event_stream_id` 代替 provider speaker namespace。
3. 分离角色值与 authority；只有用户确认校准或人工修正形成的 trusted effective role 可进入角色相关下游消费。
4. 由服务端 calibration attempt 权威标记校准控制内容，保留原始证据但排除故事记忆、已问问题、摘要和普通 AI 上下文。
5. 冻结单段默认与持久 preview/membership 的原子批量修正，保留原始角色、映射历史、操作者和影响范围。
6. DEV-004C 只产生 `speaker_role_revision` 与受影响 segment membership；DEV-006/007 负责各自派生结果失效、重算和失败状态。
7. 将实现拆为 DEV-004C1（正式流校准与可信角色门禁）和 DEV-004C2（修正与失效 seam）；复杂批量 UI 继续后置到完整回顾切片。

## 修改范围

- 产品、流程、数据、API/事件、音频/转录、AI、安全、测试和协作规范：`01`、`03` 至 `10` 中相关章节。
- 治理：ADR-025、CON-014、任务板、需求追踪、项目学习记录。
- 任务：`DISC-004C`、`SPEC-DEV-004C`、`DEV-004`、`DEV-004C1`、`DEV-004C2`。

## 明确未做

- 未修改业务代码、Prisma schema、数据库 migration、共享运行时 contracts 或测试代码。
- 未实现真实 ASR 供应商、声纹、跨会话身份、多说话人 diarization、AI 记忆或建议重算。
- 未关闭 CON-014，未将 DEV-004C1/C2 解锁，未宣布 DEV-004 或 DEV-006 完成。

## 验证与审查

- 文档格式、链接、冲突措辞和 Git diff 检查由总控在提交前执行并记录。
- 本契约涉及跨模块数据模型、API、角色可信度和 AI 消费边界，必须由项目负责人按 GitHub final head 明确给出 `PASS` 或 `REQUEST_CHANGES`。
- 只有项目负责人 PASS 后，才可将 SPEC 标记 DONE、ADR-025 设为 Accepted、CON-014 设为 RESOLVED，并将 DEV-004C1 解锁为 READY；DEV-004C2 继续等待 C1 PASS。

### REV-027 首轮结论

- 项目负责人审查严格绑定 PR #17 head `6983ee042c573bd833cc26f91f92751d19eb4b9c` 与 CI `31297150204`。
- 结论 `REQUEST_CHANGES`，P0=0、P1=3：final 到达态不能定义控制内容；下游没有可执行的 revision/stale consumer seam；WS 1.1 与 REST 缺统一 snapshot。
- 已采用定向路线：PCM 串行 marker 冻结不可变半开区间；新增独立 `SPEC-DEV-006` 硬门禁而不在 C 中偷设计跨 session AI 表；统一 `SpeakerCalibrationSnapshot`；补稳定总序闭区间。
- 修订完成前后均不改变本任务 `REVIEW`、CON-014 `OPEN`、C1/C2 `BLOCKED`。

## 后续顺序

1. 项目负责人审查 SPEC-DEV-004C。
2. 审查 PASS 后治理收口并下发 DEV-004C1。
3. C1 PASS 后先完成并审查 `SPEC-DEV-006`；只有两者均 PASS，DEV-006 才可推进。DEV-004C2 实现修正与 producer 失效 seam。
4. C2 通过后再判断父 DEV-004 是否满足当前内部 MVP 范围的完成条件。
