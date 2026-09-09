# 通用组件设计树方案

## 1. 目标

通用 AI 设计工具不能把每个业务组件都做成一套定制逻辑，也不应要求所有用户提供组件源码。组件设计的基础输入只需要：

```text
组件 JSON + thumbnail + 当前 KV/视觉参考图
```

输出必须是可编辑的通用设计节点，而不是一张完整组件图片：

```text
Component Design Tree
  -> 原生 Canvas Elements
  -> Props Patch / Theme Binding
  -> 可编辑设计稿
```

真实组件源码和 Runtime Inspect 作为可选增强能力，不作为基础生成前提。

## 2. 能力分层

### Level 1：Contract Projection

从 JSON 提取可设计能力：

- width、height、x、y、padding、gap、radius
- color、background、textColor、borderColor
- image、backgroundImage、animation Slot
- title、label、description、button 文案
- visible、show、enable 等结构开关
- 数组、列表、表单字段和重复项结构

不确定的业务属性保留为 `passthroughProps`，禁止猜测或覆盖。

### Level 2：Thumbnail Vision Design Tree

没有源码时，AI 读取 thumbnail，识别通用视觉节点：

```text
page、container、surface、heading、text、image、icon、button、input、progress、list、list-item、divider、badge
```

视觉识别结果必须包含：

```json
{
  "id": "visual-node-1",
  "type": "button",
  "role": "task-action",
  "bounds": { "x": 260, "y": 180, "width": 90, "height": 36 },
  "text": "去完成",
  "confidence": 0.86,
  "source": "thumbnail-vision"
}
```

无法绑定业务 Props 的节点也要保留，并标记：

```json
{
  "bindingStatus": "visual-only",
  "propPath": null,
  "editable": true
}
```

### Level 3：Runtime Inspect（可选）

组件 JSON 可以声明 `componentJs`、`componentCss` 和 `framework`。Runtime 在独立 Electron Sandbox 中加载组件 Bundle、注入默认 Props，并从真实 DOM 提取节点、文本、Computed Style 和 BoundingBox。它用于提高准确度和开发一致性，但不是通用组件生成的前置条件。

数据优先级：

```text
Runtime Inspect > Component JSON > Thumbnail Vision
```

## 3. Canonical Component Design Tree

三类输入统一为通用设计树：

```ts
interface DesignTreeNode {
  id: string
  type:
    | 'container'
    | 'surface'
    | 'text'
    | 'button'
    | 'image'
    | 'icon'
    | 'input'
    | 'progress'
    | 'list'
    | 'list-item'
    | 'divider'
    | 'badge'
  role: string
  parentId?: string
  children?: string[]
  bounds: { x: number; y: number; width: number; height: number }
  content?: string
  propPath?: string
  bindingStatus: 'bound' | 'visual-only' | 'unresolved'
  source: 'contract' | 'thumbnail-vision' | 'runtime-inspect' | 'merged'
  confidence: number
  style?: Record<string, unknown>
}
```

合并原则：

| 信息       | 来源优先级                          |
| ---------- | ----------------------------------- |
| 父子关系   | Runtime > JSON > Thumbnail          |
| Props 绑定 | JSON/Runtime > AI 推断              |
| 文案内容   | Runtime > 视觉识别                  |
| 位置尺寸   | Runtime > Thumbnail                 |
| 颜色样式   | 当前 KV Theme > Runtime > Thumbnail |
| 装饰节点   | Thumbnail                           |

## 4. Theme 与颜色 Props

Theme 是生成约束，不是生成后的图片评分：

```text
KV/视觉参考
  -> Theme Tokens
  -> Component Color Bindings
  -> Props Patch + Canvas Paint
```

通用 Theme Token：

```text
primary、secondary、background、surface、text、mutedText、border、active、disabled、success、warning、danger
```

组件颜色字段根据路径、label、valueTypeMap、默认值和节点角色映射到 Token：

```text
primaryColor / activeColor / buttonColor -> primary
backgroundColor / pageBg -> background
cardColor / panelColor -> surface
textColor / fontColor -> text
subTextColor / descriptionColor -> mutedText
borderColor -> border
```

映射结果必须形成受限 Patch：

```json
{
  "kind": "props-update",
  "changes": {
    "theme.primaryColor": "#ff8a00",
    "theme.cardBackground": "#ffffff"
  }
}
```

