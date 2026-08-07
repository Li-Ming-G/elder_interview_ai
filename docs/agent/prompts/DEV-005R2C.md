# DEV-005R2C 新任务启动提示词

你是拾光长者传记项目的 DEV-005R2C 前端音频核心实现 Agent。请在 Codex 独立 worktree 中完成“浏览器采集与归档核心”，不得切换或修改总控工作区。

## 先读

1. 依次完整读取 `AGENTS.md`、根目录 `00` 至 `10`、协作入口与任务板。
2. 读取 `SPEC-DEV-005R.md`、`DEV-005R2C.md`、DEV-003A/C、DEV-004B2、ADR-017/019/023、CON-020 和最新交接。
3. 检查现有 `apps/web/src/audio/**`、realtime transport、IndexedDB schema 和测试；保留已有 harness 兼容，避免无关重写。

## 必须完成

- 一个接受外部 MediaStream 的浏览器采集核心；同一流驱动 MediaRecorder 与 AudioWorklet，禁止第二次 getUserMedia；
- AudioWorklet mono/16k/s16le/100ms/3200 bytes；不使用 ScriptProcessor，不在主线程持续重采样；
- archive Blob 单写、delivery 引用与 ACK 只清 delivery；IndexedDB 前向升级保留历史分片、sequence、timeline、upload job；
- 顺序 delivery pump 和稳定 request ID 存储 seam；dirty checkpoint、archive/delivery 高水位、恢复模型；
- 20 未 ACK PCM 帧背压；实时失败不停止 MediaRecorder/archive；
- IndexedDB canary、storage estimate/configurable threshold、实际写失败、track ended/recorder error 回调；
- session browser lock，只承诺单浏览器单标签所有权；
- unit 与专用 Chromium 虚构数据测试，证明 ACK 后 archive 仍在、刷新后同 job/ID/高水位恢复。

## 严格禁止

不得修改 `packages/contracts/**`、`apps/api/**`、Prisma、`apps/web/src/app.tsx`、正式 preparation/workbench/routes、全局 `styles.css`、中央治理文档。不得自行发明公共 API DTO、服务端状态或正式页面文案；这些归 R1/R2/R3。

## 交付纪律

执行适用 format/lint/typecheck/unit/build/Chromium。完成后：

1. 任务保持 `REVIEW`，不得自宣 `PASS/DONE`；
2. commit、push `codex/` 分支并创建非 Draft PR；
3. 不要等待总控追问，必须主动使用 `send_message_to_thread` 向总控 thread `019fc195-5bd7-76a2-914b-65c65d37ce71` 发送 final head、PR、CI、修改文件、命令结果、风险和未完成项；
4. CI 失败必须继续修到终态，不能以“核心代码写完”结束。
