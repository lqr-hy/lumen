# AI 设计 Agent 与画布事务重构方案

> 状态：动态 Placement、目标握手、请求级 Lease、Revision Guard 和 Renderer 幂等已完成；完整跨存储 Reconciler 待实施
> 审计基线：2026-08-19
> 适用范围：聊天输入、Pi Agent、设计工作流、画布目标、增量交付、Session、Checkpoint 和错误恢复

## 1. 结论

当前项目已经具备组件契约、页面组合、节点级生图、Artifact、Checkpoint、Props Patch、质量门禁和
部分 Renderer ACK，但聊天到画布之间还不是一条统一事务。最直接的表现是：Renderer 先用正则判断
是否创建画板，Pi 随后又根据会话历史独立判断是否执行设计。两边结论不一致时，设计可以生成成功，
但最终因没有 `canvasTarget` 而无法写入。

目标不是继续补充关键词，而是建立以下唯一生产链路：

```text
用户消息 / Mention / 附件 / 选择
  -> Pi WorkflowDecision（唯一高层意图）
  -> Canvas Target Handshake（应用确定性解析和建板）
  -> DesignTurnTransaction
  -> Deterministic Workflow Graph
  -> Artifact Nodes
  -> Canvas Mutation Deliverable
  -> Renderer ACK
  -> Commit / Failed / Interrupted
```

产品行为必须满足：用户不选择画板也能生成；普通问答不创建画板；重试不重复建板；所有设计结果只有
真实写入画布后才能显示完成；内部 Blueprint、协议字段和 Provider 错误不进入普通聊天正文。

## 2. 当前架构审计

### 2.1 已有可复用能力

- Pi Agent 已是自然语言和高层 Tool Call 入口。
- 领域 Workflow Graph 已支持 Plan、Step、Observation、Checkpoint、取消和有限重试。
- 组件 JSON 已是结构、Profile、Slot 和 Props Patch 的事实源。
- 页面由 Page Shell 和独立 Component Section 组合，可增量生成。
- Artifact 已外置存储，组件图片节点支持独立重试和本地 fallback。
- Renderer 已能校验 Page Shell、组件 Root、Instance、Section 和画板归属。
- 项目快照、Agent Session 和 Pi SQLite 已具备持久化基础。

这些能力保留，不重新实现模型 Runtime、组件契约或画布编辑器。

### 2.2 关键问题

| 问题 | 当前实现 | 后果 |
| --- | --- | --- |
| 双重意图判断 | Renderer 的 `resolveCanvasTarget()` 与 Pi Tool Call 分别判断 | “重新生成一下”可被前端判成聊天、Pi 判成组件生成 |
| 两套聊天执行器 | `ChatPanel` 与 `AiCanvasChat` 各自维护请求、建板、写入和恢复 | 行为分叉，修复容易只覆盖一个入口 |
| 画板是前置参数 | Runtime 执行前要求 Renderer 猜测并传入 `canvasTarget` | Pi 决定执行后无法补建目标 |
| Session 目标未验证 | 有旧 `session.canvasTarget` 就直接复用 | 画板被删除、项目切换后会使用失效 ID |
| `create-artboard` 不执行写入 | Runtime 只回复“已新增画板” | 前端未预建时会出现文字成功、画布无变化 |
| ACK 覆盖不完整 | 页面组件和 Page Shell 有 IPC ACK；图片、素材、组件和局部替换在请求结束后由 UI 写入 | 领域 Session 可能先完成，Renderer 后写入失败 |
| 缓存与目标耦合 | 所有 Step 的 `inputHash` 都包含 `canvasTarget` | 只更换画板也会使昂贵的生图 Checkpoint 失效 |
| 历史错误泄漏 | 旧消息持久化了 Blueprint/version 原文 | 新 Runtime 已修复后，用户仍看到内部协议错误 |
| 静默失败 | ChatPanel 建板失败直接 `return` | 用户没有结果、没有错误，也无法行动 |
| 状态事实源分散 | ChatRun、项目快照、领域 Session、Pi SQLite 分别持久化 | 重启后可能出现 Run、目标和 Checkpoint 不一致 |
| 测试层级不足 | Resolver 和工作流测试较多，缺少真实 IPC 建板事务 E2E | 单元测试通过仍可能在应用里缺少目标画板 |

