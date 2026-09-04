# Pi Agent Runtime 重构方案

> 状态：Pi 原生 Runtime 已完成  
> 版本基线：2026-08-07

## 1. 决策

应用采用 `@earendil-works/pi` 生态作为通用模型和 Agent Runtime，但不嵌入完整
`pi-coding-agent`。设计领域的 Blueprint、Props Patch、Canvas Deliverable、Renderer ACK、
Artifact、质量门禁和导出继续由本项目维护。

依赖固定为：

```json
{
  "@earendil-works/pi-ai": "0.84.0",
  "@earendil-works/pi-agent-core": "0.84.0",
  "@earendil-works/pi-session-backend-sqlite-node": "0.84.0"
}
```

禁止使用 `^`。npm 上 SQLite Backend `0.84.1` 依赖尚未发布的
`pi-agent-core ^0.84.1`，当前不可采用。Pi 要求 Node `>=22.19.0`；项目开发 Node
`22.23.2` 和 Electron 43 满足要求。

## 2. 采用与排除

| 包 | 决策 | 用途 |
| --- | --- | --- |
| `pi-ai` | 采用 | 推理 Provider、模型目录、Thinking、Tool Calling、ImagesModels |
| `pi-agent-core` | 采用 | Agent Loop、状态、事件、Continue、Abort、Steering、Follow-up |
| `pi-session-backend-sqlite-node` | 采用 | Session Repository、迁移、搜索；只保存 Agent 消息和轻量状态 |
| `pi-telemetry` | 间接依赖 | 暂不建立上传链路，只保留本地诊断映射 |
| `pi-protocol` / `pi-client` | 暂不采用 | 未来拆分远程 Runtime 时再评估 |
| `pi-server` | 不采用 | 官方标记 Experimental，不能作为生产依赖 |
| `pi-coding-agent` | 不采用 | Bash/文件编辑工具与设计应用权限边界不匹配 |
| `pi-tui` / `pi-web-ui` | 不采用 | 已有 React 画布和聊天 UI，Web UI 版本也未同步 |

## 3. 目标架构

```text
React Renderer
  -> Electron IPC
  -> StudioAgentRuntime（项目稳定接口）
     -> PiAgentAdapter（pi-agent-core）
        -> PiModelRegistry（pi-ai Models / ImagesModels）
        -> StudioAgentTool[]（现有 Tool Registry 适配）
     -> DesignWorkflowEngine（现有确定性 Plan / Checkpoint）
        -> Canvas Deliverable -> Renderer ACK
        -> Artifact Repository
        -> Component/Page Quality Gate
     -> Pi Session SQLite + Project/Artifact Repository
```

`StudioAgentRuntime` 是防腐层。Renderer、DesignDocument 和领域工具不得直接依赖 Pi 类型，
以后替换 Pi 只需更改适配层。

## 4. 双模型 Runtime

- 推理模型使用 Pi `Models`：Codex 通过 OpenAI Responses，Claude 通过 Anthropic Messages，Copilot 通过直接 Prediction Provider。
- 生图模型使用 Pi `ImagesModels`：`gpt-image-2`、`nano-banana-pro`。
- B 站接口注册为自定义 Provider，Base URL、Key 和模型白名单仍由 Electron 主进程控制。
- 图片 API 返回后立即转为 Raster Artifact；Base64 不写入 Agent Message 或 Tool Observation。
- Pi 内置图片 Provider 当前只覆盖 OpenRouter，因此 B 站 ImagesProvider 由项目实现。
- 所有 Provider 都由 Electron 主进程使用 URL 和 Key 直接请求；不启动 Codex CLI，不创建任务临时目录。

## 5. 混合 Agent 策略

Pi Agent 原生接收模型文本和 Tool Call，暴露三个受控工具：

```text
skill_activate
skill_read_resource
studio_run_design_workflow
```

模型自行决定正常回复、激活 Skill 或执行设计工作流，不再预先生成 Conversation Decision 后合成
Tool Call。`RuntimeContextAssembler` 统一提供会话、画布、选择、引用图和已选 Skill 摘要。
设计执行进入高层工具后，仍由确定性 Plan 处理页面组件、增量交付、ACK、失败重试和 Repair。

工具完成后返回 `terminate: true`，避免为了总结再次请求推理模型。Blueprint 等待确认仍由项目
Session 标记为 `awaiting-confirmation`；用户下一轮确认后，领域工作流从检查点恢复。

## 6. Tool 适配与安全

高层工作流包装为 Pi `AgentTool`，参数使用 TypeBox：

- `beforeToolCall`：验证工具白名单、当前画板、EditScope、Session 所有权和参数上限。
- `execute`：调用现有 Tool Registry；写操作使用 `sequential`，纯读取和独立生图可并行。
- Tool Result：脱敏结果，只保存摘要，不保存 Artifact Base64；Canvas 写入仍必须包含成功 ACK。
- `runId + toolCallId + targetId` 形成幂等键，重复调用返回已完成 Observation。
- 工具超时、Provider 重试和取消信号继续由项目包装层控制。

Pi 不提供权限沙箱。应用禁止注册 Bash、任意文件读写、任意 URL 请求和凭证读取工具。

## 7. 状态与持久化

Pi SQLite 当前镜像保存 Session 元数据和本轮 LLM Message、Tool Call/Result；图片只保存附件占位，
不写入 Base64。项目 Repository 继续保存 DesignDocument、Step Checkpoint、Canvas Observation、
Blueprint、Repair 状态、Artifact 内容和导出文件。

