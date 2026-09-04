# 统一 Render IR 技术方案

## 1. 问题

同一份 `DesignElement` 在编辑画布、版本对比、PNG 导出、响应式预览和代码导出中被重复解释，导致代码产物与画布视觉不一致。

`canonical-renderer-migration-plan.md` 已把**快照链路**统一到 `ElementRenderer`，但代码生成链路仍是独立实现。当前存在三套并行的"元素 → 视觉"解释：

| 出口 | 入口文件 | DOM 结构 | 样式真源 |
| --- | --- | --- | --- |
| 编辑画布 | `ElementRenderer.tsx:43` | 外层 `.design-element` + 内层 `.text-element`/`.button-element`… 两层 | inline `baseStyle` **+** `_canvas-legacy.scss:292-410` 类规则 |
| 版本对比 / PNG / 响应式预览 | `StaticArtboardRenderer.tsx`、`ResponsivePreviewPanel.tsx:257` | 复用 `ElementRenderer`，两层 | 同上 |
| 代码生成 | `normalize-scene.ts:222` `boxStyle()` | 压平为一层 `<span>`/`<button>`/`<img>` | `elementVisualStyle()`（`scene-visual-contract.ts:33`）经 `CodeNodeStyle` 白名单过滤 |

第四套残留：`artboard-snapshot.ts:45` `createExportNode()` 手写 DOM，已无调用方。

根因不是"某处算错了"，而是 **`elementVisualStyle()` 在用 TypeScript 重抄一遍 SCSS 规则**。抄漏即错乱，且每次新增视觉属性都要在三处同步。

## 2. 已定位的具体缺陷

以下均可从代码直接推定，作为迁移后的回归用例：

### 2.1 圆形被渲染为方形

`normalize-scene.ts:239` 用 `borderRadius: element.cornerRadii?.topLeft`，未消费 `visual.borderRadius`。而 `CodeNodeStyle.borderRadius` 类型为 `number`（`types.ts:56`），无法承载 `shape === 'circle'` 需要的 `'50%'`（`scene-visual-contract.ts:97`），四角不等时也只取 `topLeft`。

### 2.2 字体族与省略号静默丢弃

`elementVisualStyle()` 输出 `fontFamily`（`scene-visual-contract.ts:55`），但 `CodeNodeStyle` 无此字段，`cssStyle()`（`shared.ts:25`）的条目表也无 `font-family` → 白名单过滤时静默丢弃。`textOverflow: 'ellipsis'`（`ElementRenderer.tsx:117`）同理。

### 2.3 双层 overflow 语义在压平后打架

画布上外层 `overflow` 由 `clipContent` 决定（`ElementRenderer.tsx:55`），内层由 `element.style.overflow` 决定（`ElementRenderer.tsx:116`）。压平成一层后两者只能保留其一：`clipContent === false` 且 `style.overflow === 'ellipsis'` 的文本，画布显示 `…`，代码里直接硬裁剪。

### 2.4 HTML 与 React/Vue 产出结构不一致

`html-compiler.ts:88` `flattenCanvasNodes()` 把整棵树拍平到 root 下并累加父偏移；`react-compiler.ts:57` 与 `vue-compiler.ts:48` 是递归嵌套。因此同一份 `CodeDocument` 的 HTML 产物会丢失：

- section 的 `overflow: hidden` 对子节点的裁剪
- 父级 `opacity` / `transform` 对子树的继承
- `z-index` 语义从"同父层叠上下文内竞争"变成"全局竞争"

### 2.5 归一化只在一侧生效

`normalizeArtboardScene()`（`scene-visual-contract.ts:20`）会把坐标 clamp 到 `[0, artboard.width - 1]`、尺寸夹到画板内。只有 codegen 全量走它（`normalize-scene.ts:52`）；画布与 `StaticArtboardRenderer` 都不 clamp。越界元素在画布上溢出画板，在代码里被夹回边界。

此外 `normalize-scene.ts:46` 有分支不一致：`selectionIds` 非空时**只做原点平移不做 clamp**，为空时才走 `normalizeArtboardScene`。同一元素在"导出选区"和"导出整板"两条路径下尺寸可能不同。

### 2.6 runtime-placeholder 三处样式各不相同

- 画布：`.runtime-placeholder-element` SCSS，含 `cards`/`list` 两种 grid 变体（`_canvas-legacy.scss:318-370`）
- `createExportNode`：`artboard-snapshot.ts:126` 硬编码 `#f1f5f9` 背景与 dashed 边框
- codegen：`elementVisualStyle()` 完全没有 `runtime-placeholder` 分支 → 落到 base 样式，预览内容丢失

## 3. 目标