### 2.3 当前故障的精确路径

```text
“重新生成一下”
  -> Renderer：缺少页面/组件等对象词，判定 kind=chat
  -> 不调用 ensureChatThreadArtboard
  -> request.canvasTarget = undefined
  -> Pi：依据历史 Session 选择 continue/create-component
  -> 组件工作流完成
  -> Renderer onDeliverable / result handler 没有 target
  -> CANVAS_TARGET_MISSING
```

因此“无选中画板自动创建”不能只放在提交前正则中，必须放到 Pi 已确定执行设计之后、领域工作流开始之前。

## 3. 产品交互原则

### 3.1 用户不需要管理目标

目标不再由关键词表或固定 Action 映射决定。Pi 根据当前轮语义和 `CanvasContext` 动态选择画布操作，
Runtime 只执行下列产品不变量：

| 用户场景 | 应用行为 |
| --- | --- |
| 普通问答、分析、方案讨论 | 不创建画板 |
| 创建独立设计成果 | 创建新画板；允许复用尺寸一致且完全空白的当前初始画板 |
| 向现有设计插入内容 | 必须提交明确目标画板，不允许使用历史线程隐式回退 |
| 恢复任务 | 只能复用上一 Run 的有效 Lease；目标失效则重新规划 |
| 上次目标已删除 | 返回 `CANVAS_TARGET_INVALID/EXPIRED`，禁止静默写入其他画板 |
| 选中组件或 Slot 后修改 | 原位使用该节点所属画板 |
| 明确要求新页面/新版本 | 新建画板；Variant 才复制已有内容 |
| 生成独立按钮、背景、图标 | 创建或复用线程素材画板 |
| 修改对象不明确且可能破坏已有内容 | 追问，不擅自修改 |

画板默认逻辑宽度固定为 375；初始高度 812；`autoHeight=true`，根据页面 Blueprint 和实际内容向下增长。

### 3.2 设计任务必须产生可见结果

- 开始执行后立即显示目标画板和非侵入式生成状态。
- 第一个 Deliverable 到达后写入真实图层，不等待整页结束。
- 失败时保留输入、附件、目标和已成功节点。
- 重试复用同一目标与成功 Artifact，不创建重复画板或重复组件。
- 用户只看到“理解需求、生成内容、添加到画布”及可行动错误。

### 3.3 页面规划默认不阻断

普通页面生成不再默认要求 Blueprint 确认。只有以下场景暂停确认：

- 引用的组件 JSON 无法唯一解析。
- 用户要求替换或删除已有内容，影响范围不明确。
- 原型、KV 和组件结构存在无法自动解决的冲突。
- 用户主动开启“生成前确认结构”。

排序、估算高度等确定性结果应直接执行，生成后可继续自然语言修改。

## 4. 目标架构

```text
PromptComposer
  -> DesignChatController
      -> Electron startTurn
          -> Pi Agent
              -> chat reply
              -> skill_activate
              -> studio_run_design_workflow(WorkflowDecision)
                  -> CanvasTargetCoordinator.ensureTarget()
                      -> IPC target.request
                      -> Renderer CanvasTransactionManager
                      -> IPC target.ack
                  -> DesignWorkflowEngine
                      -> Artifact Graph
                      -> CanvasMutation Deliverable[]
                      -> Renderer apply + ACK
                  -> finalize transaction
      -> ChatRun projection
```

### 4.1 唯一高层决策

