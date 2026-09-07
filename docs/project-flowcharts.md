# 项目流程图

> 基于当前 `React Renderer + Electron IPC + Pi Agent Runtime + Workflow Graph + Canvas Transaction` 实现整理。
> 本文用于快速理解从用户输入、模型决策、设计生成到画布提交、持久化和恢复的完整链路。

## 1. 系统端到端主流程

```mermaid
flowchart TD
    User["用户输入<br/>自然语言 / 图片 / @组件 / 选区"] --> Composer["PromptComposer / Lexical<br/>整理文本、Mention、附件"]
    Composer --> ChatPanel["ChatPanel<br/>创建消息与 ChatRun"]
    ChatPanel --> Controller["executeDesignChatTurn<br/>统一设计回合控制器"]

    Controller --> Context["构造 RuntimeContext<br/>项目、画板、选区、组件引用<br/>模型、Skill、Style Pack"]
    Context --> API["applyChatEdit"]
    API --> Preload["Electron Preload Bridge"]
    Preload --> IPC["runtime:startStream IPC"]

    subgraph Main["Electron 主进程"]
        IPC --> MainHandler["main.mjs<br/>注册 Stream 与 ACK 通道"]
        MainHandler --> Request["startRuntimeStream"]
        Request --> TypeCheck{"请求类型"}

        TypeCheck -->|agent_run| PiRuntime["Pi Agent Runtime"]
        TypeCheck -->|结构化文本任务| TextProvider["Pi Text Model"]
        TypeCheck -->|生成图片| ImageProvider["Pi Images Provider"]

        PiRuntime --> Assemble["组装 Agent 上下文<br/>当前消息、历史摘要、CanvasContext<br/>Skill Catalog、组件引用"]
        Assemble --> AgentLoop["pi-agent-core Agent Loop"]
        AgentLoop --> AgentDecision{"模型决策"}

        AgentDecision -->|普通问答| Reply["流式聊天回复"]
        AgentDecision -->|需要 Skill| Skill["skill_activate<br/>skill_read_resource"]
        Skill --> AgentLoop

        AgentDecision -->|设计或修改| WorkflowTool["studio_run_design_workflow"]
        WorkflowTool --> DecisionCheck["校验 WorkflowDecision<br/>action / taskKind / placement<br/>surface / output / references"]
        DecisionCheck --> TargetRequest["CanvasTargetRequest<br/>目标画板、操作类型、基础 Revision"]
    end

    TargetRequest -->|IPC Event| CanvasResolver["resolveWorkflowCanvasTarget<br/>Renderer 确定性解析目标"]
    CanvasResolver --> TargetChoice{"Placement"}

    TargetChoice -->|create| NewBoard["新建或复用空白画板"]
    TargetChoice -->|insert| ExistingBoard["追加到指定画板"]
    TargetChoice -->|revise| SelectionBoard["使用选区所属画板"]
    TargetChoice -->|variant| VariantBoard["复制旧画板生成新版本"]
    TargetChoice -->|assets| AssetBoard["创建或复用素材画板"]
    TargetChoice -->|resume| ResumeBoard["验证并复用上次 Lease"]

    NewBoard --> Lease["CanvasTargetLease<br/>artboardId / documentRevision<br/>leaseId / transactionId"]
    ExistingBoard --> Lease
    SelectionBoard --> Lease
    VariantBoard --> Lease
    AssetBoard --> Lease
    ResumeBoard --> Lease

    Lease -->|CanvasTargetAck| Workflow["Design Workflow Engine"]
    Workflow --> Session["加载 Agent Session<br/>恢复 Plan 与 Checkpoint"]
    Session --> Plan["按 taskKind 创建确定性 Plan"]
    Plan --> Ready["Workflow Graph<br/>选择 Ready Step"]
    Ready --> Budget["检查 Turn Budget<br/>迭代、模型、生图预算"]
    Budget --> Tool["执行领域 Tool"]
    Tool --> ToolResult{"执行结果"}

    ToolResult -->|成功| Checkpoint["保存 Observation<br/>Artifact 与 Step Checkpoint"]
    Checkpoint --> Dynamic{"是否产生动态步骤"}
    Dynamic -->|是| Extend["插入页面组件、Repair<br/>或分段交付步骤"]
    Extend --> Ready
    Dynamic -->|否| Deliverable{"是否产生画布交付物"}
    Deliverable -->|否| More{"还有未完成 Step"}
    More -->|是| Ready

    Deliverable -->|是| Deliver["Canvas Deliverable<br/>图片 / Scene / Patch / 组件 / 页面"]
    Deliver -->|IPC Event| CanvasBridge["DesignTurnCanvasBridge"]
    CanvasBridge --> LeaseCheck{"目标与 Lease 校验"}

    LeaseCheck -->|画板不存在| Expired["CANVAS_TARGET_EXPIRED"]
    LeaseCheck -->|目标节点有并发修改| Conflict["CANVAS_DOCUMENT_REVISION_CONFLICT"]
    LeaseCheck -->|可安全重基| Rebase["更新 Lease Revision"]
    LeaseCheck -->|版本一致| Apply["applyIncrementalCanvasDeliverable"]
    Rebase --> Apply

    Apply --> Idempotent{"deliveryId 已处理？"}
    Idempotent -->|是| CachedAck["返回历史 Observation<br/>忽略重复交付"]
    Idempotent -->|否| Mutation["原子修改 Zustand DesignDocument"]
    Mutation --> PostCheck["后置条件校验<br/>目标、根节点、数量、Revision"]
    PostCheck -->|失败| WriteFail["Canvas ACK Failed"]
    PostCheck -->|成功| Persist["保存项目快照<br/>记录 Mutation Ledger"]

    Persist --> PersistResult{"持久化成功？"}
    PersistResult -->|否| Rollback["回滚 Document 与 Ledger"]
    Rollback --> WriteFail
    PersistResult -->|是| Ack["Canvas ACK Success"]
    CachedAck --> Ack

    Ack -->|IPC| Checkpoint
    More -->|否| Complete["Session 与 Canvas Transaction<br/>标记 completed / committed"]
    Complete --> FinalReply["生成用户可见结果<br/>更新 Run Timeline"]
    Reply --> FinalReply

    ToolResult -->|可重试错误| Retry{"attempt 小于 2？"}
    Retry -->|是| Ready
    Retry -->|否| Failed["保存失败 Session 与错误事件"]
    ToolResult -->|暂停确认| Waiting["awaiting-confirmation<br/>保存 Pending Task"]
    Waiting --> User
    ToolResult -->|用户取消| Cancelled["AbortController<br/>任务标记 cancelled"]

    Expired --> Failed
    Conflict --> Failed
    WriteFail --> Failed
    Failed --> FinalReply
    Cancelled --> FinalReply
    FinalReply --> UI["聊天正文、执行时间线<br/>画布结果与可行动错误"]
```

