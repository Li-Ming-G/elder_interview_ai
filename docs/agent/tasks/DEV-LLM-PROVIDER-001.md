# DEV-LLM-PROVIDER-001｜LLM direct-provider runtime 与真实调用验收

## 基本信息

- 状态：`BLOCKED`
- 前置契约：SPEC-LLM-PROVIDER-001 已由 REV-051（branch-local REV-050）接收并合入 main
- 开工门禁：DEV-ASR-PROVIDER-001 正式 PASS；项目负责人明确选择 provider/model/region/data policy；数据治理接收适用的 retention/training/DPA/跨境处理与重授权依据
- 输入：`02` §19、`04` §11、`05` §13、`07` §§17/19、`08` §21、`09` §19、`10` §16、ADR-040
- 负责人：未分配

## 目标

在全部外部门禁关闭后，以独立受审 runtime PR 实现 SPEC-LLM-PROVIDER-001 已冻结的 Vercel AI SDK direct-provider adapter、唯一 active binding、失败关闭 registry、精确 model config/provenance、共享 deadline/abort 与隔离评测接缝。

## 合同派生范围

- 重新核验并精确 pin `ai` 与实际选定 provider package，锁文件固定传递依赖并完成 license/SBOM 检查；
- 实现 `createProviderRegistry` 的进程内查找与启动时 Schema + `llm-provider-registry-semantics-v1` 校验；
- 每次 SDK 调用显式 `maxRetries=0`，保持项目既有 8 秒绝对 deadline、primary/最多一次完全同输入 retry 与 late-result fence；
- 以受审前向 migration 保存 immutable model config、requested/observed model、provider request/SDK response identity source、package/token/latency/region/direct-mode 与 sanitized warning/status；legacy 缺事实只能 `incomplete|unjudged`；
- provider/endpoint/region/secret/environment/data-class 任一缺失、歧义或不匹配即失败关闭；真实内容只在正式 data policy 与授权兼容门禁满足时调用；
- 横评继续只写隔离 evaluation artifact，不调用 QuestionEvidence current/history writer；formal loader 只加载已接收 bundle。

## 明确不做

- 本任务卡不选择 provider/model/region，不批准 DPA/跨境依据，不索取或保存密钥；
- 不在门禁关闭前安装 SDK/provider package、创建 active binding 或发送真实访谈内容；
- 不加载 `v2-draft`，不自动发布 formal v2，不实现 Gateway、LiteLLM、fallback、shadow call、第二 critic、在线 Prompt 管理或自动 winner；
- 不替代 DEV-ASR-PROVIDER-001、SPEC-CONSENT-TEXT-POLICY-001、DEV-008B2、DEV-008D 或真实试点验收。

## 验收

完整执行 `09` §19.2 的 runtime 反例、迁移、provenance、依赖与真实 provider 兼容性矩阵；创建独立 non-Draft PR，取得 exact-head 完整 CI SUCCESS 与项目负责人手动审查结论。CI、fixture 或密钥存在均不能单独形成真实 provider PASS。
