# 组件 Runtime 原型与混合可编辑设计技术方案

> Runtime 的 Skill 发现、DMG 打包和工具执行机制见
> [`runtime-skills.md`](runtime-skills.md)。本文只定义组件设计领域模型与处理流程。

## 1. 背景与目标

活动组件 JSON 同时包含业务配置、设计配置、运行时开关、自定义控制器和缩略图。设计 Agent 不应理解或重写全部属性，只需要从组件契约中提取可设计表面，并把其余字段作为不透明配置保留。

目标是实现：

1. 从任意组件 JSON 中抽取尺寸、位置、颜色、图片和结构开关。
2. 优先使用真实 Runtime DOM 和 Runtime PNG 建立权威结构原型，thumbnail 仅作次级参考。
3. 首次设计一次生成纯氛围底图，并用 Runtime 原生节点确定性承载可编辑 UI。
4. 将颜色、尺寸、位置写入最小 Props Patch；只有用户明确导出图片 Slot 时才生成独立素材。
5. 支持不同组件配置、配置 Profile、继承和实例覆盖。
6. 未识别的业务属性保持原值，不让 AI 猜测。

核心原则：

```text
组件设计 = AI 氛围底图 + Runtime 原生 UI 节点 + 最小 Props Patch + 不透明业务配置
```

组件在设计画布上的默认可见结构为：

```text
Component Root
+ Component Backdrop Image（底色、纹理、光效、边缘装饰）
+ Runtime Surface/Progress/Text/Button/Image Nodes（可编辑 UI）
+ Runtime DesignTree（完整结构元数据）
+ Props Patch（仅配置数据，不参与画布合成）
```

独立图片 Slot 属于首次组件设计主流程：只要当前 Profile 明确声明可生成图片 Prop，系统就生成独立素材并写回准确路径。没有图片 Slot 的通用组件仍只生成氛围底图和原生 UI。

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
  -> Thumbnail Layout Contract / Generic Fallback
  -> ComponentBlueprint
  -> Asset Slot Plan
  -> 独立素材生成与校验
  -> 原生 Canvas Elements + ComponentBinding
  -> Props Patch 双向同步
```

程序负责属性解析、继承、Profile、基础布局、尺寸和回写；AI 负责视觉主题与每个素材槽位的视觉设计。

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

基础布局采用数据驱动的两级策略：

1. 已校准组件读取 Skill 内的 `runtime/layout-specs/<ComponentName>.json`。Sidecar 按 Profile 保存画布尺寸、区域层级、Slot ID、边界和默认显隐，并与 thumbnail URL 一起校验。
2. 没有 Sidecar 时根据 Props 坐标、宽高、Slot 角色和结构开关生成通用布局 fallback；禁止在通用 Plan Builder 中判断组件名称。

Sidecar 是组件原型契约，不是视觉稿。KV 仍负责配色、材质和装饰，生成出的按钮等 Props 素材仍是独立图层。状态型素材可以继续生成和导出，但通过 `visible=false` 默认隐藏，避免“谢谢参与”等弹窗态内容破坏组件初始 UI。

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
  visible?: boolean
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
component.plan
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

组件 Plan 会安全读取打包内 `componentsJson`，调用 Skill Tool 完成事实提取、规则分类、Profile/继承合并、素材槽位和诊断。Runtime 根据组件契约确定性生成 Blueprint 兼容结构；模型只提取 KV 视觉主题，不再决定 version、Region、Slot ID 或 Props 路径。每个图片节点独立生图和重试，连续失败时使用可局部替换的本地 SVG fallback，保证最终组件设计稿仍可写入画布。

正式应用和 DMG 只通过 Agent Tool Registry 调用上述 Electron Runtime Tools，不启动系统 `node` 子进程。CLI 脚本仅用于开发测试和人工排查，不属于产品执行链路；`extract_design_contract.mjs` 只是兼容旧命令的入口。

Loop 规则：

1. 先生成 Contract 和 Blueprint。
2. 原型校验通过后才生成素材。
3. 为当前 Profile 的每个主 Asset Slot 生成独立素材；存在 KV/视觉参考且组件没有背景图片 Prop 时，再生成一个不绑定 Props 的纯装饰背景。
4. 先确定性修复遗漏或重复的合法 Slot；仍存在未知 Slot、越权 Prop、尺寸或安全性错误时，整个任务失败，不写入画布。
5. 最终输出 Props Patch，并将 Blueprint Region 转为可编辑原生图层；组合预览只用于诊断，不进入最终画布。

画布交付时，Provider 不直接返回整份 `DesignDocument`。Renderer 使用当前项目文档执行确定性写回：

```text
ComponentDesignResult
  -> applyComponentDesign
  -> Section 根节点 + 最底层 Design-only Background + 原生 Region 图层
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
    propPath?: string
    designOnly?: boolean
  }>
  propsPatch: Record<string, unknown>
  unresolved: unknown[]
  diagnostics: Diagnostic[]
}
```

`propsPatch` 只包含 AI 实际生成或用户确认的设计属性，不输出完整 Props，也不覆盖 passthrough 数据。

## 12. 校验规则

- Props Asset 必须绑定一个完整 Prop Path；`designOnly` 背景禁止绑定 Prop Path。
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

组件 ZIP 包含 `manifest.json`、`props.patch.json`、`blueprint.json`、`component.structure.json`、可写回 Props 的独立 Slot 图片，以及可选的 `design/background.*`。导出过程会将 Props Patch 中的 Data URI 改写为相对文件路径；装饰背景标记为 `design-only`，不得写回组件 Props。

底部 JSON 图标现在打开左侧只读结构检查器，而不是立即下载。检查器支持当前选择、当前画板和整个项目三个范围，并提供搜索、复制和范围下载；所有 Data URI 都会转换为 `asset://` 摘要，避免渲染大段 Base64。旧项目中的 `Artboard.componentDesign/componentDesigns` 会在加载时迁移到 `DesignDocument.componentInstances`，新链路不再写入画板级组件元数据。

