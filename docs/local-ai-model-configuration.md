# 本地 AI 模型配置

本项目把本地模型入口统一放在仓库根目录的 `.env.local`。该文件会被 Git 忽略，可以直接
修改后重启本地服务；不要把真实 API Key 写进本文件、`.env.example`、日志、提交或截图。

## 当前生效状态

| 模型职责 | 当前运行时 | 修改配置是否生效 |
| --- | --- | --- |
| Director | 第三方 Anthropic Messages 或 OpenAI-compatible Chat Completions | 是，仅 `pnpm checkpoint-a:start` |
| P1 Working Memory | 本地确定性 Provider | 否，配置位预留但未激活 |
| P2 consolidation | Provider 接口和确定性测试实现，尚未接入应用运行时 | 否，配置位预留但未激活 |

P1、P2 真正接入外部模型需要各自的 Prompt、输出校验、Provider adapter、运行时绑定和测试，
不能只靠填写 API Key 激活。生产 Provider、模型和数据策略仍未在此决定。

## `.env.local` 配置块

把下面两组中的一组放进现有 `.env.local`。不要写 `$env:`，不要加 PowerShell 引号，也
不要同时配置两组。第三方平台给出的模型 ID 必须原样填写。

### AgentRouter + Claude（Anthropic Messages）

```dotenv
ANTHROPIC_AUTH_TOKEN=你的AgentRouter_API_KEY
ANTHROPIC_BASE_URL=https://co.agentrouter.org
ANTHROPIC_MODEL=claude-opus-4-8
```

这就是三项完整配置。程序会自动使用 Anthropic Messages 协议并请求 `/v1/messages`。

### AgentRouter + DeepSeek（OpenAI Chat Completions）

```dotenv
OPENAI_API_KEY=你的AgentRouter_API_KEY
OPENAI_BASE_URL=https://co.agentrouter.org/v1
OPENAI_MODEL=你的AgentRouter账户实际可用的DeepSeek模型ID
```

AgentRouter 的模型可用性跟 API Key 对应的资源池有关，所以 DeepSeek 的精确 ID 应以账户
模型页或 `/v1/models` 返回值为准，不能由项目猜测。

### P1、P2、Director 的模型位置

使用同一个网关，但将来需要为三个职责选择不同模型时，位置统一写在同一文件：

```dotenv
# 当前生效：覆盖共享的 ANTHROPIC_MODEL 或 OPENAI_MODEL
# AI_DIRECTOR_MODEL=精确模型ID

# RESERVED / INACTIVE: P1
# AI_P1_MODEL=第三方平台提供的精确模型ID

# RESERVED / INACTIVE: P2
# AI_P2_MODEL=第三方平台提供的精确模型ID
```

P1、P2 的覆盖变量当前只用于占位说明，不会触发外部调用。

### 高级自定义模式

只有第三方网关不能使用上面的标准变量组时，才需要原来的四项：

```dotenv
AI_DIRECTOR_API_PROFILE=openai_chat_completions
AI_DIRECTOR_ENDPOINT=https://第三方平台完整地址/v1/chat/completions
AI_DIRECTOR_MODEL=第三方平台提供的精确模型ID
AI_DIRECTOR_API_KEY=第三方平台提供的API_KEY
```

`AI_DIRECTOR_API_PROFILE` 用来区分普通 OpenAI Chat Completions 与需要额外路由字段的
OpenRouter-compatible 请求。使用标准 `ANTHROPIC_*` 或 `OPENAI_*` 三变量组时无需填写它。

远程 endpoint 必须使用 HTTPS，且 URL 内不得嵌入用户名、密码、查询参数或片段。本机回环
地址允许 HTTP，方便本地兼容服务。API Key 只进入 API 进程，不会传给 Workbench，也不会
进入模型配置摘要。

如果现有 `.env.local` 只有旧的 `OPENROUTER_API_KEY`，本版本会把它作为 Director Key 的
兼容回退，不需要复制或暴露其值；以后手动把变量名改成 `AI_DIRECTOR_API_KEY` 即可。

## 更换模型

1. 停止当前 `pnpm checkpoint-a:start` 进程。
2. 修改 `.env.local` 中所选三变量组的 Base URL、模型或 Key。
3. 重新运行 `pnpm checkpoint-a:start`。

当前只有 Director 执行第 2 步后会改变实际调用。配置缺失、endpoint 不安全、第三方服务
超时、返回非 JSON 或输出不符合 Director Schema 时，系统会保持失败关闭；录音与最终转录
不得因此停止或损坏。
