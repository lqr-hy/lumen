# Runtime 上下文工程技术方案

## 目标

为 `Lumen` 提供一套类似 Codex 的本地 runtime 上下文能力：页面聊天框可以选择 Codex、Claude Code、OpenAI/Anthropic 兼容服务和独立图片模型；Electron 主进程根据选择读取系统配置、本机环境变量或 Studio 配置，并代理请求。

本方案支持主进程本地配置 `~/.lumen/config.json`，并自动复用 Codex 与 Claude Code 的系统配置。应用运行时仍优先继承环境变量，Renderer 不接触配置文件或密钥。

当前项目是 Vite + React + Electron。本文描述的 Provider、IPC、Agent 与 Skill Runtime 已落地；文中的“后续扩展”仍是路线图。

项目快照、Artifact、Agent Run 检查点和取消协议见 [`agent-engineering-runtime.md`](agent-engineering-runtime.md)。Provider 公共状态包含 `chat/vision/structuredOutput/rasterImage` 能力位；推理模型通过 Pi Models 负责对话、规划和 Tool Calling，图片 Provider 通过 Pi ImagesModels 负责真实位图生成。

- 前端入口运行在 renderer 进程。
- Electron 主进程位于 `electron/main.mjs`。
- `electron/preload.mjs` 已通过 `contextBridge` 暴露了 `window.lumenElectron`。
- Renderer 的 `src/features/ai/api.ts` 只负责构造 IPC Payload，不读取 AI Key，也不直接访问模型 URL。

核心改造是：密钥只在 Electron 主进程读取，renderer 不直接接触 key；页面只传用户选择的 `provider/model` 和业务请求内容。

## 设计原则

1. 密钥不进入前端构建产物
   - 不使用 `VITE_*_KEY` 保存密钥。
   - 不通过 `import.meta.env` 暴露 key。
   - 不把 key 返回给 renderer。

2. 配置复用且不泄露密钥
   - 首次启动创建 `~/.lumen/config.json`，声明图片模型、Provider URL 与密钥环境变量名；也支持在主进程配置中直接填写 `apiKey`。
   - 自动读取 `~/.codex/config.toml` 当前 `model_provider`。
   - 自动读取 `~/.claude/settings.json` 的 Provider 环境配置。
   - 环境变量优先，任何密钥都不返回 Renderer。

3. 前端只传选择，不传凭证
   - renderer 调用 `window.lumenElectron.runtime.startStream(...)`。
   - 请求中包含 `provider`、`model`、`prompt`、画布上下文等。
   - 主进程负责查白名单、读环境变量、拼装认证头和请求协议。

4. provider 能力白名单内置在应用代码中
   - 聊天框展示 Codex、Claude Code 和图片模型选项。
   - 每个 provider 的协议和能力由应用代码定义；URL 可从受控本地配置解析。
   - renderer 不能任意传 URL、header 或 env key 名称。

## 环境变量设计

用户在本机 shell 中设置变量：

```bash
export AICODING_API_KEY="你的本地 key"
export ANTHROPIC_API_KEY="你的本地 key"
export OPENAI_API_KEY="你的本地 key"
export IMAGE_API_KEY="你的本地生图 key"
```

可选 base URL：

```bash
export AICODING_BASE_URL="https://your-codex-gateway.example/v1"
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export IMAGE_BASE_URL="https://your-image-api.example/v1"
```

`image` 不内置密钥；通过 `IMAGE_API_KEY`、Studio 配置中的 `apiKey` 或 `OPENAI_API_KEY` 提供。直接填写 `apiKey` 会以明文保存在本机配置文件中，应优先使用环境变量或系统 Keychain。

注意：macOS 双击打开 `.app` 时不一定继承 shell 环境变量。开发阶段建议从终端启动；正式方案可以提供启动脚本、登录项环境注入，或后续接入 Keychain。

## Provider Registry

Provider 的协议、模型和能力仍由应用代码形成可审计白名单；Base URL 与密钥环境变量名可以从主进程本地配置解析。

实现位置：

```text
electron/runtime/providers.mjs
```

示例：

