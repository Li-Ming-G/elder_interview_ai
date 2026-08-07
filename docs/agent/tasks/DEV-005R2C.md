# DEV-005R2C｜浏览器采集与归档核心（并行基础）

## 基本信息

- 状态：`IN_PROGRESS`（独立任务 `019fdce6-9746-7e63-8776-03f4264bb1d9`）
- 负责人：新的前端音频核心实现任务
- 输入依据：`SPEC-DEV-005R`、`06`、`09`、ADR-023
- 前置依赖：SPEC-DEV-005R 候选基线已提交；只做不依赖共享 DTO 的浏览器核心
- 交接对象：DEV-005R2、总控 Agent

## 目标

在不触碰共享 API、正式路由和工作台的前提下，实现可复用的单流采集、archive/delivery 分离、AudioWorklet PCM、容量检查和 session browser lock 核心，为 R1 PASS 后的正式集成提供稳定模块。

## 允许修改

- `apps/web/src/audio/**` 中的新模块或向后兼容重构；
- `apps/web/src/realtime-transcription/**` 中纯 PCM producer seam；
- 新 AudioWorklet 文件、单元测试和专用 Chromium harness 测试；
- 本任务卡和任务专属 handoff。

## 禁止修改

- `packages/contracts/**`、`apps/api/**`、Prisma；
- `apps/web/src/app.tsx`、正式 interview routes/workbench/preparation、全局 `styles.css`；
- 任务板、追踪、冲突、ADR 等中央协作文档；
- 自行定义与 R1 冲突的公共 DTO 或服务端状态。

## 验收

- 同一注入 MediaStream 同时驱动 recorder 与 worklet，不自行获取第二条流；
- archive Blob 单写，delivery 只引用；ACK 不删除 archive；
- 顺序泵、稳定 request ID 存储 seam、dirty checkpoint、高水位与前向 IndexedDB 升级；
- mono/16k/s16le/100ms PCM 和 20 帧背压；
- canary/estimate/写失败与 browser lock；
- unit + 专用 Chromium 虚构数据测试通过；只提交 `REVIEW` 候选并主动通知总控。