支持 `base`、`light`、`soft`、`dark`、`alpha` 和 `contrast` 变体，避免把同一个颜色原值机械填充到所有字段。

## 5. 通用组件生成流程

```text
1. 冻结本轮 thumbnail、KV 和组件 JSON
2. 解析 ComponentDesignContract
3. 提取 KV Theme
4. 解析 thumbnail 视觉节点
5. 合并 Contract、Thumbnail 和可选 Runtime 节点
6. 生成 Canonical Component Design Tree
7. 建立 Props/Theme Binding Plan
8. 根据图片 Slot 动态选择是否生图
9. 编译原生 Canvas Elements
10. 写入颜色、尺寸、显隐和图片 Props Patch
11. 对 visual-only 节点保留可编辑层
12. 执行结构、颜色、可编辑覆盖率和开发可用性校验
13. 通过 Canvas Deliverable/ACK 交付
```

### 有图片 Slot

```text
component.plan-assets
-> component.generate-assets
-> component.validate-assets
-> component.compose
```

### 没有图片 Slot，但有颜色字段

```text
component.plan-assets
-> component.apply-theme
-> component.compose
```

### 没有图片和颜色字段

```text
component.plan-assets
-> component.apply-layout
-> component.compose
```

没有图片 Slot 时禁止调用生图模型，也禁止执行图片主题评分。

## 6. 任务组件示例

任务列表不应只有一个外壳节点，应至少生成：

```text
EraTasklist Root
├── Background
├── Header
│   ├── Title
│   └── Subtitle
├── TaskList
│   ├── TaskItem
│   │   ├── Icon
│   │   ├── TaskTitle
│   │   ├── TaskDescription
│   │   ├── Progress
│   │   └── ActionButton
├── Footer
└── Decorative Layers
```

任务标题、描述、进度和按钮绑定业务 Props；背景、分割线、装饰图形即使没有业务绑定，也作为 `visual-only` 原生节点保留。

## 7. 失败与置信度策略

视觉识别必须输出置信度：

```text
>= 0.85：自动生成
0.65 ~ 0.85：生成并在 Timeline 标记待确认
< 0.65：不绑定业务 Props，只生成 visual-only 节点或请求确认
```

禁止将低置信度视觉识别结果直接覆盖业务属性。解析失败时禁止降级为普通整图生成，应明确显示：

```text
组件结构未完全解析，已保留可确认的视觉节点，未覆盖未知业务配置。
```

## 8. 源码 Runtime 的边界

源码 Runtime 只在以下场景接入：

- 高频使用且结构复杂的组件
- Props 与视觉节点关系无法从 JSON/thumbnail 推断
- 需要验证真实 React/Vue 运行效果
- 需要导出开发一致的组件包

它作为 Component Pack 的可选能力声明，不进入通用主流程。

## 9. 实施边界

当前通用设计软件优先实现：

- Component Contract 通用提取
- Thumbnail Vision 节点识别
- Canonical Design Tree
- Theme/Color Binding
- 原生节点编译
- visual-only 节点
- 图片 Slot 动态分流

暂不把组件源码上传、React/Vue Bundle 执行、业务专用适配器和线上 Props 写回作为基础依赖。

## 10. 验收标准

| 场景                       | 预期                                           |
| -------------------------- | ---------------------------------------------- |
| 无源码任务组件 + thumbnail | 至少生成容器、文本、按钮、进度等通用节点       |
| 任务组件只有颜色 Props     | 跳过生图，Theme 写入 Props Patch               |
| 组件包含图片 Slot          | 仅图片 Slot 调用生图，背景和结构仍由节点树承载 |
| Thumbnail 识别不完整       | 保留 visual-only 节点，不覆盖未知业务 Props    |
| 组件 JSON 有继承           | 合并后按完整路径和 Profile 生成设计值          |
| KV 颜色改变                | 颜色 Token 和 Props Patch 随本轮 KV 更新       |
| 多次重试                   | 使用本轮冻结的 JSON、thumbnail、KV 和 Revision |

## 11. 状态

- [x] Component Contract、Profile、Props 白名单和图片 Slot
- [x] KV Theme 与颜色 Props 的基础映射
- [x] 无图片 Slot 时跳过生图并生成颜色驱动外壳
- [x] 通用 Thumbnail Vision Design Tree
- [x] Contract、Thumbnail 节点的统一 Canonical Tree 合并器
- [x] 视觉节点到 Props 的置信度绑定
- [x] 可选 Runtime DOM Inspect Adapter（Vue 2 UMD、React UMD）

