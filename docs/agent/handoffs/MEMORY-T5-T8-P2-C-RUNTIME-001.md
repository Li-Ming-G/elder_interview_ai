# Handoff｜MEMORY-T5-T8-P2-C-RUNTIME-001

状态：`REVIEW / CONTRACT-FIRST / IMPLEMENTATION NOT STARTED`

## 当前停点

- 分支 `codex/memory-p2-c-runtime-001`，起点 `3369869`。
- 当前 latest-main integration 分支为 `codex/memory-p2-c-contract-integration`，base `origin/main@7e183217e5b6b08abe418c9cb80d77294b7777b0`；它只承接 source `0e58d4f` 的 P2-C contract-first 基线与其后17个非`.codex` dirty docs/contracts/governance变更，不承接`3369869`的无关AGENTS/可见窗口修改。
- 已登记 A1 PR #71 accepted `dbb0cc76` / CI `32210618025` / owner PASS `P0=P1=P2=0`、merge/main `7d02fa65` / CI `32211560361`；P2-B PR #72 accepted `717c5ca` / CI `32245656541` / independent PASS、merge/main `8bbb2cc` / CI `32254759316`；PR #73 governance closeout merge/main `7e183217` / CI `32256919620`。
- 已新增 P2-C 任务卡、REV-065 待审占位，并在 `04/07/08/09/10` 冻结数据库目标、运行协议、安全/保留与验收门禁。
- 本停点没有修改 `apps/`、Prisma、migration、package 或 `.codex`；没有 runtime、provider 调用、远端 CI、PASS、DONE 或 merge 结论。

## 后续实现必须复用

- `04` §17：`MemoryResolution.authority_id`、checkpoint/layer/Long/typed retention/semantic trace/evidence refs 的 forward-only 目标；
- `07` §23：freeze -> call -> validate -> transient plan -> CAS/atomic commit，及 deterministic/unavailable seam；
- `08` §25：transient content、最小日志、deletion/retention 四次检查与 cleanup；
- `09` §24：migration、repository、duplicate/concurrent/retry/rebase/crash/restart/late/final-tail/rollback 验收；
- `10` §23：P2-C exact-head 审查和 P2-D 解锁门禁。

已吸收P2-A/B到当前schema的冲突：P1 terminal/P2 producer分列；online/final必填矩阵；非success target nullable；AiJob Int与P2 string version分列；claim/evidence revision；自动P2继承AiJob root且typed target无状态；v1.1历史/v1.2当前producer；stable resolution authority+new row supersedes；final Mid不可用时Long terminal unavailable。实现必须扩展现有AiJobCoordinator，post-session仍归P1 final lane，P2只唤醒且不阻塞completed/opening。

## 本停点验证与中断历史

- 本轮从同一 worktree 续接；上轮因 Codex `502` 中断，未形成 commit，现有 docs 修改保留并在此基础上继续，没有回滚或重做已完成设计。
- 主工作区 `C:\Users\TR\Documents\elder_interview_ai\node_modules\.bin\prettier.cmd --check`：所有 changed Markdown `All matched files use Prettier code style`。
- Markdown relative links PASS（28 个 changed/untracked Markdown 扫描）；Markdown fence/table shape PASS；`git diff --check` PASS；authorized docs-only scope、`package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`、`apps/`、Prisma、`migrations/`、`.codex/` 未变。
- 早先尝试用 worktree `pnpm exec prettier --check` 时，依赖恢复因 registry socket/network failure terminated；按后续约束未联网重试，改用主工作区已存在的 Prettier 完成检查。该失败只记录为环境历史，不改变 lockfile。
- 本停点仍无 runtime/provider调用、远端CI、PASS/DONE、push或merge；REV-065保持`PENDING / NOT REVIEWED`。

## Contract repair handoff

对 `0e58d4f` 的独立只读复核发现原正式映射仍不可直接实施：retention 错把 `long_projection` 当 target kind 并允许 CASCADE；stable authority 没有真实 FK registry 且 `origin_thread_id` 被放宽为 nullable；`MemoryClaimEvidence.id` 无法承担跨 claim evidence authority；physical FK 清单、deletion scope digest、Trace 非空字段映射与稳定 error registry 不完整。该回合按 Correction 只做 docs/contracts/governance 修复。

新增 `docs/contracts/memory-persistence-p2c-compatibility-v1.md` 与机器清单 `docs/contracts/memory-persistence-p2c-physical-fk-v1.json`，并同步 `04/07/08/09/10`、task/trace/ADR/board/handoff/review 索引。后续定向修复又把 digest 明确为非 FK scalar，补齐 Trace typed source columns/FKs/CHECK，并按当前工作树重算 `20260814210000_dev008b2_review_invariants` hash。P2-B accepted 文件字节保持不变；本回合不改变 Prisma/runtime/provider/真实数据边界。完成后必须以新 exact commit 重新独立审查，REV-065 在此前保持 `PENDING / NOT REVIEWED`。

### 2026-08-20｜exact 6de1d96 三项 P1 docs-only correction

本轮继续只改 contracts/governance：物理 `memory_resolution.authority_id` 改为 legacy-compatible nullable，并冻结 P2-only non-null gate；retention root view 的 P2 字符串 policy 字段改由 `memory_p2_job_projection.p2_policy_revision` / `p2_retention_policy_version` 提供，旧 AiJob Int 只保留 legacy snapshot 且禁止隐式 cast；重新核对 `20260814210000_dev008b2_review_invariants` 实际 SHA `92a8faae0197f0390c3547664872a4a0ad167f9a139daea6c44c1393e31d049e`，并写入 26 条 migration 长度/upgrade expected count/canonical predecessor fingerprint 自校验。无 Prisma/runtime/CI/Git 元数据变更，旧 FAIL 历史保留，仍需新 exact commit 独立审查。

