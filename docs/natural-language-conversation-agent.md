# 自然语言 Conversation Agent 技术方案

## 1. 目标

聊天入口不再要求用户记忆“生成组件、添加到画布、继续”等固定句式。模型根据当前会话、画布、选择、参考图、组件 JSON 和最近 Artifact 判断用户目标；本地 Runtime 负责执行受控工具并验证结果。

核心原则：

```text
自然语言由模型理解
执行行为由 Tool Registry 约束
组件字段由 JSON 契约约束
画布结果由本地后置条件验证
模型不可直接写 DesignDocument
```

## 2. 运行架构

```text
Chat UI
  -> ConversationContextAssembler
  -> ConversationAgent Decision
  -> Decision Schema Validator
  -> ReAct NextAction Decision
  -> Ready Tool Graph / Tool Registry
  -> 单工具 Runtime Executor
  -> 结构化 Observation / Checkpoint
  -> Deliverable IPC -> Renderer Canvas Postcondition -> ACK Observation
  -> ReAct NextAction Decision（循环）
  -> Canvas Postcondition
  -> Chat Delivery
```

正则路由器仅作为以下场景的 fallback：模型不可用、输出不符合 Schema、明确的安全命令。它不再是正常聊天的主路由。

## 3. Conversation Context

发送给决策模型的是摘要，不传完整 DesignDocument 或 Base64：

```ts
interface ConversationContext {
  message: string
  recentHistory: Array<{ role: 'user' | 'agent'; text: string }>
  session: {
    status: string
    taskKind?: string
    goal?: string
    componentRequest?: string
    completedComponent?: string
    failedStep?: string
  }
  canvas?: {
    artboardId: string
    width: number
    height: number
    placementMode?: string
  }
  selection?: {
    type: string
    componentName?: string
    instanceId?: string
    slotId?: string
  }
  references: Array<{ name: string; role: string; mime: string }>
  capabilities: string[]
}
```

## 4. Decision 协议

```ts
interface ConversationDecision {
  version: 1
  mode: 'reply' | 'execute' | 'clarify'
  action:
    | 'chat'
    | 'continue'
    | 'create-artboard'
    | 'create-page'
    | 'create-component'
    | 'create-assets'
    | 'create-image'
    | 'revise-page'
    | 'revise-page-shell'
    | 'revise-component'
    | 'regenerate-slot'
  taskKind: string
  confidence: number
  reason: string
  target?: { type?: string; id?: string; componentName?: string }
  response?: string
}
```

- `reply`：普通问答，不执行工具。
- `execute`：进入现有受控 Planner/Tool Registry。
- `clarify`：目标冲突或置信度不足时追问。
- 模型不得声明工具已经完成，只能选择动作。

## 5. Provider 协议

新增 `decide_agent_action` Runtime 请求。Codex CLI 只写入 `agent-decision.json`；Responses API、Claude Code 和 Copilot 可返回纯 JSON 或 Markdown JSON 代码块。Runtime 统一提取并校验 Decision；失败后记录降级原因并调用确定性 fallback。

决策请求不加载设计 Skill，不传图片二进制，只传参考图名称和角色摘要，控制延迟与上下文体积。

## 6. ReAct NextAction 协议

Conversation Decision 进入 `execute` 后，不再默认顺序跑完整 Recipe。固定 Plan 仅用于表达 Runtime 依赖图、恢复点和最终必需步骤；每轮 Runtime 计算 `readySteps`，模型只能从就绪步骤或只读 Inspect 工具中选择一个动作。

```ts
interface AgentNextAction {
  version: 1
  mode: 'tool' | 'clarify' | 'finish'
  tool?: {
    stepId: string
    name: string
    arguments?: Record<string, unknown>
  }
  response?: string
  confidence: number
  reason: string
}
```

- `tool`：每轮只执行一个工具；计划工具的 `stepId/name` 必须与 `readySteps` 完全一致。
- `clarify`：只有缺少用户才能提供的信息时暂停，Session 进入 `waiting-user`。
- `finish`：只有 `readySteps` 为空时生效；否则 Runtime 强制执行首个就绪步骤。
- 模型不可编造工具、覆盖计划参数或直接修改 `DesignDocument`。

Codex CLI 使用 `decide_agent_next_action` 并写入 `agent-next-action.json`。其他 Provider 可以返回纯 JSON 或 Markdown JSON 代码块；非法结果自动降级到首个就绪步骤。

## 7. Observation 与恢复

每次工具执行都会写入结构化 Observation：

```ts
interface AgentObservation {
  id: string
  stepId: string
  tool: string
  status: 'success' | 'partial' | 'failed'
  summary: string
  data?: {
    keys: string[]
    artifactCount?: number
    componentName?: string
    componentCount?: number
    failed?: boolean
    targetArtboardId?: string
  }
  errorCode?: string
  retryable?: boolean
  createdAt: string
}
```

工具失败时，ReAct 模式不立即结束任务：失败先成为 Observation，下一轮模型可以检查状态、重试就绪工具或向用户澄清。同一工具、参数和错误最多允许两次失败；第二次失败后 Runtime 强制终止，避免无限循环。