## 12. 已实现的 Runtime 接入

当前实现入口：

- `electron/runtime/component-design-tree.mjs`：负责节点协议、边界/数量/置信度归一化、Contract 与 Vision Tree 合并，以及向现有 Blueprint 区域编译。
- `electron/runtime/component-runtime-inspector.mjs`：下载受限大小的 HTTP/HTTPS Bundle/CSS（不限制域名），在隔离 Session 和隐藏 Sandbox Window 中挂载组件，提取真实 DOM Design Tree，并在结束时销毁窗口。
- `electron/runtime/agent-planner.mjs`：组件任务在 `component.resolve` 后先执行 `component.inspect-runtime`，不支持或失败后再执行 `component.inspect-thumbnail`。
- `electron/runtime/agent-tools.mjs`：Runtime Tree 成功时跳过 Thumbnail Vision；否则调用 `extract_design_tree`，只上传当前组件 thumbnail。两条链路都禁止降级为普通整图。
- `electron/runtime/pi/task-runtime.mjs`：为 Vision 任务提供严格 JSON 协议和允许 Props 路径约束。
- `src/features/editor/store/editor-store.ts`：将视觉树中的按钮编译为原生 Button，其余节点继续通过 Shape/Text/Image/Runtime Placeholder 编译。
- `.agents/skills/component-design-assets/scripts/lib/json-schema-adapter.mjs`：将标准 JSON Schema、`allOf`、本地 `$ref` 和 `x-design-*` 设计扩展转换为统一 Component Contract。

交付结果同时保存：

```text
componentDesign.designTree
componentDesign.blueprint.regions
componentDesign.propsPatch
componentDesign.diagnostics
```

其中 `designTree` 是事实上的 Canonical 结构，`blueprint.regions` 是当前画布编译器的兼容投影。视觉节点只有在契约允许的路径中才会标记为 `bound`；未能绑定的节点仍以 `visual-only` 保留并可编辑，不会覆盖未知业务字段。

当前 Runtime Inspect 内置 `Vue@2` UMD 和 React UMD 框架适配器。React 组件统一使用应用内置 React 19 Runtime 挂载；其他框架返回 `unsupported` 并回退 Thumbnail Vision，不影响无源码组件通过 JSON + thumbnail 生成可编辑节点的主流程。

标准 JSON Schema 已作为唯一内部输入格式接入。当前历史组件文件如果仍是 `props[]` 形态，只在入口通过一次性转换器转成 JSON Schema，之后不再存在 legacy Contract、legacy sourceFormat 或 legacy 分支；生成引擎只消费 JSON Schema 适配后的 Contract。

`useCustomFormController` 也不再触发组件专用逻辑。入口会将其转换为通用 `repeat-list` 元数据：

```text
controller -> repeaters[path]
          -> list / list-item 视觉语义
          -> Thumbnail Vision 补充实际节点
```

如果没有公开数组字段或控制器 Schema，系统不会猜测业务字段，只保留通用列表项结构和 `visual-only` 节点。

### 12.1 重复列表节点编译状态

`repeaters` 已进入视觉树和 Blueprint 编译。编译器采用“识别后标注，不凭空复制”的策略：

```text
Vision list/list-item
  -> repeaterPath: 数据路径
  -> repeatIndex: 当前缩略图中的可见项序号
  -> templateId: 数据路径[]
  -> Canvas 可编辑节点
```

当 Vision 识别出多个列表项时，每个项保持独立的 Canvas 节点，并共享同一个重复数据路径；列表容器本身保留模板标识。若只识别到列表容器而没有识别到具体项，系统只输出模板节点，不根据控制器名称猜测标题、奖励、按钮等业务字段。

这使任意 JSON Schema 数组都能使用同一套列表语义。真正基于运行时数组数据复制实例属于后续可选能力，需要输入实例数据或明确的设计样例，不能由缺失 Schema 的自定义控制器自动推断。

当前节点绑定层也会同步保存 `repeaterPath`、`repeatIndex` 和 `templateId`。因此选择某个列表项时，局部编辑 Scope 可以定位到具体重复项，而不是只能定位到整个组件。后续如果接入真实数组数据，可在这个绑定基础上执行单项更新。

## 13. 完整技术架构

