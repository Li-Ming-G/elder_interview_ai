# DEV-005R2C｜浏览器采集与归档核心最终交接

## 候选范围

- 分支：`codex/dev-005r2c-browser-capture`
- 最终 head：`ae0774763e36c13d3e4d99b666039adf15ef0c2e`
- 最终基线：`main@4784080343fa2175dccf997fd79815884ce58069`
- 状态：`DONE`；PR #12 以 merge commit `e455c13f34a61de699d6e6015c055bec6b83be28` 合入 `main`。未修改共享 DTO、API、Prisma、正式 interview 路由/工作台/准备页、全局样式或中央治理文档。

## 实现证据

- `BrowserCaptureCore` 接收调用方提供的唯一 `MediaStream`，同流连接 `MediaRecorder` 与 `AudioWorklet`；实时链路启动或背压失败不停止 archive。
- AudioWorklet 在音频渲染线程完成多声道下混、16k 线性重采样、s16le 编码，并固定输出 100ms/3200-byte 帧；未使用 `ScriptProcessor` 或主线程持续重采样。
- IndexedDB v4 分离 `archive-chunks` 与 `delivery-queue`。archive Blob 单写，delivery 仅保存引用状态；ACK 校验 checksum 后只清 delivery，archive、sequence、timeline 与高水位保留。
- v2/v3 前向升级保留历史 chunk/session progress/upload job；新增 dirty capture checkpoint、稳定 upload/chunk request ID、顺序单飞 delivery pump、canary、容量 estimate/可配置阈值与实际写失败映射。
- `SessionBrowserLock` 使用 Web Locks 原子独占，只承诺同一浏览器单标签所有权；track ended、recorder error、archive write/capacity failure均向上层报告。
- 专用 Chromium 虚构音频证明单流创建一次、PCM 帧精确 3200 bytes、dirty 刷新后相同 job/ID/archive/timeline/high-water 恢复，以及 ACK 后 delivery 清零但 archive 跨刷新仍存在。

## 本地门禁

- `pnpm.cmd format:check`：PASS。
- `pnpm.cmd lint`：PASS。
- `pnpm.cmd typecheck`：PASS。
- `pnpm.cmd test:unit`：PASS，28 files / 133 tests。
- `pnpm.cmd build`：PASS。
- `.\\node_modules\\.bin\\playwright.cmd test --project=chromium`：PASS，6/6；其中 DEV-005R2C 专用与既有 audio buffer 用例 3/3。
- `git diff --check`：PASS。

## 风险与未冻结项

- Android Chrome 是完整访谈主设备，但 R2C 仅交付浏览器核心；页面后台/恢复后的最终 `continue/interrupted` 行为必须由 DEV-005R2 真机证据决定，本候选未冻结该语义。
- 重采样采用连续线性插值，满足格式/帧长契约；长时运行的音质、功耗、厂商 MediaRecorder 分片行为仍需 Android 真机验收。
- Web Locks 不承诺跨浏览器或跨设备所有权；服务端租约/冲突状态不在本任务范围。
- archive 保留策略有意不随 ACK 回收；最终清理时点与容量产品策略由后续正式集成确定。

## 最终审查

- REV-022：项目负责人定向复审 `PASS`，P0=0、P1=0。
- 四项修复 4/4 关闭：archive-first 停止流程、checkpoint 失败恢复与首因、Web Locks request rejection、旧 generation 异步结果隔离。
- GitHub CI `31246011913` 完整 verify PASS；总控在最终 head 另行复跑关键 unit 3 files / 9 tests PASS，并确认换基前后 `apps/web` 与 `tests/e2e` 业务逻辑无差异。
- 下一接收对象：DEV-005R2；其状态已解锁为 `READY`。

## REQUEST_CHANGES 定向修复候选

- 原始 archive 终止顺序改为先等待 `MediaRecorder.stop()` 与最终 Blob 持久化，再启动不阻塞 archive 的 realtime teardown；即使 `pcmProducer.stop()` 或在途 `onFrame` 永不 settle，checkpoint、track cleanup 和 browser lock 释放仍完成。
- `PcmAudioWorkletProducer.stop()` 同步断开 source/node/port，不再等待 delivery chain；`AudioContext.close()` 最多等待 250ms。每次 start/stop 推进 generation，旧 generation 的延迟 resolve/reject 不得触发新代 backpressure/failure，也不能 disable 新代 producer。
- checkpoint 串行器把“本次写入结果”和“内部可继续尾链”分开；运行时写失败进入一次 `local_archive_failed`，失败 checkpoint 可重试，持续写失败也由 finally 保证 recorder final archive、track 和锁清理。cleanup 次生错误不覆盖最初 failure callback 根因。
- `SessionBrowserLock.acquire()` 在 `locks.request()` 于 callback 前拒绝时稳定 reject；内部 request promise 吸收该拒绝，后续 `release()` 不悬挂。
- 定向 unit：3 files / 9 tests，覆盖挂起 producer stop、挂起 onFrame/context close、旧 generation resolve/reject、checkpoint 瞬时/持续失败及 lock request reject。
- 完整本地门禁：format、lint、全仓 typecheck、unit 29 files / 141 tests、migration deploy/status、integration 30/30、auth 13/13、build、smoke、Chromium 6/6、auth Chromium 4/4 全部通过；音频 Chromium repeat-each=3 为 9/9。
- 独立只读子 Agent 因 Codex refresh token 被撤销而不可用；本轮按 iteration-coach 约定由主 Agent 回退审查。任务保持 `REVIEW`，等待 PR #12 新 head CI 与总控复核。
