# Scene Graph 与 Source Adapter 重构方案

> 状态：P5.2 已完成，通用 UI 已接入 Render First Runtime Draft 与原子 Scene Commit
> 基线日期：2026-08-26

## 1. 背景

产品目标是通用 AI 设计软件，而不是活动组件配置器。当前业务组件链路已经将以下概念放进核心 Agent 和 Canvas：

```text
Component Contract
Component Profile
Thumbnail Vision
Runtime DOM Inspect
Visual Shell
Props Slot
Props Patch
Component Export
Runtime Validation
```

这些能力单独都有效，但同时参与一次交付时会产生多个视觉事实源。当前 EraLottery 案例中：

```text
Runtime DOM Inspect       26 个节点
Component Plan             7 个区域
Props Asset Generation     3 个素材
Visual Shell               1 张完整背景
Compose                    29 个可编辑节点
```

最终画布同时包含完整粉色外壳、Runtime DOM 投影、Slot 素材和原生文本/按钮。左上角青色节点、重复按钮和风格割裂不是单一识别错误，而是架构允许多个层重复拥有同一视觉区域。

此外，3 个素材任务耗时约 9 分钟，说明组件流程默认调用生图模型的成本过高。DOM 已经提供真实结构时，继续生成完整外壳和所有 Slot 并不能稳定提升质量。

## 2. 重构目标

核心设计软件只理解统一 Scene Graph，不理解具体业务组件协议：

```text
任意输入
  -> Source Adapter
  -> Canonical Scene Graph
  -> Design Transform
  -> Canvas Transaction
  -> Export Adapter
```

目标包括：

1. 页面、后台、H5、图片、HTML 和业务组件共享同一个画布编译器。
2. 每个视觉区域只有一个 Owner，禁止重复渲染。
3. Runtime DOM Inspector 成为通用 HTML/Runtime 导入器。
4. Props、Slot 和组件导出迁移到可选 Component Plugin。
5. 没有安装业务插件时，产品仍是完整的 AI 设计软件。
6. Raster 只用于明确需要位图的叶子节点，Editable Scene 禁止生成完整组件外壳。

## 3. 单一视觉所有权

一次设计任务必须选择以下一种主交付模式，三者互斥。

### 3.1 Editable Scene 模式

适用于后台、Web、H5、App、DOM 导入和需要继续编辑的设计稿。

```text
Scene Graph Nodes 是唯一视觉事实源
Raster 只允许作为 image/background-image 叶子节点
```

禁止额外添加覆盖整个 Frame 的 Visual Shell。

### 3.2 Raster Composition 模式

适用于 KV、海报、插画和用户明确要求的一整张图片。

```text
单张 Raster 是唯一视觉事实源
不叠加伪可编辑 DOM/Text/Button 节点
```

需要编辑时使用图片 Mask 或重新生成，不伪装成结构化 UI。

### 3.3 Runtime Snapshot 模式

适用于只查看真实组件运行状态。

```text
Runtime Screenshot 是唯一视觉事实源
DOM Tree 只用于检查、定位和元数据，不重复显示
```

用户选择“转换为可编辑设计”后，才把 DOM Tree 转成 Editable Scene。

## 4. Canonical Scene Graph

核心节点不包含 Component 专用字段：

```ts
interface SceneGraph {
  version: 1
  id: string
  rootNodeId: string
  mode: 'editable-scene' | 'raster-composition' | 'runtime-snapshot'
  surface: {
    kind: 'mobile' | 'desktop-web' | 'desktop-admin' | 'custom'
    width: number
    height: number
  }
  nodes: SceneNode[]
  tokens?: DesignTokens
  diagnostics?: SceneDiagnostic[]
}

interface SceneNode {
  id: string
  type: 'frame' | 'group' | 'text' | 'shape' | 'image' | 'button' | 'input'
  parentId?: string
  bounds: { x: number; y: number; width: number; height: number }
  layout?: SceneLayout
  style?: SceneStyle
  content?: string
  asset?: { source: string; fit?: string }
  source: {
    adapterId: string
    sourceNodeId?: string
    confidence: number
  }
  ownership: {
    regionId: string
    role: 'structure' | 'raster' | 'snapshot'
  }
  bindings?: Record<string, unknown>
}
```