### 13.1 总体架构

```text
用户请求
  |
  v
Agent Planner
  |
  +-- reference.prepare
  +-- component.resolve
  +-- component.inspect-thumbnail
  |       |
  |       +-- Pi Vision Model
  |       +-- Thumbnail Vision Tree
  |
  +-- component.plan
  |       |
  |       +-- Component Contract
  |       +-- Profile
  |       +-- KV Visual Theme
  |       +-- Deterministic Blueprint
  |
  +-- component.plan-assets
  +-- component.generate-assets / component.apply-theme
  +-- component.validate-assets
  +-- component.compose
          |
          +-- Canonical Component Design Tree
          +-- Props Patch
          +-- 原生 Canvas Elements
          +-- Canvas Deliverable / ACK
```

系统分成四个边界：

1. **识别边界**：只负责从 thumbnail 识别视觉节点，不修改业务 Props。
2. **契约边界**：只允许组件 JSON Contract 声明的属性进入 Props Patch。
3. **编译边界**：把统一设计树转换成画布原生节点。
4. **交付边界**：通过统一 Deliverable 写入画布，并校验结果是否完整。

### 13.2 为什么不直接生成一张组件图

整图方案无法满足以下需求：

- 修改按钮文字和颜色
- 单独移动任务项或操作按钮
- 导出单独图片和 Props
- 对指定节点执行局部重生成
- 根据同一组件 JSON 生成不同视觉主题
- 继续进行页面级组合和响应式布局

因此图片只承担两类职责：

- 有图片 Props 时，作为独立素材 Slot
- 作为不能拆解的视觉装饰或页面外壳

组件主体结构必须通过原生节点生成。

## 14. 输入与输出协议

### 14.1 输入冻结

每次组件任务开始时，必须冻结本轮输入：

```json
{
  "componentJson": "当前解析到的组件 JSON",
  "thumbnail": "当前组件 thumbnail",
  "references": ["本轮 KV/视觉参考图"],
  "profile": "当前设计 Profile",
  "documentRevision": 12
}
```

重试不能重新读取历史对话中的图片，也不能自动混入上一轮 KV。

### 14.2 Thumbnail Vision Tree

Pi Vision 模型只返回结构化 JSON：

```json
{
  "version": 1,
  "componentName": "EraTasklist",
  "width": 375,
  "height": 600,
  "nodes": [
    {
      "id": "task-title",
      "type": "heading",
      "role": "任务标题",
      "bounds": { "x": 24, "y": 28, "width": 327, "height": 36 },
      "content": "每日任务",
      "confidence": 0.92,
      "bindingStatus": "visual-only",
      "source": "thumbnail-vision"
    },
    {
      "id": "task-action",
      "type": "button",
      "role": "任务操作按钮",
      "bounds": { "x": 256, "y": 180, "width": 92, "height": 36 },
      "content": "去完成",
      "propPath": "tasks[0].actionText",
      "bindingStatus": "bound",
      "confidence": 0.86,
      "source": "thumbnail-vision"
    }
  ]
}
```

约束：

- 最多 96 个节点
- 所有节点必须位于组件画布范围内
- `confidence` 必须在 0 到 1 之间
- `propPath` 必须存在于 Contract 白名单
- 模型不能创建未声明的业务字段
- 不允许把整个 thumbnail 返回为单个 image 节点

### 14.3 Canonical Component Design Tree

Contract、Thumbnail Vision 和未来 Runtime Inspect 都转换为统一树：

```text
ComponentDesignTree
  - version
  - componentName
  - width
  - height
  - nodes[]
      - id
      - type
      - role
      - parentId
      - slotId
      - bounds
      - content
      - propPath
      - bindingStatus
      - source
      - confidence
      - editable
      - style
  - diagnostics[]
```

节点类型使用通用设计语义：

```text
container / surface / text / heading / button / image
icon / input / progress / list / list-item / divider / badge
```

## 15. 合并与优先级

### 15.1 数据优先级

```text
Runtime Inspect > Component JSON Contract > Thumbnail Vision
```

具体规则：

| 内容            | 优先来源                       |
| --------------- | ------------------------------ |
| 合法 Props 路径 | Contract / Runtime             |
| 节点位置和尺寸  | Runtime / Thumbnail            |
| 节点角色        | Runtime / Thumbnail / Contract |
| 业务文案        | Runtime / Contract / Thumbnail |
| KV 颜色主题     | 当前 KV Theme                  |
| 装饰节点        | Thumbnail                      |
| 图片 Slot       | Contract                       |

