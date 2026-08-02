# Project Iteration Journal

## Current Snapshot
- Product goal: 帮助倾听员可靠完成长者人生故事访谈，保存可追溯的原始资料，并由 AI 提供跨会话记忆和候选追问；MVP 不自动生成完整传记。
- Current stage: MVP 研发基线建立阶段；正式业务代码尚未开始。
- Architecture: 模块化单体；React + TypeScript + Vite 前端、NestJS + TypeScript 后端、PostgreSQL，录音、ASR、AI 三条链路解耦。
- Constraints: 原始录音、原始转录和原始授权记录不可覆盖；AI/ASR 故障不得影响原始录音；AI 结论必须回链确定态转录；不得提前实现 MVP 外功能。
- Open questions: 工程初始化前仍需确认技术栈中的“推荐”项是否构成已批准基线，以及 Git 仓库/分支基线由谁建立。

## Adopted Decisions

## Assumptions to Validate

## Iteration Log