`bindings` 是不透明扩展数据。Canvas 核心只保存，不解释：

```json
{
  "runtime.domPath": "#app > div:nth-child(2)",
  "component.instanceId": "instance-1",
  "component.propsPath": "style.drawButton.image",
  "figma.nodeId": "12:34"
}
```

解释和导出绑定由对应插件负责。

## 5. Source Adapter

所有输入源使用同一接口：

```ts
interface SourceAdapter<Input> {
  id: string
  supports(input: unknown): boolean
  inspect(input: Input, context: AdapterContext): Promise<SourceInspection>
  toSceneGraph(inspection: SourceInspection, context: AdapterContext): Promise<SceneGraph>
}
```

内置 Adapter：

| Adapter | 输入 | 输出 |
| --- | --- | --- |
| Prompt Adapter | 自然语言 | DesignSpec/Scene Graph |
| Image Adapter | 图片、KV、原型 | Raster 或视觉 Token |
| Runtime DOM Adapter | HTML、JS、CSS、URL | DOM Scene Graph |
| Generic Schema Adapter | 通用 JSON Schema | 表单/列表结构 Scene Graph |
| DesignSpec Adapter | Block Spec | 通用 UI Scene Graph |

Prompt Adapter 当前采用双层输出：先生成 DesignSpec 作为语义内容清单，再生成 Static HTML/CSS Runtime Draft。正常路径通过 Electron DOM Inspector 得到 Scene Graph；只有 Runtime Draft 生成、沙箱渲染或 Scene 质量门禁失败时才调用 DesignSpec Adapter。

```text
Prompt
  -> DesignSpec Content Inventory
  -> Static HTML/CSS Runtime Draft
  -> Electron Sandbox
  -> DOM + ComputedStyle + Bounds
  -> Canonical Editable Scene
  -> Namespaced Atomic Canvas Commit
```

该路径允许模型自由决定低代码平台、IDE、后台、网站和移动页面的真实布局，同时保留可验证、可降级的内容契约。

可选 Adapter：

| Adapter | 所属插件 |
| --- | --- |
| Campaign Component Adapter | 活动组件插件 |
| Figma Adapter | Figma 插件 |
| React Export Adapter | 开发交付插件 |

## 6. Runtime DOM Adapter

现有 `component-runtime-inspector.mjs` 迁移为通用 `runtime-dom-adapter`：

```text
Remote JS/CSS 或 HTML
  -> 隔离 Sandbox Runtime
  -> DOM + Computed Style + Bounds
  -> DOM Inspection Tree
  -> Scene Graph
```

它不再负责：

- 选择组件 Profile
- 生成 Props Patch
- 规划图片 Slot
- 生成 Visual Shell
- 验证业务组件 Runtime

结构导入规则：

1. 文本、按钮、输入框和真实图片转换为叶子节点。
2. 有填充、边框、阴影或布局职责的元素转换为 Frame/Shape。
3. 纯包装且只有一个子节点的 DOM 不进入 Scene Graph。
4. 重叠节点按 DOM 父子关系保留，不按面积盲目去重。
5. Runtime 样式是原型基线；用户提供 KV 后通过 Token Transform 重设计。

## 7. Design Transform

Source Adapter 只负责结构事实，设计风格统一由 Transform 处理：

```text
Scene Graph
  -> Theme Token Extraction
  -> Semantic Role Mapping
  -> Layout Normalization
  -> Contrast/Readability Guard
  -> Asset Requirement Planning
  -> Final Scene Graph
```

KV 不再生成一张完整 Visual Shell 覆盖 DOM，而是映射：

- page/background/surface Token
- primary/secondary/accent Token
- heading/body/muted Text Token
- radius、border、shadow、spacing
- 明确的 image 节点视觉提示

只有无法通过 Shape、Text 和 CSS 表达的插画、纹理、商品图或复杂装饰，才创建 Raster Asset Task。

## 8. Component Plugin

活动组件能力迁移为可选插件：

