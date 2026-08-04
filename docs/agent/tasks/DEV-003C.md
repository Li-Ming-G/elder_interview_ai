# DEV-003C｜浏览器可靠上传编排与存储恢复加固

## 基本信息

- 状态：`REVIEW`
- 负责人：总控 Agent（协调后端存储与音频前端实现）
- 前置依赖：DEV-003A、DEV-003B、REV-010
- 分支：`codex/dev003c-reliable-upload`
- 交接对象：项目负责人（GitHub 审查）、父 DEV-003、后续 DEV-004

## 目标

修复 REV-010 两项服务端存储 P2，并把浏览器 IndexedDB 分片队列与正式 audio object API 接成可跨刷新、响应丢失和短时断网恢复的最小可靠上传链路。

## 输入依据

`00` 至 `06`、`08` 至 `10`、ADR-013/015/016/017、REV-010、HO-013、CON-012、DEV-003A/B。

## 前置依赖与假设

- 仅使用合成或虚构音频、虚构身份和隔离存储/数据库；
- 一个 upload job 对应一个 audio object，sequence 从 0 连续增长；
- 复用现有同源 Cookie、CSRF、assignment 和 audio REST，不修改身份协议；
- CON-012 不阻塞本任务，真实试点前另行决策。

## 允许修改

- `apps/api/src/audio` 的临时文件清理、已有 chunk 元数据优先校验和恢复测试；
- `apps/web/src/audio` 的 upload job/store/uploader、现有 IndexedDB 前向升级、内部 harness；
- `packages/contracts` 中仅为复用现有响应所需的类型整理；
- 相关 unit、PostgreSQL integration、Playwright E2E 和本任务协作文档。

## 禁止修改

- 不修改正式 REST 路径、响应 Schema、Prisma 服务端数据模型或身份/授权协议；
- 不实现 ASR、AI、完整访谈工作台、Service Worker、无限后台重试、真实云存储或真实麦克风；
- 不使用真实访谈录音、转录、个人信息或密钥；
- ACK 全字段匹配前不得删除本地 Blob，失败不得静默丢弃或伪装 complete。

## 交付物

- `putImmutable` 覆盖 open/write/sync/link 的完整临时文件清理与失败注入测试；
- 服务端先校验已有 chunk 元数据，再决定恢复缺失文件，错误内容不得留下冲突 orphan；
- IndexedDB 前向迁移和持久化 `AudioUploadJob`：稳定 create/chunk/complete request ID、audio object ID、expected count 和状态；
- init → 顺序 chunk upload → 严格 ACK → complete 编排；刷新、响应丢失和短时失败后安全重试；
- 内部 Chromium 纵向 E2E，证明成功 ACK 才删除、失败保留、刷新复用对象/请求并最终 complete。

## 验证方式

- format、lint、typecheck、build、unit；
- PostgreSQL integration：两项 P2、同对象/同序号恢复、冲突拒绝和完整 manifest；
- Chromium：合成录音、初始化、失败保留、响应丢失重放、刷新恢复、ACK 删除、complete；
- 根 CI 全门禁通过，敏感信息和内部 object key 不泄露。

## 验收标准

- write/sync/link 任一步失败均不遗留任务临时文件，原始错误不被清理错误覆盖；
- 已有数据库元数据不匹配时，在写存储前返回冲突；元数据匹配且文件缺失时可用相同字节恢复；
- 页面刷新或响应丢失不创建重复 audio object，不更换既有阶段 request ID；
- 服务端 ACK 任一字段不匹配时本地分片保留并进入 failed；
- expected count 在录制停止时冻结，全部分片 ACK 后仍能正确 complete；
- 完成后 push 新 GitHub PR，状态转 `REVIEW`；只有项目负责人按候选 head 明确通过后才可 `DONE`。

## 实现与验证记录（2026-08-04）

- 服务端：`b3376d9` 完成完整临时文件生命周期清理、原错误优先和已有数据库元数据优先恢复；错误内容不接触缺失存储，匹配内容可恢复，现存篡改对象返回冲突；
- 浏览器：`d85311a` 完成 IndexedDB v3 upload job、稳定 create/chunk/complete request ID、严格 ACK、ACK 后删除和 complete；`7d7785a` 将原生录音小数时钟归一为连续整数毫秒边界以符合正式 API；
- 本地：format、lint、typecheck、build、unit 12 files/56 tests、Chromium 3/3 通过；针对性上传/迁移 unit 5/5 与上传 Chromium 2/2 通过；
- GitHub：PR #2，CI run `30875678125` 对实现 head `7d7785a` 全门禁通过，包含 migration deploy/status、PostgreSQL integration/auth、smoke、普通 Chromium 3/3 和认证真实 API Chromium 3/3；
- 未在本地执行：PostgreSQL integration/auth（本机无可用 PostgreSQL/Docker）；由上述 GitHub CI 补齐；
- 当前结论：交付物和自动验证已满足，进入 `REVIEW`；项目负责人尚未按最终 PR head 给出审查结论，因此不得标记 `DONE`。