Pi 的 `studio_run_design_workflow` 是生产环境唯一设计意图入口。Renderer 不再判断 `chat/design`，只提交
结构化上下文。确定性 `intent-router.mjs` 仅作为 Pi 不可用时的同层离线降级，不允许 Renderer 再维护
另一套规则。

```ts
interface WorkflowDecision {
  version: 2
  action:
    | 'create-page'
    | 'create-component'
    | 'create-assets'
    | 'create-image'
    | 'revise-page'
    | 'revise-page-shell'
    | 'revise-component'
    | 'regenerate-slot'
    | 'create-artboard'
    | 'continue'
  taskKind: string
  placement: {
    operation: 'create' | 'insert' | 'revise' | 'variant' | 'assets' | 'resume'
    scope: 'document' | 'artboard' | 'selection' | 'asset-board'
    targetArtboardId?: string
    targetElementIds?: string[]
    reason: string
    confidence: number
  }
  componentName?: string
  confidence?: number
}
```

模型只能从 `CanvasContext` 提供的候选 ID 中选择目标。Runtime 必须验证 Project、Revision、画板存在性
和 Selection 归属；模型不能创建任意 ID，也不能把无目标的 `insert/revise/variant` 降级到线程历史画板。

### 4.2 RuntimeContext 调整

请求不再要求提前传入单一 `canvasTarget`，而是提供只读候选上下文：

```ts
interface CanvasContext {
  projectId: string
  documentVersion: number
  artboards: Array<{
    id: string
    width: number
    height: number
    empty: boolean
    generationState?: string
  }>
  selectedElementIds: string[]
  selectedArtboardId?: string
  activeArtboardId?: string
  threadTargetArtboardId?: string
  lastCommittedTargetId?: string
}
```

不发送图片 Base64、完整 DesignDocument 或凭证。节点细节继续通过受限 CanvasSnapshot 提供。

## 5. Canvas Target Handshake

### 5.1 请求协议

领域工作流执行前调用宿主能力，而不是假设目标已经存在：

```ts
interface CanvasTargetRequest {
  id: string
  turnId: string
  sessionId: string
  projectId: string
  action: WorkflowDecision['action']
  operationId: string
  placement: WorkflowDecision['placement']
  preferredArtboardId?: string
  editScope?: SelectionScope
  baseDocumentRevision: number
  logicalSize: { width: number; initialHeight: number; autoHeight: boolean }
}

interface CanvasTargetAck {
  status: 'ready' | 'needs-confirmation' | 'failed'
  lease?: CanvasTargetLease
  reason?: string
  errorCode?: string
}
```

### 5.2 Target Lease

```ts
interface CanvasTargetLease {
  leaseId: string
  transactionId: string
  artboardId: string
  mode: 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
  source: 'selection' | 'thread' | 'active' | 'retry' | 'created' | 'override'
  createdForTurn: boolean
  documentVersion: number
  state: 'reserved' | 'writing' | 'committed' | 'failed' | 'expired'
  width: 375
  height: number
  autoHeight: true
}
```

Lease 解决三个问题：目标有明确生命周期；重试可以复用；用户手动删除或项目切换后可以检测失效。
Runtime 不再长期保存未经验证的裸 `canvasTarget`。

### 5.3 目标验证算法

```text
Pi 根据 CanvasContext 选择 operation/scope/target
  -> Runtime 校验 baseDocumentRevision
  -> 校验 target 是否属于当前 Document
  -> insert/revise/variant/resume 缺少目标：失败
  -> create：新建或复用尺寸一致的完全空白初始画板
  -> assets：创建或复用线程素材画板
  -> operationId 已处理：返回同一 Target ACK
```

Selection、当前活动画板和历史任务只是 Agent 的观察信息，不是 Runtime 的隐式 fallback。这样既不要求
用户手动选画板，也不会把新的设计任务意外追加到旧设计下面。

### 5.4 失败时的画板行为

