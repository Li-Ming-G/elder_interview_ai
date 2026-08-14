# SPEC-CONSENT-TEXT-POLICY-001｜正式持续授权正文与 machine policy 接收

## 基本信息

- 状态：`BLOCKED`
- 负责人：未分配；必须由项目负责人、数据治理角色与有权提供/批准正式授权正文的主体参与
- 前置：产品持续授权决定已明确；本任务不由 docs/runtime 执行 Agent 代写或自批法律文本
- 后续：真实 `covered` happy path、DEV-008B1 端到端产品交付与真实试点

## 阻塞事实

仓库当前没有经有权主体与项目负责人/数据治理正式接收、且明确覆盖同 project 当前及未来计划内访谈的真实授权正文及 machine policy。示例 `mvp-v1`、现存 valid consent、版本字符串相等或测试 fixture 都不能形成真实 `covered`。

## 必须交付

1. 真实使用的完整正式授权正文，明确覆盖同 project 当前及未来计划内访谈，并说明长者可随时暂停、停止或撤回。
2. 不可混淆的 `consent_text_version`、正文 digest/不可变证据，以及正文与版本的一一对应接收记录。
3. 版本化 machine policy：`future_planned_interviews_covered`、processing purposes、authorized access subjects、provider processing regions、public/training flags 与有向 compatibility allowlist。
4. 对现存正文/版本的明确处理：接收其覆盖范围，或明确不兼容并要求使用新版本全文和新匹配授权音频；禁止跨版本复用旧音频。
5. 项目负责人/数据治理及有权正文主体的审查证据，绑定仓库、版本、digest、提交/PR 或等价不可变载体和结论。

## 验收门禁

- 执行 Agent 只能承载已获授权的正文/policy，不得自行撰写、解释为法律意见、批准或把测试文本升级为正式文本。
- 正文与 machine policy 必须一致；任一 scope 维度缺失、未知或无法证明时失败关闭。
- 新版本正式授权必须录制与该版本一致的新完整音频，不能迁移或复用旧版本音频。
- 本任务正式接收前，生产/真实数据路径必须保持 `unavailable` 或 `reauthorization_required`，不能返回 `covered`。
- 若未来为开发采用 local/test fixture，fixture 必须显式标记“虚构演示、非正式授权文本”，仅在隔离的 local/test 配置可达；生产/真实路径继续失败关闭，CI 证据不得宣称真实正文已接收。

## 禁止范围

- 不在本任务中实现 runtime、Prisma/migration、页面、ASR/LLM、删除或部署。
- 不以隐私政策链接、轻提醒、点击“开始访谈”、ServiceTerm 或后台默认值替代正式授权正文。
- 不因 SPEC-CONTINUING-CONSENT-001 的契约通过而把本任务机械标为 DONE。