```text
Campaign Component Plugin
  ├── Component Pack Registry
  ├── Component JSON -> Adapter Input
  ├── Props Schema / Binding
  ├── Slot Binding
  ├── Props Patch Export
  └── Runtime Validation
```

插件调用通用 Runtime DOM Adapter 得到 Scene Graph，再附加不透明 Component Binding。核心 Agent 不再执行固定 `component.*` 流水线。

未安装插件时：

- 仍可把 JS/CSS/HTML 导入为普通可编辑设计。
- 不显示 Props、Slot 和组件导出。
- 不影响 Prompt、Image、后台 UI 和页面设计。

## 9. Agent 工作流

Agent 只选择高层设计意图和 Adapter：

```text
reference.prepare
source.inspect
source.to-scene
design.transform
scene.validate
canvas.commit
```

组件请求不再固定执行 10 个专用步骤。下面三类用户意图需要明确区分：

| 用户意图 | 交付模式 |
| --- | --- |
| “导入这个组件/网页” | Editable Scene，保留原始 DOM 风格 |
| “根据这个 KV 重设计组件” | Editable Scene + Token Transform |
| “生成一张组件效果图” | Raster Composition |
| “预览真实组件运行效果” | Runtime Snapshot |
| “导出业务 Props” | Component Plugin Export |

## 10. 当前案例的正确执行方式

用户输入“根据图 1 设计 EraLottery 组件”时：

```text
1. Component Plugin 解析 JSON 和 Props Binding
2. Runtime DOM Adapter 导入真实结构
3. KV Adapter 提取粉色主题 Token
4. Design Transform 将 Token 应用到 DOM Scene Graph
5. 只为确实需要图片的 Slot 规划素材
6. Canvas Commit 一次性写入 Scene Graph
```

禁止：

```text
完整粉色 Visual Shell
+ 原始 Runtime DOM 节点
+ Thumbnail Vision 节点
+ 3 个带背景的 Slot 图片
```

Runtime DOM 成功后，Thumbnail 只用于差异检查，不再进入 Canvas。组件背景若已由 Scene Graph Frame 表达，不再生成整张背景图。

## 11. 性能预算

| 阶段 | 预算 |
| --- | ---: |
| Source Inspect | 15 秒 |
| Scene Graph 编译 | 1 秒 |
| Theme Transform | 10 秒 |
| 单个必要 Raster Asset | 90 秒 |
| 默认 Raster Asset 数量 | 0 |
| 单次任务最大自动 Raster 数量 | 2 |
| 无 Raster 的可编辑稿总时间 | 30 秒 |

超过预算时必须输出具体失败步骤，不允许长时间静默重试。素材生成失败保留原节点或占位，不得用大色块伪装成功。

## 12. 质量门禁

Scene Commit 前必须满足：

1. 每个视觉区域只有一个 Owner。
2. 不存在覆盖整个 Frame 的 Raster 与同区域原生节点同时可见。
3. Text/Button 文案不能来自内部 ID 或 Role fallback。
4. Runtime 和 Thumbnail 的重复节点不能同时进入 Scene Graph。
5. Raster 节点必须有明确 `assetRole`，不能用于替代可原生表达的 UI。
6. 节点必须位于父 Frame 内，除非明确允许 overflow。
7. 主题对比度和文字可读性通过。
8. Canvas ACK 返回的节点数必须等于 Scene Commit 节点数。

## 13. 迁移计划

### P0：冻结组件专用扩张

- 不再向核心新增组件名称、Props 类型或控制器特判。
- 当前问题只修阻断性错误，不继续增加叠层过滤规则。

### P1：建立 Scene Graph 核心

- [x] 定义 `SceneGraph`、`SceneNode`、诊断协议、Validator 和 Scene Commit。
- [x] 将 Generic UI/DesignSpec 全量编译结果接入 Scene Graph。
- [x] Generic UI 全量写入只消费校验通过的 Scene Commit。
- [x] 校验稳定 ID、父子关系、循环、边界、Source Owner、伪文案和全画布 Raster 所有权冲突。
- [x] 将 Generic UI 增量 Block Patch、结构 Patch、响应式重排和预览迁移为 Scene Transaction。

