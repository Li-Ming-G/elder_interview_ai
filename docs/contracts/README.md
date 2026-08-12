# 机器可读契约目录

本目录用于保存可被代码生成器、契约测试和 Agent 直接读取的正式契约。

文件状态逐项声明，不能再把整个目录一概视为占位。标记为正式的文件可作为机器契约；其余候选/占位文件仍不得用于生产代码生成或运行时校验。

- `openapi.yaml`：REST API 的机器可读定义；
- `websocket-events.md`：实时事件目录及其 Schema 文件索引；
- `interview-recorder-output.schema.json`：访谈记录员结构化输出；
- `interview-director-context.schema.json`：`InterviewDirectorContextV1`，正式；是 Director 实际输入字段、类型、必填性、枚举和边界的唯一技术结构；
- `interview-director-output.schema.json`：`InterviewDirectorOutputV1`，正式；是 Director 实际输出字段、类型、必填性、枚举和交叉约束的唯一技术结构；
- `export-manifest.schema.json`：导出资料包清单。
- `streaming-asr-provider-v2.schema.json`：`StreamingAsrAdapter v2` 供应商中立 lifecycle/result/drain/error 正式 Schema；
- `tencent-realtime-asr-v2.profile.json`：腾讯实时 ASR V2 正式 profile，含 verified/inference/unknown 及实际 query、参数省略和 canonical signature 规则；
- `streaming-asr-provider-v2.md`：v1→v2 迁移、腾讯映射、安全、指标、成本与真实 provider 验收的唯一技术契约。