- 尚未产生任何 Artifact：保留一个标记为 failed 的空目标，供重试复用。
- 已写入部分节点：保留成功节点和失败状态，禁止整体回滚。
- 用户取消且画板完全为空：可以自动移除本轮创建的临时画板。
- 显式“新增画板”即使为空也必须保留。

## 6. DesignTurnTransaction

聊天消息、Agent Run、领域 Session 和画布写入使用同一个 `turnId`：

```ts
interface DesignTurnTransaction {
  turnId: string
  runId: string
  sessionId: string
  projectId: string
  decision?: WorkflowDecision
  targetLease?: CanvasTargetLease
  status:
    | 'understanding'
    | 'resolving-target'
    | 'generating'
    | 'delivering'
    | 'committed'
    | 'partial'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
  appliedMutationIds: string[]
  createdAt: string
  updatedAt: string
}
```

状态转换只能单向进行，`failed/cancelled/interrupted` 不得被 Pi `agent_end` 覆盖。`committed` 必须至少有
一个成功画布 Mutation ACK；纯聊天没有 DesignTurnTransaction。

## 7. 统一 Canvas Mutation 与 ACK

### 7.1 所有设计结果使用同一协议

现有 Deliverable 扩展为：

```ts
type CanvasMutationKind =
  | 'artboard-create'
  | 'image-upsert'
  | 'asset-set-upsert'
  | 'component-upsert'
  | 'component-slot-replace'
  | 'page-shell-upsert'
  | 'page-component-upsert'
  | 'page-finalize'

interface CanvasMutationDeliverable {
  version: 2
  id: string
  idempotencyKey: string
  transactionId: string
  runId: string
  leaseId: string
  kind: CanvasMutationKind
  expectedDocumentVersion?: number
  payload: unknown
}
```

单组件、整图、素材和局部替换不能再由 ChatPanel 在 Runtime 返回后自行写入。所有写操作都通过 IPC
Deliverable，并等待 Renderer ACK。

### 7.2 ACK 协议

```ts
interface CanvasMutationAck {
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'failed'
  mutationId: string
  artboardId?: string
  documentVersionBefore?: number
  documentVersionAfter?: number
  rootElementId?: string
  instanceId?: string
  writtenElementIds?: string[]
  summary: string
  errorCode?: string
}
```

- `idempotencyKey` 防止 IPC 重发产生重复节点。
- `expectedDocumentVersion` 保护运行期间用户手动编辑。
- `conflict` 触发重新读取 CanvasSnapshot 或要求用户确认，不允许覆盖新编辑。
- Renderer 在 Store Mutation 后执行后置条件，再返回 `applied`。
- 领域 Step 只有收到 `applied/duplicate` 才完成。

### 7.3 最终结果

Runtime 最终返回聊天摘要和结构化 Run 状态，不再携带一份需要 UI 二次写入的完整结果。ChatPanel 不再
包含 `result.kind === component/page/image` 的写入分支。

## 8. Chat Controller 收敛

新增共享 `DesignChatController` 或 `useDesignChatController`：

- 读取并冻结本轮 Draft、Mention、附件和选择。
- 创建 message、run 和 turnId。
- 调用 Runtime，消费 Token、Agent Event、Target Request 和 Deliverable。
- 管理取消、失败恢复和最终状态。
- 统一错误映射。

`ChatPanel` 只负责历史、时间线和确认 UI；`AiCanvasChat` 只保留紧凑 Composer，提交时调用同一个
Controller，不再维护本地线程列表或复制生成逻辑。

## 9. Session、Checkpoint 与恢复

### 9.1 三类存储职责

| 存储 | 保存内容 |
| --- | --- |
| Project Repository | DesignDocument、ChatThread、ChatRun、DesignTurn 摘要 |
| Domain Agent Session | Goal、Decision、Plan、Observation、Artifact 引用、Lease 摘要 |
| Pi SQLite | 模型消息和脱敏 Tool Call/Result |

