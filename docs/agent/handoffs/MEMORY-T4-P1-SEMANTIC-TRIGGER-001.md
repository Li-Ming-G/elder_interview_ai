# Handoff｜MEMORY-T4-P1-SEMANTIC-TRIGGER-001

状态：`REVIEW / REQUEST_CHANGES FIXED LOCALLY / RE-REVIEW PENDING`

## 基本信息

- branch：`codex/memory-t4-p1-semantic-trigger-001`
- base：`main@d50e56886723de41f3fccf38a9d76b5b70541b32`
- mapping：T2/Foundation + T4/P1 + T18-T19/P6 + T0/Foundation-Observability
- review：REV-062

## 当前目标

以 forward-only `memory-maintainer-v1.2` 关闭 optional tag 与 ASR 碎片累计门禁两个 P1；不修改 v1/v1.1 历史，不进入 P2-B。

普通 batch/time not-ready 必须零 AiJob/provider/记忆写；session final flush 累计不足时保留唯一 deterministic `MEMORY_UNJUDGED` terminal system job，使 post-session/opening lane 终结，但 provider/snapshot/claim/resolution/thread/boundary/consumption 均为 0。

## CI 策略

开发期间只运行定向本地测试。contract、migration、runtime、full local matrix、governance 和独立本地 review 全部收敛后，才形成一个 exact head 并运行一次完整 CI；不得为格式、换行、单项 finding 或治理索引逐次触发远端 CI。

## 已实现候选

- immutable v1.2 Context/Output/fixtures/pure validator：`semantic_kind=episode|fact`，`memory_tag` optional/null，Boundary 独立。
- forward migration：旧 `memory_type` nullable；legacy 与 P1 使用互斥 partial identity/current indexes；v1.1 bytes 和数据不改。
- runtime 先选 selected-new batch，再以 NFKC、去 Unicode 空白、Unicode code point 累计；普通 not-ready 零 job，final low-content 只有唯一 terminal `MEMORY_UNJUDGED` system job。
- v1.1 terminal job/snapshot 保持可读；新 producer、snapshot、namespace 和 provider seam 使用 v1.2。
- Decision Trace 新增 reference-only trigger observation 与 ordered segment membership；Reader 从 source authority 重算 revision/digest/count/manifest，漂移即拒绝。

## 本轮 P1 修复与验证

- final-low freeze 将 `AiJobSessionScope.eligibleSegmentCount/segmentManifestHash`、`AiJob.inputHash` 与 Decision Trace selected-new manifest 绑定到同一 canonical `decisionTraceMemoryTriggerManifest`；明确 input-hash envelope 可由持久 source rows 重算，service/Reader 对 scope、job、trace、source rows 漂移失败关闭，suffix 仍为 full manifest 前 32 hex。
- startup/reconcile 对 fresh pending/running v1.2 missing-trace orphan 在事务内 CAS 为 failed，并只从持久 job/scope/input rows 建立 stage=`recovered`、status=`unavailable` trace；不调用 provider、不重跑 final flush、不伪造当前 config/transcript/空 observation。历史 succeeded/provider-called、normal/final-low replay 与 v1/v1.1 reader 兼容保持。
- 新增 persisted PG 覆盖 scope/inputHash drift、fresh pending/running startup-only、provider/succeeded history preservation 与并发幂等；`memory-maintainer-runtime.test.ts` 43/43，相关 unit 74/74，workspace typecheck/lint/format/diff-check PASS。

本交接仍为 `REVIEW / REQUEST_CHANGES FIXED LOCALLY / RE-REVIEW PENDING`；未 commit、push、PR、merge 或触发远端 CI。

## 独立审查历史

首轮独立实现审查返回 `REQUEST_CHANGES / P0=0/P1=3/P2=3`：post-session v1.1 test drift、null namespace、缺 typed trigger observation，以及 v1.1 historical-reader、final-low-content 并发恢复、README 状态三项缺口。第二次定向复审确认旧意见主体已关闭，但返回 `REQUEST_CHANGES / P0=0/P1=2/P2=0`：job→trace 仍有两次提交 crash seam，final-low 又缺 durable source membership/suffix parity。第三次独立聊天窗口复审再发现 `P1=2`：final-low scope/inputHash 与 trace manifest 不是同一 canonical authority，fresh pending/running missing-trace orphan 仍等 grace。第四次复审确认这两项关闭，但发现 `P1=1`：final-low 未拒绝 overlap/额外 input/额外 session scope。REV-062 永久保存四轮结论；当前修复中。

## 本地矩阵

- contract `43/43`；targeted unit `5 files / 76`；full unit `75 files / 604`。
- fresh PostgreSQL `26/26`；v1.1 exact upgrade `1/1`；targeted PG `3 files / 39`；full integration `17 files / 137`；auth `4 files / 26`。
- typecheck、lint、build、smoke PASS；治理同步后再跑一次 final format/diff-check。
- 历史失败保留：修复前 integration `134/136`，以及根级测试新增后各一次 Prettier/ESLint 失败；均未删改测试目标。

尚未 commit、push、建 PR 或触发 CI；独立 re-review PASS 后才形成唯一远端 exact-head 候选。

## 永久前置事实

- PR #69 accepted `042ec56f2b0362679bf240fcced95c61be77141f` / CI `32042589647` / independent PASS P0=P1=P2=0 / comment `5317377208`；
- merge/main `d50e56886723de41f3fccf38a9d76b5b70541b32` / main CI `32042952178` SUCCESS；
- 429 action-download annotation 是网络退避，最终 main verify 全步骤成功；
- P2-A 的 old lint failure、两轮 REQUEST_CHANGES 与所有 accepted history 继续由 REV-061 永久保留。

## 范围外

P2-B/C/D、P3/P4 新功能、真实 provider/secret/data、Context V2、UI、staging 和真实试点均不由本任务完成。P1 只理解当前 session，不做 Long Memory write-side retrieval；历史 Long 由后续 P3 检索后供 P4/Director 使用。
