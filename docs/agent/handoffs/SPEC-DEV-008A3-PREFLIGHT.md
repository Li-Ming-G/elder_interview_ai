# SPEC-DEV-008A3-PREFLIGHT 交接

## 状态

- 当前：`DONE`
- base：`origin/main@51e2337ea86739e209ad696804de7decbcf7a9df`
- branch：`codex/spec-dev-008a3-finalization-size`
- 审查：[PR #37](https://github.com/Li-Ming-G/elder_interview_ai/pull/37) final exact head `70167688202117364e5cab74c9a320e0a7d76742` / CI `31597563095` SUCCESS；[项目负责人 PASS](https://github.com/Li-Ming-G/elder_interview_ai/pull/37#issuecomment-5266978939)，P0/P1/P2=0
- 合并：merge commit `60f60cb6b5c8f70c9fca9840aa6c495f6e2318d8`；main CI `31598183784` SUCCESS
- 下游：DEV-008A3 已恢复 `READY`；父 DEV-008A `IN_PROGRESS`、DEV-008A2 `READY`、DEV-008D `BLOCKED` 与 CON-023 `OPEN / NOT IMPLEMENTED / NOT VERIFIED` 均不变

## 已冻结内容

- 公共 `SessionFinalizationSnapshot` additive 增加 `total_size_bytes?: number | null`，值仅来自同一 session 关联既有 `AudioObject.totalSizeBytes`，不新增 Prisma 字段或 migration。
- contract-first 阶段为兼容既有 mapper 使用 optional+nullable；A3 runtime mapper 落地后 ordinary canonical `GET /sessions/:id` 必须显式返回 key。
- awaiting_upload/verifying/unrecoverable 为 null；正常 processing/completed 必须为非 null safe integer；failed 仅 complete-manifest lane 为非 null。complete+missing/null/unsafe/不一致按 legacy/corrupt 失败关闭，不得当 0。
- `ProjectSessionListItem` 与 `EvidenceFinalizationResponse` 均不扩字段；A3 通过 ordinary canonical session GET 获取，沿用现有 assignment/ordinary visibility 权限。
- fresh delete preflight 必须机械比对 session/audio identity、chunk count、total bytes、chunk-size sum、manifest checksum 与 local archive metadata；任一缺失或不一致均禁止播放/本机删除。

## 留给 DEV-008A3 的实现与测试

- runtime mapper/API lifecycle：key presence、BigInt→safe integer、terminal/null/legacy/corrupt 失败关闭。
- auth/assignment/restricted/deleted/soft-deleted/created_by 反例；不得由 evidence seam 或首页 list 绕过 ordinary read。
- fresh manifest/local archive identity、count、bytes、chunk sum、checksum 与 metadata 正反例。
- local deletion 仍只删除本 origin IndexedDB 副本，不创建或暗示服务器删除；权限、删除范围、CON-023 不变。

## 明确未做

- 未改业务 service/controller/mapper、Prisma/migration、IndexedDB、页面或 runtime 测试。
- 未实现 A3，未改 A2、ASR、007、008D、导出或服务器 deletion runtime。
- 本交接仅登记项目负责人已经给出的 REV-044 exact-head PASS 与已完成 merge/main CI，不是执行窗口自行审查。

## 风险

- 在 A3 mapper 实现前，新字段可缺省；消费者不得把缺省/null 当 0 或当作服务端已验证。
- `AudioObject.totalSizeBytes` 为 BigInt；超出 JavaScript safe integer 必须失败关闭，不能截断或舍入。
- legacy complete 行可能缺权威 total bytes；普通只读事实可继续显示，但 A3 播放与本机删除必须保持阻断。

## REV-044 最终接收

- exact head/CI、项目负责人正式 PASS、merge commit 与 main CI 已形成完整证据链；
- SPEC-DEV-008A3-PREFLIGHT `DONE`、ADR-036 `Accepted`、CON-029 `RESOLVED`、DEV-008A3 `READY`；
- 旧 Correction 和 REV-044 `PENDING` 候选历史保留；本接收不冒充 A3 runtime、IndexedDB、页面或服务器删除实现；
- A3 执行时必须完成显式 key/safe integer、ordinary 权限白名单、fresh identity/count/bytes/checksum/逐片 metadata 与 legacy/null 全部反例，不能把契约 PASS 当 runtime PASS。