P1 当前实现位置：

```text
src/features/editor/scene/scene-graph.ts
src/features/editor/scene/scene-validator.ts
src/features/editor/scene/design-element-adapter.ts
src/features/editor/scene/design-spec-adapter.ts
src/features/editor/scene/design-spec-transaction.ts
src/features/editor/scene/scene-commit.ts
scripts/test-scene-graph.mjs
```

当前采用受控迁移：DesignSpec 暂时复用既有确定性布局编译器，再转换为 Canonical Scene Graph，经严格校验后编译为 Scene Commit。这样先建立统一事务边界，不在同一阶段重写已经稳定的布局算法。

P1.1 已增加 Region Scene Transaction：

- 先编译并校验完整目标 Scene，再计算 Region Diff。
- 变化 Region 使用新 Commit，未变化 Region 保留当前节点和用户修改。
- 删除 Region、受影响节点和 Block Root ID 由事务统一返回。
- 手工节点不属于受管 Scene，事务始终保留。
- 画板缩放、断点切换、批量 Token 和响应式预览不再直接消费旧编译器结果。
- 不再扫描或迁移 Legacy Generic UI Root。

### P2：迁移 Runtime DOM

- [x] Runtime Inspector 提供与组件协议无关的 `inspectRuntimeDomSource` 输入。
- [x] 新增 `runtime-dom-adapter`，把 DOM Inspection 编译为 Canonical Scene Graph。
- [x] 提取 DOM Path、图片来源和 Computed Style，并写入 Source/Binding。
- [x] 压缩无填充、边框、阴影且最多只有一个子节点的包装层。
- [x] Runtime Scene 使用 `editable-scene`，所有节点由 `runtime-dom` Source 独占结构所有权。
- [x] Runtime 成功后跳过 Thumbnail Vision 和完整 Visual Shell。
- [x] Component Contract 只为匹配节点附加 Props/Slot Binding，不再补充第二套可见结构。
- [x] Runtime 模式只生成明确的 Props 图片叶子素材。

P2 当前实现位置：

```text
electron/runtime/component-runtime-inspector.mjs
electron/runtime/runtime-dom-adapter.mjs
electron/runtime/component-design-tree.mjs
electron/runtime/agent-tools.mjs
scripts/test-runtime-dom-adapter.mjs
scripts/test-component-runtime-inspector.mjs
```

组件流程当前通过 Component Plugin Bridge 将 Runtime Scene 映射到已有组件绑定和 Canvas 节点。Scene Graph 是结构事实源；Bridge 只附加业务 Binding。P3 将继续把这段 Bridge、Props、Slot 和 Export 从核心 Agent Tools 移入独立 Component Plugin。

### P3：迁移 Component Plugin

- [x] 核心 Planner 不再定义或直接选择组件、组件页面、Slot 和页面外壳计划。
- [x] Campaign Component Plugin 声明计划、能力和工具所有权。
- [x] Tool Registry 只暴露已启用插件声明的组件工具；禁用插件后不注册 `component.*`、组件页面工具和对应 Canvas 交付工具。
- [x] 无插件时 Generic UI、普通生图、独立素材和通用局部编辑保持可用。
- [x] 组件请求在无插件时明确返回 `COMPONENT_PLUGIN_MISSING`，禁止降级为整图。
- [ ] UI 中组件 Props、Slot 和 Export 面板迁入可独立启停的插件贡献点。
- [x] P4 已用统一 Source/Scene 阶段封装插件内部 `component.*` 实现，公开计划不再暴露业务工具。

P3 当前实现位置：

```text
electron/runtime/plugins/plugin-registry.mjs
electron/runtime/plugins/campaign-component-plugin.mjs
electron/runtime/agent-planner.mjs
electron/runtime/agent-tools.mjs
electron/runtime/agent.mjs
scripts/test-component-plugin-boundary.mjs
```

当前边界规则：

