# 代码阅读入口

本文按“应用入口 → 聊天与 Agent → Runtime → 画布提交 → 持久化与导出”的顺序整理主要模块职责。
适合第一次接触项目时建立代码地图，也可作为排查问题时的索引。

## 一、总体文档入口

- [仓库总览 README](../README.md)：产品边界、技术栈、开发命令、目录结构和总体架构。
- [项目流程图](project-flowcharts.md)：从用户输入、Pi 决策到 Canvas ACK、持久化和恢复的完整图示。
- [能力状态](capability-status.md)：区分已实现、部分实现和规划中能力，是判断当前行为的事实索引。
- [技术文档索引](README.md)：按 Runtime、Agent、设计能力、编辑器和交付链路组织专题文档。
- [Agent 总体架构](../agent.md)：Session、Plan、Step、Observation、Artifact 和恢复机制。

## 二、应用与桌面端入口

- [`src/main.tsx`](../src/main.tsx)：React Renderer 启动入口，挂载应用 Router 和全局样式。
- [`src/app/router.tsx`](../src/app/router.tsx)：浏览器与 Electron 路由定义，连接首页、生成页、编辑器和测试 Fixture。
- [`src/components/layout/AppLayout.tsx`](../src/components/layout/AppLayout.tsx)：应用级布局、导航和主内容出口。
- [`src/pages/EditorPage.tsx`](../src/pages/EditorPage.tsx)：编辑器页面总装配，负责项目加载、自动保存、面板组合和导出入口。
- [`electron/main.mjs`](../electron/main.mjs)：Electron 主进程入口，创建窗口、初始化仓库并注册 Project/Runtime IPC。
- [`electron/preload.mjs`](../electron/preload.mjs)：通过 `contextBridge` 暴露受限的项目和 Runtime API。

## 三、聊天输入与 Agent 回合

- [`src/components/ui/PromptComposer.tsx`](../src/components/ui/PromptComposer.tsx)：基于 Lexical 的输入器，管理文本、IME、附件和不可拆分 Mention。
- [`src/features/ai/composer-draft.ts`](../src/features/ai/composer-draft.ts)：定义 Composer Draft，并在 UI 状态和 Runtime 请求之间转换。
- [`src/features/editor/hooks/use-component-mentions.ts`](../src/features/editor/hooks/use-component-mentions.ts)：查询可用组件并生成结构化 `@组件` 候选。
- [`src/features/editor/components/ChatPanel.tsx`](../src/features/editor/components/ChatPanel.tsx)：编辑器聊天入口，提交当前消息、选区、引用图和模型配置。
- [`src/features/editor/components/AiCanvasChat.tsx`](../src/features/editor/components/AiCanvasChat.tsx)：画布内聊天交互和设计任务触发入口。
- [`src/features/ai/design-chat-controller.ts`](../src/features/ai/design-chat-controller.ts)：统一执行一次设计聊天回合，组合 Run Controller 与 Canvas Bridge。
- [`src/features/ai/agent-chat-run-controller.ts`](../src/features/ai/agent-chat-run-controller.ts)：消费 Runtime 事件并维护回复文本、步骤时间线和 Run 终态。
- [`src/features/ai/agent-run.ts`](../src/features/ai/agent-run.ts)：ChatRun 状态模型、事件归并、去重和步骤状态转换。
- [`src/features/ai/api.ts`](../src/features/ai/api.ts)：Renderer 侧 Runtime 客户端，发送 IPC 请求并处理 Token、事件、Deliverable 和 ACK。
- [`src/features/ai/types.ts`](../src/features/ai/types.ts)：Renderer 与 Electron 之间的请求、决策、Deliverable、ACK 和 SelectionScope 协议。

## 四、Runtime 请求与 Pi Agent

