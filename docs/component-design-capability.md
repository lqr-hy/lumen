# 组件设计能力投影与独立素材生成技术方案

> Runtime 的 Skill 发现、DMG 打包和工具执行机制见
> [`runtime-skills.md`](runtime-skills.md)。本文只定义组件设计领域模型与处理流程。

## 1. 背景与目标

活动组件 JSON 同时包含业务配置、设计配置、运行时开关、自定义控制器和缩略图。设计 Agent 不应理解或重写全部属性，只需要从组件契约中提取可设计表面，并把其余字段作为不透明配置保留。

目标是实现：

1. 从任意组件 JSON 中抽取尺寸、位置、颜色、图片和结构开关。
2. 使用 `thumbnail` 识别组件的视觉区域，并生成可校验的结构化原型。
3. 为每个图片属性建立独立素材槽位，逐项生成素材。
4. 将颜色、尺寸、位置写回 Props，将图片素材写回准确的图片 Prop。
5. 支持不同组件配置、配置 Profile、继承和实例覆盖。
6. 未识别的业务属性保持原值，不让 AI 猜测。

核心原则：

```text
组件 != 一张设计图片
组件 = 结构 + 设计配置 + 独立素材槽位 + 不透明业务配置
```

组件在设计画布上的完整视觉由两类 Artifact 共同组成：

```text
Component Visual Shell（背景、容器、边框、光效、静态装饰，不写 Props）
+ Props Layers（图片、颜色、几何、显隐，按完整路径写回）
+ Runtime Regions（动态业务内容占位）
```

页面级背景和多组件编排见 [`page-composition-capability.md`](page-composition-capability.md)。

当用户明确指定组件 JSON 文件或组件名时，本轮及同一 Session 的后续“生成设计稿”“继续”“重试”必须进入组件约束模式，优先级高于普通整页设计：

```text
组件 JSON + thumbnail -> 结构、Region、Profile、Slot 和 Props 白名单
KV / 视觉参考       -> 色彩、材质、装饰和视觉风格
用户补充文案         -> 仅作用于已存在且允许编辑的 Region
```

不得把 KV 中的业务模块加入组件，不得遗漏 thumbnail 中的组件主体，也不得因为本轮短指令未重复组件名而退回整页自由生成。切换组件时，以用户最后一次明确指定的组件 JSON 为准。

## 2. 范围

### 2.1 设计属性

设计系统自动理解以下属性：

| 类别 | 典型属性 | 处理方式 |
| --- | --- | --- |
| Geometry | width、height、left、top、x、y、padding、borderRadius | 写入配置并参与布局 |
| Paint | color、bgColor、textColor、themeColor | 提取视觉 Token，直接写入配置 |
| Asset | image、static_image、backgroundImage、animation | 建立独立素材槽位 |
| Structure | open_*、show_*、visible、enable_* | 决定区域是否存在，不进入图片生成 |

### 2.2 不透明属性

以下属性默认不解释、不生成、不覆盖：

- 活动 ID、接口参数、奖品数据和任务数据。
- 事件、回调和运行时注入字段。
- 只有 `useCustomFormController` 而没有公开 Schema 的配置。
- 无法确定语义的字符串、数字和对象。

它们进入 `passthroughProps`，在最终 Props 合并时保持原值。

## 3. 总体流程

```text
组件 JSON
  -> Design Capability Extractor
  -> ComponentDesignContract
  -> Profile Resolver
  -> Thumbnail Analyzer
  -> ComponentBlueprint
  -> Asset Slot Plan
  -> 独立素材生成与校验
  -> 原生 Canvas Elements + ComponentBinding
  -> Props Patch 双向同步
```

程序负责属性解析、继承、Profile、尺寸和回写；AI 负责缩略图视觉理解和每个素材槽位的视觉设计。

## 4. ComponentDesignContract