### 14.1 KV 视觉一致性

组件生成时参考图职责必须分离：thumbnail 只提供组件结构、区域和 Slot 边界；用户 KV 或视觉参考图提供最终主色、辅助色、明暗关系、材质与装饰语言。Component Blueprint 使用 `visualTheme` 固化该视觉契约，并在后续 Props、原生节点、可选装饰背景和独立 Slot 素材之间复用。

当存在用户视觉参考时，Runtime 要求 `visualTheme.source` 为 `kv` 或 `visual`，且至少包含两个有效颜色。所有当前 Profile 的颜色属性会按语义确定性映射到该色板，防止模型重新使用组件 JSON 或 thumbnail 中的默认配色。视觉优先级固定为：

```text
用户 KV / 视觉参考 > 用户文字风格 > thumbnail 配色 > 组件默认配色
```

独立 Slot 和可选装饰背景生成后会检查主要颜色与主题色板的距离。首次偏离时 Agent 自动携带同一色板重试一次；连续两次偏离则禁止将错误主题写入画布。

主题链路现已增加独立的 KV 像素证据，避免模型错误色板自证通过：

```text
用户 KV（仅 kv/visual，不含 thumbnail）
  -> 模型提取字体、材质、装饰与候选色板
  -> Runtime 解码 PNG/JPEG 并量化主导色
  -> 候选色板与像素色板亲和度校验
  -> 偏差过大时校准 colors/colorTokens/surfaces
  -> 同一校准主题传播到 Props、原生节点、装饰背景和 Slot 素材
  -> 使用像素证据复核所有生成制品
```

`VisualThemeContract.evidence` 保存 `referenceName`、本地主导色、模型亲和度和是否发生校准。发生校准时记录 `COMPONENT_VISUAL_THEME_PIXEL_CALIBRATED` 诊断。主题提取请求中的 `referenceImageIndex` 相对该次请求计算，因此只有一张 KV 时固定为 `1`，不再把 thumbnail 合并列表中的位置误写为 `2`。

当前仍未实现：生成前的人工 Blueprint 确认界面、Props Patch 写回线上组件实例、语义级 KV Vision 相似度评分，以及对单张图片内部像素的自动分层。当前已实现颜色像素证据，但还不能判断品牌字体、人物、图形母题等高级视觉语义是否一致。Slot 工具级失败目前会自动重试一次，但还没有用户可见的 Slot 历史版本和手动选择能力。

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
## 组件能力分流

组件设计不等于生图。Runtime 会根据当前 Profile 的设计契约动态选择能力：

```text
有图片 Slot：图片素材生成 + Theme/Props + 可编辑布局
无图片 Slot 且有 KV：Theme/颜色 Props + 可编辑布局 + 单一 Design-only 背景
无图片 Slot 且无 KV：Theme/颜色 Props + 可编辑布局
无图片且无颜色：布局 + 结构预览
```

无图片 Slot 且没有 KV 的组件（例如任务列表、表格、表单等）不会执行 `component.generate-assets`。流程为：

```text
reference.prepare
-> component.resolve
-> component.plan
-> component.plan-assets
-> component.apply-theme
-> component.compose
-> canvas.present-component
```

`component.apply-theme` 会把当前 Theme 映射到组件契约中声明的颜色 Props和原生节点。颜色 Props 仍会进入最终 `propsPatch`，组件节点保持可编辑。

有图片 Slot，或存在 KV 且需要 Design-only 背景时，会动态插入：

```text
component.generate-assets
-> component.validate-assets
```

图片主题评分只针对真实生成的图片素材执行，颜色驱动组件使用颜色 Props 和结构完整性进行校验。

## 26. 生成链路诊断