建立单一真源：**`buildRenderBox()` 是"`DesignElement` → 视觉"的唯一解释者**，所有出口退化为对同一 IR 树的不同打印方式。

约束：

1. 视觉属性只在一处定义，新增属性无需改动多个文件。
2. 画布 / 快照 / 代码三者的 DOM 结构同构，层叠与继承语义一致。
3. 坐标归一化只发生一次，且不静默改值。
4. 存在像素级门禁防止再次漂移。

非目标：本方案不改动 `DesignElement` 数据模型，不改动 `DesignSpec` / Scene Graph 适配层，不改动 Runtime Component 的黑盒引用协议。

## 4. Render IR 设计

新增 `src/features/editor/render/render-box.ts`。

### 4.1 类型

```ts
/** 一个 DesignElement 展开后的 DOM 盒子。box 为定位层，content 为内容层。 */
export interface RenderBox {
  /** 稳定标识，等于 element.id；content 层为 `${element.id}::content`。 */
  key: string
  role: 'artboard' | 'box' | 'content'
  tag: RenderTag
  /**
   * 全量 CSS 声明，kebab-case 键、字符串值，已带单位。
   * 开放 Record 而非白名单 —— 新增视觉属性不需要同步修改编译器。
   */
  css: Record<string, string>
  /** 语义化 class，供代码产物可读性与画布交互态挂载使用。 */
  classNames: string[]
  attrs?: Record<string, string>
  /** 纯文本内容；与 children 互斥。 */
  text?: string
  children: RenderBox[]
  /** 供 codegen 建立 sourceMap 与 runtime 引用，画布侧忽略。 */
  meta: RenderBoxMeta
}

export type RenderTag =
  | 'main' | 'section' | 'div' | 'span' | 'p'
  | 'h1' | 'h2' | 'h3' | 'button' | 'input' | 'img'

export interface RenderBoxMeta {
  elementId?: string
  elementType?: DesignElement['type']
  /** 该 box 对应 Runtime Component 实例根节点时存在。 */
  runtime?: {
    instanceId: string
    componentName: string
    componentPackId?: string
    props: Record<string, unknown>
    binding?: ComponentBinding
  }
  /** 编辑器专属交互能力，静态出口据此跳过事件绑定。 */
  interactive?: {
    editableText?: boolean
    selectable?: boolean
  }
}
```

`css` 选用 `Record<string, string>` 而非 `CSSProperties` 的理由：codegen 需要直接序列化为 CSS 文本，React 需要 camelCase 对象。统一存 kebab-case 字符串，两侧各做一次机械转换，避免 `CodeNodeStyle` 白名单那类"忘记加字段就静默丢失"的失效模式。

### 4.2 构建上下文

```ts
export interface RenderContext {
  /** 画板局部坐标系原点已在调用前减去，此处仅用于 page-shell 撑满与 clamp 诊断。 */
  artboard: Artboard
  /** 'canvas' 保留交互态与 contentEditable；'static' 用于快照；'export' 用于 codegen。 */
  mode: 'canvas' | 'static' | 'export'
  /** 父元素，用于判定 autoLayout 流式定位。 */
  parent?: DesignElement
  diagnostics: RenderDiagnostic[]
}

export interface RenderDiagnostic {
  code: 'OUT_OF_BOUNDS' | 'INVALID_BOUNDS' | 'ORPHAN_PROMOTED' | 'RUNTIME_PACK_MISSING'
  severity: 'error' | 'warning'
  message: string
  elementId?: string
}
```

`mode` 只影响两件事：是否附加交互态 class / `contentEditable`，以及 `runtime-placeholder` 是否渲染。**不影响任何视觉 CSS**——这是保证一致性的关键约束。

### 4.3 主函数

```ts
export function buildRenderBox(element: DesignElement, ctx: RenderContext): RenderBox
export function buildArtboardRenderTree(
  document: DesignDocument,
  artboard: Artboard,
  options: { mode: RenderContext['mode']; selectionIds?: string[] },
): { root: RenderBox; diagnostics: RenderDiagnostic[] }
```

`buildArtboardRenderTree` 承担现在分散在 `normalize-scene.ts:39-130`、`StaticArtboardRenderer.tsx:12` 和 `InfiniteCanvas` 中的职责：筛选可见元素、建立父子关系、按 `zIndex` 排序、处理 Runtime Component 实例遮蔽、生成 artboard 根盒子。

### 4.3.1 扁平与嵌套两种结构

实现时发现的一处关键差异：**编辑画布是扁平渲染的**。元素与画板 DOM 同级、使用世界坐标（`InfiniteCanvas.tsx:1393`），`parentId` 不参与 DOM 嵌套；而代码导出按 `parentId` 递归嵌套。

因此 `buildArtboardRenderTree` 需要 `structure` 参数：