### 2026-08-20｜integration typed source nullable correction

总控机器检查确认 physical FK manifest 把 `decision_trace_memory_source_input_segment_fk` 错标为 `nullable=false`，会使 checkpoint/job/evidence/resolution 四种合法 source kind 无法建行。integration 分支已把五个 typed source FK 统一为物理 nullable，并冻结 source-kind CHECK + `num_nonnulls(...)=1`；真正必填的 `trace_id/source_kind/source_revision/membership_digest/deletion_scope_digest/input_order` 不变。manifest 新增五个正例与 zero/multiple/kind-mismatch/missing-required-column 反例；仍不构成独立 PASS。

### 2026-08-20｜pre-integration `c3eaa4ae…` REQUEST_CHANGES correction

独立 reviewer 对 dirty snapshot `c3eaa4ae…` 正式给出 `REQUEST_CHANGES P0=0/P1=3/P2=0`；缩写按审查方原文保留。integration candidate 已窄修：Trace source-kind 五值闭域，parent/semantic child 逐列归位；唯一 evidence revision owner 收敛为 `memory_evidence_authority.authority_revision`，claim evidence/bridge 只保 pair parity；P2 string policy source 收敛为 `memory_p2_job_projection`，checkpoint只保 legacy Int snapshot与独立contract identity。manifest含相应positive/negative semantic cases。legacy-null gate、26 migrations/SHA/fingerprint、62 FK/唯一SET_NULL、P2-B accepted artifacts immutable与旧审查历史继续保留。当前 head 尚未独立复审，不得写PASS/DONE/merge。

### 2026-08-20｜integration local validation failure history

- 首次完整 JSON semantic command 返回 `trace semantic case mismatch: terminal_error_on_parent`：这是候选 machine fixture 的真实缺陷，正例漏写 `parent_fields_present=true` 与 `parent_sentinels_valid=true`。已窄修 fixture，没有放宽判定规则。
- 随后的两个等价只读 PowerShell one-liner 分别因过度压缩触发解析/引用错误：一次把 canonical JSON function 解析成不存在的 `return{+` command；一次使用简写 `Where-Object` 时缺少可识别 operator。更早一次同类 one-liner 还因 `foreach($c in$tc)` 缺空格产生 `Missing 'in'` parser error。它们均未修改文件、未运行CI，也不代表契约失败。
- 改用未压缩、显式 script block 的等价窄检查后通过：`migrations=26`、目标 SHA 与 26 条实际 bytes一致、fingerprint一致、`fks=62`、唯一 SET_NULL、五类 typed FK nullable、source/Trace/Evidence/policy 共 `10/5/4/6` 个正反 semantic cases全符合预期、P2-B五个accepted artifacts相对`origin/main`无漂移。失败命令与最终替代结果均永久保留，不重跑昂贵CI/全量测试。
- 首次 Markdown table/fence command 因压缩脚本写成无空格的 `throw"..."`，被 PowerShell 解析为不存在的 `throwtable...` command；等价显式命令随后因朴素 pipe 计数把 inline code 内的 `|` 也当作列分隔符，先在 `04` 报一处、继而在 `07` 的既有 enum code spans 报多处 false positive。`04` 表述仍等价澄清为两个独立 code token `semantic_park` / `capacity_checkpoint`；最终检查改为忽略 inline code/escaped pipe 后再比较列数，不弱化真实表格 delimiter/row shape，结果在后续验证记录中登记。
- 首次 scope command 只列出17个dirty allowlist，遗漏了承接修订所必需的`0e58d4f` contract-first基线，因此报告actual 28/expected 17；这是检查口径缺口，不是越权文件。最终 scope 机械比较`0e58d4f`文件集 + source 17 dirty - 三个accepted immutable artifacts，得到exact 28个docs/contracts/governance文件；`AGENTS.md/.codex/apps/Prisma/migrations/package/lock/CI`均未进入。

### 2026-08-20｜integration final local docs-only verification

- JSON parse与semantic：PASS；26条migration实际SHA全匹配，目标SHA=`92a8faae0197f0390c3547664872a4a0ad167f9a139daea6c44c1393e31d049e`，canonical fingerprint=`2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6`；62 FK、唯一`memory_p2_retention_target_cleanup_job_fk SET_NULL`；source/Trace/Evidence/policy正反cases=`10/5/4/6`。
- Markdown relative links：PASS，16个changed Markdown、236个relative targets；fence/table shape：PASS，16文件、44个table blocks；Prettier：17个changed Markdown/JSON全部PASS；`git diff --check origin/main` PASS。
- scope/source safety：PASS，最终28个文件全部为预期docs/contracts/governance；P2-B五个accepted artifacts相对`origin/main`零漂移；source保持HEAD `0e58d4f143638e84145ac5b56b16b247d3d2c115`、17个非`.codex`dirty、tracked diff hash `3ce785949c7dc07452555c5a26ca018bcba25425`，用户`.codex/iteration-learning.md`仍只在source modified，未复制/覆盖。
- 未运行CI、全量测试、typecheck/lint/unit/integration/E2E；这是本次大块一次CI策略的有意边界，等待独立reviewer对新exact head给结论。

## 不得越界

真实 P2 provider/model/region/secret/data 属于 P2-D；P3/pgvector、P4 budget、UI 均另立任务。deterministic fake 只允许 local/test，unavailable 是合法且必须可恢复的终态，不能伪装成 semantic success。
