# DEV-005R2C｜浏览器采集与归档核心 REVIEW 交接

## 候选范围

- 分支：`codex/dev-005r2c-browser-capture`
- 基线：`origin/codex/dev-005r-contract-baseline@07de3deda85dae1d1691786480b65f09bdb88879`
- 状态：`REVIEW`；未修改共享 DTO、API、Prisma、正式 interview 路由/工作台/准备页、全局样式或中央治理文档。

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
