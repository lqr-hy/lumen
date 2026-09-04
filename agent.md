# AI Campaign Page Studio Agent Runtime 技术方案

## 1. 目标

将当前“一次输入、一次模型回复”的 Runtime 升级为由应用托管的 Agent Runtime，使任务能够规划、调用工具、读取工具结果、继续执行、失败重试和跨消息恢复。

首个完整闭环是：用户提供 KV 与原型图，Agent 生成一张完整设计图并作为单个图片节点放入画布。架构必须能够继续扩展到画布分析、改图、导出和文件处理，而不是为“请继续”增加孤立关键词。

当前实施状态统一以 [`docs/capability-status.md`](docs/capability-status.md) 为准。当前已落地自然语言 Conversation Decision、受约束 ReAct NextAction、成功/失败 Observation、Decision/Repair Loop、Step 输入/输出哈希、可编辑 Blueprint、page-shell EditScope、Vision Review 接口、SHA-256 内容寻址存储、项目版本恢复、Electron Component Sandbox、开发包 v3、Auto Layout/Crop/文字溢出和 Chrome E2E。ReAct 详细协议见 [`docs/natural-language-conversation-agent.md`](docs/natural-language-conversation-agent.md)。

## 2. 原始问题（已作为实施基线）

当前调用链为：

```text
用户输入 -> applyChatEdit -> Runtime Provider -> 一段文本 -> 结束
```

主要缺口：

1. 没有持久化 Agent Session，`sessionId` 只是请求字段。
2. 没有 Goal、Plan、Step、Observation 和 Artifact。
3. 没有 Loop Engine，模型说“接下来会执行”不会触发工具。
4. 当前附件发送后从输入态清空，后续“继续”无法稳定复用参考图。
5. 普通聊天和任务执行共用一次性文本协议。
6. 前端只接收 token，没有计划、工具、制品和任务状态事件。
7. Codex 使用 `--ephemeral`，应用未保存可恢复的工程状态。

## 3. 设计原则

1. 应用拥有任务状态，不能把执行状态寄托在模型自然语言中。
2. Provider 负责推理，Tool 负责副作用，Loop Engine 负责推进。
3. 普通聊天不修改画布；只有 Artifact 事件可以产生画布变更。
4. Agent Action 与 DesignDocument 解耦，不恢复旧 operations/H5 生成协议。
5. 所有任务都有循环上限、超时、失败状态和可重试检查点。
6. Provider、模型和凭证继续从本地环境选择，不引入业务 config.toml。
7. 参考图按任务持久化；新原型可以替换旧原型，KV 可以继续复用。

## 4. 总体架构

```text
Renderer
  -> runtime:startStream(type=agent_run)
Electron Agent Runtime
  -> Session Store
  -> Turn Planner
  -> Conversation Decision
  -> ReAct NextAction / Ready Tool Graph
  -> 单工具 Loop Engine
  -> Tool Registry
       -> reference.prepare
       -> design.generate
       -> artifact.validate
       -> canvas.present
       -> Skill Runtime Tools
  -> Skill Registry
       -> 自动/显式选择 Skill
       -> Session 保留 Skill 名称
       -> 隔离 Job 暂存 Skill
  -> Provider Adapter
       -> Codex CLI
       -> Claude Messages
       -> Copilot
  -> Agent Events
Renderer
  -> 文本消息 / 执行状态 / Deliverable 增量落画布
  -> Canvas Postcondition ACK / Observation
```

Skill 的目录、发现、DMG 打包和 Runtime Tool 规范见
[`docs/runtime-skills.md`](docs/runtime-skills.md)。组件设计领域能力见
[`docs/component-design-capability.md`](docs/component-design-capability.md)。
设计稿 Blueprint、质量审查、自动修正、生成元数据和导出闭环见
[`docs/ai-design-generation.md`](docs/ai-design-generation.md)。
项目持久化、Artifact 仓库、检查点恢复和取消协议见
[`docs/agent-engineering-runtime.md`](docs/agent-engineering-runtime.md)。

## 5. 核心数据结构

### 5.1 Agent Session

```ts
interface AgentSession {
  id: string
  goal?: string
  status:
    | 'idle'
    | 'collecting'
    | 'ready'
    | 'planning'
    | 'running'
    | 'waiting-user'
    | 'failed'
    | 'completed'
  plan: AgentStep[]
  currentStepId?: string
  references: AgentReference[]
  artifacts: AgentArtifactMeta[]
  observations: AgentObservation[]
  skills: string[]
  lastError?: AgentError
  createdAt: string
  updatedAt: string
}
```

Session 以聊天线程 ID 为主键，持久化到 Electron `userData/agent-sessions`。MVP 可以在 JSON 中保存 Data URL；后续迁移为文件制品仓库。