`projectId + sessionId + turnId + runId` 是跨存储关联键。

### 9.2 启动时对账

应用加载项目后执行 Reconciler：

1. running/delivering 统一转为 interrupted。
2. 校验 Lease 指向的画板仍存在；不存在则标记 expired。
3. 对比 Mutation Ledger，确认哪些 Deliverable 已真实写入。
4. 清除旧项目或旧文档版本中的 `session.canvasTarget`。
5. 将旧 Blueprint/version 内部错误迁移为结构化错误码和用户摘要。
6. 恢复 Draft，但不自动恢复后台网络请求。

### 9.3 Checkpoint 解耦

Step Hash 分为两类：

```text
Generation Hash = Prompt + Reference + Component SourceHash + Theme + Provider + Model
Delivery Hash   = Artifact Hash + Lease + Document Revision + Mutation Kind
```

生成、验证和合成 Step 不包含 Artboard ID。目标被删除或更换时，只重跑交付 Step，不重新调用生图模型。

## 10. 页面与组件生成策略

### 10.1 组件

```text
Component JSON / thumbnail / KV
  -> Contract
  -> VisualTheme
  -> Deterministic Plan
  -> Visual Shell + Props Slot Artifact Nodes
  -> Component Compose
  -> component-upsert Deliverable
  -> ACK
```

单节点失败继续使用可局部替换的 fallback。Props Patch 只存在于组件实例根和
`componentInstances`，不挂到普通画板或任意子图层。

### 10.2 页面

```text
Reference / Component JSON[]
  -> Shared VisualTheme
  -> Deterministic Page Plan
  -> Target Lease
  -> Page Shell + Component Node[]
  -> 每个结果完成即串行交付
  -> Renderer Snapshot
  -> Page Quality Review
  -> page-finalize ACK
```

- Artifact 生成可以受控并发，建议默认并发 2。
- Canvas Mutation 始终串行，避免 Document Version 冲突。
- Page Shell 和每个组件有独立 Checkpoint。
- 单组件失败不撤销其他组件；手动重试只恢复失败节点。
- 页面高度由 Blueprint 和真实写入结果增长，不压缩到 812。

## 11. 错误与恢复

错误必须分层，不能全部显示为“生成失败”：

| 分类 | 示例 | 用户行为 |
| --- | --- | --- |
| Intent | 目标含糊、修改对象不明确 | 追问或展示确认卡 |
| Target | 目标被删除、Lease 过期 | 自动重建或重新绑定 |
| Contract | 组件 JSON 不存在、Profile 无效 | 指明具体组件问题 |
| Provider | 空响应、超时、限流 | 节点级有限重试 |
| Artifact | 图片无效、尺寸错误 | 当前节点 fallback/重生成 |
| Delivery | Renderer 不可用、版本冲突 | 保留 Artifact，只重试交付 |
| Quality | 主题、布局、完整性不达标 | 最小范围 Repair |
| Runtime | 真实组件 Bundle 错误 | 阻断开发交付，不用生图掩盖 |

禁止向用户显示 Blueprint JSON、`version`、Regions Path、SSE 原文、Provider Body 和堆栈。开发诊断保留
`errorCode`、Step、Artifact ID、Mutation ID 和原始 Cause。

## 12. 开源项目借鉴