- [`electron/runtime/request.mjs`](../electron/runtime/request.mjs)：Runtime 统一请求入口，负责预算校验、Provider 路由、文本任务和生图任务分流。
- [`electron/runtime/pi/agent-runtime.mjs`](../electron/runtime/pi/agent-runtime.mjs)：Pi Agent 主循环，注册 Skill Tool 与唯一设计工作流 Tool，并投影流式事件。
- [`electron/runtime/pi/context-runtime.mjs`](../electron/runtime/pi/context-runtime.mjs)：组装最小 RuntimeContext，只提供决策所需的画布、选区、引用和扩展摘要。
- [`electron/runtime/pi/context-policy.mjs`](../electron/runtime/pi/context-policy.mjs)：控制上下文预算、历史裁剪、Compaction 和 Tool Result 大小。
- [`electron/runtime/pi/model-runtime.mjs`](../electron/runtime/pi/model-runtime.mjs)：注册文本与图片模型，适配 Responses、Messages 和内部网关协议。
- [`electron/runtime/pi/task-runtime.mjs`](../electron/runtime/pi/task-runtime.mjs)：执行视觉主题、UI Schema、Runtime Draft、DesignAction 和 Patch 等结构化模型任务。
- [`electron/runtime/pi/session-store.mjs`](../electron/runtime/pi/session-store.mjs)：将 Pi 消息写入 SQLite，并移除不适合持久化的大体积内容。
- [`electron/runtime/pi/cancellation.mjs`](../electron/runtime/pi/cancellation.mjs)：登记正在运行的 Pi Agent，并将用户取消传播到底层请求。
- [`electron/runtime/pi/turn-budget.mjs`](../electron/runtime/pi/turn-budget.mjs)：限制单轮迭代、Tool、文本模型和图片模型调用次数。
- [`electron/runtime/pi/structured-results.mjs`](../electron/runtime/pi/structured-results.mjs)：校正和规范化模型返回的结构化数据。

## 五、领域工作流与调度

- [`electron/runtime/agent.mjs`](../electron/runtime/agent.mjs)：确定性设计工作流总入口，管理 Canvas Lease、执行循环、Checkpoint、重试和最终状态。
- [`electron/runtime/agent-planner.mjs`](../electron/runtime/agent-planner.mjs)：把 WorkflowDecision 转换为 taskKind、Session 状态和具体 Plan。
- [`electron/runtime/workflow-graph.mjs`](../electron/runtime/workflow-graph.mjs)：从 Plan 中选择依赖已满足的 Ready Step，并允许页面组件步骤并行。
- [`electron/runtime/intent-router.mjs`](../electron/runtime/intent-router.mjs)：Pi 不可用时的同层确定性意图降级，以及选区操作的安全校验。
- [`electron/runtime/agent-tools.mjs`](../electron/runtime/agent-tools.mjs)：领域 Tool Registry，包含参考图、UI、组件、页面、图片、质量检查和画布交付工具。
- [`electron/runtime/plugins/plugin-registry.mjs`](../electron/runtime/plugins/plugin-registry.mjs)：注册 Runtime Plugin、Plan 和 Source Adapter，并校验能力边界。
- [`electron/runtime/plugins/core-design-plugin.mjs`](../electron/runtime/plugins/core-design-plugin.mjs)：通用 UI 的标准阶段与 Prompt Source Adapter。
- [`electron/runtime/plugins/campaign-component-plugin.mjs`](../electron/runtime/plugins/campaign-component-plugin.mjs)：业务组件、页面组合、Slot 编辑和 Page Shell 的 Plan 与 Source Adapter。

## 六、通用 UI 与 Scene Graph