1. 核心 Planner 只维护 Generic UI、图片、独立素材和通用 Patch 计划。
2. `component-design`、`page-design`、Slot 编辑和页面外壳编辑计划由 Campaign Plugin 提供。
3. Agent Tools 内的既有组件执行函数暂作为 Plugin Bridge Implementation Catalog，不会自动成为可执行工具。
4. 插件安装阶段从 Catalog 选择并注册声明工具；未安装插件时这些实现不可发现、不可执行。
5. 页面组合属于 Campaign Plugin，因为当前页面语义仍依赖 Component Pack；普通后台和 Web 页面继续走核心 Generic UI。

### P4：统一 Agent

- [x] 单组件主计划已改为 `source.inspect -> source.to-scene -> design.transform -> scene.validate -> canvas.commit`。
- [x] Campaign Plugin 通过 `sourceAdapters` 声明 Task Kind、阶段和内部实现映射。
- [x] Contract、Runtime DOM、Thumbnail、Props 和 Slot 工具已变成 Adapter 私有实现，不再出现在 Agent Tool Registry。
- [x] 每个通用阶段保留内部工具及执行摘要，失败会定位到具体 Source Adapter 阶段。
- [x] Runtime Scene 仍是唯一结构 Owner，统一阶段没有恢复 Thumbnail 或 Visual Shell 叠层。
- [x] 组件页面组合已迁移为 Page Source Adapter，并保留 Blueprint 确认和组件增量交付。
- [x] Adapter Memory 随通用阶段检查点保存，确认后继续、失败重试和应用重启恢复不会丢失私有阶段结果。
- [x] `pause`、`nextSteps` 和 `decision` 必须由 Adapter 按阶段显式授权，禁止跨 Adapter 传播动态步骤。
- [x] Generic UI/DesignSpec 已迁移为不可卸载的 Prompt Source Adapter，无需 Campaign Plugin。
- [x] Generic UI 保留逐 Block 动态子任务、失败隔离、稳定节点 ID 和响应式场景事务。
- [x] `ui.extract-theme`、`ui.plan`、`ui.transform`、`ui.validate` 和最终 UI Present 已改为 Adapter 私有实现。
- [x] 删除旧 Component Blueprint 到 Canvas 的直接节点构造分支，组件统一消费 Canonical Scene Commit。
- [x] 组件 Region 使用稳定 Element ID，整体修订不再为同一 Region 创建随机新节点。
- [x] Component Binding 作为 Scene Node 的不透明 Binding 往返保存，Scene 核心不解释 Props。
- [x] Editable Scene 抑制全尺寸组件 Visual Shell，背景、文字、按钮和图片 Slot 由单一 Owner 表达。

P4.1 单组件计划现在固定为：

```text
reference.prepare
source.inspect
source.to-scene
design.transform
scene.validate
canvas.commit
```

Campaign Component Source Adapter 的内部阶段：

```text
source.inspect
  component.resolve
  component.inspect-runtime
  component.inspect-thumbnail  # Runtime Scene 成功时自动跳过

source.to-scene
  component.plan
  component.plan-assets

design.transform
  component.generate-assets    # 仅存在必要图片 Slot 时
  component.validate-assets    # 仅存在必要图片 Slot 时
  component.apply-theme
  component.compose

canvas.commit
  canvas.present-component
```

这些内部名称只用于 Adapter 诊断和迁移期实现目录，Agent 无法直接选择或调用它们。组件完整流程从原来的 10 个公开步骤减少为 6 个稳定步骤，新增组件类型不再改变核心 Planner。

P4.2 页面公开计划：

```text
reference.prepare
source.inspect
source.to-scene
source.confirm
design.transform
scene.validate
canvas.commit
```

Page Source Adapter 内部阶段：

```text
source.inspect
  page.resolve-components

source.to-scene
  page.blueprint

source.confirm
  page.confirm-blueprint
  -> pause: blueprint-confirmation

design.transform
  page.extract-theme
  page.generate-shell
  -> nextSteps: page.generate-component[]

scene.validate
  page.review
  -> decision: targeted-repair

canvas.commit
  canvas.present-page
```

双组件页面的稳定计划为 7 个统一阶段加 2 个动态组件子任务。页面外壳在 `design.transform` 完成后增量写入，各组件完成后分别增量写入，最终 `canvas.commit` 只负责原子确认完整交付。