```ts
interface ComponentDesignContract {
  componentName: string
  label?: string
  thumbnail?: string
  profiles: DesignProfile[]
  designProperties: DesignProperty[]
  structuralControls: DesignProperty[]
  slots: DesignSlot[]
  passthroughProps: string[]
  diagnostics: Diagnostic[]
}

interface DesignProperty {
  path: string
  label?: string
  kind:
    | 'width'
    | 'height'
    | 'x'
    | 'y'
    | 'spacing'
    | 'radius'
    | 'color'
    | 'image'
    | 'visibility'
  defaultValue?: unknown
  hidden?: boolean
  profile?: string
  source: 'component-default'
}

interface DesignSlot {
  id: string
  label: string
  role: 'background' | 'button' | 'decoration' | 'content-image' | 'animation'
  profile?: string
  bindings: {
    width?: string
    height?: string
    x?: string
    y?: string
    color?: string
    image: string
    fallbackImage?: string
    visible?: string
  }
}
```

所有绑定使用完整路径，例如：

```text
freeStyleConfig.draw_one_btn.image
```

禁止使用叶子字段名 `image` 作为唯一标识。

## 5. 属性分类算法

优先使用 `valueTypeMap` 中的编辑器类型：

```text
editor=image  -> Asset
editor=color  -> Paint
editor=switch -> 候选 Structure
editor=number -> 候选 Geometry
```

再结合 `name` 和 `label` 判断具体语义：

```text
width/宽度                        -> width
height/高度                       -> height
left/x/横向                       -> x
top/y/纵向                        -> y
padding/margin/间距/内边距        -> spacing
radius/圆角                       -> radius
open/show/visible/enable/展示/开启 -> visibility
```

无法确定时归类为不透明属性，而不是猜测。

## 6. Profile 与继承

### 6.1 Profile

`styleConfig` 和 `freeStyleConfig` 是不同配置模式，不应直接合并。

```ts
interface DesignProfile {
  id: string
  rootPath: string
  activeWhen?: {
    prop: string
    equals: unknown
  }
}
```

EraLottery 的推荐映射：

```text
normal -> styleConfig      when freeMode=false
free   -> freeStyleConfig  when freeMode=true
```

Agent 只生成当前 Profile 所需素材。没有实例配置时优先使用普通模式，用户明确要求自由布局时选择 free。

### 6.2 继承与覆盖

解析后的设计值保留来源：

```ts
interface ResolvedDesignValue {
  path: string
  value: unknown
  source:
    | 'global-default'
    | 'base-component'
    | 'mixin'
    | 'component-default'
    | 'instance'
    | 'ai-generated'
    | 'user'
}
```

覆盖顺序：

```text
global-default
< base-component
< mixin
< component-default
< instance
< ai-generated
< user
```

合并以完整属性路径和 Profile 为键。用户值始终优先，AI 只能生成设计范围内的增量 Patch。

## 7. Thumbnail 与 Blueprint

缩略图不是最终设计稿，也不能直接作为整个组件图片。它只用于：

- 识别区域数量和层级。
- 估算区域边界。
- 将视觉区域匹配到 Design Slot。
- 生成可校验的原型图。

```ts
interface ComponentBlueprint {
  componentName: string
  profile: string
  width: number
  height: number
  regions: BlueprintRegion[]
}

interface BlueprintRegion {
  id: string
  role: string
  bounds: { x: number; y: number; width: number; height: number }
  slotId?: string
  propBindings: string[]
  renderMode: 'runtime' | 'text' | 'color' | 'generated-asset'
  confidence: number
}
```

Blueprint 必须先渲染为灰阶原型供校验。低置信度区域不得自动绑定图片 Prop。

Provider 输出进入 Contract 校验前会先做确定性归一化：数值字符串转数值、缺省集合补空值、负坐标裁切、画布扩展到完整包含 Region；缺省的非 Slot Region 降级为 `runtime` 占位。

Slot 映射采用“模型识别 + Runtime 契约修复”：

1. 模型输出的 Slot ID、完整 Prop Path 和 Profile 必须在组件 Contract 白名单内。
2. 同一 Slot 被重复映射时，只保留置信度最高的 Region，并记录 `COMPONENT_SLOT_DUPLICATE_REPAIRED`。
3. 模型漏掉 JSON 已声明的静态图片 Slot 时，Runtime 根据宽高/位置默认值和 Slot 角色补充独立 Region，并记录 `COMPONENT_SLOT_MAPPING_REPAIRED`。
4. 补全只能使用 JSON 已声明的 Slot，不得新增业务模块或未知 Prop。
5. `role=animation` 当前不要求进入 Blueprint，继续保留原值并输出能力缺失诊断。