- [`electron/runtime/generic-ui.mjs`](../electron/runtime/generic-ui.mjs)：规范化 DesignSpec、Surface、主题、Breakpoint 和 Block 结构。
- [`electron/runtime/design-catalog.mjs`](../electron/runtime/design-catalog.mjs)：维护可生成的 Design Block Catalog 及其结构约束。
- [`electron/runtime/design-block-registry.mjs`](../electron/runtime/design-block-registry.mjs)：注册内置或扩展 Block 定义。
- [`electron/runtime/component-runtime-inspector.mjs`](../electron/runtime/component-runtime-inspector.mjs)：在隔离的 Electron 窗口中渲染静态 HTML/CSS，并读取真实 DOM 和样式。
- [`electron/runtime/runtime-dom-adapter.mjs`](../electron/runtime/runtime-dom-adapter.mjs)：把 Runtime DOM Inspection 转换为 Canonical Scene Graph。
- [`src/features/editor/scene/scene-graph.ts`](../src/features/editor/scene/scene-graph.ts)：Renderer 侧 Canonical Scene Graph 类型和基础操作。
- [`src/features/editor/scene/scene-validator.ts`](../src/features/editor/scene/scene-validator.ts)：校验节点 ID、父子关系、范围、所有权和节点数量。
- [`src/features/editor/scene/runtime-scene.ts`](../src/features/editor/scene/runtime-scene.ts)：为 Runtime Scene 添加画板命名空间并转换坐标。
- [`src/features/editor/scene/scene-commit.ts`](../src/features/editor/scene/scene-commit.ts)：把 Scene Graph 编译为可写入 DesignDocument 的原生节点事务。
- [`src/features/editor/scene/design-spec-adapter.ts`](../src/features/editor/scene/design-spec-adapter.ts)：把 DesignSpec 编译成统一 Scene Commit。
- [`src/features/editor/scene/component-design-adapter.ts`](../src/features/editor/scene/component-design-adapter.ts)：把组件设计树、绑定和素材转换成统一 Scene Commit。

## 七、组件与页面设计

- [`electron/runtime/component-packs.mjs`](../electron/runtime/component-packs.mjs)：发现和加载 Component Pack，解析 Manifest、组件 Schema 和导出 Adapter。
- [`electron/runtime/component-runtime-adapters.mjs`](../electron/runtime/component-runtime-adapters.mjs)：识别组件 Runtime 类型，并选择 DOM、Thumbnail 或安全降级来源。
- [`electron/runtime/component-design-tree.mjs`](../electron/runtime/component-design-tree.mjs)：合并 Runtime、Thumbnail、Sidecar 与主题信息，形成统一组件设计树。
- [`electron/runtime/page-composition.mjs`](../electron/runtime/page-composition.mjs)：生成和校验 Page Blueprint、Section 顺序和页面布局指标。
- [`electron/runtime/design-eval.mjs`](../electron/runtime/design-eval.mjs)：计算页面和组件质量维度，并生成可执行的 Repair Target。
- [`electron/runtime/vision-review.mjs`](../electron/runtime/vision-review.mjs)：基于画板快照执行可选视觉评审，并将问题定位到 Shell 或 Section。
- [`src/features/editor/utils/component-instances.ts`](../src/features/editor/utils/component-instances.ts)：创建、规范化并维护组件实例与节点绑定。
- [`src/features/editor/utils/component-export.ts`](../src/features/editor/utils/component-export.ts)：生成组件开发包、Props Patch、资源和校验信息。
- [`src/features/editor/utils/page-delivery.ts`](../src/features/editor/utils/page-delivery.ts)：生成完整页面开发包和交付质量报告。

## 八、局部修改与画布事务

- [`electron/runtime/design-action.mjs`](../electron/runtime/design-action.mjs)：把模型生成的语义 DesignAction 转换为受限操作。
- [`electron/runtime/design-action-compiler.mjs`](../electron/runtime/design-action-compiler.mjs)：优先确定性编译简单文本、样式和布局修改。
- [`electron/runtime/design-patch.mjs`](../electron/runtime/design-patch.mjs)：规范化并校验普通节点 DesignPatch。
- [`electron/runtime/design-spec-patch.mjs`](../electron/runtime/design-spec-patch.mjs)：规范化并校验 DesignSpec Block 结构修改。
- [`src/features/editor/utils/selection-scope.ts`](../src/features/editor/utils/selection-scope.ts)：冻结节点、文本范围、图片 Mask、组件和 Page Shell 选区。
- [`src/features/ai/design-turn-canvas-bridge.ts`](../src/features/ai/design-turn-canvas-bridge.ts)：处理 Canvas Target、Lease Revision、Deliverable 和项目持久化。
- [`src/features/ai/canvas-rebase.ts`](../src/features/ai/canvas-rebase.ts)：判断任务执行期间的画布变化能否安全重基。
- [`src/features/editor/utils/workflow-canvas-target.ts`](../src/features/editor/utils/workflow-canvas-target.ts)：根据 Placement 创建、复用或复制目标画板。
- [`src/features/editor/utils/incremental-delivery.ts`](../src/features/editor/utils/incremental-delivery.ts)：按 Deliverable 类型执行幂等画布写入和严格后置条件校验。
- [`src/features/editor/utils/mutation-ledger.ts`](../src/features/editor/utils/mutation-ledger.ts)：记录 deliveryId 与 Observation，防止重试造成重复写入。
- [`src/features/editor/utils/layer-tree.ts`](../src/features/editor/utils/layer-tree.ts)：维护手工 Group、兄弟层级顺序、拖拽 Reparent 和画布绘制顺序。
- [`src/features/editor/store/editor-store.ts`](../src/features/editor/store/editor-store.ts)：DesignDocument 的唯一 Renderer 状态源，承载节点编辑、事务、Undo/Redo 和聊天状态。