## 2. 高层意图与任务分流

```mermaid
flowchart TD
    Input["当前轮消息 + CanvasContext<br/>SelectionScope + ComponentReferences"] --> Pi{"Pi Agent 判断"}

    Pi -->|普通问答| Chat["直接流式回复<br/>不创建画板"]
    Pi -->|设计操作| Tool["studio_run_design_workflow"]
    Tool --> Validate["校验 action、taskKind 与 placement"]
    Validate --> Route{"action"}

    Route -->|create-ui| GenericUI["generic-ui<br/>通用 Web / H5 / App / Dashboard"]
    Route -->|create-component| Component["component-design<br/>单个业务组件"]
    Route -->|create-page| Page["page-design<br/>多个业务组件页面"]
    Route -->|create-image| Image["design-image<br/>KV / 海报 / 插画"]
    Route -->|create-assets| Assets["asset-set<br/>独立透明素材"]
    Route -->|revise-design| Patch["design-patch<br/>普通节点局部修改"]
    Route -->|revise-ui-structure| SpecPatch["design-spec-patch<br/>Block 结构修改"]
    Route -->|revise-component| ComponentEdit["component-design<br/>组件实例原位修订"]
    Route -->|revise-page| PageEdit["page-design<br/>页面局部修订"]
    Route -->|revise-page-shell| ShellEdit["page-shell-edit<br/>页面视觉外壳替换"]
    Route -->|regenerate-slot| Slot["component-slot-edit<br/>单个组件素材替换"]
    Route -->|regenerate-slots| Slots["component-slot-batch-edit<br/>批量组件素材替换"]
    Route -->|continue| Continue["恢复 Pending Task<br/>复用 Checkpoint 与 Lease"]
    Route -->|create-artboard| Artboard["仅创建目标画板"]

    ComponentReferences{"存在结构化组件引用？"} -->|一个| Component
    ComponentReferences -->|多个且要求组合页面| Page
    ComponentReferences -->|没有| GenericUI

    Selection{"SelectionScope 类型"} -->|generic-node / multi-node| Patch
    Selection -->|text-range| Patch
    Selection -->|image-region| Patch
    Selection -->|component-instance| ComponentEdit
    Selection -->|component-region| Slot
    Selection -->|component-region-batch| Slots
    Selection -->|page-shell| ShellEdit
```