```js
export const PROVIDERS = {
  codex: {
    label: 'Codex',
    wireApi: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'AICODING_BASE_URL',
    apiKeyEnv: 'AICODING_API_KEY',
    models: ['default', 'gpt-5', 'gpt-5-mini'],
  },
  claudeCode: {
    label: 'Claude Code',
    wireApi: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-1', 'claude-sonnet-4'],
  },
  openai: {
    label: 'OpenAI Compatible',
    wireApi: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'OPENAI_BASE_URL',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-5.5'],
  },
  anthropic: {
    label: 'Anthropic Compatible',
    wireApi: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-8'],
  },
  image: {
    label: 'Image',
    wireApi: 'openai_images',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'IMAGE_BASE_URL',
    apiKeyEnv: 'IMAGE_API_KEY',
    models: ['gpt-image-2', 'nano-banana-pro'],
  },
}
```

聊天框选择 provider/model 后，只传 provider id 和 model id：

```ts
type RuntimeModelSelection = {
  provider: 'codex' | 'claudeCode' | 'image'
  model: string
}
```

主进程按 provider id 查 registry，再按优先级解析环境变量与本地配置：

```js
const provider = PROVIDERS[payload.provider]
const runtime = resolveProviderRuntimeConfig(provider)
// 环境变量 > Studio config.json > Codex/Claude 系统配置 > 公共默认值
```

这样允许用户复用本机配置，同时不会允许 renderer 任意指定 URL、Header 或密钥值。

`openai` 与 `anthropic` 是通用兼容入口：它们允许在 Studio 配置中使用任意兼容服务 URL、环境变量名和模型 ID，但协议仍固定为 Responses 或 Anthropic Messages。完全不同协议的服务需要新增受控 Provider 适配器，不能只填一个 URL。

## Electron 架构

当前目录：

```text
electron/
  main.mjs
  preload.mjs
  runtime/
    providers.mjs
    env.mjs
    request.mjs
    agent.mjs
    agent-planner.mjs
    agent-tools.mjs
    agent-session-store.mjs
    skills.mjs
```

职责划分：

- `providers.mjs`
  - 维护 provider 白名单 registry。
  - 声明每个 provider 的模型列表、base URL 变量名、key 变量名和协议类型。

- `env.mjs`
  - 只读取 registry 中声明过的 `process.env`。
  - 返回脱敏状态，例如 `hasApiKey`、`baseUrlHost`。
  - 不向 renderer 返回 key。

- `request.mjs`
  - 单一 Runtime 请求入口，分发 Pi Agent、Pi 文本任务和 Pi ImagesModels。
  - 校验 Provider、模型、任务类型和能力，不实现 CLI 或手写推理流协议。

- `skills.mjs`
  - 扫描开发目录或 DMG Resources 中的 Skill。
  - 构建 Skill Catalog，支持自动/显式选择、激活和渐进读取引用资料。
  - Skill 不复制到临时 Job；Pi Agent 通过受控 Tool 直接读取已注册 Skill。

- `pi/*.mjs`
  - 组装 RuntimeContext，运行 Pi Agent，直接通过 URL + Key 调用 Pi Models。
  - 注册 Skill 与设计工作流工具，并镜像保存 Pi Session 消息。

- `agent*.mjs`
  - 作为 `studio_run_design_workflow` 内部的确定性领域执行器。
  - 保存 Goal、Plan、Observation、Checkpoint 和 Artifact，处理 ACK、重试及恢复。

当前支持的 `wireApi`：

- `openai-responses`：Codex / OpenAI Responses API，由 Pi 官方适配器执行；B 站 Codex Provider 仅增加网关要求的 Codex 请求体与 Header 映射。
- `anthropic-messages`：Claude / Anthropic Messages API，由 Pi 官方适配器执行。
- `openai_images`：OpenAI Images 兼容协议；无参考图调用 `/images/generations`，有参考图调用 `/images/edits`。

Codex Provider 不补写 terminal event。B 站网关必须返回真实的 `response.completed` 或
`response.incomplete`；HTTP 200 空 Body 会作为上游协议错误返回。当前 B 站 Key 不是 OpenAI OAuth
JWT，因此不使用 Pi 的 `openai-codex-responses` OAuth 适配器，而是在 Pi `openai-responses` 请求入口
映射网关所需的 `instructions`、`OpenAI-Beta`、`originator` 和 Session Header。

## 推理模型与生图模型

Renderer 分别提交两套选择：

```ts
{
  provider: 'codex',
  model: 'gpt-5.6-sol',
  imageProvider: 'image',
  imageModel: 'gpt-image-2',
}
```