## 九、图片生成与 Raster 处理

- [`electron/runtime/generation-brief.mjs`](../electron/runtime/generation-brief.mjs)：把目标、参考图职责、尺寸和透明度要求编译为 Generation Brief。
- [`electron/runtime/raster-analysis.mjs`](../electron/runtime/raster-analysis.mjs)：解析、缩放、裁剪、透明度检查、主题分析和 Mask 合成。
- [`electron/runtime/raster-worker-client.mjs`](../electron/runtime/raster-worker-client.mjs)：把耗时 Raster 归一化任务派发到 Worker，并处理取消和超时。
- [`electron/runtime/raster-worker.mjs`](../electron/runtime/raster-worker.mjs)：在 Worker Thread 中执行图片归一化，避免阻塞主进程。
- [`src/features/editor/utils/image-mask.ts`](../src/features/editor/utils/image-mask.ts)：Renderer 侧图片矩形、画笔和擦除 Mask 数据处理。
- [`src/features/editor/utils/rasterize-node.ts`](../src/features/editor/utils/rasterize-node.ts)：将选中节点或子树稳定地栅格化为 PNG。
- [`src/features/editor/utils/artboard-snapshot.ts`](../src/features/editor/utils/artboard-snapshot.ts)：生成画板级快照，供视觉评审、导出和回归测试使用。

## 十、持久化、扩展与安全边界

- [`electron/projects/project-repository.mjs`](../electron/projects/project-repository.mjs)：项目快照、版本历史、迁移、损坏备份和恢复。
- [`electron/artifacts/artifact-repository.mjs`](../electron/artifacts/artifact-repository.mjs)：内容寻址保存 Raster/SVG Artifact，避免大数据进入 Session。
- [`electron/runtime/agent-session-store.mjs`](../electron/runtime/agent-session-store.mjs)：领域 Session 与 Step Checkpoint 的原子读写。
- [`electron/runtime/agent-run-logger.mjs`](../electron/runtime/agent-run-logger.mjs)：开发环境下记录 Agent 事件，便于复盘执行过程。
- [`electron/runtime/providers.mjs`](../electron/runtime/providers.mjs)：Provider 白名单、模型解析、能力声明和统一 Runtime Error。
- [`electron/runtime/env.mjs`](../electron/runtime/env.mjs)：只在主进程读取 Provider URL 与凭证，并向 Renderer 返回脱敏状态。
- [`electron/runtime/skills.mjs`](../electron/runtime/skills.mjs)：发现、激活和读取内置/用户 Skill，并校验 Tool 名称与资源路径。
- [`electron/runtime/user-extensions.mjs`](../electron/runtime/user-extensions.mjs)：安装、启停和删除用户 Skill 与 Style Pack。

## 十一、画布渲染、属性编辑与响应式

