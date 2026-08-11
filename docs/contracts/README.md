# 机器可读契约目录

本目录用于保存可被代码生成器、契约测试和 Agent 直接读取的正式契约。

文件状态逐项声明，不能再把整个目录一概视为占位。标记为正式候选的文件只有在对应 SPEC 获项目负责人审查 PASS 并合并后才成为正式机器契约；其余文件仍不得用于代码生成或运行时校验。

- `openapi.yaml`：REST API 的机器可读定义；
- `websocket-events.md`：实时事件目录及其 Schema 文件索引；
- `interview-recorder-output.schema.json`：访谈记录员结构化输出；
- `interview-director-context.schema.json`：`InterviewDirectorContextV1`，SPEC-QUESTION-DIRECTOR-001 正式候选；是 Director 实际输入字段、类型、必填性、枚举和边界的唯一技术结构；
- `interview-director-output.schema.json`：`InterviewDirectorOutputV1`，SPEC-QUESTION-DIRECTOR-001 正式候选；是 Director 实际输出字段、类型、必填性、枚举和交叉约束的唯一技术结构；
- `export-manifest.schema.json`：导出资料包清单。