## 3. 通用 UI 工作流

```mermaid
flowchart TD
    Start["create-ui / generic-ui"] --> Ref["reference.prepare<br/>准备视觉参考"]
    Ref --> Theme["ui.extract-theme<br/>提取 VisualThemeContract"]
    Theme --> Plan["ui.plan<br/>生成 DesignSpec 内容清单"]
    Plan --> Transform["ui.transform<br/>生成 Static HTML/CSS Runtime Draft"]
    Transform --> Security{"静态 Runtime 安全检查"}

    Security -->|包含脚本、事件或非法网络能力| Fallback["转入 DesignSpec Renderer 降级"]
    Security -->|通过| Sandbox["Electron Sandbox BrowserWindow<br/>禁止脚本、导航和连接"]
    Sandbox --> Inspect["读取可见 DOM<br/>ComputedStyle + Bounds + 语义标签"]
    Inspect --> Graph["runtimeDomInspectionToSceneGraph<br/>生成 Canonical Scene Graph"]
    Graph --> Validate{"ui.validate<br/>节点数、深度、叶子和所有权"}

    Validate -->|通过| RuntimeDeliver["generic-ui-runtime Deliverable"]
    Validate -->|不通过| Fallback

    Fallback --> Blocks["按 DesignSpec Block 动态创建<br/>canvas.present-ui-section[]"]
    Blocks --> SectionResult{"Section ACK"}
    SectionResult -->|成功| NextSection["累计成功 Block"]
    SectionResult -->|失败| PartialFailure["标记 partialFailure<br/>保留其他成功 Block"]
    NextSection --> More{"还有 Block？"}
    PartialFailure --> More
    More -->|是| Blocks
    More -->|否| Finalize["generic-ui-finalize<br/>验证顺序、根节点与数量"]

    RuntimeDeliver --> PrepareScene["为 Scene ID 添加 artboard 命名空间<br/>并平移到目标画板坐标"]
    PrepareScene --> Commit["compileSceneCommit<br/>生成 Text / Button / Input / Image / Shape / Section"]
    Commit --> Atomic["单 Revision 原子替换目标画板"]
    Atomic --> Ack["校验根节点、节点集合、数量和 Revision +1"]
    Finalize --> Ack
```

## 4. 业务组件与完整页面工作流