P4.3 Prompt Source Adapter：

```text
reference.prepare

source.inspect
  ui.extract-theme

source.to-scene
  ui.plan

design.transform
  ui.transform

scene.validate
  ui.validate
  -> nextSteps: canvas.present-ui-section[]

canvas.commit
  canvas.present-ui
```

Prompt Source Adapter 属于不可卸载的 `core-design` 插件。即使传入空的可选插件列表，后台、Dashboard、Web、H5 和 App 的通用 DesignSpec 生成仍然可用。Campaign Plugin 只增加业务组件能力，不再决定通用设计软件是否可用。

P4.4 Component Design Scene Adapter：

```text
ComponentDesignMeta + Props/Slot Binding
  -> campaign-component-design Scene Adapter
  -> Canonical Scene Graph
  -> Scene Validator
  -> Scene Commit
  -> Editor Store 原子写入
```

实现位置：

```text
src/features/editor/scene/component-design-adapter.ts
src/features/editor/store/editor-store.ts
scripts/test-scene-graph.mjs
scripts/test-component-canvas.mjs
```

组件 Scene 规则：

1. Root、Region、Props Binding 先进入 Scene Graph，Store 不再逐类型创建画布节点。
2. Region Element ID 基于 Root ID 和 Region ID 稳定生成，组件修订保持节点身份。
3. 图片 Slot 是 `image` 叶子节点，颜色、文字和按钮使用原生节点。
4. 全尺寸组件 Visual Shell 不再生成，也不再存在于 Agent、IPC、Renderer、Store 和导出契约中。
5. 页面级背景仍属于 Page Scene，可作为独立 Page Shell 放在所有组件之后，不与组件内部结构争夺 Owner。

### P5：清理和兼容截止

- [x] 删除组件 Visual Shell 的生成任务、主题修订、fallback、合成和质量检查路径。
- [x] 删除 Agent 返回值、IPC Deliverable、Renderer API、Store、Scene Adapter 和组件导出包中的组件 Shell 字段。
- [x] Runtime、thumbnail 和 contract fallback 都只提交原生可编辑节点与明确的 Props 图片 Slot。
- [x] 无图片 Slot 组件不调用生图模型；有 Slot 组件按叶子任务独立生成和重试。
- [x] 页面级 Page Shell 保留，且继续作为页面背景的唯一 Owner。
- [ ] 将 UI 中 Props、Slot 和 Export 面板迁入可独立启停的插件贡献点。
- [ ] 将核心中的 Props Patch 和 Slot 私有执行函数继续下沉到 Campaign Plugin 实体模块。

P5.1 验证入口：

```text
npm run test:component-design
npm run test:component-canvas
npm run test:component-export
npm run test:page-agent
npm run test:scene-graph
npm run lint
npm run build
```

## 14. 风险

| 风险 | 处理方式 |
| --- | --- |
| Scene Graph 首次迁移范围大 | 先接 Generic UI，再迁 Runtime DOM，最后迁组件插件 |
| 复杂 DOM 无法完全还原 | 保留 Runtime Snapshot 模式，不伪装完全可编辑 |
| 组件 Props 绑定丢失 | Binding 作为不透明元数据原样迁移 |
| React/Vue Runtime 差异 | Framework Adapter 只负责挂载，DOM 协议保持统一 |
| 生图效果弱于完整外壳 | 仅对明确 Raster 区域生图，并允许用户主动选择效果图模式 |

## 15. 验收标准

完成重构后，同一 EraLottery 案例必须满足：

- Runtime DOM 成功后不再调用 Thumbnail Vision 生成节点。
- Editable Scene 不生成完整 Component Visual Shell。
- 默认 Raster Asset 数量为 0；只有用户或绑定明确要求时才生成。
- 画布不存在重复按钮、伪文案和覆盖结构的大色块。
- 原型结构、文案和层级来自 Runtime DOM。
- KV 通过 Token Transform 改变主题，不覆盖结构。
- 无生图情况下 30 秒内完成。
- Component Plugin 可以基于 Binding 导出 Props Patch。
