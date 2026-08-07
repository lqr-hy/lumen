# Runtime 上下文工程技术方案

## 目标

为 `AI Campaign Page Studio` 提供一套类似 Codex 的本地 runtime 上下文能力：页面聊天框可以选择不同 provider/model，例如 Codex、Claude Code、Copilot；Electron 主进程根据选择直接读取本机环境变量中的 API 地址和 key，并代理请求。

本方案不引入项目自己的 `config.toml`。用户只需要在本机环境里配置变量，应用运行时继承这些变量。

当前项目是 Vite + React + Electron。本文描述的 Provider、IPC、Agent 与 Skill Runtime 已落地；文中的“后续扩展”仍是路线图。

项目快照、Artifact、Agent Run 检查点和取消协议见 [`agent-engineering-runtime.md`](agent-engineering-runtime.md)。Provider 公共状态包含 `chat/vision/svgDesign/rasterImage` 能力位；当前 Codex 负责对话、规划和 SVG 回退，`Bilibili Image / gpt-image-2` 负责真实位图生成。

- 前端入口运行在 renderer 进程。
- Electron 主进程位于 `electron/main.mjs`。
- `electron/preload.mjs` 已通过 `contextBridge` 暴露了 `window.aiCampaignElectron`。
- 当前 AI 请求在 `src/features/ai/api.ts` 中直接读取 `import.meta.env.VITE_COPILOT_API_URL` 并从浏览器侧请求接口。

核心改造是：密钥只在 Electron 主进程读取，renderer 不直接接触 key；页面只传用户选择的 `provider/model` 和业务请求内容。

## 设计原则

1. 密钥不进入前端构建产物
   - 不使用 `VITE_*_KEY` 保存密钥。
   - 不通过 `import.meta.env` 暴露 key。
   - 不把 key 返回给 renderer。

2. 不维护额外配置文件
   - 不新增 `~/.ai-campaign-page-studio/config.toml`。
   - 不要求用户维护 provider 配置。
   - 直接继承启动 Electron 进程时可见的 `process.env`。

3. 前端只传选择，不传凭证
   - renderer 调用 `window.aiCampaignRuntime.request(...)`。
   - 请求中包含 `provider`、`model`、`prompt`、画布上下文等。
   - 主进程负责查白名单、读环境变量、拼装认证头和请求协议。

4. provider 白名单内置在应用代码中
   - 聊天框可以展示 Codex、Claude Code、Copilot 等选项。
   - 每个 provider 的 `baseUrlEnv`、`apiKeyEnv`、`wireApi` 由应用代码定义。
   - renderer 不能任意传 URL、header 或 env key 名称。

## 环境变量设计

用户在本机 shell 中设置变量：

```bash
export AICODING_API_KEY="你的本地 key"
export COPILOT_API_KEY="你的本地 key"
export ANTHROPIC_API_KEY="你的本地 key"
export OPENAI_API_KEY="你的本地 key"
export BILI_IMAGE_API_KEY="你的本地生图 key"
```

可选 base URL：

```bash
export AICODING_BASE_URL="https://api-ai-coding.bilibili.co/api/v1/codex"
export COPILOT_API_URL="https://copilot.bilibili.co/api/v1/prediction/e3558bcf-64ee-4522-85a5-e07ccfc7d99f"
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export BILI_IMAGE_BASE_URL="http://llmapi.bilibili.co/v1"
```

`biliImage` 当前按项目要求内置了应用级默认 Key；`BILI_IMAGE_API_KEY` 仍可在运行时覆盖。其他 Provider 不得把真实 key 提交到仓库，也不要写进任何 `VITE_*` 变量。

注意：macOS 双击打开 `.app` 时不一定继承 shell 环境变量。开发阶段建议从终端启动；正式方案可以提供启动脚本、登录项环境注入，或后续接入 Keychain。

## Provider Registry

provider 不从用户配置文件读取，而是写在应用代码中，形成可审计的白名单。

实现位置：

```text
electron/runtime/providers.mjs
```

示例：

```js
export const PROVIDERS = {
  codex: {
    label: 'Codex',
    wireApi: 'responses',
    defaultBaseUrl: 'https://api-ai-coding.bilibili.co/api/v1/codex',
    baseUrlEnv: 'AICODING_BASE_URL',
    apiKeyEnv: 'AICODING_API_KEY',
    models: ['default', 'gpt-5', 'gpt-5-mini'],
  },
  claudeCode: {
    label: 'Claude Code',
    wireApi: 'anthropic_messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-1', 'claude-sonnet-4'],
  },
  copilot: {
    label: 'Copilot',
    wireApi: 'copilot_prediction',
    defaultBaseUrl: 'https://copilot.bilibili.co/api/v1/prediction/e3558bcf-64ee-4522-85a5-e07ccfc7d99f',
    baseUrlEnv: 'COPILOT_API_URL',
    apiKeyEnv: 'COPILOT_API_KEY',
    models: ['default'],
  },
  biliImage: {
    label: 'Bilibili Image',
    wireApi: 'openai_images',
    defaultBaseUrl: 'http://llmapi.bilibili.co/v1',
    baseUrlEnv: 'BILI_IMAGE_BASE_URL',
    apiKeyEnv: 'BILI_IMAGE_API_KEY',
    models: ['gpt-image-2', 'nano-banana-pro'],
  },
}
```

聊天框选择 provider/model 后，只传 provider id 和 model id：

```ts
type RuntimeModelSelection = {
  provider: 'codex' | 'claudeCode' | 'copilot' | 'biliImage'
  model: string
}
```

主进程按 provider id 查 registry，再读取环境变量：