```mermaid
flowchart TD
    Decision{"任务类型"}

    Decision -->|component-design| C1["解析 Component Pack 与组件 JSON"]
    C1 --> C2["source.inspect<br/>检查 Runtime DOM / Thumbnail / Sidecar"]
    C2 --> C3{"Runtime DOM 可用？"}
    C3 -->|是| C4["Electron 静态 Runtime Inspector"]
    C3 -->|否| C5["Thumbnail Vision 或通用 Fallback"]
    C4 --> C6["统一 Component Design Tree"]
    C5 --> C6
    C6 --> C7["生成确定性 Region、Slot 和 Props Binding"]
    C7 --> C8["仅为明确图片 Slot 生成 Raster Artifact"]
    C8 --> C9["合并主题、Runtime 结构与素材"]
    C9 --> C10["Scene Validator<br/>结构、绑定、可编辑覆盖率"]
    C10 --> C11["canvas.commit<br/>component Deliverable"]
    C11 --> C12["Renderer 写入组件节点与实例元数据"]
    C12 --> C13["校验 Root、Instance、Props Patch 与目标画板"]

    Decision -->|page-design| P1["解析多个组件来源"]
    P1 --> P2["生成 Page Blueprint<br/>Section 顺序、尺寸和组件绑定"]
    P2 --> P3{"是否需要结构确认？"}
    P3 -->|需要| P4["awaiting-confirmation<br/>用户排序、删除或调整高度"]
    P4 --> P5["恢复确认后的 Workflow"]
    P3 -->|无需| P5
    P5 --> P6["提取共享页面视觉主题"]
    P6 --> P7["生成 Page Shell"]
    P7 --> P8["增量写入 Page Shell + ACK"]
    P8 --> P9["动态创建 page.generate-component[]"]
    P9 --> P10["多个页面组件可并行生成"]
    P10 --> P11["每个组件完成后增量交付 + ACK"]
    P11 --> P12["page.review<br/>主题、布局、完整性和可编辑性评审"]
    P12 --> P13{"质量问题目标"}
    P13 -->|Page Shell| P14["只修复页面外壳"]
    P13 -->|单个 Section| P15["只修复对应组件"]
    P13 -->|缺失 Slot| P16["只重生成对应素材"]
    P14 --> P11
    P15 --> P11
    P16 --> P11
    P13 -->|通过| P17["canvas.present-page<br/>验证组件数量、顺序和唯一 Shell"]

    Decision -->|component-slot-edit| S1["冻结组件实例与 Slot Scope"]
    S1 --> S2["重新生成单个或批量素材"]
    S2 --> S3["验证尺寸、Artifact 和 Slot Binding"]
    S3 --> S4["原位替换图片节点并同步 Props Patch"]

    Decision -->|page-shell-edit| H1["冻结 Page Shell Scope"]
    H1 --> H2["重新生成页面级视觉外壳"]
    H2 --> H3["校验页面背景约束"]
    H3 --> H4["保留 elementId 原位替换"]
```

## 5. 图片、素材与局部修改工作流