### 5.2 Plan 与 Step

```ts
interface AgentStep {
  id: string
  title: string
  tool: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: unknown
  observationId?: string
}
```

图片任务的默认计划：

1. 准备并识别参考图。
2. 生成结构化 Design Blueprint。
3. 生成完整静态设计图或局部模块。
4. 审查 SVG 尺寸、内容和安全性。
5. 必要时携带问题列表自动修正一次。
6. 验证最终 SVG 制品。
7. 将制品交给画布展示。

### 5.3 Reference

```ts
interface AgentReference {
  id: string
  name: string
  role: 'kv' | 'prototype' | 'visual' | 'unknown'
  data: string
  mime: string
  updatedAt: string
}
```

规则：

- 明确标记为原型图的新附件替换旧 prototype。
- 明确标记为 KV 的新附件替换旧 KV。
- 未指定角色的附件保留为 visual/unknown。
- 任务执行时从 Session 组装全部有效参考图，不依赖当前输入框附件。

## 6. Conversation Decision 与 Turn Planner

模型优先判断“回复、澄清还是执行”，Turn Planner 将已校验 Decision 转成受控依赖图，不生成页面节点。模型不可用或 Decision 非法时才使用本地 Intent Router。

优先级：

1. 明确生成命令：创建/更新 Goal，生成 Plan，立即运行。
2. 设计修订命令：“完善、优化、重做、重新实现、按建议修改”等在已有 Goal、组件约束或选中组件实例时创建新 Run，禁止降级为建议回复。
3. 新参考图修正：更新 Session Reference；如果存在 Goal，状态变为 ready。
4. “继续/开始/执行/重试”：存在 ready/failed Session 时恢复运行。
5. 普通问答：调用聊天 Provider，不改变任务状态。
6. 没有可恢复任务时的“继续”：回复需要明确目标，不伪造执行承诺。

Planner 必须区分疑问和祈使语义：`如何优化这个设计稿` 属于咨询，`优化一下这个设计稿` 属于执行。Loop Engine 只处理已经进入 Run 的任务；若 Planner 错误返回 `chat`，后续 Tool Loop 不会自行启动。

## 7. ReAct Loop Engine

```text
load session
plan turn
while session is running and iteration < maxIterations
  calculate ready steps
  ask model for one NextAction
  validate tool against ready steps / inspect tools
  emit step.started
  execute tool
  save structured observation
  emit step.completed / step.failed
  checkpoint session
  replan from latest observation
end
emit task.completed / task.failed
```

MVP 限制：

- ReAct 每次最多 20 个工具循环；模型不可扩大预算。
- 普通工具和单个页面组件 Step 默认超时 5 分钟，可通过 `AGENT_TOOL_TIMEOUT_MS` 调整。页面组件不再聚合为一个长 Step，每个组件独立检查点、独立重试和独立失败状态。
- ReAct 模式不在工具内部隐式重试；相同工具、输入和错误最多由循环恢复 1 次。
- 任务失败保留 Goal、Plan 和 References。
- 不允许两个请求同时运行同一个 Session。

## 8. Tool Registry 与 Skill

统一接口：

```ts
interface AgentTool {
  name: string
  execute(context: AgentToolContext, input: unknown): Promise<AgentToolResult>
}
```

MVP 工具：

### reference.prepare

校验图片 Data URL、角色和数量，返回用于 Provider 的 uploads。

### design.generate

调用现有 Provider 图片任务。Codex CLI 在隔离目录接收 `--image`，生成单个 `design.svg`。

### artifact.validate

验证 SVG 标签、尺寸、大小和外部文件引用，输出可交付 Artifact。

### canvas.present

不直接操作 Renderer。它产生 `artifact.created` 事件并把 Artifact 放入最终 Runtime Result，由前端转换 PNG 后创建一个 ImageElement。

页面外壳和组件使用带 ACK 的增量 Deliverable：`page.generate-shell` 先写入唯一 page-shell，`page.generate-component` 再发送组件制品和 Blueprint bounds；Renderer 写入并验证真实 DesignDocument，回传 element、root、instance、pageSectionId 和节点摘要。只有 ACK 成功后工具才标记完成，最终 `canvas.present-page` 按 elementId/pageSectionId 复用已有节点。

Renderer 在任务开始发送无 Base64 的 CanvasSnapshot，并在每次 ACK 后回传实际写入节点。Runtime 将最新快照提供给 Conversation Agent、ReAct NextAction 和 `canvas.inspect`，避免模型只依据 Provider 文案判断画布状态。

### 独立素材工具链

当用户要求“独立、单独、分别、逐个”生成按钮或素材时，Planner 使用：