这样可以避免模型偶发漏掉 `thanks_pic` 等槽位时中断整个 Agent Run，同时保持指定组件 JSON 是最终结构约束。

## 8. Asset Slot Plan

每个 `kind=image` 属性产生独立素材任务。颜色和几何属性不生成位图。

```ts
interface AssetTask {
  id: string
  slotId: string
  propPath: string
  role: string
  targetSize: { width: number; height: number }
  transparent: boolean
  exactText?: string
  styleReferences: string[]
}
```

按钮推荐两阶段生成：

1. 图片模型生成无文字按钮底图。
2. 本地 SVG/Canvas 使用确定性字体渲染准确中文。
3. 合成后写入对应图片 Prop。

这样避免图片模型生成错误的“抽一次”“十连抽”文字。

## 9. EraLottery 示例

### 9.1 Profile

```text
normal: styleConfig
free: freeStyleConfig, activeWhen freeMode=true
```

### 9.2 独立素材槽位

```text
freeStyleConfig.draw_one_btn.image
freeStyleConfig.draw_one_btn.static_image
freeStyleConfig.draw_ten_btn.image
freeStyleConfig.draw_ten_btn.static_image
freeStyleConfig.thanks_pic
freeStyleConfig.open_lottery_animation

styleConfig.draw_one_pic
styleConfig.draw_ten_pic
styleConfig.thanks_pic
```

### 9.3 非图片配置

```text
freeStyleConfig.bgColor                  color
freeStyleConfig.majorTextColor           color
freeStyleConfig.draw_one_btn.width       width
freeStyleConfig.draw_one_btn.height      height
freeStyleConfig.oneBtnLeftPosition       x
freeStyleConfig.oneBtnTopPosition        y
freeStyleConfig.open_lottery_ten_btn     visibility
freeStyleConfig.open_wlist               visibility
```

最终画布至少包含独立的“抽一次”“十连抽”和“谢谢参与”素材，而不是一个 EraLottery 整体图片。

## 10. Agent 工具链

组件任务当前使用以下 8 步 Agent Plan：

```text
reference.prepare
component.resolve
component.blueprint
component.plan-assets
component.generate-assets
component.validate-assets
component.compose
canvas.present-component
```

当前已落地的确定性基础工具为：

```text
component-design-assets.extract-facts
component-design-assets.resolve-contract
```

普通独立素材任务仍使用：

```text
design.generate-assets
artifact.validate-assets
canvas.present-assets
```

多素材任务通过 `manifest.json` 声明每个独立 SVG，Runtime 将其作为多个 Artifact 返回并分别创建画布图片节点。整图任务继续使用 `design.generate`，两种输出协议不得混用。

组件 Plan 会安全读取打包内 `componentsJson`，调用 Skill Tool 完成事实提取、规则分类、Profile/继承合并、素材槽位候选和诊断，再通过 Codex thumbnail 分析生成 Component Blueprint。Slot ID 和完整属性路径会使用 Contract 白名单二次校验。

正式应用和 DMG 只通过 Agent Tool Registry 调用上述 Electron Runtime Tools，不启动系统 `node` 子进程。CLI 脚本仅用于开发测试和人工排查，不属于产品执行链路；`extract_design_contract.mjs` 只是兼容旧命令的入口。

Loop 规则：

1. 先生成 Contract 和 Blueprint。
2. 原型校验通过后才生成素材。
3. 先生成一个不绑定 Props 的 Component Visual Shell，再为当前 Profile 的每个主 Asset Slot 生成独立 SVG；fallback 默认复用主素材。
4. 先确定性修复遗漏或重复的合法 Slot；仍存在未知 Slot、越权 Prop、尺寸或安全性错误时，整个任务失败，不写入画布。
5. 最终输出 Props Patch，并将 Blueprint Region 转为可编辑原生图层；组合预览只用于诊断，不进入最终画布。

画布交付时，Provider 不直接返回整份 `DesignDocument`。Renderer 使用当前项目文档执行确定性写回：

```text
ComponentDesignResult
  -> applyComponentDesign
  -> Section 根节点 + Visual Shell + 原生 Region 图层
  -> DesignDocument.componentInstances[instanceId] + Props Patch
  -> DesignDocument version + 1
  -> 项目快照自动保存
```

新项目默认视口为 75%。当对话绑定目标画板时，如果当前视口低于 50%，编辑器自动聚焦目标画板并恢复到 75%；正常缩放下保留用户当前视图，避免每次对话都强制跳转。