```mermaid
flowchart TD
    Action{"任务类型"}

    Action -->|design-image| I1["reference.prepare<br/>区分 KV / Prototype / Visual / Edit Base"]
    I1 --> I2["design.brief<br/>编译 Generation Brief"]
    I2 --> I3["调用 Images Provider"]
    I3 --> I4["Raster 尺寸、比例、像素和主题分析"]
    I4 --> I5{"质量是否达标？"}
    I5 -->|否且可修正| I6["design.refine<br/>重新生成或局部修正"]
    I6 --> I4
    I5 -->|是| I7["artifact.validate"]
    I7 --> I8["image Deliverable + Canvas ACK"]

    Action -->|asset-set| A1["准备参考图"]
    A1 --> A2["拆分独立素材任务"]
    A2 --> A3["分别调用图片模型"]
    A3 --> A4["逐项验证透明度、尺寸和比例"]
    A4 --> A5["asset-set Deliverable + Canvas ACK"]

    Action -->|design-patch| D1["冻结 SelectionScope、targetHash 和 Revision"]
    D1 --> D2{"简单文本替换？"}
    D2 -->|是| D3["确定性 Action Compiler"]
    D2 -->|否| D4["模型生成 DesignAction"]
    D4 --> D5{"能否编译为受限 Patch？"}
    D5 -->|否| D6["模型生成 DesignPatch"]
    D5 -->|是| D7["得到 DesignPatch"]
    D3 --> D7
    D6 --> D7
    D7 --> D8["校验节点类型、操作白名单和 Revision"]
    D8 --> D9{"包含图片操作？"}
    D9 -->|否| D13["原子应用 Patch"]
    D9 -->|整图替换| D10["生成替换图片"]
    D9 -->|Mask 局部重绘| D11["发送 Edit Base + Mask"]
    D11 --> D12["本地合成并逐像素保护 Mask 外内容"]
    D10 --> D13
    D12 --> D13
    D13 --> D14["校验影响节点、targetHash 和 Revision +1"]

    Action -->|design-spec-patch| S1["读取当前 DesignSpec"]
    S1 --> S2["规划 insert / update / remove / move Block"]
    S2 --> S3["校验 Block ID、Kind、数量和 Revision"]
    S3 --> S4{"基础 Revision 已变化？"}
    S4 -->|没有| S6["应用结构修改"]
    S4 -->|只有无冲突修改| S5["安全 Rebase"]
    S4 -->|同一目标被修改| SError["拒绝提交并提示重新执行"]
    S5 --> S6
    S6 --> S7["重编受影响 Block 与发生位移的后继 Block"]
    S7 --> S8["保留未影响 Block 的稳定 Element ID"]
    S8 --> S9["design-spec-patch ACK"]
```

## 6. Canvas Deliverable 事务

```mermaid
sequenceDiagram
    autonumber
    participant W as Workflow Engine
    participant M as Electron Main
    participant B as DesignTurnCanvasBridge
    participant S as Zustand Editor Store
    participant P as Project Repository

    W->>M: onDeliverable(deliverable)
    M->>B: runtime:deliverable
    B->>S: 检查目标画板与 Lease Revision

    alt 目标画板不存在
        S-->>B: CANVAS_TARGET_EXPIRED
        B-->>M: ACK failed
        M-->>W: Observation failed
    else 目标节点发生冲突修改
        S-->>B: CANVAS_DOCUMENT_REVISION_CONFLICT
        B-->>M: ACK failed
        M-->>W: Observation failed
    else 仅无关节点变化
        B->>B: 安全 Rebase Lease Revision
        B->>S: applyIncrementalCanvasDeliverable
    else Revision 一致
        B->>S: applyIncrementalCanvasDeliverable
    end

    S->>S: 查询 Mutation Ledger 中的 deliveryId
    alt deliveryId 已处理
        S-->>B: 返回历史 Observation
    else 首次交付
        S->>S: 执行原子 Document Mutation
        S->>S: 校验根节点、数量、绑定和 Revision
        alt 后置条件失败
            S-->>B: Canvas ACK failed
        else 后置条件通过
            B->>P: 保存项目快照和 Mutation Ledger
            alt 持久化失败
                B->>S: 回滚 Document 与 Ledger
                B-->>M: CANVAS_MUTATION_PERSIST_FAILED
            else 持久化成功
                P-->>B: saved
                B-->>M: Canvas ACK success
                M-->>W: Observation success
                W->>W: 保存 Step Checkpoint
            end
        end
    end
```

## 7. 状态、恢复与持久化闭环