| 出口 | structure | 原因 |
| --- | --- | --- |
| 编辑画布 | `flat` | 拖拽、缩放、选区命中都依赖世界坐标，改为嵌套会牵动全部交互逻辑 |
| 静态快照 / 版本对比 / PNG | `nested` | 无交互，必须与导出一致才能让 `clipContent` 裁剪、透明度继承成立 |
| 代码导出 | `nested` | 同上 |

这是本方案唯一允许的结构分歧，且**只影响坐标的参照系，不影响定位方式和任何视觉 CSS**：

- `flat`：坐标相对画板，节点全部平铺在画板根层
- `nested`：坐标相对父节点，DOM 按 `parentId` 嵌套

两者都用 `position: absolute`，因此同一元素**累加各层偏移后必须落在相同的屏幕位置**。`scripts/test-render-ir.mjs` 的用例 4b 就断言这一点——它比"逐个字段比对 CSS"更能反映真实意图。

静态预览一开始误用 `flat`，导致父节点的 `clipContent` 对子节点失效——被一致性门禁捕获，现已改为 `nested`。

### 4.4 双层结构保留

每个元素展开为 box + content 两层，与画布现状一致：

```
RenderBox(role='box', tag='div', class=['design-element'])
  css: position/left/top/width/height/opacity/z-index/transform/box-shadow/border-radius/overflow
  └─ RenderBox(role='content', tag='span', class=['text-element'])
       css: color/font-*/line-height/text-align/overflow/text-overflow/white-space
```

保留双层而非压平的收益：

- `border-radius: inherit` 语义天然成立（`ElementRenderer.tsx:148`、`172`、`195` 都依赖它）
- 2.3 的双层 overflow 冲突消失
- 变换 / 透明度 / 层叠上下文的继承关系与画布逐字节一致

代价是 DOM 节点数翻倍。对导出代码可读性的影响可接受：外层 class 语义为布局定位，内层为内容样式，这本身也是手写代码的常见结构。

### 4.5 各元素类型的展开规则

规则从 `ElementRenderer.tsx:92-243` 与 `_canvas-legacy.scss:292-410` 合并迁移而来。

| type | box class | content tag | content class | 关键 CSS |
| --- | --- | --- | --- | --- |
| `text` | `design-element` | `span` | `text-element` | `color`、`font-family`、`font-size`、`font-weight`、`line-height`、`text-align`、`overflow`、`text-overflow`、`white-space: pre-wrap`、`display: flex`、`align-items: flex-start` |
| `image` | `design-element` | `img` | `image-element` | `object-fit`、`object-position`、`border-radius: inherit`、`display: block`、`width/height: 100%` |
| `button` | `design-element` | `button` | `button-element` | `background`、`color`、`font-size`、`font-weight`、`border: 0`、`border-radius: inherit`、`text-align: center` |
| `input` | `design-element` | `input`（所有 mode 一致） | `input-element` | `display: flex`、`align-items: center`、`padding: 0 10px`、`background`、`color`、`font-*`、`border`、`border-radius: inherit` |
| `shape` | `design-element` | `div` | `shape-element`（+ `circle`） | `background`、`border`、`border-radius`（circle 时 `50%`） |
| `section` | `design-element` | `div` | `component-section-element` | 仅 box 层的通用盒模型；**不写 `autoLayout` 的 flex 属性**（见 4.5.1） |
| `runtime-placeholder` | `design-element` | `div` | `runtime-placeholder-element` + `runtime-placeholder-${variant}` | 见 4.6 |

**`autoLayout` 不产出任何 flex 容器 CSS，所有节点一律绝对定位。** 这与直觉相反，理由见 4.5.1。

### 4.5.1 autoLayout 是编辑期工具，不是渲染期布局

**`autoLayout` 不得在渲染时生成 flex 布局。** 本项目的 `autoLayout` 语义是"设置时算一次并写回坐标"：`editor-store.ts` 的 `applySectionAutoLayoutToElements()` 调用 `auto-layout.ts:layoutSection()`，把计算出的 `x`/`y` 直接写进子元素（`editor-store.ts:2612`）。**存量坐标本身就是排版结果**，画布也只按绝对坐标渲染，从不消费 `autoLayout`。

若导出时再让子节点走 `position: relative` + flex 流，等于用另一套基准重算一遍布局：`gap` 取代了设计坐标，卡片内多行文字会挤到一起。这是本方案初版实现引入的真实缺陷，表现为"部分页面元素堆叠"——画布正常、导出错乱。

因此：

- box 层一律 `position: absolute`
- section 的 `autoLayout` **不写入** `display: flex` / `flex-direction` / `gap` / `padding`（`padding` 尤其危险，会挤压 content 层）
- 未来若要支持真正的响应式流式布局，应作为独立的 `layoutMode` 字段引入，并让画布同步消费，而不是让导出单方面解释 `autoLayout`