```text
reference.prepare
-> design.generate-assets
-> artifact.validate-assets
-> canvas.present-assets
```

Codex 输出 `artifacts/manifest.json` 和多个独立 SVG。Runtime 逐项验证后返回 `artifacts[]`，Renderer 将每个素材转换为独立 ImageElement，禁止合并成整页图片。

### Skill Runtime Tool

内置工具之外，Registry 会把未知工具名交给 `executeSkillTool(toolName, input)`。
Skill 通过 `runtime/manifest.json` 声明工具，由 Electron Node Runtime 直接执行，不依赖用户安装 Node。

每轮请求先根据显式 `skillNames`、`$skill-name` 和触发词选择 Skill。所选 Skill 名称写入 Session，后续“继续”会沿用；Codex CLI 执行时则将 Skill 复制到隔离 Job，并在 Prompt 中要求先读取 `SKILL.md`。

## 9. Agent 事件协议

```ts
type AgentEvent =
  | { type: 'session.updated'; sessionId: string; status: string }
  | { type: 'plan.updated'; sessionId: string; steps: AgentStep[] }
  | { type: 'step.started'; sessionId: string; step: AgentStep }
  | { type: 'step.completed'; sessionId: string; step: AgentStep }
  | { type: 'step.failed'; sessionId: string; step: AgentStep; error: string }
  | { type: 'artifact.created'; sessionId: string; artifact: AgentArtifactMeta }
  | { type: 'task.completed'; sessionId: string }
  | { type: 'task.failed'; sessionId: string; error: string }
```

IPC 增加 `runtime:agentEvent`。聊天 token 继续使用 `runtime:streamToken`。

## 10. 前端行为

1. 所有 Electron 对话统一发送 `type=agent_run`。
2. 普通聊天结果 `kind=text`，不调用 `setDocument`。
3. Artifact 结果 `kind=image`，转换为 PNG 后按 Placement Intent 放入目标画板。
4. 执行中显示应用事件生成的状态文案，不展示模型虚构的执行承诺。
5. 输入附件发送后可以清空 Composer，但 Agent Session 已持久化副本。
6. “请继续”由 Agent Session 恢复，不要求用户重新上传 KV/原型图。

### 10.1 Placement Intent

每次生成前先把自然语言和输入框分段控件解析为明确的放置模式：

```ts
type PlacementMode =
  'auto' | 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
```

决策优先级为：用户本轮明确表达 > 分段控件 > 默认追加当前画板。这样用户可以直接说“再生成一个页面”，也可以在自然语言不明确时手动选择目标。

| 用户意图                     | Placement Mode      | 画布行为                                         |
| ---------------------------- | ------------------- | ------------------------------------------------ |
| 再生成一个页面、UI、第二屏   | `new-artboard`      | 新建独立画板，不覆盖现有页面                     |
| 当前页面继续往下、增加模块   | `append-section`    | 复用当前目标画板，在已有内容下方追加             |
| 再做一个版本、换个方案       | `duplicate-variant` | 复制源画板作为新变体，生成结果只替换变体内容     |
| 单独生成按钮、图标、背景素材 | `asset-board`       | 创建或复用该对话的素材画板，每个素材保持独立节点 |

新画板使用 `375px` 逻辑宽度和 `812px` 初始高度。完整页面和追加模块按图片比例自然扩展画板高度；`750px` 二倍图会映射为 `375px` 逻辑宽度。

### 10.2 对话与画板关系

一个对话可以关联多个页面画板，并保存当前目标和素材目标：

```ts
interface EditorChatThread {
  artboardIds?: string[]
  activeTargetArtboardId?: string
  assetArtboardId?: string
  placementMode?: PlacementMode
  lastPlacementMode?: Exclude<PlacementMode, 'auto'>
}
```

- 新对话没有明确目标时，第一次生成会自动创建标准画板。
- “新页面”和“新变体”会把新画板加入当前对话的 `artboardIds`。
- “当前画板”优先使用用户选中的元素所属画板或选中的画板，其次使用对话最近目标。
- “素材”在同一对话中复用 `assetArtboardId`，避免每次生成都创建零散素材画板。
- 删除画板时同步清理对话绑定，下一次生成会重新解析并创建有效目标。

Placement 结果会写入 `canvasTarget` 并保存在 Agent Session 中，因此继续执行和失败重试仍使用同一落位语义。Runtime 的 `design.generate` 根据模式约束输出：`append-section` 只生成局部模块，其他页面模式生成完整页面，素材模式进入多 Artifact 工具链。

## 11. Provider 策略

- Codex：聊天、看图、设计图工具。
- Claude/Copilot：聊天、看图；设计图工具返回明确的不支持错误。
- Agent Runtime 与 Provider 解耦，未来可以增加真正的图片 API Tool。

