# LLM Model Config V1 候选契约

状态：`CANDIDATE / REVIEW / REV-050`。本文件不选择真实 provider，也不授权真实数据调用。

## Digest 对象

`model_config_digest` 精确覆盖通过 [`llm-model-config-v1.schema.json`](llm-model-config-v1.schema.json) 的完整 manifest；不覆盖 registry wrapper、binding、secret、Prompt、Context 或 provider response。manifest 的 `model_config_version` 是 identity，内容变化必须产生新 version 和 digest，禁止同 version 改内容。

## `llm-model-config-canonical-json-v1`

1. 输入必须先通过 Schema，且不得含 `undefined`、函数、symbol、BigInt、非有限数字或负零；字符串不做 trim、换行转换或 Unicode 归一化。
2. object key 按 JavaScript UTF-16 code unit 的升序排列，不使用 locale；array 保持原顺序。
3. key、string、finite number、boolean 与 null 使用 ECMAScript `JSON.stringify` 的 JSON 表达；object/array 无额外空白。
4. 对 canonical JSON 的 UTF-8 字节计算 SHA-256，输出 64 位小写 hex。
5. `provider_options` 仍属于 digest；只能保存非敏感、可审查的 provider namespace options，禁止 secret、credential、Authorization/header 或账户数据。

golden vector 位于 [`fixtures/llm-model-config-v1.fixtures.json`](fixtures/llm-model-config-v1.fixtures.json)。实现必须同时匹配 canonical string 与 digest，不能只比较版本字符串。

## 参数与横评

`null` 表示该参数不发送，不等于 provider default 已被证明相同。temperature、max output、sampling、penalty、seed、stop、reasoning、response format、tools 与 provider options 全部显式进入 manifest。横评只有在所有 receipt 引用相同 version/digest 且 `config_application_status=as_requested`、warnings 为空时，才能标记为 `equal_effective_config=true`；`diverged|unknown` 或任一 sanitized warning 必须分组/排除，不能冒充相同有效配置。