### 15.2 合并规则

1. 先把 Contract Blueprint 转成基础设计树。
2. 再将 Thumbnail Vision 节点按角色和空间重叠进行匹配。
3. 有对应 Contract 区域时复用稳定 ID，避免每次重试产生重复节点。
4. Thumbnail 节点无法绑定业务属性时，标记为 `visual-only`。
5. 有图片 Slot 的 Contract 区域不能被不确定的 Vision 节点覆盖。
6. 新发现的标题、按钮、分割线和装饰节点可以追加到设计树。
7. 合并过程不能修改未知业务字段。

## 16. Props 与 Theme 绑定

### 16.1 Props 白名单

只允许以下来源进入 `propsPatch`：

```text
Contract.designProperties
Contract.structuralControls
Contract.slots.bindings
```

以下内容禁止进入 Props Patch：

- 模型猜测的业务字段
- 未声明的节点属性
- 任意组件 JSON 中无法确认用途的字段
- Thumbnail 中无法映射到 Contract 的视觉文案

### 16.2 视觉节点绑定置信度

```text
confidence >= 0.85
  自动绑定，但保留诊断信息

0.65 <= confidence < 0.85
  生成节点，默认 visual-only，等待用户确认

confidence < 0.65
  不绑定业务 Props，仅保留视觉节点
```

当前实现已经完成合法路径过滤和 `bound/visual-only/unresolved` 状态；后续可以在 Timeline 中增加低置信度节点确认入口。

### 16.3 Theme 映射

```text
KV/视觉参考
  -> VisualThemeContract
  -> primary/background/surface/text 等 Token
  -> Contract 颜色字段匹配
  -> Props Patch + Canvas Paint
```

颜色字段必须根据字段名、label、默认值、valueTypeMap 和节点角色综合判断，不能把一个主色机械填充到所有颜色属性。

## 17. 画布编译策略

Canonical Tree 当前投影到 Blueprint，再由编辑器 Store 编译为原生节点：

| Design Tree 类型 | Canvas 节点                   |
| ---------------- | ----------------------------- |
| container        | Section / Runtime Placeholder |
| surface          | Shape                         |
| text / heading   | Text                          |
| button           | Button                        |
| image + Slot     | Image                         |
| image 无 Slot    | 可编辑占位节点                |
| progress         | Shape + 文本语义              |
| divider          | Shape                         |
| badge            | Shape / Text                  |
| list / list-item | Section / Runtime Placeholder |

视觉外壳的 z-index 必须低于可编辑节点：

```text
Root Section
  -> Visual Shell
  -> Native Design Nodes
```

这样即使视觉外壳是完整图片，也不能遮挡按钮、文字和列表节点。

## 18. 图片生成分流

### 18.1 有图片 Slot

```text
component.plan-assets
  -> component.generate-assets
  -> component.validate-assets
  -> component.compose
```

每个图片 Slot 独立生成、独立校验、独立写入 Props Patch。

### 18.2 无图片 Slot

```text
component.plan-assets
  -> component.apply-theme
  -> component.compose
```

不调用生图模型。背景、按钮、卡片和装饰通过 Theme、Shape、Text 等原生节点生成。

### 18.3 视觉外壳边界

视觉外壳可以包含：

- 背景纹理
- 不可拆解的光效
- 边框和复杂装饰
- 不属于业务交互的氛围元素

视觉外壳不能包含：

- 可编辑按钮
- 需要准确展示的业务文案
- 需要独立导出的图片 Slot
- 需要局部重生成的节点

## 19. 失败、重试与诊断

### 19.1 Thumbnail 识别失败

允许：

- 保留 Contract Blueprint
- 继续生成可编辑的确定性区域
- 在 diagnostics 中记录失败原因

禁止：

- 降级为普通整图生成
- 删除已解析的组件节点
- 使用历史会话中的 thumbnail
- 把未知字段写入 Props

### 19.2 生图失败

只影响对应图片 Slot：

- 记录 Slot 级错误
- 使用可替换的本地占位素材
- 不影响其他原生节点交付
- 不重新创建一个新的组件任务

### 19.3 Revision 冲突

组件重新生成时必须校验：

```text
componentName
profile
sourceHash
documentRevision
targetInstanceId
```