## 11. 输出协议

```ts
interface ComponentDesignResult {
  componentName: string
  profile: string
  sourceHash: string
  blueprint: ComponentBlueprint
  assetTasks: Array<{
    slotId: string
    propPath: string
  }>
  propsPatch: Record<string, unknown>
  unresolved: unknown[]
  diagnostics: Diagnostic[]
}
```

`propsPatch` 只包含 AI 实际生成或用户确认的设计属性，不输出完整 Props，也不覆盖 passthrough 数据。

## 12. 校验规则

- 每个 Asset 必须绑定一个完整 Prop Path。
- 每个图片 Prop 最多由一个活动 Profile 的 Slot 写入。
- 颜色必须是合法 CSS 颜色。
- 宽高必须为正数并符合组件约束。
- 按钮等局部素材必须有透明背景或明确的非透明要求。
- 图片尺寸与 Blueprint Slot 比例偏差超过阈值时重新生成。
- exactText 必须通过本地文本层渲染或 OCR 校验。
- 不得生成整个组件截图代替所有素材。
- 自定义 Controller 未提供 Schema 时必须输出诊断，不得猜测。

## 13. 缓存

Contract 和 Blueprint 使用以下键缓存：

```text
componentName + componentJsonHash + thumbnailHash + profile
```

KV 变化时只重新生成 Asset，不重新分析组件结构。组件 JSON 或 thumbnail 变化时使 Blueprint 缓存失效。

## 14. 实施状态

1. 先接入通用 Design Capability Extractor。
2. 使用 EraLottery 校准 Slot 匹配和 Profile。
3. 再实现 thumbnail 到 Blueprint 的视觉分析。
4. 接入独立素材生成与透明图校验。
5. 输出 Props Patch 并在属性面板中预览。
6. 用 EraTasklist 验证跨组件泛化。

上述第 1 至第 6 项已经接入正式 Agent Planner，并使用 `EraLottery` 与 `EraTasklist` 覆盖“多图片 Slot”和“无图片 Slot”两类组件。Props Patch 归属于文档级组件实例，并且只在选中组件 Root Section 时展示；子图层只展示自身 Region/Slot 绑定。图片 Slot 可以通过属性面板或右键菜单执行局部重生成。

P2.2 已将组件结果转换为原生画布结构：

```text
Component Blueprint
  -> Section 根节点
  -> Image / Shape / Text / RuntimePlaceholder Region
  -> ComponentBinding（实例、Region、Slot、完整 Prop Path）
  -> 元素编辑同步 Props Patch
  -> 选中图片 Slot 的局部重生成与原位替换
```

移动或缩放 Section 会按比例联动子图层；修改 Region 的位置、尺寸、颜色、图片和显隐会写回对应的完整 Props Path。删除 Section 会级联删除子图层和实例元数据。局部重生成保留原 elementId，不新增整组件图片。

P2.3 已补齐实例检查与交付：

```text
选择图层
  -> ComponentBinding.instanceId
  -> DesignDocument.componentInstances[instanceId]
  -> 只读 Props Patch / 组件统计
  -> 导出组件 ZIP
```

组件 ZIP 包含 `manifest.json`、`props.patch.json`、`blueprint.json`、`component.structure.json`、设计专用 Visual Shell 和可写回 Props 的独立 Slot 图片。导出过程会将 Props Patch 中的 Data URI 改写为相对文件路径，Visual Shell 标记为 `design-only`，不得写回组件 Props。

底部 JSON 图标现在打开左侧只读结构检查器，而不是立即下载。检查器支持当前选择、当前画板和整个项目三个范围，并提供搜索、复制和范围下载；所有 Data URI 都会转换为 `asset://` 摘要，避免渲染大段 Base64。旧项目中的 `Artboard.componentDesign/componentDesigns` 会在加载时迁移到 `DesignDocument.componentInstances`，新链路不再写入画板级组件元数据。

### 14.1 KV 视觉一致性

组件生成时参考图职责必须分离：thumbnail 只提供组件结构、区域和 Slot 边界；用户 KV 或视觉参考图提供最终主色、辅助色、明暗关系、材质与装饰语言。Component Blueprint 使用 `visualTheme` 固化该视觉契约，并在后续 Props、Visual Shell 和独立 Slot 素材之间复用。