`input` 的标签名不得随 `mode` 变化。最初设计为编辑器用 `div`、导出用 `input`，实测两者的浏览器文本基线与内边距算法不同，产生约 640 像素的稳定偏差。统一为 `input` 后，编辑器侧的指针穿透改由 `input-element-static` class 表达，**不进入 `css`**，以保持"视觉 CSS 与 mode 无关"的不变式。

### 4.6 runtime-placeholder 的处理

`.runtime-placeholder-element` 的 grid 变体样式（cards / list）目前只存在于 SCSS，且用了 `:has()` 选择器（`_canvas-legacy.scss:333`）。迁移策略：

- `mode === 'export'`：placeholder 是编辑器占位概念，不应出现在交付代码中。`buildRenderBox` 返回 `null`，并推入 `RUNTIME_PACK_MISSING` 诊断（若该 placeholder 关联了未声明 Pack 的组件）。
- `mode === 'canvas' | 'static'`：展开为完整 IR，`:has()` 逻辑改为在构建时判定 `element.preview` 是否存在，直接产出对应 CSS，不依赖选择器。

### 4.7 CSS 值生成的确定性

所有数值必须显式带单位并统一舍入，避免浮点差异造成 diff 噪声。新增内部工具：

```ts
function px(value: number): string       // Math.round(value * 100) / 100 + 'px'
function lineHeight(value?: number): string | undefined  // >4 视为 px，否则无单位倍数
```

`lineHeight` 的 `> 4` 判定沿用 `design-properties.ts:41` 与 `shared.ts:64` 的既有约定，收敛到一处。

## 5. 三个消费者的改造

### 5.1 `RenderBoxView` —— React 渲染器

新增 `src/features/editor/render/RenderBoxView.tsx`：

```tsx
export function RenderBoxView({
  box,
  override,
}: {
  box: RenderBox
  /** 按 box 返回交互态覆盖；缺省即纯静态渲染。 */
  override?: (box: RenderBox) => RenderBoxOverride | undefined
}): ReactElement

export interface RenderBoxOverride {
  className?: string
  style?: CSSProperties
  children?: ReactNode      // 替换子内容，用于文本编辑态
  props?: Record<string, unknown>
}
```

内部把 `css`（kebab-case）转为 React `CSSProperties`（camelCase，由 `toReactStyle()` 承担），递归渲染 `children`。

采用 `override` 回调而非预设的 `interaction` 字段包：交互需求会持续变化（选中、编辑、锁定、切图态…），回调让 `RenderBoxView` 不必知道任何编辑器概念，保持"只是一台打印机"。`toReactStyle` 放在 `render-box.ts` 而非组件文件，避免 fast-refresh 告警。

`ElementRenderer` 保留为薄封装：调用 `buildRenderBox` 后交给 `RenderBoxView`，并在 box 层追加 `selected` / `editing` class 与事件。`EditableTextElement`（`ElementRenderer.tsx:245`）的 contentEditable 与 selection 读取逻辑原样保留——那是纯交互，不属于视觉真源。

`StaticArtboardRenderer` 改为直接 `buildArtboardRenderTree(..., { mode: 'static', structure: 'nested' })` + `RenderBoxView`，不再经过 `ElementRenderer`，省掉传一堆空回调。

### 5.2 codegen —— IR 转 CSS + 模板

`normalize-scene.ts` 的 `boxStyle()` / `semanticTag()` / `nativeNode()` 整体删除，改为：

```ts
export function normalizeScene(document, artboardId?, selectionIds?): NormalizedScene {
  const tree = buildArtboardRenderTree(document, artboard, {
    mode: 'export',
    structure: 'nested',
    selectionIds,
  })
  return { root: tree.root, nodes: tree.boxes, diagnostics: /* 映射为 CodeDiagnostic */, artboard }
}
```

`CodeNodeStyle` 类型删除；`CodeNativeNode` / `CodeRuntimeNode` 收敛为 `RenderBox`（`meta.runtime` 存在即 runtime component）。`CodeDocument.root` 类型改为 `RenderBox`。

`shared.ts` 的 `cssStyle()` 从"白名单条目表"改为直接序列化：

```ts
export function cssDeclarations(box: RenderBox): string {
  return Object.entries(box.css)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n')
}
```

三个 compiler 统一改为**递归输出嵌套 DOM**：

- `html-compiler.ts`：删除 `flattenCanvasNodes()`（`:88`）与 `findParentId()`（`:112`）。`data-parent-id` 属性因结构已嵌套而不再需要，DOM 层级本身即父子关系。
- `react-compiler.ts` / `vue-compiler.ts`：递归逻辑保持，节点取值改为读 `RenderBox`。