领域恢复始终以项目 Session 和 Artifact Repository 为真相源，Renderer 提供的历史用于重建 Pi
Agent State。应用重启时持久化的 running 状态统一转为 interrupted，不声称后台仍在执行。

## 8. 事件映射

```text
pi agent_start               -> task.started
pi turn_start                -> agent.turn.started
pi message_update            -> runtime:streamToken
pi tool_execution_start      -> step.started
pi tool_execution_update     -> step.progress
pi tool_execution_end        -> step.completed / observation
pi agent_end                 -> task.completed / task.waiting
```

Renderer 继续消费现有 IPC 事件，避免 UI 与 Pi 强绑定。

## 9. 实施结果

1. [x] Pi Models 直接请求 URL/Key，Codex CLI 和手写协议 Transport 已删除。
2. [x] Pi Agent 原生处理文本、Skill Tool Call 和设计 Tool Call。
3. [x] B 站生图包装为 ImagesProvider，保留 Raster Artifact 校验。
4. [x] RuntimeContextAssembler 收拢会话、画布、选择、引用图和 Skill 上下文。
5. [x] Skill Catalog、自动选择、显式激活和渐进资源读取已接入。
6. [x] SQLite Session 消息镜像、图片脱敏和 Abort 已接入。
7. [x] Legacy Runtime 开关、Codex Job、Skill staging 和 CLI 输出文件协议已删除。
8. [x] Pi `transformContext`、Token 估算、旧 Turn 摘要和 Tool Result 预算已接入。
9. [x] 当前消息、历史和 Skill 正文的重复 System Prompt 注入已删除。

## 10. 验收标准

1. 推理与生图模型选择行为不变，Key 不进入 Renderer、消息和 Session。
2. 普通聊天、Tool Call 和停止通过 Pi 事件链工作；确认恢复保持现有领域语义。
3. 页面与组件生成仍满足 Blueprint、增量 ACK、Props Patch 和质量门禁。
4. 应用重启后不重复已完成组件，不丢失 Artifact，不恢复不存在的后台进程。
5. Pi Runtime 的领域结果通过 Agent、组件、页面和导出测试。
6. `npm run test:all`、E2E、生产构建和 DMG 全部通过。

## 11. 已落地代码

| 能力 | 实现位置 | 验证 |
| --- | --- | --- |
| Pi Models / ImagesModels 直连 | `electron/runtime/pi/model-runtime.mjs` | `test:pi-direct`、`test:image-provider`、`test:pi-runtime` |
| Pi 原生 Agent 与受控 Tool | `electron/runtime/pi/agent-runtime.mjs` | `test:pi-runtime` |
| RuntimeContext | `electron/runtime/pi/context-runtime.mjs` | `test:pi-runtime` |
| 上下文预算与 Pi Compaction | `electron/runtime/pi/context-policy.mjs` | `test:pi-context` |
| 结构化文本任务 | `electron/runtime/pi/task-runtime.mjs` | Agent/组件/Page 回归 |
| Skill Catalog 与渐进读取 | `electron/runtime/skills.mjs` | `test:pi-runtime` |
| Abort 路由 | `electron/runtime/pi/cancellation.mjs` | `test:pi-runtime` |
| SQLite Session 镜像 | `electron/runtime/pi/session-store.mjs` | `test:pi-runtime` |
| 单一 Pi 请求入口 | `electron/runtime/request.mjs` | `test:pi-runtime` |
| Design Eval 与局部 Repair | `electron/runtime/design-eval.mjs` | `test:design-eval`、`test:page-agent` |
| B 站 Codex Responses 协议映射 | `electron/runtime/pi/model-runtime.mjs` | `test:pi-direct`、真实网关探测 |

Codex 推理仍由 Pi `Models` 和 `openai-responses` API 执行。B 站 Codex Key 不是
`openai-codex-responses` 所要求的 OpenAI OAuth JWT，因此不能直接使用该适配器；Provider 层只负责把
Pi 请求映射为网关要求的 Codex 请求契约：`instructions`、`text.verbosity`、`include`、
`parallel_tool_calls`、`OpenAI-Beta`、`originator` 和标准 Session Header。模型事件、Tool Call、流解析和
Agent Loop 均由 Pi 管理。

旧的 terminal event 补写逻辑已删除。Provider 不伪造 `response.completed`；网关必须返回真实 terminal
event。HTTP 200 空 Body 会转换为明确的中文上游协议错误，不再暴露 Pi 内部的英文解析错误。

专项回归命令：

```bash
npm run test:pi-runtime
npm run test:pi-direct
```

## 12. 2026-08-07 验证结果

- Pi 普通回复流、Agent 生命周期、原生 Tool、领域工作流和 SQLite Session：通过。
- OpenAI Responses 直连 URL、Key、Session Header/Body 与 SSE 文本流：通过。
- `gpt-image-2`、`nano-banana-pro`、Generation、Edit、多素材和 Raster Artifact：通过。
- Agent、组件、页面、导出、Runtime Adapter、Lint 和生产构建回归：通过。
- Playwright 桌面与 390px 兼容视口：4/4 通过；设计画板宽度仍为 375px。
- Electron arm64 DMG：构建通过，产物为 `release/AI Campaign Page Studio-0.1.0-arm64.dmg`。

Node 22 执行 SQLite 专项测试时会输出 `node:sqlite` ExperimentalWarning，这是 Node 当前 API
状态提示，不影响测试和 Electron 43 打包结果。
