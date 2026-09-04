# KV 到设计稿与开发配置交付技术方案

## 1. 目标

本方案定义从 KV、原型图和组件 JSON 到可编辑设计稿、组件配置、切图与 Runtime 验证结果的完整工程流程。最终产物不是单张效果图，也不是孤立的 Props Patch，而是一份可以继续设计、可以被开发消费、可以验证来源和质量的页面工程。

```text
KV / 原型图 / 组件 JSON / 用户需求
  -> Reference Contract
  -> Visual Theme Contract
  -> Page Blueprint
  -> Page Root / Container / Component Instance Plan[]
  -> Component Blueprint[]
  -> Layer / Asset / Props 生成
  -> DesignDocument 组合
  -> Quality Review + Repair Loop
  -> Runtime Adapter 验证
  -> 页面包 / 组件包 / PNG / 配置导出
```

## 2. 设计原则

1. KV 决定视觉语言，不决定业务结构。
2. 原型图和组件 thumbnail 决定结构，不得覆盖 KV 配色。
3. 组件 JSON 是可写回字段的唯一白名单。
4. 页面、组件实例、Props Patch 和素材都必须有稳定 ID。
5. 生成结果必须经过结构、视觉、可读性和开发可用性检查。
6. Agent 只通过 Artifact 和结构化 Tool Result 修改画布，不使用聊天承诺代替执行。
7. 真实组件 Runtime 不可用时必须输出 `unsupported`，不得伪造“验证通过”。

## 3. 核心协议

### 3.1 Reference Contract

```ts
interface ReferenceContract {
  references: Array<{
    id: string
    role: 'kv' | 'prototype' | 'thumbnail' | 'visual'
    authority: 'visual' | 'structure' | 'both'
    name: string
    imageIndex: number
  }>
  visualPriority: string[]
  structurePriority: string[]
}
```

固定优先级：

```text
视觉：用户 KV / 视觉参考 > 用户文字 > thumbnail > 组件默认值
结构：用户原型 > 组件 thumbnail > 用户文字
字段：组件 JSON Contract > 模型推断
```

### 3.2 Visual Theme Contract

```ts
interface VisualThemeContract {
  source: 'kv' | 'visual' | 'prompt' | 'thumbnail'
  referenceImageIndex?: number
  colors: ThemeColorToken[]
  typography: TypographyToken[]
  surfaces: SurfaceToken[]
  effects: EffectToken[]
  imagery: { style: string; rendering: string; keywords: string[] }
  decoration: { language: string; motifs: string[]; density: 'low' | 'medium' | 'high' }
  spacing: { base: number; scale: number[]; density: 'compact' | 'comfortable' | 'spacious' }
  visualStyle: string
  confidence: number
}
```

颜色不仅保存字符串，还要标记 `primary/background/text/accent/surface` 等语义，供 Props、Visual Shell 和页面背景复用。

### 3.3 Page Blueprint

```ts
interface PageCompositionBlueprint {
  version: 1
  width: 375
  estimatedHeight: number
  visualTheme: VisualThemeContract
  pageRoot?: { componentName: string; designPaths: string[] }
  containers?: Array<{ componentName: string; designPaths: string[] }>
  sections: Array<{
    id: string
    role: string
    kind: 'page-content' | 'component-instance' | 'runtime-region'
    bounds: { x: number; y: number; width: number; height: number }
    source: 'prototype' | 'prompt' | 'component-thumbnail'
    component?: { componentName: string; profile?: string }
  }>
  constraints: Array<{ type: string; from: string; to?: string; value?: number }>
}
```

页面生成采用三类节点：`pageRoot`（例如 `EvaPage`）负责页面背景和页面级 Props；`containers`（例如 `EvaLayoutContainer`）负责容器边界、背景、间距和层级；`sections` 只放需要独立生成和写回的业务组件。页面根节点可以没有 thumbnail，业务组件仍必须有 thumbnail。

每个叶子组件 Section 进入并行 Agent 子任务，并以 `instanceId` 写入 `DesignDocument.componentInstances`。页面根和容器只进入结构契约和页面 Blueprint，不生成整块替代组件的图片。组件任务失败时，页面仍交付已完成组件，并记录失败组件名称；Vision Review 属于异步质量增强，不阻断首次交付。

