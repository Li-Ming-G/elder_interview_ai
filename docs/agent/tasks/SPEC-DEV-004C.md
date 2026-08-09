# SPEC-DEV-004C｜说话人校准、修正与可信角色消费契约

## 基本信息

- 状态：`REVIEW`
- 负责人：总控 Agent
- 分支：`codex/spec-dev-004c-speaker-calibration`
- 输入依据：DISC-004C 已定稿决定包、`01/03/04/05/06/07/08/09/10`、ADR-025、CON-014、DEV-004A/B1/B2 与 DEV-005 已通过事实
- 前置依赖：DISC-004C DONE
- 交接对象：项目负责人 GitHub 审查、DEV-004C1、DEV-004C2、DEV-006/007

## 目标

在不改变原始录音优先级的前提下，冻结流级说话人身份、用户确认可信度、校准控制内容、失败/跳过/重试、单段与批量修正、派生失效 seam 和移动端状态，使 C1/C2 以及未来 DEV-006/007 获得唯一可执行答案。

## 已冻结的核心决定

1. 原子 start 先建立正式录音与正式 ASR；校准随后在同一正式 speaker stream 内立即进行，不是录音硬门禁。
2. `speaker_stream_id` 独立表示 provider speaker namespace。它不等于 capture generation、`audio_stream_id` 或 WebSocket `event_stream_id`。
3. role value 与 authority 分离；只有用户确认校准或人工修正形成 trusted role。未确认 provider 候选按 unknown 消费。
4. 服务端 calibration attempt 权威标记控制片段；客户端不能任意把故事内容标成校准句。
5. 失败/跳过时录音和转录继续；新 speaker stream 必须重新确认。
6. 默认单段修正；批量只限同一 stream/label/明确范围，先持久预览，排除既有单段人工修正，执行全成全败。
7. DEV-004C 只产生 correction revision 与受影响 membership。DEV-006/007 负责各自派生结果的实际失效、重算和失败态。
8. 原始角色、原始转录、授权、审计和人工边界不可覆盖或自动解除。
9. 校准控制内容由服务端 PCM 串行泵冻结不可变 sequence/session-timeline 半开区间；迟到 final 按区间重叠归类，不按到达时 attempt 状态归类。
10. GET、begin、resolve、session.ready 与 WS updated 共享唯一 `SpeakerCalibrationSnapshot`。
11. DEV-006 仍受独立 `SPEC-DEV-006` 硬门禁；C1 PASS 不再单独解锁 DEV-006 实现。

## 正式修改范围

- `01`、`03`：产品旅程、工作台校准、失败/恢复/修正行为；
- `04`：speaker stream、calibration attempt/membership、role authority、content kind、持久批量 preview、correction operation/revision；
- `05`：查询、校准、单段修正、批量预览/执行、幂等/权限/并发/错误和 WS 1.1；
- `06`：同正式流校准、namespace 隔离、控制句、修正和失效 seam；
- `07`：trusted role 消费、unknown/控制句排除和下游重算责任；
- `08`：校准、修正、preview/execute 与派生失效的审计范围；
- `09`：自动化、并发、AI 门禁、Android 小屏验收矩阵；
- `10`：C1/C2 与 DEV-006 的依赖和交接边界；
- `CON-014`、ADR-025、任务板、追踪和交接。

## 禁止范围

- 不修改代码、Prisma、共享 contracts、Web UI 或测试实现；
- 不接真实 ASR/LLM，不承诺分离准确率、阈值或声纹；
- 不实现多人 diarization、跨会话身份复用或复杂批量回顾 UI；
- 不实现 DEV-006/007 的 memory/suggestion 重算；
- 不关闭 DEV-004 或把 C1/C2 提前标记 READY/DONE。

## 验证方式

- `pnpm format:check`；
- `git diff --check`；
- 文档引用与冲突状态核对；
- 项目负责人对最终 GitHub head 手动审查。

## REV-027 首轮审查

- 绑定 PR #17 head：`6983ee042c573bd833cc26f91f92751d19eb4b9c`；CI `31297150204` PASS。
- 结论：`REQUEST_CHANGES`，P0=0、P1=3。
- 定向修订范围：不可变校准音频边界；独立 SPEC-DEV-006 consumer 门禁；统一 calibration snapshot/WS 1.1 payload；批量稳定排序闭区间。
- 当前仍为 `REVIEW`，CON-014 仍 OPEN，DEV-004C1/C2 仍 BLOCKED。

## 验收标准

- `01/03/04/05/06/07/09` 对校准时点、可信角色、流级作用域、控制句、修正与下游责任给出一致答案；
- 现有 session-only mapping 与 start 前校准旧语义被明确取代；
- C1/C2 任务边界可执行，DEV-006 解锁条件不反向依赖尚不存在的 AI 重算；
- 无 P0/P1 文档或契约冲突；
- 项目负责人绑定最终 PR head 明确 PASS。

## 当前结论边界

本任务只形成可审查契约候选。进入 `REVIEW` 不代表契约已通过，也不代表 DEV-004C 开发已经开始。
