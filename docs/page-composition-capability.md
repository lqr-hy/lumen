# 页面组合设计能力技术方案

## 1. 目标

页面生成不能在“整页一张图”和“只有组件 Props 素材”之间二选一。最终设计稿需要同时满足：

1. KV 决定整页视觉语言、背景、材质、光效和装饰。
2. 原型图决定页面模块、顺序、尺寸和组件占位。
3. 组件 JSON 决定每个组件可编辑的图片、颜色、尺寸、位置和显隐字段。
4. 动态奖品、任务、榜单等运行时内容保留为明确的 Runtime Region。
5. 页面在画布上看起来完整，同时组件配置仍能独立导出和写回。

核心模型：

```text
完整页面设计稿
  = Page Visual Shell
  + Component Instance[]
  + Page Content / Overlay

Component Instance
  = Component Surface（页面内嵌）或 Component Visual Shell（独立生成）
  + Props Color / Geometry Layers
  + Props Asset Slot Layers
  + Runtime Regions
```

## 2. 分层协议

### 2.1 Page Visual Shell

页面级视觉外壳负责整页背景、跨模块装饰、全局纹理和统一氛围。它不绑定组件 Props，也不能包含组件按钮、精确文字或动态业务内容。

### 2.2 Component Visual Shell

组件背景分为两种明确模式：

- `standalone`：独立组件可以生成完整氛围外壳，负责组件自身的底色、边框、光效和静态装饰。
- `page-embedded`：页面内组件只使用高覆盖率、低对比的 Tonal Surface，负责明确分层、轻微边界和内容可读性，不再独立调用高饱和背景生图。

同一 KV 只共享颜色、材质和字体气质，不共享完整构图。页面 Shell 独占主放射、主图形、跨模块装饰和全幅纹理，避免页面背景和组件背景成为两张近似图片。

### 2.3 Page Visual Direction

页面生成在主题提取后调用 `page-visual-direction.compile`，生成结构化视觉方向：

- 页面类型与一句话视觉概念。
- Background、Surface、Text、Muted Text、Accent 色彩角色。
- 唯一 Signature Element 及其页面级归属。
- Page Shell 与 Component Surface 的视觉密度。
- 页面外壳规则、内嵌组件规则和反模式清单。

该 Skill 参考 Anthropic `frontend-design`、`taste-skill` 和 `superdesign-skill` 的公开规则，但不引入它们的 HTML/CSS Runtime。第三方来源和许可证记录在根目录 `THIRD_PARTY_NOTICES.md`。

### 2.4 Props Layers

组件 JSON 中的设计字段继续使用独立图层：

| 字段类型 | 画布表示 | 写回方式 |
| --- | --- | --- |
| color | Shape/Text Paint | 写入完整颜色 Prop Path |
| image | 独立 Image Layer | 写入完整图片 Prop Path |
| width/height/x/y | Element Geometry | 写入完整几何 Prop Path |
| visible | Element Visibility | 写入完整显隐 Prop Path |

设计级 Visual Shell 与 Props Patch 必须分开存储，禁止把 Visual Shell Data URI 写入未知组件字段。

### 2.5 Runtime Regions

奖品列表、任务数据、排行榜、用户状态等无法由静态设计稿确定的内容使用透明 Runtime Placeholder。占位层只标识范围，不使用大面积不透明灰色遮罩，避免覆盖底层完整视觉。

## 3. Page Blueprint

```ts
interface PageCompositionBlueprint {
  version: 1
  width: 375
  height: number
  theme: {
    colors: string[]
    visualStyle: string
  }
  pageRoot?: {
    componentName: string
    designPaths: string[]
  }
  containers?: Array<{
    componentName: string
    designPaths: string[]
  }>
  sections: Array<{
    id: string
    role: string
    bounds: { x: number; y: number; width: number; height: number }
    source: 'prototype' | 'prompt'
    componentRef?: {
      componentName: string
      profile?: string
      componentJsonHash: string
    }
  }>
}
```

原型图存在时，`sections` 只能来自原型图；KV 只影响 `theme` 和 Visual Shell。没有组件 JSON 的区域可以生成普通页面内容，但不得伪造 Props Patch。

## 4. Agent Recipe

规划中的多组件页面 Recipe：

```text
page.resolve-context
page.blueprint
page.extract-theme
page.generate-shell
component.resolve[]
component.plan[]
component.generate-assets[]
component.compose[]
page.compose
page.validate
canvas.present-page
```

`page.extract-theme` 只读取用户指定的 KV/视觉参考图并生成一次共享
`VisualThemeContract`。页面外壳和所有叶子组件必须复用该契约；确定性组件计划中的
颜色 Props 会按共享色板校正，禁止 thumbnail 默认色覆盖 KV。