如果画布已经变化，应提示用户重新选择目标，不允许静默覆盖其他组件实例。

## 20. Runtime DOM Inspect Adapter

Runtime Inspect 是增强能力，不是基础依赖。组件 JSON 可以声明：

```json
{
  "framework": "Vue@2",
  "componentJs": "https://static.example.com/Component.js",
  "componentCss": "https://static.example.com/Component.css"
}
```

执行链路：

```text
Component JSON
  -> 校验有效 HTTP/HTTPS URL 与资源大小（不限制域名）
  -> 加载本地固定版本 Framework Runtime
  -> 注入 JSON 默认 Props
  -> Electron Sandbox 挂载 UMD Component
  -> DOM + getComputedStyle + getBoundingClientRect
  -> runtime-inspect Design Tree
  -> Props 白名单绑定与 Canvas 编译
```

安全边界：

- 使用非持久化独立 Session、`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- 禁止窗口打开和外部导航。
- 阻断 Script、XHR、Fetch 和 WebSocket 网络请求；只允许 HTTP/HTTPS 图片、字体和媒体静态资源，不限制域名或 IP 范围。
- `componentJs` 最大 4MB，`componentCss` 最大 2MB，默认超时 12 秒。
- DOM 最多提取 192 个可见节点，进入 Canonical Tree 后继续执行节点上限和边界归一化。
- 任务成功、失败或超时后都销毁隐藏窗口。

当前框架适配状态：

| Framework | 状态   | 挂载方式                                                     |
| --------- | ------ | ------------------------------------------------------------ |
| Vue@2     | 已实现 | 本地 Vue 2 Runtime + UMD 全局组件                            |
| Vue@3     | 未实现 | 回退 Thumbnail Vision                                        |
| React     | 已实现 | 本地 React 19 + ReactDOM Client + JSX Runtime + UMD 全局组件 |

适合以下组件：

- 高频使用的业务组件
- 缩略图层级复杂且无法稳定识别的组件
- 需要与真实运行时 DOM 完全一致的组件
- 需要开发导出一致性的组件

它不能成为所有组件的强制前置条件，否则通用设计工具会退化为组件源码运行器。

## 21. 测试策略

### 21.1 单元测试

- 非法节点类型归一化
- 越界坐标裁切
- 节点数量限制
- 重复 ID 消除
- 未知 Props 路径拒绝绑定
- Contract 与 Vision 节点空间合并
- Button 投影为可编辑节点

### 21.2 流程测试

- 有图片 Slot 的组件
- 无图片 Slot 的颜色驱动组件
- 有 KV 的组件主题覆盖
- Thumbnail 识别失败
- Pi 返回空 JSON
- 生图 Slot 单独失败
- 重试不产生重复组件

### 21.3 画布验收

必须检查：

- `componentDesign.designTree` 存在
- 原生节点数量大于单一外壳节点
- Button/Text/Shape/Image 节点类型正确
- Props Patch 与节点绑定一致
- Visual Shell 位于原生节点下方
- 组件实例和画板归属正确

当前已验证：

```text
npm run test:component-design
npm run test:component-canvas
npm run lint
npm run build
```

## 22. 后续阶段

### P1：设计树确认体验

- 在 Agent Timeline 展示识别出的节点数量和低置信度节点
- 支持用户确认、删除或重新绑定节点
- 支持在画布中定位来源 thumbnail 节点

### P2：节点级局部编辑

- 选择单个 Design Tree Node
- 将选择范围序列化为稳定 nodeId
- 只对该节点执行文本、颜色、布局或图片替换
- 通过 Patch 写回，不重新生成整个组件

### P3：Runtime Inspect Adapter（已完成基础版本）

- [x] 组件 JSON 自动发现 `componentJs/componentCss/framework`
- [x] Vue 2 UMD 隔离挂载
- [x] React UMD 使用 React 19 隔离挂载
- [x] Runtime 输出真实层级、BoundingBox、文本和 Computed Style
- [x] Runtime 成功时优先于 Thumbnail Tree
- [ ] Vue 3 框架适配器
- [ ] Component Pack Runtime Fixture 和受控 API Mock

### P4：通用布局与响应式

- 将 bounds 转换为约束、自动布局和响应式 Token
- 支持 375、750 二倍图和桌面画板
- 在不改变组件业务结构的情况下生成多个断点投影
