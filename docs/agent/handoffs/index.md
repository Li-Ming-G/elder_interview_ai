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

SPEC-CONTINUING-CONSENT-001 的同 project 持续授权、每次正式录音前版本化轻提醒、重授权/版本漂移门禁、REV-049 old REQUEST_CHANGES 与 accepted exact-head PASS/merge、CON-012 关闭及 B1/B2 精确解锁边界见 [`SPEC-CONTINUING-CONSENT-001.md`](SPEC-CONTINUING-CONSENT-001.md)。B1/B2 随后已在各自 fail-closed/provider-neutral 范围 DONE；真实 covered 仍受 BLOCKED 的 SPEC-CONSENT-TEXT-POLICY-001 约束。

DEV-008B1 的单一 repeat/continuation current-facts owner、next-session 幂等并发、全新 session 隔离、recording reminder start gate、Home unknown/online replay、production policy unavailable 与完整审查历史见 [`DEV-008B1.md`](DEV-008B1.md)、[`REV-050`](../reviews/REV-050.md) 和 [PR #51](https://github.com/Li-Ming-G/elder_interview_ai/pull/51)。accepted head `30975626` 已 PASS 并 merge `6e546853`，main CI `31785578105` attempt 2 SUCCESS；attempt 1 ordinary Chromium unknown-project 时序 flake与 old REQUEST_CHANGES 永久保留。治理 closeout 已完成，任务仅在 fail-closed runtime 范围 DONE；真实 policy 继续 BLOCKED，B2 后续已由 REV-054 在独立范围 DONE。

SPEC-LLM-PROVIDER-001 的 Vercel AI SDK direct-provider、单 active binding、Prompt draft/candidate/formal、隔离 synthetic 横评、真实 provenance 与 region/secret fail-closed 交接见 [`SPEC-LLM-PROVIDER-001.md`](SPEC-LLM-PROVIDER-001.md)。accepted exact head `77fb3a8` / CI `31783061076` 与 integration head `a324e2b` / CI `31787175381` 均获项目负责人 PASS（P0/P1/P2=0），PR #52 merge/main `99ce83d` / main CI `31789810221` attempt 1 SUCCESS；old `b7ae9a4` REQUEST_CHANGES P1=3 永久保留。治理索引使用 REV-051 canonical alias，不改 branch-local REV-050 历史。本交接不包含真实 provider/runtime/密钥/formal v2；后续由 BLOCKED 的 [`DEV-LLM-PROVIDER-001`](../tasks/DEV-LLM-PROVIDER-001.md) 承接。

SPEC-STAGING-DEPLOY-001 的 Quick/Named 双环境、synthetic/fictional-only 数据分类、唯一 `data_mode=synthetic_only`、同源 HTTPS Web/API/WS、Access/app 双身份、trusted proxy/IP、Windows 无人值守、备份恢复、监控回滚与真实数据新任务门禁见 [`SPEC-STAGING-DEPLOY-001.md`](SPEC-STAGING-DEPLOY-001.md)。REV-052 永久保留 old `195c4be2` / CI `31798730203` REQUEST_CHANGES（P1=1），并记录 accepted `64cf94f3` / CI `31808762082` PASS、merge `751a32e1` / main CI `31815415871` SUCCESS；任务仅在契约范围 DONE，未安装 Cloudflare、未请求 token、未部署。

SEC-AUTH-PUBLIC-001 的匿名登录失败审计、staging/production 安全 Cookie、会话撤销竞态、Access/应用账号分责、默认直接对端 IP 与部署 adapter 门禁见 [`SEC-AUTH-PUBLIC-001.md`](SEC-AUTH-PUBLIC-001.md) 和 [PR #55](https://github.com/Li-Ming-G/elder_interview_ai/pull/55)。REV-053 记录 content `0101837` / CI `31798421917` 与 integration `d67dd12d` / CI `31816652463` 双 PASS、merge/main `8bcf65b2` / main CI `31817732960` SUCCESS；branch-local ADR-041 机械映射为 canonical ADR-042，CON-008 RESOLVED、DEV-001B/SEC 在应用身份/会话范围 DONE。trusted ingress/proxy/header/origin 防直连仍未实现，DEV-STAGING-DEPLOY-001 继续 BLOCKED，公网与真实数据继续禁止。

DEV-008B2 的 completed 后双分析 lane、current stream calibration gate、权威 Context provenance、opening exact-once 与 crash/restart terminalization 最终交接见 [`DEV-008B2.md`](DEV-008B2.md)、[REV-054（branch-local REV-052）](../reviews/REV-054.md) 和 [PR #56](https://github.com/Li-Ming-G/elder_interview_ai/pull/56)。accepted `90ce5b35` / CI `31820768146` 获独立 PASS，merge/main `4b59c4d3` / CI `31821662034` SUCCESS；old `0e703af` P1=3 与 `996994f` P1=1 永久保留。任务仅在 fail-closed/provider-neutral 范围 DONE，不代表真实 LLM 或 continuing-consent covered 可用。

DEV-ASR-PROVIDER-001 的最终工程交接见 [`DEV-ASR-PROVIDER-001.md`](DEV-ASR-PROVIDER-001.md)、[`REV-055`](../reviews/REV-055.md) 和 [PR #57](https://github.com/Li-Ming-G/elder_interview_ai/pull/57)。accepted content `5271b52` / CI `31800257197` 与 latest-main integration `27f1c84` / CI `31824839261` 均获正式 PASS（P0/P1/P2=0），merge/main `dd45f5e` / CI `31825548551` SUCCESS；旧 `af99d91` provider/replay/desktop/Android 虚构证据仍只绑定旧 head。DONE 仅限工程实现与既有证据；actual billing/SKU unknown、CON-027 OPEN、真实长者/PII/真实数据/公网/生产试点继续禁止。DEV-LLM-PROVIDER-001 只解除 ASR 工程依赖，其余真实 LLM 门禁不变。