- [Onlook](https://github.com/onlook-dev/onlook)：对象到代码的稳定映射、实时预览、Checkpoint 和 Branch。
- [OpenUI](https://github.com/wandb/openui)：自然语言生成后立即渲染，并围绕结果继续迭代。
- [tldraw Make Real](https://github.com/tldraw/make-real)：把选择作为可选上下文，生成结果成为画布对象。
- [Penpot](https://github.com/penpot/penpot)：SVG/JSON、Component 和 Design Token 作为开放事实源。
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)：节点任务图、局部重算和可复用中间结果。

项目不直接嵌入上述 Runtime。Pi、DesignDocument 和组件 JSON 已满足本项目边界，只采用其事务、映射、
预览和局部恢复思想。

## 13. 分阶段实施

### P0：当前故障止血

**状态：已完成，并已由 P2 的 Pi 后决策握手替代临时双重判断。**

1. Renderer Resolver 将 `continue/retry/重新生成` 与线程最后任务绑定。
2. 设计结果到达但 target 为空时，执行一次确定性自愈建板，而不是直接失败。
3. Session 目标使用前校验当前 CanvasContext。
4. ChatPanel 建板失败不能静默返回。
5. 空画板重试复用，增加不重复建板测试。
6. 历史 Blueprint/version 错误在展示层脱敏。

生产链路已删除 Renderer 的自然语言意图 Resolver，因此不再长期保留双重判断。

### P1：统一聊天入口

**状态：部分完成。** `ChatPanel` 与 `AiCanvasChat` 已共用 `design-turn-canvas-bridge.ts`，目标握手、
Deliverable 应用、Canvas ACK 和末端去重已经统一；Draft、线程创建、请求载荷和失败恢复仍需抽取到
完整 `DesignChatController`。

1. 新增 `DesignChatController`。
2. 将 Draft、Run、Runtime 请求和恢复逻辑移出两个 UI 组件。
3. 删除 `AiCanvasChat` 本地线程状态和重复结果写入代码。
4. 两个 Composer 使用同一个 Store Thread 和 Controller。

### P2：Target Handshake 与事务

**状态：核心已完成。** Target Request/ACK IPC、Pi 决策后解析目标、自动建板/复用及旧 Renderer 意图
判断删除均已落地。当前目标确认通过请求级 Handshake 完成，持久化 Lease 与版本冲突检测归入 P4。

1. 新增 Target Request/ACK IPC。
2. 新增 `CanvasTransactionManager` 和 Target Lease。
3. WorkflowDecision v2 增加动态 `placement`，删除生产链路 `targetPolicy` 和 `auto -> append-section`。
4. Pi 决策后再解析/创建目标。
5. 删除 Renderer 生产链路中的 `chat/design` 意图判断。

### P3：统一 Deliverable

**状态：核心已完成。** 图片、素材集、组件、组件 Slot、Page Shell、页面组件和页面终态均走统一
Deliverable/Renderer ACK；聊天组件末端重复写入已删除。当前 Ledger 为进程内 Delivery ID 幂等，
持久化 Ledger 归入 P4。

1. 扩展 Canvas Mutation Kind。
2. 图片、素材、组件、Slot、Page Shell 和页面组件全部走 ACK。
3. 增加 Mutation Ledger 和幂等键。
4. 删除 ChatPanel/AiCanvasChat 的末端 Store 写入分支。
5. Runtime 只在 Mutation ACK 后完成。

### P4：恢复与缓存

**状态：第一阶段已完成。** 稳定 Delivery ID、项目级持久化 Mutation Ledger、重启幂等和 ACK 前项目保存已落地；跨存储 Reconciler、Hash 分离与 revision 冲突检测待实施。

1. 增加跨存储 Reconciler。
2. Generation Hash 与 Delivery Hash 分离。
3. 目标失效只重跑交付。
4. 增加失败组件/Slot 单节点重试入口。
5. 增加运行期间用户编辑的冲突检测。

### P5：页面体验和性能

**状态：待实施。**

1. Blueprint 默认自动执行，低置信度时才确认。
2. Artifact 节点受控并发，Mutation 串行。
3. 目标画板显示轻量生成状态与失败状态。
4. 页面完成后自动聚焦并展示可编辑节点。

### P6：E2E 与可观测性

**状态：待实施。**

1. Electron IPC 真实目标握手 E2E。
2. 应用重启、删除画板、切换线程、连续重试和取消 E2E。
3. 记录 Turn、Target、Provider、Artifact、Mutation 和 ACK 时延。
4. 统计自动建板率、重复建板率、交付成功率、目标自愈率和重试复用率。

## 14. 代码迁移边界

建议新增：

```text
src/features/ai/design-chat-controller.ts
src/features/editor/canvas-transactions/canvas-transaction-manager.ts
src/features/editor/canvas-transactions/canvas-target-policy.ts
src/features/editor/canvas-transactions/mutation-ledger.ts
electron/runtime/canvas-target-coordinator.mjs
electron/runtime/canvas-delivery.mjs
electron/runtime/session-reconciler.mjs
```

已删除或完成缩减：

```text
src/features/editor/utils/canvas-target-resolver.ts  # 已删除
src/features/editor/utils/placement-intent.ts        # 仅保留 PlacementMode 类型
ChatPanel.tsx / AiCanvasChat.tsx 的目标解析和结果写入 # 已移入共享 Bridge
```

仍待缩减：两个聊天组件中的 Draft、线程创建、Runtime 请求载荷和失败恢复。

保留：Pi Agent、Workflow Graph、Tool Registry、Artifact Repository、组件 Contract、Design Eval、
DesignDocument Store 和现有导出能力。

## 15. 测试矩阵

### 15.1 目标行为

- 空画布生成 EraLottery：自动创建一个 375px 画板并写入组件。
- 有空白画板生成页面：复用空白画板，不额外新增。
- 失败后“重新生成一下”：复用原目标，不出现第二个画板。
- 目标被删除后继续：创建替代画板，只重跑交付。
- 普通问答：画板数量不变。
- 明确新页面：只新增一个画板。
- 两个聊天入口：得到相同 Decision、Lease 和 Mutation。

### 15.2 事务与 ACK

- Renderer 未注册 ACK：Run 失败，不能回复完成。
- Mutation 重发：返回 duplicate，不产生重复节点。
- Document Version 冲突：不覆盖用户编辑。
- Agent 增量交付期间用户修改画布：目标 Lease Revision 失效，拒绝后续交付并保留已经写入的结果。
- Agent 增量交付期间用户修改无关节点：基于目标节点指纹自动更新 Lease，继续交付；修改目标节点或整页结构时才进入冲突。
- 组件 Root、Instance 或 Slot 缺失：ACK rejected/failed。
- 页面部分组件失败：保留成功组件，Run 为 partial。

### 15.3 恢复

- 应用重启：running 转 interrupted。
- Checkpoint 有 Artifact、目标失效：不重新生图。
- Pi Session 与项目快照不一致：以真实 DesignDocument 和 Mutation Ledger 为准。
- 旧 Blueprint 错误：普通 UI 只显示可行动摘要。

### 15.4 生成与导出

- KV 主题进入 Page Shell 和组件 Props。
- 组件 JSON 仍是 Props 白名单。
- 独立素材不合并成整组件图片。
- 页面和组件导出只包含真实已写入实例。
- fallback 节点可后续局部替换。

## 16. 验收标准

1. 生产链路只有 Pi/同层 fallback 能决定是否执行设计。
2. 用户不选择画板也能完成页面、组件、图片和素材生成。
3. 任意设计写入都有 Target Lease、Mutation 和 Renderer ACK。
4. 重试不会重复创建画板、组件或 Page Shell。
5. 删除目标后可以复用 Artifact 并只恢复交付。
6. 两个聊天入口不再包含重复业务编排。
7. 普通用户不看到 Blueprint、协议字段和 Provider 原文。
8. 页面默认直接生成，只有真实歧义才要求确认。
9. 全量单元测试、Electron IPC E2E、Lint、Build 和 DMG 通过。

## 17. 实施优先级

P0、P2、P3 的主链能力已经上线。下一步先完成 P1 剩余的 `DesignChatController`，再实施 P4 的持久化
Ledger、跨存储 Reconciler 和缓存哈希拆分；P5-P6 在事务恢复稳定后推进。