class 名生成仍走 `readableClass()`（`shared.ts:5`），但需要为 content 层生成区分名（如 `${readableClass(...)}-content`），避免 box 与 content 共用同一 class。实现为 `boxClass()`。

### 5.1.9 解析 CSS box-shadow 必须先摘颜色

Chrome 的 computed `box-shadow` 把**颜色放在最前面**：

```
输入:     8px 8px 0 rgb(110,27,11)
computed: rgb(110, 27, 11) 8px 8px 0px 0px
```

`parseCssShadow`（`electron/runtime/runtime-dom-adapter.mjs`）原先直接对整串取数字，于是 RGB 通道被当成了几何量：解析出 `{x:110, y:27, blur:11}`，而正确值是 `{x:8, y:8, blur:0}`。表现为**硬阴影退化成大范围模糊、位置整体偏移**，点"立即整理"（会把阴影重置为 `x:8,y:8,blur:0`）后才恢复正常——这也正是该缺陷的诊断信号。

修正为先摘掉颜色与 `inset` 关键字，再取剩余数字作为 offset-x / offset-y / blur / spread；多层阴影按括号深度切分后取首层（`rgba(...)` 内部的逗号不能当层分隔符）。

### 5.1.10 行高归一化只能做一次

行高在链路里有两种量纲：**像素**（`18px`）和**倍数**（`1.2857`）。两处都会做换算：

| 位置 | 行为 |
| --- | --- |
| `runtime-dom-adapter.mjs` `normalizeRuntimeLineHeight` | 像素 ÷ 字号 → 倍数，且 `<= 4` 时视为已是倍数直接返回 |
| `component-design-adapter.ts` | 原先**无条件** ÷ 字号 |

于是已归一化的 `1.2857` 又被除一次：`1.2857 / 14 ≈ 0.0918`。行盒高度塌到约 1px，文字墨迹全部溢出并被 `.text-element` 的 `overflow: hidden` 裁掉 —— 表现为**文案偏上、上下都被切**。实测存量数据中有 48 个元素中招。

修正：`component-design-adapter.ts` 改用 `normalizeLineHeight()`，与上游共用同一条阈值（`LINE_HEIGHT_RATIO_MAX = 4`）判断量纲，避免两处判据漂移。缺字号时退回默认值，**不能拿像素值当倍数用**。

历史坏数据不做兼容处理：重新生成即可得到正确值。

### 5.2.0 class 名必须由分配器保证唯一

`class` 一旦碰撞，多个元素共用同一条 CSS 规则、后者覆盖前者：位置被覆盖则元素堆叠，尺寸被覆盖则元素"消失"。

初版沿用 `readableClass(name, id)`（`slug` + id 哈希截断 5 位），在真实数据上碰撞率很高：生成链路的 id 形如 `…:runtime:art-title-16`、`…-17`，仅尾部序号不同，而 `hash * 31` 的差异集中在低位、正好被 `.slice(0, 5)` 截掉。实测一个 45 元素的画板出现 **6 组碰撞、涉及 13 个元素**。

修正为 `src/features/codegen/class-pass.ts` 的 `assignClassNames()`：深度优先遍历 IR，用注册表分配 `meta.className`，重名追加 `-2`、`-3`。`boxClass()` 改为只读该字段，缺失即抛错。`readableClass()` 与 `cssClass()` 已删除。

**换更强的哈希不是解法**——那只降低概率。唯一性需要注册表来保证。

### 5.2.1 导出产物的基础样式必须带字体栈

实现时由一致性门禁发现：编辑器在 `:root` 声明了 Inter 字体栈（`base/_reset.scss:4`），而三个 compiler 各自硬编码的 reset 都没有 `font-family`，导出页面回退到浏览器默认衬线字体。设计稿的文本尺寸与换行都基于该字体度量，缺失会让**每一处文本**都与画布偏移。

修正：把 reset 收敛为 `shared.ts` 的 `CODEGEN_RESET_CSS` 常量，含与编辑器一致的字体栈及字体平滑设置，三个 compiler 共用。这类"两处硬编码同一份基础样式"正是本方案要消除的失效模式。

### 5.3 响应式预览

`ResponsivePreviewPanel.tsx:257` 的 `ElementRenderer` 调用改为 `RenderBoxView` + `mode: 'static'`。该面板本身的断点缩放与 DesignSpec Scene Commit 逻辑不变。

### 5.4 删除残留实现

`artboard-snapshot.ts:45-135` 的 `createExportNode()` 与 `createExportElement()` 整体删除（已无调用方，且是 2.6 中样式分歧的来源之一）。