- Conversation、Blueprint、VisualTheme 和 Pi Tool Calling 使用推理模型 `provider/model`。
- `generate_image`、`generate_assets` 使用 `imageProvider/imageModel`。
- Codex 当前模型读取 `~/.codex/config.toml` 顶层 `model`；Claude Code 读取 `settings.json` 的 `model` 或 `ANTHROPIC_MODEL`。
- 图片模型读取 Studio `config.json` 的 `providers.image.model/models`。
- `gpt-image-2` 与 `nano-banana-pro` 共用 `image` Provider、Base URL 和 Key，只切换请求体中的 `model`。
- 多素材任务通过 `imageTasks[]` 描述名称、目标尺寸、透明背景和独立提示词，主进程最多并发三张，按输入顺序返回。
- API 返回 URL 时主进程立即下载；最终统一为 Base64 Raster Artifact，Renderer 和检查点都不依赖远程 URL。
- Key 只用于主进程请求，公共状态仅返回 `hasApiKey`。

## IPC 接口

主进程注册流式入口：

```js
ipcMain.handle('runtime:getPublicState', async () => {
  return getPublicRuntimeState()
})

ipcMain.handle('runtime:startStream', async (event, payload) => {
  return startRuntimeStream(payload, {
    onToken: (token) => event.sender.send('runtime:streamToken', token),
    onAgentEvent: (agentEvent) => event.sender.send('runtime:agentEvent', agentEvent),
  })
})
```

preload 暴露：

```js
contextBridge.exposeInMainWorld('lumenRuntime', {
  getPublicState: () => ipcRenderer.invoke('runtime:getPublicState'),
  startStream: (payload) => ipcRenderer.invoke('runtime:startStream', payload),
})
```

renderer 使用：

```ts
const result = await window.lumenRuntime?.request({
  type: 'chat_edit',
  provider: selectedProvider,
  model: selectedModel,
  prompt,
  document,
  selectedElementIds,
  referenceImages,
  referenceImageNames,
})
```

公开状态只能包含：

```ts
type PublicRuntimeState = {
  providers: Array<{
    id: string
    label: string
    models: string[]
    baseUrlHost?: string
    wireApi: string
    hasApiKey: boolean
  }>
  skills: Array<{
    name: string
    description: string
    triggers: string[]
    tools: string[]
  }>
}
```

不得包含：

- API key
- 完整 Authorization header
- 原始环境变量快照
- 任意未声明的环境变量

## 画布放置上下文

Renderer 在请求前只提交只读 `CanvasContext`。Pi 在工具调用中输出动态 `placement`，Runtime 完成
Revision、目标归属和操作约束校验后，通过 Target Handshake 获得 `canvasTarget`：

```ts
type CanvasTarget = {
  artboardId: string
  createdForThread: boolean
  width: number
  height: number
  autoHeight?: boolean
  placementMode: 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
  placementSource: 'prompt' | 'control' | 'default'
  operationId: string
  leaseId: string
  documentRevision: number
}
```

输入框不要求用户选择放置模式。Agent 根据当前轮完整语义、画板候选和 Selection 动态选择
`create/insert/revise/variant/assets/resume`。`insert/revise/variant/resume` 缺少明确目标时直接失败，
不再默认 `append-section`，也不从历史线程静默选择画板。

`canvasTarget` 作为带版本的 Lease 记录在 Agent Session。继续和重试只能恢复有效 Lease；新建任务重新
规划目标。Provider 负责生成制品，实际创建画板、追加高度和放置节点仍由 Renderer Store 完成。

## Skill 与生产资源路径

开发环境从项目目录读取：

```text
<appRoot>/.agents/skills
<appRoot>/componentsJson
```

`electron-builder.extraResources` 在打包时复制到：

```text
process.resourcesPath/skills
process.resourcesPath/componentsJson
```

Skill 位于 `app.asar` 外部的只读应用资源中。Pi Agent 只获得 Skill Catalog，并通过受控 Tool 渐进激活正文或读取 references；API Key、环境变量快照和 Agent Session 不进入 Skill。详细规范见 [`runtime-skills.md`](runtime-skills.md)。

这套机制不改变凭证原则：Provider 只在 Electron 主进程读取环境变量与受控本地配置，Skill 和 Renderer 都不能读取或声明用户凭证。

## 前端迁移方案

`src/features/ai/api.ts` 只调用 Electron Runtime。非 Electron 环境明确返回“Runtime 不可用”，不再
保留浏览器 Copilot 直连或 `VITE_*` URL fallback，避免绕过 Provider 白名单、凭证隔离和 Pi Tool Calling。

## 流式响应

`ipcRenderer.invoke` 只适合一次性返回。若需要 token 级流式输出，推荐使用事件通道：