当前只读 Inspect 工具：

```text
agent.inspect-state
canvas.inspect
artifact.inspect
```

Inspect 工具不接受写操作，不改变画布和组件配置，并作为 transient Step 持久化，恢复固定依赖图时会自动忽略。

## 8. 循环边界

- ReAct 任务最多 20 次工具迭代；模型决策不可扩展预算。
- 相同工具、输入和错误最多失败两次。
- ReAct 模式的单次工具调用不在工具内部隐式重试，恢复策略由下一轮决定。
- 模型不可跳过未完成的必需步骤，`finish` 不是成功依据。
- App 重启后，`running` 任务转为可恢复的 `failed`，不会显示不存在的后台重试。
- 模型决策不可用时降级为确定性的首个就绪步骤，现有固定 Plan 仍可完整执行。

页面中的多个 `page.generate-component` 是同级就绪节点，模型可以根据 Observation 选择下一个组件；`page.review` 只有全部组件节点完成后才会进入就绪集合。单个组件失败可形成 partial delivery，不会清除其他已完成组件检查点。

页面组件工具完成后通过带确认的 Deliverable IPC 增量交付：Electron 发送组件设计、素材、`pageSectionId` 和 Blueprint bounds；Renderer 转换 SVG、首次插入或按 `pageSectionId` 原位替换，并验证 root、instance、目标画板和元素数量。Renderer ACK 成功后 Step 才能完成，ACK 失败或 30 秒超时会形成可恢复的失败 Observation。最终页面交付按 `pageSectionId` 复用已写入实例，只补齐 page-shell、页面元数据和最终状态，不重复创建组件。

`page.generate-shell` 使用同一 ACK 协议在组件生成前写入页面视觉外壳；Repair 保留 page-shell elementId，最终页面交付原位更新外壳，画板中始终只有一个 page-shell。

Renderer 每轮开始时发送不含 Base64 的 CanvasSnapshot，包含画板尺寸、节点类型、DesignRole、组件绑定、bounds、选择和计数。每次 ACK 再返回本次实际写入的节点摘要，Runtime 合并到 Session；`canvas.inspect`、Conversation Context 和 ReAct Context 均读取最新快照。

## 9. 执行与后置条件

组件结果只有满足以下条件才能回复“已添加到画布”：

1. `applyComponentDesign` 返回实例 ID。
2. `componentInstances` 存在该 ID。
3. 根 Section 存在且属于目标画板。
4. 视觉外壳或可编辑区域至少存在一项。

页面结果必须验证 Page Shell、组件实例数量和目标画板。验证失败时聊天显示结构化错误，不得把 Provider 文案当作成功结果。

## 10. 与现有 Agent 的迁移

### 已实施（P0）

- Conversation Context Assembler。
- Codex `decide_agent_action` 结构化决策协议。
- Responses API、Claude Code、Copilot 的 Decision JSON 文本兼容。
- 模型决策优先，正则 fallback。
- `reply / execute / clarify`。
- 组件和页面画布写入后置条件。
- Decision 单元测试与现有 Agent 全量回归。
- `decide_agent_next_action` ReAct 协议。
- Ready Tool Graph 和单工具循环执行。
- 成功、部分成功、失败 Observation。
- Inspect 工具、20 次循环限制和相同失败两次限制。
- `waiting-user` 暂停与继续恢复。
- 模型不可用时首个就绪步骤 fallback。
- 页面组件 Deliverable IPC 和 Renderer ACK。
- 按 Blueprint bounds 增量定位组件。
- Repair 按 `pageSectionId` 原位替换。
- Canvas 后置条件作为下一轮 ReAct Observation。
- 最终页面交付复用增量实例，避免重复节点。
- page-shell 在组件生成前增量写入、Repair 原位替换并最终去重。
- Renderer CanvasSnapshot 初始摘要和 ACK 后节点增量同步。
- `canvas.inspect`、Conversation Agent 和 ReAct 共用最新画布快照。

### 后续（P1）

- “这个、刚才那个、右边空画板”等实体解析与置信度。
- Artifact 跨轮复用和显式归属校验。
- 运行期间用户手动编辑、选择变化主动推送到正在运行的 Agent，而不只在请求开始和 Deliverable ACK 时同步。

### 后续（P2）

- 删除大部分 generation/page/component 正则。
- 将固定 `createTaskPlan()` 进一步降为声明式依赖图，不再维护手写顺序 Recipe。
- 为超大画布增加分页式 `canvas.inspect-region` 和按组件查询，替代 80 节点摘要上限。

## 11. 降级与安全

- 模型请求失败或 JSON 非法：使用 `intent-router.mjs`。
- 置信度低于阈值：澄清，不执行破坏性操作。
- Props 仍只允许组件设计契约中的图片、颜色、尺寸、位置和显隐字段。
- 任何会话不得恢复其他会话的组件 Artifact。
- “新增画板”必须由 Decision 明确返回 `create-artboard`。