组件素材生成使用两级可观测性：外层时间线展示 Source Adapter 阶段，展开阶段后展示内部工具和单个素材任务。素材日志包含 Slot、目标尺寸、尝试次数、耗时、状态和错误码，不包含 API Key、Base64 或完整 Prompt。

开发环境会把 `tool.trace` 同步写入：

```text
<Electron userData>/logs/agent-runs/YYYY-MM-DD/<runId>.jsonl
```

生产包默认关闭文件日志，可通过 `AI_STUDIO_AGENT_LOGS=1` 开启。组件氛围底图默认等待 60 秒，可通过 `AGENT_BACKDROP_TIMEOUT_MS` 单独覆盖；Props 等普通素材默认 90 秒，页面设计背景仍为 120 秒，二者可通过 `AGENT_ASSET_TIMEOUT_MS` 统一覆盖。组件氛围底图超时不会终止事务，而是立即使用当前 VisualTheme 编译确定性纯背景，继续生成 Props 图片、校验并提交画布；Props 图片失败仍按严格契约报错，避免向组件配置写入伪造素材。

透明 Props 叶子素材携带 KV 时，如果 Provider 的编辑接口不支持透明参数，但生成接口支持透明参数，Runtime 不再把 KV 原图送入 `images/edits`。它会保留已经提取并校准的 `visualTheme`，改走 `images/generations + background=transparent`。局部 Mask 编辑和显式 `edit-base` 不允许使用该降级，避免把图片编辑错误改成重新生成。

当多个素材都由 Runtime 叠加准确文案，且角色、尺寸和透明契约完全一致时，它们属于同一无文字底图组。各任务仍独立生成；只有某项连续失败而同组另一项成功时，失败项才复用成功底图并重新叠加自身文案。不同角色、尺寸或不含准确文案的图片禁止复用。

组件图片 Slot 默认使用 `model-exact` 策略：模型直接生成包含 Contract `exactText` 的完整图片；Props Patch、画布和导出只保留一个 Image 节点。Scene Compiler 删除与图片 Slot 重叠的 Runtime Text，避免第二份文案。`embedded-exact` 只作为显式的 Provider 兼容策略保留。

`model-exact` 按钮图片按 Slot 尺寸直接生成并校验透明度与文案要求，不执行本地文字合成。只有 Contract 将文案声明为独立 Text Prop 时，画布才保留可编辑 Text 节点。

当前 `gpt-image-2` 服务对 `background=transparent` 的执行并不稳定。透明组件叶子素材使用纯色键生成和本地 Alpha 去色：Raster Worker 先校验边缘色键覆盖率，再执行软遮罩与去色边；去色结果仍需通过透明覆盖率、白底和棋盘格质量门禁。Codex 系统 `imagegen` Skill 依赖宿主专有 `image_gen` 工具，应用不会读取或假定该工具存在，只复用了其可移植的透明处理方法。
## 混合可编辑组件交付（当前默认）

组件首次设计不再使用“独立素材 + Runtime Text/Button/Color 节点 + SVG Preview”的合成模式。当前默认链路为：

1. 加载 Component JSON 与 Props Contract。
2. 挂载真实 Runtime DOM，提取 DesignTree 并捕获裁切后的 Runtime PNG。
3. Runtime PNG 负责结构、节点数量、位置、字号和原文案；thumbnail 仅作次级参考，二者都不能直接作为最终画布图片。
4. 生图请求只携带 KV/Visual Reference；Runtime PNG、thumbnail 和节点结构摘要不能进入氛围底图请求。模型只生成底色、纹理、光效和边缘装饰，禁止任何需要与 DOM 坐标对齐的 UI 结构。
5. 画布写入一张氛围底图、当前 Profile 声明的独立 Props 图片，再写入 Runtime 提取的 Surface、Progress、Text、非图片 Button 和业务 Image。原生 UI 按 KV Theme Token 重着色。
6. 绑定图片 Slot 的 Runtime Button/Image 必须编译为生成的 Image Region，禁止降级为原生文本 Button；素材同时写入准确 Props Path。
7. 氛围底图经 Vision Gate 检出 UI 污染时，只重生成底图一次，不重复生成 Runtime 节点和 Props 图片。第二次仍污染则自动使用 VisualTheme Token 编译确定性渐变/光效背景，并记录 `COMPONENT_BACKDROP_DETERMINISTIC_FALLBACK`，不得让整个组件任务失败。

Runtime DesignTree 继续保存在 `componentDesign.designTree`，用于诊断、重新生成和开发导出；写入画布时只筛选有真实内容的 Text、Button 和 Image 节点，过滤无视觉职责的包装容器，避免出现重复文案或 45 个无意义节点。

这项模式同时保证视觉一致性和基础可编辑性。Runtime Text、Button、Shape 和业务 Image 可直接选择编辑；Props 图片可单独重生成和导出；氛围底图通过选择范围和 Mask 编辑。