```mermaid
flowchart LR
    Run["一次 Chat Run"] --> PiSession["Pi SQLite Session<br/>消息与轻量上下文"]
    Run --> DomainSession["Agent Session<br/>Goal、Plan、Step、状态"]
    Run --> Transaction["Canvas Transaction<br/>Lease 与 Revision"]
    Run --> Timeline["Renderer ChatRun<br/>事件时间线"]

    DomainSession --> Checkpoint["Step Checkpoint<br/>inputHash / outputHash"]
    Checkpoint --> ArtifactRepo["Artifact Repository<br/>内容寻址图片与中间产物"]
    Transaction --> Document["DesignDocument<br/>画板、节点、组件实例"]
    Document --> Ledger["Mutation Ledger<br/>deliveryId 幂等记录"]
    Document --> ProjectRepo["Project Repository<br/>项目快照与版本"]
    Timeline --> ProjectRepo

    Retry["重试 / 继续"] --> Validate["校验 Session、Checkpoint<br/>Artifact 与 Canvas Lease"]
    Validate -->|输入哈希一致| Reuse["复用已完成 Step 和 Artifact"]
    Validate -->|输入或依赖变化| Invalidate["失效当前及下游 Checkpoint"]
    Validate -->|画板或选区失效| Stop["停止写入并返回目标过期错误"]
    Validate -->|仅无关节点变化| SafeRebase["安全更新 Lease Revision"]

    Reuse --> Continue["继续执行剩余 Step"]
    Invalidate --> Continue
    SafeRebase --> Continue
    Continue --> Document

    AckFail["Renderer ACK 失败"] --> DomainFailed["Session failed<br/>保存 lastError"]
    PersistFail["项目持久化失败"] --> Rollback["回滚本次 Document Mutation"]
    Rollback --> DomainFailed
    Cancel["用户取消"] --> Aborted["传播 AbortSignal<br/>运行中 Step cancelled"]

    DomainFailed --> Retry
    Aborted --> Retry
```

## 8. 主要代码入口映射

| 流程区域                         | 主要实现                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 页面路由与编辑器外壳             | `src/app/router.tsx`、`src/pages/EditorPage.tsx`                                                      |
| 聊天回合控制                     | `src/features/ai/design-chat-controller.ts`、`agent-chat-run-controller.ts`                           |
| Renderer 与 Electron 通信        | `src/features/ai/api.ts`、`electron/preload.mjs`、`electron/main.mjs`                                 |
| Pi Agent 与高层工具              | `electron/runtime/pi/agent-runtime.mjs`、`electron/runtime/request.mjs`                               |
| 意图与确定性计划                 | `electron/runtime/intent-router.mjs`、`agent-planner.mjs`                                             |
| Workflow Graph 与执行循环        | `electron/runtime/workflow-graph.mjs`、`electron/runtime/agent.mjs`                                   |
| 领域工具实现                     | `electron/runtime/agent-tools.mjs`                                                                    |
| Runtime Plugin 与 Source Adapter | `electron/runtime/plugins/`                                                                           |
| Canvas Target 与事务桥接         | `src/features/editor/utils/workflow-canvas-target.ts`、`src/features/ai/design-turn-canvas-bridge.ts` |
| 增量交付与 ACK                   | `src/features/editor/utils/incremental-delivery.ts`                                                   |
| Scene Graph 与原子提交           | `src/features/editor/scene/`                                                                          |
| 编辑器状态与文档事务             | `src/features/editor/store/editor-store.ts`                                                           |
| 项目、Session 与 Artifact 持久化 | `electron/projects/`、`electron/runtime/agent-session-store.mjs`、`electron/artifacts/`               |

## 9. 核心不变量

1. Pi Agent 是在线高层设计意图的唯一来源，Renderer 不重复判断聊天或设计任务。
2. 模型只能从 `CanvasContext` 提供的候选目标中选择，不能生成任意画板或节点 ID。
3. 所有设计结果必须通过 Canvas Deliverable 写入真实画布，并收到 Renderer ACK。
4. 未通过目标、Revision、节点集合和后置条件校验的交付不能标记完成。
5. `deliveryId` 与 Mutation Ledger 保证重复交付幂等。
6. Checkpoint 只有在输入哈希和依赖输出仍一致时才能复用。
7. Renderer 不读取 API Key；Provider 凭证只存在于 Electron 主进程。
8. 图片 Base64 不写入 Agent 消息或 Tool Observation，生成结果转为 Artifact 保存。
9. 项目持久化失败时回滚对应画布变更，避免内存状态与磁盘状态分叉。
10. 取消、失败和部分成功必须保留已确认的 Artifact、画布节点与可恢复上下文。