主进程：

```js
ipcMain.handle('runtime:startStream', async (event, payload) => {
  const streamId = crypto.randomUUID()
  startRuntimeStream(payload, {
    onToken: (token) => event.sender.send('runtime:streamToken', { streamId, token }),
    onDone: () => event.sender.send('runtime:streamDone', { streamId }),
    onError: (message) => event.sender.send('runtime:streamError', { streamId, message }),
  })
  return { streamId }
})
```

preload：

```js
contextBridge.exposeInMainWorld('lumenRuntime', {
  startStream: (payload) => ipcRenderer.invoke('runtime:startStream', payload),
  onStreamToken: (listener) => {
    const wrapped = (_event, data) => listener(data)
    ipcRenderer.on('runtime:streamToken', wrapped)
    return () => ipcRenderer.off('runtime:streamToken', wrapped)
  },
})
```

这样可以保持现有 `callbacks.onToken` 的交互体验。

## 安全边界

必须遵守：

- renderer 不允许读取任意环境变量。
- renderer 不允许传入任意 URL 让主进程代请求，避免 SSRF 风险。
- renderer 不允许传入任意 env key 名称，例如 `apiKeyEnv: 'HOME'`。
- 主进程只允许请求 provider registry 中声明的 base URL。
- 错误信息要脱敏，不能把 header、key、完整环境变量内容返回到页面。
- 日志中只输出 key 是否存在，不输出 key 值。

建议校验：

```ts
type RuntimeRequest = {
  type: 'chat_edit' | 'generate_design'
  provider: 'codex' | 'claudeCode'
  model: string
  prompt: string
  document?: unknown
  selectedElementIds?: string[]
  referenceImages?: string[]
  referenceImageNames?: string[]
}
```

不要让 renderer 直接传：

```ts
{
  url: 'https://...',
  headers: { Authorization: '...' },
  apiKeyEnv: 'AICODING_API_KEY'
}
```

## 错误提示

常见错误和用户提示：

- provider 不存在  
  `当前模型供应商未被应用支持：claudeCode2。`

- model 不存在  
  `当前模型不属于 Codex 可选列表：xxx。`

- 未设置 key  
  `未检测到 AICODING_API_KEY，请在 shell 配置中 export 后重启应用。`

- 网络失败  
  `AI 服务请求失败，请检查网络、base URL 或供应商服务状态。`

## 开发步骤

1. 新增 runtime provider registry
   - 新增 `electron/runtime/providers.mjs`
   - 声明 Codex、Claude Code、Copilot 等 provider
   - 声明每个 provider 的 env key 名称和默认 base URL

2. 新增环境变量读取模块
   - 只读取 registry 声明过的 `process.env`
   - 输出脱敏 public state
   - 缺 key 时返回明确错误

3. 新增主进程请求代理
   - 在 `electron/main.mjs` 注册 IPC handler
   - 根据 provider 选择 wire adapter
   - 根据 model 组装模型参数
   - 注入 API key

4. 扩展 preload
   - 暴露 `window.lumenRuntime`
   - 保留现有 `window.lumenElectron`

5. 修改前端 AI API
   - `applyChatEdit` 只走 Electron Runtime
   - 聊天框把 `provider/model` 放入 Runtime Request
   - 非 Electron 环境不发起模型请求

6. 增加类型声明
   - 在 `src/vite-env.d.ts` 增加 `Window.lumenRuntime`
   - 定义 request、stream、public state 类型

7. 增加文档说明
   - 在 README 或 docs 中列出支持的 provider、model 和 env 名称
   - 不提供真实 key 示例

## 验收标准

- 打包后的 `dist` 中搜索不到真实 API key。
- renderer 不能通过 DevTools 直接读取 key。
- 删除环境变量后，应用能明确提示缺少 key。
- 设置 `AICODING_API_KEY` 后，Codex provider 能成功请求。
- 设置 `ANTHROPIC_API_KEY` 后，Claude Code provider 能成功请求。
- 前端聊天面板仍能收到流式 token。
- 在聊天框切换 Codex / Claude Code / Copilot 后，主进程按 provider 读取对应环境变量。

## 后续扩展

- 支持应用内设置页展示 provider/env 检测状态，但不展示 key。
- 支持 macOS Keychain 读取密钥。
- 支持从用户 shell profile 启动应用时自动继承环境变量。
- 支持 provider 健康检查。
- 支持 runtime 环境变量变更后重启提示。