当存在用户视觉参考时，Runtime 要求 `visualTheme.source` 为 `kv` 或 `visual`，且至少包含两个有效颜色。所有当前 Profile 的颜色属性会按语义确定性映射到该色板，防止模型重新使用组件 JSON 或 thumbnail 中的默认配色。视觉优先级固定为：

```text
用户 KV / 视觉参考 > 用户文字风格 > thumbnail 配色 > 组件默认配色
```

Visual Shell 生成后会检查 SVG 的主要 `fill`、`stroke` 和 `stop-color` 与主题色板的距离。首次偏离时 Agent 自动携带同一色板重试一次；连续两次偏离则返回 `COMPONENT_VISUAL_THEME_MISMATCH`，禁止将错误主题写入画布。

当前仍未实现：生成前的人工 Blueprint 确认界面、Props Patch 写回线上组件实例、真实图片/动画 Provider、thumbnail/KV Vision 相似度评分，以及对单张图片内部像素的自动分层。Slot 工具级失败目前会自动重试一次，但还没有用户可见的 Slot 历史版本和手动选择能力。

`role=animation` 的 Slot 当前保留原值并输出 `ANIMATION_PROVIDER_MISSING` 诊断，不使用静态 SVG 冒充动效素材。

## 15. 通用化实现架构

正式实现采用三层结构，避免在单个脚本中硬编码组件名和字段名：

```text
Generic Fact Extractor
  -> Rule Registry
  -> Optional Component/Family Adapter
```

### 15.1 Generic Fact Extractor

只递归读取 JSON 事实：完整路径、父路径、名称、标签、`valueTypeMap`、编辑器类型、默认值、显隐和自定义控制器。该层不识别 EraLottery，也不假设 `styleConfig`、`freeStyleConfig` 或 `freeMode`。

### 15.2 Rule Registry

通用规则根据编辑器类型和字段语义产生候选分类。每次分类必须返回：

```ts
interface RuleMatch {
  kind: DesignPropertyKind
  confidence: number
  evidence: string[]
}
```

低置信度设计候选进入 `unresolved`，不得自动绑定或回写。

### 15.3 Optional Adapter

特殊组件或组件族通过外部 Adapter 扩展：

```ts
interface ComponentDesignAdapter {
  name: string
  supports(component: unknown, facts: ComponentFacts): boolean
  rules?: DesignRule[]
  refineContract?(contract: ComponentDesignContract, context: unknown): ComponentDesignContract
}
```

推荐覆盖比例：通用读取与规则约 80%，组件族规则约 15%，单组件 Adapter 不超过 5%。Adapter 只修正规则无法表达的 Profile、继承或 Slot 关系。

### 15.4 Runtime Tool 正式入口

Agent Planner 生成结构化 Step，由 Loop Engine 通过 Tool Registry 执行：

```js
{
  id: 'resolve-component-contract',
  title: '解析组件设计契约',
  tool: 'component-design-assets.resolve-contract',
  input: {
    component: componentJson,
    bases: baseComponents,
    sourceName: componentJson.name,
  },
  status: 'pending',
}
```

Tool Registry 的实际调用为：

```js
await executeSkillTool('component-design-assets.resolve-contract', step.input)
```

开发环境从 `<appRoot>/.agents/skills` 加载工具；DMG 从 `process.resourcesPath/skills` 加载工具。两者都使用 Electron 自带的 Node Runtime 动态导入 `runtime/entry.mjs`，不依赖用户机器安装 `node`。

继承层通过结构化 `bases` 数组传入，按数组顺序从低到高合并，当前组件最后覆盖。每个解析后的设计属性保留 `source` 与 `sourceName`。

### 15.5 开发调试 CLI

以下命令只用于 Skill 开发、回归测试和人工排查，不得由正式应用通过子进程调用：

```bash
node scripts/extract_component_facts.mjs componentsJson/EraLottery.json
node scripts/resolve_design_contract.mjs componentsJson/EraLottery.json
node scripts/resolve_design_contract.mjs child.json --base base.json --base mixin.json
node scripts/resolve_design_contract.mjs component.json --adapter ./adapter.mjs
```

旧命令 `extract_design_contract.mjs` 保留并转发到新解析器。