```js
const provider = PROVIDERS[payload.provider]
const apiKey = process.env[provider.apiKeyEnv]
const baseUrl = process.env[provider.baseUrlEnv] || provider.defaultBaseUrl
```

这样既不需要 `config.toml`，也不会允许 renderer 任意指定 URL 或 key 名称。

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
  - 主进程实际发起网络请求。
  - 根据 `wireApi` 适配不同协议。
  - 注入认证头。
  - 处理流式响应。
  - 统一错误结构。

- `skills.mjs`
  - 扫描开发目录或 DMG Resources 中的 Skill。
  - 自动/显式选择 Skill，并复制到 Codex 隔离 Job。
  - 在 Electron Node Runtime 中执行受信任的 Skill Tool。

- `agent*.mjs`
  - 保存 Session、Goal、Plan、Reference、Observation 和 Artifact。
  - 驱动工具循环、超时、重试及“继续”恢复。

建议支持的 `wireApi`：

- `responses`：Codex / OpenAI Responses API 兼容协议。
- `anthropic_messages`：Claude / Anthropic Messages API 兼容协议。
- `copilot_prediction`：当前 Copilot prediction 接口协议。
- `openai_images`：OpenAI Images 兼容协议；无参考图调用 `/images/generations`，有参考图调用 `/images/edits`。

## 推理模型与生图模型

Renderer 分别提交两套选择：

```ts
{
  provider: 'codex',
  model: 'gpt-5.6-sol',
  imageProvider: 'biliImage',
  imageModel: 'gpt-image-2',
}
```

- Conversation、Blueprint、VisualTheme、ReAct Decision 使用推理模型 `provider/model`。
- `generate_image`、`generate_assets` 使用 `imageProvider/imageModel`。
- `gpt-image-2` 与 `nano-banana-pro` 共用 `biliImage` Provider、Base URL 和 Key，只切换请求体中的 `model`。
- 多素材任务通过 `imageTasks[]` 描述名称、目标尺寸、透明背景和独立提示词，主进程最多并发三张，按输入顺序返回。
- API 返回 URL 时主进程立即下载；最终统一为 Base64 Raster Artifact，Renderer 和检查点都不依赖远程 URL。
- Key 只用于主进程请求，公共状态仅返回 `hasApiKey`。

## IPC 接口

主进程注册：

```js
ipcMain.handle('runtime:getPublicState', async () => {
  return getPublicRuntimeState()
})

ipcMain.handle('runtime:request', async (_event, payload) => {
  return requestWithRuntime(payload)
})
```

preload 暴露：

```js
contextBridge.exposeInMainWorld('aiCampaignRuntime', {
  getPublicState: () => ipcRenderer.invoke('runtime:getPublicState'),
  request: (payload) => ipcRenderer.invoke('runtime:request', payload),
})
```

renderer 使用：

```ts
const result = await window.aiCampaignRuntime?.request({
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

Renderer 在请求前解析用户希望把结果放到哪里，并通过 `canvasTarget` 把确定后的目标传给 Runtime：

```ts
type CanvasTarget = {
  artboardId: string
  createdForThread: boolean
  width: number
  height: number
  autoHeight?: boolean
  placementMode: 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
  placementSource: 'prompt' | 'control' | 'default'
}
```

输入框提供 `自动 / 新页面 / 当前画板 / 新变体 / 素材` 五段控件。自动模式先识别本轮自然语言；明确提示词始终高于控件，避免用户说“再生成一个页面”时仍误写到旧画板。自然语言和控件都没有明确指定时，默认使用 `append-section`；若该对话没有目标画板，则自动创建 `375 x 812` 标准画板。

`canvasTarget` 属于 Agent Session 上下文。首次请求、继续执行和失败重试都使用同一 `artboardId` 与 `placementMode`，Provider 只负责生成符合模式的 SVG 制品，实际创建画板、追加高度和放置图片仍由 Renderer Store 完成。

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

Skill 位于 `app.asar` 外部的只读应用资源中。每次 Codex Job 只获得所选 Skill 的副本，API Key、环境变量快照和 Agent Session 不会复制进 Skill。详细规范见 [`runtime-skills.md`](runtime-skills.md)。

这套机制不改变凭证原则：Provider 仍直接读取 Electron 进程可见的本地环境变量，不增加 `config.toml`，Skill 也不能读取或声明用户凭证。

## 前端迁移方案

当前 `src/features/ai/api.ts` 中的 `readCopilotStream` 直接访问 `COPILOT_API_URL`。改造后建议分两步：

1. 抽象 AI transport

```ts
type AiTransport = {
  readChatEditStream(request: ChatEditRequest, callbacks: ChatEditCallbacks): Promise<string>
}
```

2. Electron 环境优先走 runtime

```ts
if (window.aiCampaignRuntime) {
  return readRuntimeStream(request, callbacks)
}

return readBrowserFallbackStream(request, callbacks)
```

浏览器 fallback 可以继续使用 `VITE_COPILOT_API_URL`，但只能用于无密钥、测试或内部可公开接口。

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
contextBridge.exposeInMainWorld('aiCampaignRuntime', {
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
  provider: 'codex' | 'claudeCode' | 'copilot'
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
   - 暴露 `window.aiCampaignRuntime`
   - 保留现有 `window.aiCampaignElectron`

5. 修改前端 AI API
   - `applyChatEdit` 优先走 Electron runtime
   - 聊天框把 `provider/model` 放入 runtime request
   - 非 Electron 环境保留现有 Copilot fallback

6. 增加类型声明
   - 在 `src/vite-env.d.ts` 增加 `Window.aiCampaignRuntime`
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
