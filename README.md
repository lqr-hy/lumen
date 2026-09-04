# AI Campaign Page Studio

基于 React 19、Electron 和 Pi Agent Runtime 的 AI 设计工具。用户可以通过自然语言、参考图和可选业务组件生成可编辑设计稿，并在画布中继续调整、局部重生成和导出。

项目当前同时支持三类设计任务：

- 通用 UI：后台管理系统、Web、H5 和 App 页面，生成原生可编辑节点。
- 业务组件：通过 Component Pack、组件 Schema、Runtime DOM 或 thumbnail 生成可编辑组件，并维护 Props 与图片 Slot 绑定。
- 位图设计：KV、海报、插画、透明素材和局部图片编辑，以 Raster Composition 方式交付。

当前能力状态以 [docs/capability-status.md](docs/capability-status.md) 为准。

## 核心架构

```text
聊天输入 / 图片 / 组件引用
  -> Pi Agent 选择高层工作流
  -> Source Adapter
  -> 通用 UI: Static HTML/CSS Runtime Draft
  -> Electron Sandbox DOM / ComputedStyle Inspection
  -> Canonical Scene Graph
  -> Design Transform / Validate
  -> Canvas Transaction + ACK
  -> 可编辑 DesignDocument / 导出包
```

关键边界：

- 通用 UI 和组件 Editable Scene 以原生画布节点作为唯一视觉事实源。
- 通用 UI 采用 Render First，DesignSpec 只作为内容清单和失败降级；复杂工具界面不再由固定 Block Renderer 决定布局。
- Runtime Draft 只执行静态 HTML/CSS，禁止模型脚本、导航和任意网络请求。
- 图片模型只生成明确需要位图的叶子素材，不生成覆盖整个组件的 Visual Shell。
- 完整页面可以保留独立 Page Shell 作为页面背景。
- KV、海报等整图任务使用单张 Raster，不伪装为可编辑 UI 节点。
- Component Pack 是可选插件能力，不影响普通 UI 设计工作流。

## 技术栈

- React 19、TypeScript、Vite 7
- Electron 43
- Zustand、Lexical、Moveable、Framer Motion
- `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`
- SQLite Agent Session、Artifact Repository、可恢复 Workflow Graph

## 本地开发

要求：

- Node.js 22，或满足 Vite 7 要求的 Node.js 20.19+
- npm
- macOS DMG 打包需要 macOS 环境

安装依赖：

```bash
npm install
```

完整桌面端开发需要两个终端：

```bash
# 终端 1：Renderer
npm run dev

# 终端 2：Electron 主进程
npm run electron:dev
```

默认 Renderer 地址为 `http://localhost:5173`。

只执行 `npm run dev` 会打开浏览器版界面，但完整 AI Runtime、IPC、用户 Skill、项目持久化和本地凭证隔离依赖 Electron 主进程。浏览器版目前主要用于 UI 开发和 Style Pack 预览。

## 模型配置

Renderer 不读取 API Key。Electron 主进程从启动进程的环境变量读取凭证，并通过内置 Provider 白名单发起请求。

常用变量：

| 用途         | Provider     | Base URL              | API Key                 |
| ------------ | ------------ | --------------------- | ----------------------- |
| Codex 推理   | `codex`      | `AICODING_BASE_URL`   | `AICODING_API_KEY`      |
| Claude 推理  | `claudeCode` | `ANTHROPIC_BASE_URL`  | `ANTHROPIC_AUTH_TOKEN`  |
| Copilot 推理 | `copilot`    | `COPILOT_API_URL`     | `COPILOT_API_KEY`，可选 |
| 图片生成     | `biliImage`  | `BILI_IMAGE_BASE_URL` | `BILI_IMAGE_API_KEY`    |

示例：

```bash
export AICODING_BASE_URL="http://api-ai-coding.bilibili.co/api/v1/codex"
export AICODING_API_KEY="your-key"
export BILI_IMAGE_BASE_URL="http://llmapi.bilibili.co/v1"
export BILI_IMAGE_API_KEY="your-image-key"

npm run electron:dev
```

不要把真实 Key 写入 `VITE_*` 变量。`VITE_*` 会进入前端构建产物并出现在浏览器网络请求中。完整配置和安全边界见 [docs/runtime-context.md](docs/runtime-context.md)。

## 常用命令

```bash
npm run dev                 # 启动 Vite Renderer
npm run electron:dev        # 启动 Electron 桌面端
npm run build               # 类型检查并构建 Renderer
npm run build:dmg           # 构建 macOS DMG
npm run lint                # ESLint
npm run test:all            # 非 E2E 全量回归、Lint 和 Build
npm run test:e2e            # Playwright E2E
```

按领域运行测试：

```bash
npm run test:pi-runtime
npm run test:scene-graph
npm run test:generic-ui-incremental
npm run test:component-design
npm run test:component-canvas
npm run test:component-export
npm run test:page-agent
```

## 目录结构

```text
src/                         React Renderer、画布、聊天和属性面板
electron/                    Electron 主进程、IPC、Provider 和 Agent Runtime
electron/runtime/pi/         Pi Models、Agent、上下文和 Session
electron/runtime/plugins/    Runtime Plugin 与 Source Adapter 注册
.agents/skills/              内置设计 Skill
component-packs/             可选业务组件 Pack
componentsJson/              组件 Schema 和示例数据
style-packs/                 内置声明式设计风格
scripts/                     领域测试和验证脚本
docs/                        架构、协议和能力状态文档
```

打包后的 Skill、Component Pack 和 Style Pack 位于应用 `Resources`。用户安装的扩展、项目、Agent Session 和 Artifact 写入 Electron `userData`，不会修改应用安装目录。

## 文档入口

- [技术文档索引](docs/README.md)
- [当前能力状态](docs/capability-status.md)
- [Scene Graph 与 Source Adapter](docs/scene-graph-adapter-architecture.md)
- [Pi Runtime 重构](docs/pi-runtime-refactor.md)
- [自然语言 Agent](docs/natural-language-conversation-agent.md)
- [通用 UI 工作流](docs/generic-ui-design-workflow.md)
- [组件设计能力](docs/component-design-capability.md)
- [Skill 与 Style Pack](docs/user-skill-and-style-pack.md)

## 验证基线

提交前至少运行：

```bash
npm run test:all
git diff --check
```

涉及交互或 Electron IPC 的改动，还应按对应领域文档执行人工桌面端验证。