`PageVisualDirection` 进一步把共享主题拆成不同职责：页面顶部最多 22% 拥有唯一
Signature/KV 焦点，中段为低密度内容底床，页面内嵌组件使用不透明度约 0.88 的
Tonal Surface。页面与组件共享色板和材质语言，但禁止共享完整放射、主图形和全幅纹理。

  `component.*[]` 是按 Page Blueprint 中叶子组件实例展开的并行子任务。`EvaPage` 这类页面根节点只提供页面级 Props 设计契约，`EvaLayoutContainer` 这类容器只提供容器边界、背景、间距和层级契约，不进入普通组件图片生成流水线。每个叶子实例保留独立 `instanceId`、Profile、Props Patch、Artifact 和检查点，某个组件失败时仍可交付已完成组件。

## 5. DesignDocument 写回

```text
Artboard
  Page Visual Shell Image
  Section: Hero
  Section: Component Instance A
    Component Visual Shell Image
    Props Shape / Image / Text
    Runtime Placeholder
  Section: Component Instance B
    Component Visual Shell Image
    Props Shape / Image / Text
    Runtime Placeholder
  Page Overlay / Footer
```

图层顺序必须稳定：页面背景最低，组件 Visual Shell 位于组件 Props 和 Runtime Region 下方，页面浮层最高。导出页面 PNG 时合成所有图层；导出组件配置时只读取该实例的 Props Patch 和 Slot Assets。

## 6. 当前实施状态

已实现：

- 组件 JSON 契约、Profile、Slot 和 Props Patch。
- 组件 Visual Shell Artifact。
- Visual Shell 与 Props 素材在返回协议中分离。
- Visual Shell 作为 Section 底层 Image 写入 DesignDocument。
- 图片、颜色、几何和显隐继续作为可编辑组件图层。
- Runtime Placeholder 使用透明背景展示底层视觉。
- 文档级 `componentInstances` 注册表，支持同一画板多个组件独立维护 Props Patch。
- 选中任意组件子图层后导出该实例的 Props、蓝图、结构和独立切图 ZIP。
- 左侧只读 JSON 结构检查器，支持选择、画板和项目范围并自动摘要 Base64。
- Page Composition Blueprint 与 375px 自动高度页面模型。
- 一轮对话解析多个明确指定的组件 JSON，并动态插入独立组件 Step。
- 页面级 Visual Shell，作为 `design-only` 最低层图像，不写入组件 Props。
- Blueprint 确认暂停；确认前不生成组件素材，确认后恢复同一 Run。
- Section 检查点、局部失败恢复、右键锁定和组件实例局部修订。
- 页面开发包 v2，包含 Page Blueprint、组件包、去重素材、校验和和 1x/2x 预览。
- `EvaPage` 页面根节点与 `EvaLayoutContainer` 容器节点识别；页面根/容器不再被误当成普通图片组件。
- 叶子组件按独立 `page.generate-component` Step 生成，页面视觉外壳先交付；组件拥有独立检查点、失败状态和恢复入口，部分组件失败不阻断页面交付。
- 页面确认后单独提取一次 KV `VisualThemeContract`，页面外壳和全部组件共享，不再依赖首个组件生成主题。
- 已增加 `PageVisualDirection` Skill；页面外壳独占主构图，页面内嵌组件使用安静的确定性 Surface，独立组件仍保留完整氛围背景。
- 页面最终交付按成功组件的 `pageSectionId` 清单校验。失败组件保留为可重试项，不再因为完整 Blueprint 中存在失败 Section 而把已成功的部分页面误判为最终提交失败；全部组件都失败时仍拒绝提交只有背景的空页面。
- 页面组件结果显式携带 `pageSectionId`，最终交付不再依赖组件数组的隐式顺序。生图 Provider 返回 429 时停止毫秒级自动重试，先提交已成功组件并保留失败组件任务，避免限流把整个页面拖入重复失败。
- 默认使用本地页面质量门禁并在 Renderer PNG 快照可用时执行一次远程 Vision Review；失败只降级，不阻断交付。页面流程不再保留无实际画布增量写入的“交付页面外壳”空 Step。
- 容器 Section 写入 `DesignDocument.structuralInstances`，属性面板可查看设计路径并导出结构包。

规划中：

- Blueprint 确认前的拖拽排序、替换组件、删除 Section 和高度编辑。
- 已完成多组件子任务并发；仍需补充按单组件结果持久化的精确失效和失败组件单独重试按钮。
- 页面级文字、导航、页脚与组件实例之间的约束布局。
- 使用真实 KV 数据集标定 Vision Review 阈值与局部 Repair 命中率。

当前组件 Visual Shell 使用 Codex SVG 能力，不能声明为真实位图生成。
