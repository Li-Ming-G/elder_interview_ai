# 交接归档索引

历史交接正文集中保存在 [`05-handoff-log-history.md`](05-handoff-log-history.md)，包含 `HO-001` 至 `HO-024` 及补充记录。当前接收对象只看上一级的 [`05-handoff-log.md`](../05-handoff-log.md)。

`DOC-002` 的整理记录见 [`DOC-002.md`](DOC-002.md)；`DEV-004B2` 起按任务归档，见 [`DEV-004B2.md`](DEV-004B2.md)。SPEC-SESSION-END-001 的 HO-032 与最终 REV-017 收口见 [`SPEC-SESSION-END-001.md`](SPEC-SESSION-END-001.md)。DEV-005C 实现候选见 [`DEV-005C.md`](DEV-005C.md)，DEV-005B 最终交接见 [`DEV-005B.md`](DEV-005B.md)，首个产品讨论门槛 HO-036 见 [`DISC-005D.md`](DISC-005D.md)，首次访谈重构总纲讨论 HO-037 见 [`DISC-005-R0.md`](DISC-005-R0.md)，讨论统一写回与新实现基线 HO-038 见 [`SPEC-DEV-005R.md`](SPEC-DEV-005R.md)，正式工作台与安全结束实现候选见 [`DEV-005R3.md`](DEV-005R3.md)，问题旅程与双题库候选见 [`SPEC-QUESTION-JOURNEY-001.md`](SPEC-QUESTION-JOURNEY-001.md)。后续使用任务编号作为文件名，并在此处登记最新交接编号。

SPEC-DEV-008A 的统一倾听员工作区、最小回顾、本机副本和 A1/A2/A3/008D 拆分候选见 [`SPEC-DEV-008A.md`](SPEC-DEV-008A.md)。

DEV-008A1 的共享 Home、formal project/session read model、权限降级接缝、REV-043 exact-head PASS/merge 和 A2/A3 解锁边界见 [`DEV-008A1.md`](DEV-008A1.md)。A2/A3 执行时必须复用该交接，不得重新建立 shell/routes/read model 或改变 008D/CON-023 边界。

SPEC-DEV-008A3-PREFLIGHT 的 finalization total bytes 接缝、REV-044 exact-head PASS/merge、CON-029 关闭与 A3 runtime 门禁见 [`SPEC-DEV-008A3-PREFLIGHT.md`](SPEC-DEV-008A3-PREFLIGHT.md)。该接收只解锁 A3，不代表回顾、本机删除或服务器隐私删除已实现。

DEV-008A2 的四 create 权威幂等、正式口头授权入口、离页麦克风释放、StrictMode 修复、REV-045 exact-head PASS/merge 与失败历史见 [`DEV-008A2.md`](DEV-008A2.md)。A2 接收当时不替代 A3 或父 DEV-008A 验收；A3 后续以主线唯一编号 REV-046 完成，见下一条最终交接。

DEV-008A3 的只读回顾、本机完整 archive 播放、原子本机副本删除、隐私边界、REV-046 exact-head PASS/merge 与 `70b8fe8`/`f491d99` 历史见 [`DEV-008A3.md`](DEV-008A3.md)。A1/A2/A3 与父 DEV-008A 仅在响应式网页 A 范围 DONE；DEV-008D/CON-023、server deletion、导出、PWA/App、ASR/LLM 与 DEV-007 继续独立。

DEV-008A4 的授权前当前页麦克风、正式流独立校准、自动收尾、unknown create 恢复、严格同源回顾重投影、REV-047 exact-head PASS/merge 与旧全绿但用户发现缺口历史见 [`DEV-008A4.md`](DEV-008A4.md)。本接收不完成真实 ASR/provider、server deletion、DEV-008D/CON-023 或真实试点。

SPEC-REPEAT-INTERVIEW-001 的项目级 repeat action、same-project next-session、完成后双分析、calibration/basis 双前置 opening exact once、REV-048 old REQUEST_CHANGES 与 final exact-head PASS/merge 历史见 [`SPEC-REPEAT-INTERVIEW-001.md`](SPEC-REPEAT-INTERVIEW-001.md)。本接收只机械解锁 DEV-008B1/B2，不代表其 runtime、真实 provider 或真实试点已完成。

SPEC-CONTINUING-CONSENT-001 的同 project 持续授权、每次正式录音前版本化轻提醒、重授权/版本漂移门禁、REV-049 old REQUEST_CHANGES 与 accepted exact-head PASS/merge、CON-012 关闭及 B1/B2 精确解锁边界见 [`SPEC-CONTINUING-CONSENT-001.md`](SPEC-CONTINUING-CONSENT-001.md)。本接收只使 B1 implementation-ready；真实 covered 仍受 BLOCKED 的 SPEC-CONSENT-TEXT-POLICY-001 约束，B2 继续等待 B1 runtime。