容器实例写入 `DesignDocument.structuralInstances`，并以 Section 图层绑定到 `structuralInstance.id`。选中容器后可以导出结构包，包含 `manifest.json`、`props.patch.json` 和 `structure.json`，不把容器结构误当成业务组件 Props。

### 3.4 Quality Review

```ts
interface DesignQualityReview {
  passed: boolean
  scores: {
    structure: number
    theme: number
    readability: number
    completeness: number
    developmentReadiness: number
  }
  issues: Array<{
    code: string
    severity: 'error' | 'warning'
    scope: 'page' | 'component' | 'asset' | 'props' | 'runtime'
    message: string
    repairAction?: string
  }>
  repairCount: number
}
```

质量门槛：任一 error、结构低于 0.9、主题低于 0.75、可读性低于 0.85 或开发可用性低于 0.8 时不得交付。确定性问题由 Runtime 修复；视觉问题最多自动重生成两次。

### 3.5 Runtime Validation

```ts
interface ComponentRuntimeAdapter {
  id: string
  supports(componentName: string, sourceHash: string): boolean
  render(input: {
    componentName: string
    profile: string
    baseProps: unknown
    propsPatch: unknown
    assets: Record<string, string>
  }): Promise<RuntimeRenderResult>
}
```

Runtime Render Result 必须包含状态、截图、控制台错误、未知 Props、缺失素材和设计对比结果。仓库只有组件元数据、没有真实组件 Bundle 时，状态只能是 `unsupported`。

## 4. Agent Recipe

```text
reference.prepare
theme.extract
page.resolve-components
page.blueprint
page.generate-shell
component.resolve[]
component.plan[]
component.generate-assets[]
component.compose[]
page.compose
quality.review
quality.repair
runtime.validate[]
delivery.package
canvas.present-page
```

子任务必须有独立检查点。单个组件失败时只恢复该实例，禁止重跑已经通过的页面背景和其他组件。

当前正式页面 Recipe 为：

```text
reference.prepare
page.resolve-components
  -> 动态插入 page.generate-component[instance-1..n]
page.blueprint
page.generate-shell
page.review
canvas.present-page
```

`page.resolve-components` 根据用户明确指定的组件 JSON 建立动态 Section Step。每个
`page.generate-component` 使用隔离的组件 Tool Memory，复用完整组件 Contract、Blueprint、
素材、质量和 Runtime 流程，并以独立 Step ID 保存检查点。页面结果落到画布后仍保留
Section Root、Props Slot、Text、Shape 和 RuntimePlaceholder；`page-shell` 只是最低层的
`design-only` 页面视觉外壳，不得覆盖组件主体或写入组件 Props。

## 5. 可编辑图层策略

生成结果按可编辑性从高到低分层：

1. Text：标题、按钮文案和说明文字。
2. Shape：纯色、渐变、边框、圆角、简单装饰。
3. Image：KV 图像、插画、商品、复杂纹理和组件 Slot。
4. RuntimePlaceholder：任务、榜单、奖品、用户状态等动态内容。
5. VisualShell：无法安全结构化的复杂背景，必须标记 `design-only`。

Visual Shell 不得吞掉已有文字、Props Slot 或 Runtime Region。后续编辑只更新对应层和绑定路径。

## 6. 开发交付包

页面包：

```text
page-package.zip
  manifest.json
  page.blueprint.json
  design-document.json
  theme.tokens.json
  quality.review.json
  runtime.validation.json
  components/<instanceId>/...
  page-assets/...
  previews/page@1x.png
  previews/page@2x.png
```

组件包除现有 Props、Blueprint、结构和素材外，必须增加组件版本/sourceHash、原始 Props 与 Patch Diff、主题 Token、质量报告、Runtime 结果、素材哈希和兼容性声明。

## 7. 分阶段实施

