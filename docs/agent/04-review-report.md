# 当前审查索引

本文件只保存当前仍影响推进的最新审查结论。历史审查正文保存在 [`reviews/04-review-report-history.md`](reviews/04-review-report-history.md)，原始 `REV-ID`、结论和证据保持不变。

## 当前结论

| 任务 | 最新审查 | 绑定提交 / PR | 结论 | 当前边界或未关闭意见 |
|---|---|---|---|---|
| DEV-001B | REV-007 | `ab9628b` | REVIEW | CON-008、增强 Chromium 与独立复审仍影响最终加固；不阻塞内部虚构身份原型 |
| DEV-002 | REV-009 | `f16b82a` | DONE | 仅内部虚构项目/授权/会话；CON-010 不允许真实口头授权音频试点 |
| DEV-003 | REV-011 | PR #2 / `1aa643a` | DONE | 仅内部合成音频；真实麦克风、长时、云存储、真实试点未覆盖 |
| DEV-004A | REV-012 | PR #3 / `917f888` | DONE | 仅确定态转录证据核心；真实 ASR、实时事件和真实试点未覆盖 |
| DEV-004B1 | REV-013 | PR #4 / `80ff1c7` | DONE | 仅服务端合成 PCM 协议；三个 P2 和 B2/真实 ASR/长时性能未覆盖 |
| DEV-004B2 | REV-014 | PR #5 / `73a07cb` / CI `31143035668` PASS | DONE | 定向复审 PASS；仅内部虚构/合成 PCM 浏览器纵向链路；父 DEV-004 后续已由 C1/C2 与 REV-030 收口 |
| SPEC-FE-001 | REV-015 | PR #6 / `47f7b35` / CI `31153878655` PASS / merge `474c647` | DONE | 定向复审 PASS；DEV-005A 可 READY，SPEC-SESSION-END-001 READY；CON-019 与 DEV-005C/D 仍开放/阻塞 |
| DEV-005A | REV-016 | PR #7 / `ea6c20f` / CI `31161076538` PASS / merge `066c424` | DONE | P0/P1=0；工作台状态改由服务端事实驱动、授权显示统一最新记录两项 P2 转 DEV-005B |
| SPEC-SESSION-END-001 | REV-017 | PR #8 / final head `9c471d8` / CI `31163777417` PASS / merge `9af96c1` | DONE | 定向复审 PASS；首次 snapshot 前撤权 P1 已闭环，CON-019 RESOLVED，DEV-005C READY；DEV-005D 继续等待 C PASS |
| DEV-005B | REV-018 | PR #9 / final head `c73e7ad` / CI `31166457093` PASS / merge `647a6b4` | DONE | P0/P1=0；真实 session/WS 事实、最新授权、final 去重、回看滚动与链路分离通过；父 DEV-005 仍开放 |
| DEV-005C | REV-019 | PR #10 / final head `36f534a` / CI `31174226564` PASS / merge `9691dad` | DONE | 第三次定向复审 PASS；P0/P1=0，三个 P2 保留但不阻塞当前范围；DEV-005D 的技术前置已成立，现等待新增 DISC-005D 产品讨论门槛 |
| DEV-005R1 | REV-020 | PR #13 / final head `c19a295` / CI `31245403822` PASS / merge `656db20` | DONE | 定向复审 PASS，REV-021 发现的全 generation PCM P1 已关闭；P0/P1=0，R1 前置已满足 |
| DEV-005R2C | REV-022 | PR #12 / final head `ae07747` / CI `31246011913` PASS / merge `e455c13` | DONE | 四项定向修复 4/4 关闭；P0/P1=0。仅浏览器核心积木，Android Chrome 生命周期与正式路由集成仍归 DEV-005R2 |
| DEV-005R2 | REV-024 | PR #14 / final head `829adf8` / merge `5527af2` / Android OnePlus GM1900 | DONE | REV-023 代码 P0/P1=0；真机约6分20秒、372片无缺口，旋转/后台/锁屏继续，刷新和麦克风撤权按正式原因显式 interrupted。R3 READY；CON-021 留到 R4 完整恢复/结束，CON-022 为非阻塞 P2 |
| DEV-005R3 | REV-025 | PR #15 / final head `481ee25` / CI `31289795181` PASS / merge `8d5c4c5` | DONE | 项目负责人手动 GitHub 复核 PASS，P0/P1=0；六项定向修复全部关闭。仅覆盖 R3 工作台与安全结束实现，CON-020/021/022 继续开放，R4 READY |
| DEV-005R4 / DEV-005 | REV-026 | PR #16 / final head `2fab0ea` / CI `31294084873` PASS / merge `7477dca` | DONE | 项目负责人手动 GitHub 复核 PASS，P0/P1=0；桌面与目标 Android 的刷新恢复、安全结束和终态通过，CON-020/021/022 RESOLVED。单台 Android、test ASR/no-cloud storage 范围 |
| SPEC-DEV-005R | REV-021 | PR #11 / final head `80ab84f` / CI `31244954185` PASS / merge `c572490` | DONE | 定向复审 PASS，四个 P1 4/4 关闭；解除 stacked 契约基线门禁，父 DEV-005R 与实现任务继续开放 |
| SPEC-DEV-004C | REV-027 | PR #17 / final head `2a65b1f` / CI `31298277051` PASS / merge `0b6c357` | DONE | 定向复审 PASS，P0/P1=0；三项 P1 全部关闭。ADR-025 Accepted、CON-014 RESOLVED；C1/C2 与父 DEV-004 后续均已收口，DISC-006 READY |
| DEV-004C1 | REV-028 | PR #18 / final head `a984587` / CI `31305357363` PASS / merge `99b090d` | DONE | 用户明确委派总控代行定向复审；P0/P1=0，旧三项 P1 全部关闭。C2 与父 DEV-004 后续均已 DONE；DISC-006 READY，SPEC-DEV-006/DEV-006 等待讨论与契约 |
| DEV-004C2 | REV-029 | PR #19 / final head `757bf52` / CI `31310993567` PASS / merge `83cdfef` | DONE | 用户明确委派总控代行定向复审；P0/P1=0，客户端稳定 correction request ID 的唯一 P1 已关闭。deletion scope 未实现/未验证，CON-023 OPEN；父 DEV-004 后续由 REV-030 收口 |
| DEV-004 | REV-030 | main `004dacc` / CI `31311278529` PASS / 产品范围决定 | DONE | 项目负责人决定当前内部 MVP 不以补转录为门槛；A/B/C 全部既有审查通过，原始录音、manifest、安全结束、降级可见与不伪造 final 仍是硬门禁。补转录后置 HARDEN-ASR-001，DISC-006 READY |
| SPEC-DEV-006 | — | PR #20 / exact final head 与 CI 待源任务交接绑定 | REVIEW | 高风险数据/API/AI/隐私契约候选；iteration-coach 恰好一次独立只读复核已吸收，项目负责人尚未给出 GitHub 结论。不得据本行宣称 PASS/DONE 或解锁 DEV-006 |

## 阅读规则

- `DONE` 只表示任务卡声明范围内已通过，不代表父任务或真实试点通过。
- 未关闭的 P2、CON 和范围边界仍需从任务板、冲突日志或历史审查正文追踪。
- 新审查追加到历史卷后，只在此表更新对应任务的最新一行。

## 历史索引

历史审查编号和完整正文见 [`reviews/04-review-report-history.md`](reviews/04-review-report-history.md)，当前已包含 `REV-001` 至 `REV-030`。