`renderArtboardSnapshot()`（`:8`）保留，内部仍走 `StaticArtboardRenderer`——它现在已经是 IR 的消费者。

### 5.5 SCSS 边界

`_canvas-legacy.scss` 中以下规则**迁入 IR**并从 SCSS 删除：

- `.design-element` 的 `display` / `align-items` / `justify-content` / `white-space` / `transform-origin`（`:292-299`）
- `.component-section-element`（`:316`）
- `.runtime-placeholder-element` 及全部 `.runtime-preview-*` 变体（`:318-370`）
- `.text-element` / `.shape-element` / `.button-element` / `.image-element` 的尺寸与视觉规则（`:376-410`）

以下**保留在 SCSS**，属于纯编辑器交互态：

- `.design-element` 的 `touch-action`（`:298`）
- `.design-element.selected` / `.editing` 的 outline 与 cursor（`:307-314`）
- `.editor-viewport.slicing-image` / `.slice-tool` 的 cursor 覆盖（`:301-305`）
- `.text-element[contenteditable='true']` 的 outline / user-select（`:390`）
- `.image-element` 的 `pointer-events: none`（`:407`）
- `.artboard` / `.artboard-label` / `.selection-box` 等画布外壳

判定标准：**会影响导出产物视觉的，进 IR；只在编辑时可见的，留 SCSS。** 只要视觉规则还有一部分留在 SCSS，codegen 就必须靠手抄追赶，问题会复发。

## 6. 坐标归一化的调整

当前 `normalizeArtboardScene()` 静默 clamp 坐标与尺寸，是 2.5 的直接原因。改为：

```ts
/** 只做筛选、排序、原点平移与越界诊断，不改写任何数值。 */
export function collectArtboardScene(
  document: { elements: DesignElement[] },
  artboard: Artboard,
  diagnostics: RenderDiagnostic[],
): Array<{ element: DesignElement; left: number; top: number }>
```

越界不再被夹回，而是推入 `OUT_OF_BOUNDS` 诊断。真正的拦截前移到 Scene Commit 阶段——`scene-validator.ts` 已有校验位置，越界节点在写入文档前就应被阻止或收回，而不是在渲染时各出口自行修正。

`normalize-scene.ts:46` 的 selection / 全板双分支随之消失：两条路径都走同一个 `collectArtboardScene`，只在之后按 selection 包围盒做一次统一的原点平移（保留 `normalize-scene.ts:70-87` 的包围盒计算）。

`normalizeArtboardScene()` 保留一个 deprecated 转发以免破坏外部调用，在阶段 4 完成后删除。

## 7. 迁移阶段

四个阶段均已实施完成，验证结果见 8.5。以下保留原计划供回溯。

### 阶段 1：建立 IR，画布切换

- 新增 `render-box.ts`、`RenderBoxView.tsx`
- `buildRenderBox` 此阶段**逐字节复刻**画布现状（inline style + SCSS 的并集），SCSS 暂不删
- `ElementRenderer` 改为 `buildRenderBox` + `RenderBoxView` 的薄封装
- codegen 完全不动

验收：`npm run test:visual-regression` 无差异。此阶段风险最低，因为视觉真源尚未搬迁。

### 阶段 2：SCSS 视觉规则迁入 IR

- 按 5.5 的清单迁移并删除对应 SCSS
- `StaticArtboardRenderer`、`ResponsivePreviewPanel` 切到 `RenderBoxView`

验收：`test:visual-regression` 与 `test:e2e:visual-optimization` 无差异；`test:component-export` 通过。

### 阶段 3：codegen 消费 IR

- 删除 `boxStyle()` / `semanticTag()` / `CodeNodeStyle`
- 三个 compiler 改为递归消费 `RenderBox`，删除 `flattenCanvasNodes()`
- 删除 `createExportNode()`
- 按第 6 节调整归一化

验收：`test:codegen`、`test:component-export`、`test:design-pipeline` 通过；新增第 8 节的一致性用例。

### 阶段 4：像素门禁

- 新增 `tests/e2e/codegen-parity.spec.ts`
- 删除 `normalizeArtboardScene()` 的 deprecated 转发

工作量集中在阶段 2 与 3。阶段 1 是纯机械重构，阶段 4 是新增测试。

### 实施偏差

- `scene-visual-contract.ts` 整体删除，未保留 deprecated 转发——确认全仓无其他调用方，留转发只会多一份僵尸代码。
- 阶段 3 未按计划先做"仅更新快照"的独立提交：实际只有 `test:codegen` 一条断言需要改，diff 本身就可读。
- 新增 `structure` 参数（见 4.3.1），这是原方案缺失的一层结构差异。
- 原方案 4.5 节要求"`autoLayout` 落在 box 层生成 flex 容器"，实测是错的——该字段是编辑期工具而非渲染期布局，照做会导致导出元素堆叠。已按 4.5.1 修正。