## 12. 错误与安全

- 不在日志中输出 API Key 或完整 Base64。
- 临时目录执行结束后清理。
- SVG 限制 8MB，拒绝任务目录外本地引用。
- Session 文件写入使用临时文件后原子替换。
- Runtime 错误包含 code、message 和可恢复状态。
- 失败不得修改画布。

## 13. 实施顺序

1. 新增 Session Store、Planner、Tool Registry、Loop Engine。
2. `request.mjs` 拆分为 Agent 入口和底层 Provider 调用。
3. Main/Preload 增加 Agent Event IPC。
4. `api.ts` 统一走 `agent_run`，删除前端意图判断。
5. ChatPanel 订阅 Agent Event，并仅在 Artifact 成功后更新画布。
6. 使用模拟 Codex 验证初次生成、替换原型、继续、失败重试和普通聊天。

## 14. 验收标准

1. “你好”只返回文本，画布不变化。
2. “根据 KV 和原型图输出设计稿”立即执行完整 Plan。
3. 用户补充“这才是原型图”后，新图替换旧 prototype，任务进入 ready。
4. 用户发送“请继续”后，不再返回承诺文本，而是恢复 Plan 并产生 Artifact。
5. 继续执行时无需重新上传历史 KV 和原型图。
6. 工具失败后 Session 为 failed；“重试”从任务检查点重新运行。
7. 完整页面成功时产生一个完整图片节点；独立素材任务产生多个可分别选择、导出的图片节点。
8. 应用重启后仍能从持久化 Session 恢复任务。
9. `npm run lint`、`npm run build` 和 Runtime 集成测试通过。

## 15. 当前实现边界

当前已实现 Session、整图 Plan、独立素材 Plan、Loop、重试、单/多 Artifact、Skill 发现/选择/暂存和 Runtime Tool 执行。

工程化 P0 已接入 Project Repository、Artifact Repository、项目/聊天自动保存、Run ID、Step 输出检查点、失败 Step 恢复、任务取消和 Codex 子进程终止。Provider 公共状态会区分 SVG 设计与真实位图能力，当前所有 Provider 的 `rasterImage` 均为 false。

整图 Plan 已接入通用 Design Blueprint、确定性 SVG 质量审查和一次自动修正。成功结果会把 Prompt、Provider、模型、Placement、Blueprint 和审查结果保存到画板元数据；画板支持 1x/2x PNG 导出。

组件设计 Planner 已接入 `组件 JSON -> Contract -> Thumbnail Blueprint -> Visual Shell + Asset Slot -> Props Patch -> 原生画布图层` 的 8 步流程。Visual Shell 只负责背景、容器和静态装饰，不写入 Props；组件 JSON 和 thumbnail 来源受 Runtime 白名单限制，未知业务字段不进入 Patch。EraLottery 和 EraTasklist 已覆盖有图片 Slot 与无图片 Slot 两类回归场景。

P2.2 已实现 `Section + VisualShell/Image/Shape/Text/RuntimePlaceholder` 原生图层、`ComponentBinding`、Region 编辑到 Props Patch 的同步、Section 联动变换和级联删除。选中组件图片 Region 后可执行四步 Slot 局部 Plan，成功结果保留 elementId 并原位替换素材，不重新生成整个组件。

页面级 `page-design` Recipe 已接入正式 Agent Runtime。用户在同一目标中明确指定多个组件 JSON 和完整页面时，Runtime 会动态插入每个组件的独立 Section Step，复用组件完整生成链，再生成页面 Blueprint、最低层 page-shell 和页面质量报告。前端将结果落为多个可编辑组件实例和独立页面外壳，不再退化为整页单图。

选中组件 Section、Visual Shell 或非 Slot Region 后输入整体修订命令，Planner 会创建新的组件 Run，并在成功后按 `instanceId` 原位替换整套组件图层。根 elementId、位置和实例 ID 保持不变，旧子图层不会与新结果重复叠加。

用户明确指定组件 JSON 后，Planner 会把组件选择器持久化到 Session。后续只输入“生成设计稿”“继续”或“重试”时仍强制恢复组件 Plan；组件 JSON 与 thumbnail 决定结构和 Slot，KV 只影响视觉风格，不能触发普通整页自由生成。

页面级 Visual Shell、多组件 Page Composition Blueprint、页面 Blueprint 确认暂停、Section 锁定与局部修订已经实现。可编辑 Blueprint 排序、组件 Blueprint 人工确认、Props Patch 写回线上实例、图片内部像素分层和真实视觉模型仍属于后续阶段。页面组合协议见 `docs/page-composition-capability.md`，能力状态以 `docs/capability-status.md` 为准。
