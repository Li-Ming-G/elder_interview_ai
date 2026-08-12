# SPEC-DEV-008A3-PREFLIGHT 交接

## 状态

- 当前：`REVIEW`
- base：`origin/main@51e2337ea86739e209ad696804de7decbcf7a9df`
- branch：`codex/spec-dev-008a3-finalization-size`
- 审查：REV-044 `PENDING`；非 Draft PR、final exact head 与 exact-head CI 待最终审查包绑定
- 下游：DEV-008A3 在本候选 exact-head PASS/merge 前保持 `BLOCKED`

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
- 未给出 PASS/DONE/merge 结论；自动 CI 通过也不能替代 REV-044 exact-head 手动审查。

## 风险

- 在 A3 mapper 实现前，新字段可缺省；消费者不得把缺省/null 当 0 或当作服务端已验证。
- `AudioObject.totalSizeBytes` 为 BigInt；超出 JavaScript safe integer 必须失败关闭，不能截断或舍入。
- legacy complete 行可能缺权威 total bytes；普通只读事实可继续显示，但 A3 播放与本机删除必须保持阻断。