| 阶段 | 能力 | 验收条件 | 状态 |
| --- | --- | --- | --- |
| P0.1 | Reference Contract 与扩展 Visual Theme | KV 职责明确，颜色/字体/表面/效果可复用 | 已实现 |
| P0.2 | Page Blueprint 与多组件实例计划 | 一轮任务能规划多个组件实例和页面 Section | 已实现动态 Section 子任务与可编辑页面组合 |
| P0.3 | Quality Review 与 Repair Loop | 有结构化评分，失败自动修订且不写入坏结果 | 页面/组件确定性门禁与 Renderer PNG Vision Review 已实现 |
| P1.1 | Runtime Adapter 与验证协议 | 支持真实 Adapter；缺 Bundle 时诚实返回 unsupported | Adapter 框架已实现，待业务 Bundle |
| P1.2 | 设计稿/Runtime 截图对比 | 输出结构、像素和 Props 生效诊断 | 尺寸/Region/Props 协议已实现，像素对比待真实截图 |
| P1.3 | 可编辑图层增强 | 常用文字、形状、渐变和装饰不再被整体扁平化 | Text/Shape/Props 已实现，复杂装饰待拆层 |
| P1.4 | 开发交付包 v3 | 配置、素材、主题、质量和兼容性可机器消费 | 已实现 SHA-256、资源清单、1x/2x 预览和分级交付状态 |
| P2.1 | 位图/插画/3D Provider | 复杂素材不再使用语言模型 SVG 模拟 | 待实现 |
| P2.2 | 动画 Provider | 动画 Slot 有真实产物和运行时验证 | 待实现 |

## 8. 当前边界

当前仓库的 `componentsJson` 只有组件元数据和远程 thumbnail，没有实际 React/Vue 组件 Bundle，因此可以完成 Contract、设计、Props、素材和导出验证，但不能声称真实组件已经运行。Runtime Adapter 框架完成后，需要业务组件包或可访问的预览 Runtime 才能把状态从 `unsupported` 提升为 `passed/failed`。

当前 Codex Provider 生成 SVG，适合布局、文字和矢量装饰；照片、人物、复杂插画、3D 和动画必须由后续专用 Provider 完成。

## 8.1 下一阶段强化路线

### P3.1 Blueprint 确认与任务控制

当前状态：基础已实现。

- 已实现生成前展示页面 Section、组件顺序、逻辑尺寸和组件名。
- 已实现 `awaiting-confirmation` 暂停状态，确认前不调用组件素材 Provider。
- 已实现确认后恢复同一 Run、动态插入组件 Step。
- 已实现 Page Section 锁定/解锁和组件实例局部修订。
- 已实现确认前排序、删除 Section 和编辑高度，待实现组件替换和普通 Section 插入。

### P3.2 Vision Review 与局部 Repair

- 已实现 Renderer 导出级 PNG 画板快照、Vision Review 协议和 targetId Repair；截图或远程评审失败时降级本地门禁。待使用真实 KV 数据集标定阈值。
- Review Issue 必须携带 `scope + targetId + repairPrompt`。
- 页面问题只重生成 page-shell；组件问题只恢复对应组件 Step；Slot 问题只替换原图片节点。

### P3.3 Component Sandbox

- Electron HTML Bundle Sandbox 已实现；待业务侧注册真实 React/Vue Bundle 和 createHtml Adapter。
- 收集 Runtime 截图、控制台错误、未知 Props、缺失素材和 appliedProps。
- 使用 Region 与像素对比决定 `passed/failed`，无 Bundle 时继续返回 `unsupported`。

### P3.4 精确缓存与交付包 v3

- Step 已保存 `inputHash`、依赖输出哈希和 `outputHash`，按输入变化精确失效。
- 页面包已增加 `page@1x.png`、`page@2x.png`、SHA-256 去重、字体/远程资源清单和兼容性声明。
- 不满足质量门禁时只允许导出诊断包。

### P3.5 专业编辑与 Provider 路由

- 已增加图片 Crop 焦点、阴影、文本溢出和 Section Auto Layout；自由 Mask、渐变编辑器、混合模式和响应式约束待实现。
- 按能力路由 SVG、位图、图片编辑、动画和 Vision Provider，不允许静态 SVG 冒充位图或动效。

## 9. 测试矩阵

- 黄色 KV 不得输出默认蓝色组件。
- 原型结构与 KV 风格职责不能互换。
- 多组件页面中的每个实例拥有唯一 ID 和独立 Props。
- 删除、复制和修订组件不会污染其他实例。
- 文字不能溢出，Region 不能越界，Slot 必须完整。
- 导出包不能包含未改写 Data URI、未知 Props 或 Visual Shell Props。
- Runtime 不可用时导出报告必须为 `unsupported`。
- 任一质量 error 不得进入 `canvas.present-page`。
- 多组件页面必须为每个组件创建独立 `page.generate-component` Step 和组件实例。
- 页面视觉外壳必须位于组件下方，并标记为 `design-only`，不得参与 Props Patch。
- 一个组件子任务失败时，已经完成的其他组件检查点保持可恢复。