- [`src/features/editor/components/InfiniteCanvas.tsx`](../src/features/editor/components/InfiniteCanvas.tsx)：无限画布、缩放、平移和画板交互容器。
- [`src/features/editor/components/ArtboardFrame.tsx`](../src/features/editor/components/ArtboardFrame.tsx)：画板边界、选择状态与节点渲染入口。
- [`src/features/editor/components/ElementRenderer.tsx`](../src/features/editor/components/ElementRenderer.tsx)：按节点类型渲染文本、图片、形状、按钮和容器。
- [`src/features/editor/components/LayerPanel.tsx`](../src/features/editor/components/LayerPanel.tsx)：展示节点层级、显隐、锁定和选择状态。
- [`src/features/editor/components/PropertyPanel.tsx`](../src/features/editor/components/PropertyPanel.tsx)：根据当前选区展示 Schema 驱动的属性编辑器。
- [`src/features/editor/inspector/inspector-schema.ts`](../src/features/editor/inspector/inspector-schema.ts)：定义不同节点和选择状态下可显示、可写入的属性字段。
- [`src/features/editor/utils/auto-layout.ts`](../src/features/editor/utils/auto-layout.ts)：处理 Auto Layout、Padding、Gap、Hug、Fill 和嵌套布局传播。
- [`src/features/editor/utils/responsive-preview.ts`](../src/features/editor/utils/responsive-preview.ts)：编译多 Breakpoint 只读预览和视觉差异提示。

## 十二、代码生成与交付

- [`src/features/codegen/compiler-registry.ts`](../src/features/codegen/compiler-registry.ts)：代码生成统一入口，选择 HTML、React 或 Vue 编译器。
- [`src/features/codegen/normalize-scene.ts`](../src/features/codegen/normalize-scene.ts)：把画布节点规范化为代码生成使用的中间结构。
- [`src/features/codegen/code-ir.ts`](../src/features/codegen/code-ir.ts)：定义跨框架 Code IR，隔离画布模型和最终源码。
- [`src/features/codegen/layout-pass.ts`](../src/features/codegen/layout-pass.ts)：推导 Flex/Grid/绝对定位等布局表达。
- [`src/features/codegen/semantic-pass.ts`](../src/features/codegen/semantic-pass.ts)：为节点推导更合适的 HTML 语义标签。
- [`src/features/codegen/component-pass.ts`](../src/features/codegen/component-pass.ts)：识别可复用组件和 Runtime Component 边界。
- [`src/features/codegen/asset-pass.ts`](../src/features/codegen/asset-pass.ts)：收集图片资源并决定远程引用或下载模式。
- [`src/features/codegen/compilers/`](../src/features/codegen/compilers)：将 Code IR 分别编译为 HTML、React 和 Vue 源码。
- [`src/features/codegen/validators/code-validator.ts`](../src/features/codegen/validators/code-validator.ts)：校验输出文件、依赖、资源引用和框架约束。
- [`src/features/codegen/export-code-package.ts`](../src/features/codegen/export-code-package.ts)：打包源码、资源和 Manifest，形成可下载开发包。

## 十三、验证入口

- [`scripts/`](../scripts)：按 Agent、Runtime、Scene、组件、页面、图片、导出等领域拆分的 Node 回归测试。
- [`tests/e2e/editor.spec.ts`](../tests/e2e/editor.spec.ts)：编辑器主要交互 E2E。
- [`tests/e2e/artboard-snapshot.spec.ts`](../tests/e2e/artboard-snapshot.spec.ts)：画板快照和文字栅格化回归。
- [`tests/e2e/responsive-visual.spec.ts`](../tests/e2e/responsive-visual.spec.ts)：多端响应式视觉基线。
- [`tests/e2e/codegen-parity.spec.ts`](../tests/e2e/codegen-parity.spec.ts)：画布与代码生成结果的一致性验证。

## 推荐阅读顺序

1. `README.md` 与 `docs/project-flowcharts.md`：先理解产品边界和完整链路。
2. `src/pages/EditorPage.tsx` → `design-chat-controller.ts` → `api.ts`：理解 Renderer 如何发起一次设计回合。
3. `electron/main.mjs` → `request.mjs` → `pi/agent-runtime.mjs`：理解 IPC、模型和 Pi Agent 入口。
4. `agent.mjs` → `agent-planner.mjs` → `workflow-graph.mjs` → `agent-tools.mjs`：理解确定性执行、恢复和交付。
5. `design-turn-canvas-bridge.ts` → `incremental-delivery.ts` → `editor-store.ts`：理解结果如何真正写入画布。
6. 根据任务进入 `generic-ui`、组件页面、Raster、Patch 或 Codegen 专题模块。