## 8. 验证

### 8.1 一致性门禁

新增 `tests/e2e/codegen-parity.spec.ts`：对同一画板分别截取

1. 画布区域（`[data-artboard-id]` 元素）
2. codegen HTML 产物在 iframe 中的渲染

做像素 diff，超阈值即失败。这是唯一能防止再次漂移的机制——没有它，统一后仍会因为后续改动而分叉。

实现为 `tests/e2e/codegen-parity.spec.ts` + `src/pages/CodegenParityFixturePage.tsx`（路由 `/__visual__/codegen-parity`）。fixture 刻意覆盖易错组合：非零画板原点、四角不等圆角、圆形、省略号文本、旋转+半透明、`clipContent` 裁剪、`autoLayout` 流式行、按钮与输入框。

**阈值必须实测校准，不能凭感觉设。** 初版设 `maxDiffPixelRatio: 0.02` + `threshold: 0.2`，注入"导出时圆形退化为方形"的缺陷后门禁**仍然通过**——48×48 的圆角差异只占 3.26%，且 `threshold: 0.2` 的逐像素 YIQ 容差把大部分差异吸收掉了。收紧为 `maxDiffPixelRatio: 0.004` + `threshold: 0.1` 后能稳定捕获该缺陷（0.02 > 0.004）。

新增门禁后应当用一次注入缺陷验证它真的会失败，否则容易得到一个永远通过的假门禁。

**合成 fixture 抓不到与数据规模相关的缺陷。** 5.2.0 的 class 碰撞在 13 元素的 parity fixture 上概率极低，直到 45 元素的真实画板才暴露。此类问题应补一条不依赖具体数据的结构断言（现已在 `test:codegen` 中断言"导出 CSS 无重复 class"），而非只加像素样本。

**门禁只能覆盖 fixture 里出现过的结构。** 初版 fixture 没有"`autoLayout` 容器内含多行文字"这一组合，因此 4.5.1 的堆叠缺陷逃过了门禁，直到真实页面导出才暴露。现已把该组合补进 fixture 并验证过：还原缺陷时门禁失败（0.02 > 0.004）。新增视觉能力时应同步扩充 fixture，而不只依赖既有样本。

### 8.1.1 快照链路门禁

`tests/e2e/artboard-snapshot.spec.ts` + `src/pages/SnapshotFixturePage.tsx`（路由 `/__visual__/snapshot`）。fixture 把 DOM 真源与快照位图并排渲染，测试逐像素比对——同时覆盖下面两类缺陷。

**缺陷一：空白图。** `createRoot().render()` 异步提交 DOM，而快照只等一个 `requestAnimationFrame` 就交给光栅化，经常截到空节点，产出只有画板背景色的空白图——表现为**版本对比两侧全空**。本方案把静态渲染改为 `nested` 后 DOM 层级变深、提交更慢，把它从偶发变成必现。

修正：`commitReactTree()` 先让出当前任务再用 `flushSync` 强制同步提交，`waitForRenderedContent()` 轮询兜底，且离屏节点为空时**抛错而非静默返回空图**。

**缺陷二：字形被裁（见 8.1.2）。**

门禁除逐像素比对外，另留一条"颜色种类数 > 40"的独立断言：空白图能轻易通过"差异小"的判据，必须单独排除。

### 8.1.2 不能用 html2canvas 光栅化

html2canvas 自行重算文本基线，**不处理字形墨迹溢出行盒的情况**。设计稿大量使用 `lineHeight < 1`，此时墨迹会伸到行盒上方。实测 65px 字号、`lineHeight: 0.95`：

| | 墨迹行范围 |
| --- | --- |
| DOM（真源） | `-8` → `69`（上溢 8px） |
| html2canvas | `28` → `88`（整体下移 36px，被宿主裁掉） |

表现为大字号标题底部削平、`bilibili` 的 `b` 缺下半截变成 `h`。这是库的缺陷（1.4.1 为 2021 年最后一版，已停止维护），换 `overflow`、`display`、`align-items` 都无效——实测各变体墨迹高度在 53–61px 间摆动，均不等于 DOM 的真实值。

改用 `src/features/editor/utils/rasterize-node.ts` 的 `rasterizeNode()`：SVG foreignObject 走浏览器原生排版，与 DOM **逐像素一致（实测边界偏差 0px）**。代价是两个约束，已在实现中处理：

- 图片必须内联为 data URL —— SVG 内无法发起网络请求
- 样式必须逐节点内联 —— 克隆节点脱离文档，`.text-element` 之类的选择器不再命中

`InfiniteCanvas` 的元素截图（AI 参考图、复制为图片）同样改用它。`html2canvas` 依赖已移除。

### 8.2 结构等价用例

新增 `scripts/test-render-ir.mjs`，断言同一 `DesignElement` 在 `mode: 'canvas'` 与 `mode: 'export'` 下产出的 IR **除 `classNames` 中的交互态与 `meta.interactive` 外完全相等**。这条比像素 diff 更快，适合放在 `test:all` 前段快速失败。

### 8.3 缺陷回归用例

第 2 节每条缺陷对应一个固定用例：

| 用例 | 断言 |
| --- | --- |
| circle shape | codegen CSS 含 `border-radius: 50%` |
| 四角不等圆角 | 四个角值均正确输出 |
| 自定义 `fontFamily` | codegen CSS 含 `font-family` |
| `overflow: ellipsis` 文本 | 产物含 `text-overflow: ellipsis` 且未被外层硬裁剪 |
| `autoLayout` section | HTML 产物中子节点仍是该 section 的直接子元素，且**保持绝对定位**、不生成 `gap`/`flex-direction` |
| `autoLayout` 内多行文字 | 累加偏移后与画布位置逐一相等，行距不被 `gap` 取代（用例 4b） |
| 嵌套 `opacity` | 子节点不重复乘算父透明度 |
| 越界元素 | 产出 `OUT_OF_BOUNDS` 诊断，坐标不被静默改写 |
| 选区导出 vs 整板导出 | 同一元素尺寸一致 |
| runtime-placeholder | `mode: 'export'` 下不出现在产物中 |

### 8.4 现有测试影响

`test:codegen` 有两处断言需更新，均为预期变更：

1. 嵌套坐标：原先断言拍平后的绝对坐标 `left: 130px`，改为嵌套下的相对坐标 `left: 30px`（父节点在 100px 处）。同时补了 HTML 产物父子包含关系的断言。
2. `autoLayout` 容器：原先断言产出 `display: flex` / `flex-direction: row` / `gap: 12px` 且子节点 `position: relative` 无偏移。按 4.5.1 改为断言**不产出** flex 属性、子节点保持 `position: absolute` 且带相对父节点的坐标。

`test:component-export`、`test:design-pipeline` 等实测无需改动。

### 8.5 实际验证结果

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| Render IR 结构等价与缺陷回归（11 组） | `npm run test:render-ir` | 通过 |
| 代码生成 | `npm run test:codegen` | 通过 |
| 画布与导出像素一致 | `npm run test:codegen-parity` | 通过，**差异 0 像素** |
| 快照与 DOM 逐像素一致 | `npm run test:snapshot-gate` | 通过 |
| 真实项目数据（45 元素画板） | 手工核对 | 45 个元素位置/尺寸**全部逐一相等**，残差 0.66% 为文字抗锯齿 |
| 响应式视觉基线（沿用迁移前基线） | `npm run test:visual-regression` | 通过，证明 SCSS→IR 迁移未改变画布视觉 |
| 编辑器 e2e | `playwright test tests/e2e/editor.spec.ts` | 通过 |
| 其余 13 项领域测试 / lint / build | 见 `test:all` | 通过 |

`npm run test:agent-upgrades` 失败（意图路由断言 `create-ui` vs `revise-page-shell`），已用"仅回退本次渲染改动"的方式确认为**改动前既有失败**，与本方案无关。

## 9. 风险

| 风险 | 应对 |
| --- | --- |
| 双层结构使导出 DOM 节点数翻倍 | 可接受；后续可加"content 层无独立样式时折叠"的优化，但**不在本方案内**——先保证正确，再谈精简 |
| 阶段 2 迁移 SCSS 时遗漏规则 | 依赖阶段 1 建立的视觉回归基线；逐条迁移而非批量 |
| `:has()` 选择器逻辑改为构建时判定可能行为不同 | runtime-placeholder 仅编辑器可见，影响面小；纳入 8.3 用例 |
| 现有 codegen 快照大面积变更，掩盖真实回归 | 阶段 3 先跑一次仅更新快照的提交，再做逻辑改动，让 diff 可读 |
| `CodeNodeStyle` 是公开导出类型，可能有外部消费 | 已确认仅 `compilers/` 内部使用；删除前用 `grep` 复核 |

## 10. 与既有文档的关系

- `canonical-renderer-migration-plan.md`：本方案是其第 6 条"对齐代码导出"的具体落地，已更新该文档的当前阶段描述。
- `multi-framework-codegen-runtime-components.md`：`CodeNode` / `CodeNodeStyle` 的类型描述需同步为 `RenderBox`。Runtime Component 的黑盒引用协议不变。
- `scene-graph-adapter-architecture.md`：本方案不触及 Source Adapter 层，`DesignSpec` → `DesignElement` 的转换不变。
