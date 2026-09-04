# Canonical Scene Graph 多框架代码编译方案

> 状态：P1-P3 基础编译链已实现；Preview Build、真实业务 Component Adapter 和构建门禁仍按真实依赖接入。

## 实现状态（2026-08-26）

已落地的代码入口是 `src/features/codegen/compiler-registry.ts`：

- `compileForFramework(document, 'html' | 'react' | 'vue')` 从同一份 `DesignDocument` 编译。
- `buildCodeExportPackage` 输出可下载 ZIP，包含代码、资源、Manifest 和 Source Map。
- Normalize、Layout、Semantic、Component、Asset Pass 已拆分为独立模块，便于后续替换或增加框架。
- HTML/CSS、React 19 TSX、Vue 3 SFC 静态编译器已实现，并通过 `npm run test:codegen` 验证。
- Data URI 图片会按 SHA-256 去重并写入 `assets/`；远程图片保留 URL 并输出离线复现告警。
- Runtime Component 只输出组件标签、Props 文件和依赖声明；组件内部节点不会进入 HTML、TSX 或 Vue Template。
- 未声明 Component Pack 的运行时组件输出 `runtime-required` 诊断，不伪造组件内部实现。
- 嵌套节点会转换为相对父容器的坐标；带 Auto Layout 的容器输出 Flex 方向、间距和内边距。
- 页面外壳始终从导出页面的 `(0,0)` 开始；孤儿节点会提升到根层并记录诊断，不会静默丢失。
- 导出 CSS 包含基础 box-sizing、body margin 和横向溢出 reset，避免浏览器默认样式造成空白或偏移。
- 导出阶段使用 Prettier 对 HTML、CSS、TSX、Vue 和 JSON 统一格式化；单文件格式化失败时保留原文并写入 `CODE_FORMAT_FALLBACK` 告警。
- Native 文本节点使用 `<span>`，避免 `<p>` 与 section/div 混排时触发浏览器隐式闭合，保证预览和格式化器看到的 DOM 结构一致。
- 整页导出会先将无限画布坐标归一化到当前画板原点；根节点不再重复减去 `artboard.x/y`，避免页面节点落到视口外而出现空白。
- HTML 预览 iframe 与外层预览容器使用一致的 `#codegen-root` 选择器，并提供加载中/加载失败状态；预览弹窗打开时锁定外部页面滚动，树、代码和 iframe 各自维护滚动区域。
- 画布快照与 Code IR 共享 `src/features/editor/utils/scene-visual-contract.ts` 的纯视觉契约（坐标、尺寸、圆角、阴影、文字、按钮、输入框和图片样式）；画布的选择、拖拽、缩放等交互和外层 DOM 仍由 `ElementRenderer` 独立负责，避免导出样式污染编辑器。
- “渲染预览”只消费本次生成的 `CodeDocument`，与 HTML/CSS 标签页使用相同的节点集合和画板范围；不再直接读取完整 `DesignDocument` 或调用 PNG 导出 DOM，因此局部选择不会退化为整页预览。
- 远程资源不会在未实际下载时伪造本地路径；导出 Manifest 会明确标记离线复现风险。

编辑器中可通过顶部工具栏的下载菜单导出当前活动画板：

```text
下载 -> HTML / CSS 开发包
下载 -> React 19 开发包
下载 -> Vue 3 开发包
```

导出前会执行代码校验；校验失败时不会下载不完整的 ZIP，并在界面提示诊断信息。

同一菜单提供 `HTML 结构预览`。未选择节点时预览当前画板，选中一个节点或模块时只编译该节点及其后代；预览窗口同时展示 Scene Graph、HTML、CSS 和实际 iframe 渲染结果。导出代码使用短的语义 class，并保留 `data-node-id`（HTML）用于回到画布定位。

当前仍未宣称完成的能力：

- 真实 React/Vue 业务 Bundle 的 Adapter 注册和导出包安装。
- Electron 沙箱中的 Preview Build、真实框架构建和运行截图验证。
- InteractionSpec 到事件代码的编译；没有交互契约时仍只输出静态 UI。

## 1. 目标

项目中的内容分为两类：

1. Native Scene Node：页面背景、容器、文本、图片、普通按钮、形状和布局。
2. Runtime Component：已经拥有 `componentJs`、`componentCss`、Props Schema 和 Runtime 的业务组件。

两者不能使用同一种代码生成策略。Runtime Component 内部已经拥有 DOM 和 CSS，页面编译器不应再次生成或重写它的内部结构。

目标链路：

```text
DesignDocument
  -> Canonical Scene Graph
  -> Normalize/Layout/Semantic/Component/Asset Pass
  -> Code IR
  -> HTML/CSS、React、Vue Compiler
  -> Preview Build
  -> DOM/结构/视觉验证
  -> Export Package
```

## 2. 核心边界

### 2.1 AI 不直接生成框架代码

AI 负责页面意图、视觉主题、区块、内容、组件选择、Props 和交互意图。AI 不分别生成 HTML、React 和 Vue。所有框架代码必须从同一个 Canonical Scene Graph 编译。

### 2.2 Runtime Component 是黑盒

Runtime Component 在 Scene Graph 中只记录：

- 组件实例 ID
- Component Pack ID
- 组件名称
- 页面边界和层级
- Component Binding
- Props
- 资源依赖
- Runtime Inspector 定位信息

组件内部 DOM/CSS 由组件自身负责。Runtime Inspector 识别出的内部节点只用于画布预览、节点定位和 Props 编辑，不直接进入页面代码。

### 2.3 Native Scene Node 由页面编译器生成

没有有效 `componentBinding` 的节点生成原生 HTML 元素。只有 `componentBinding` 和 Component Pack 都有效时，才生成业务组件引用，禁止凭节点名称伪造业务组件。

## 3. Canonical Scene Graph

建议显式区分原生节点和组件节点：

```ts
interface RuntimeComponentNode {
  id: string
  type: 'runtime-component'
  parentId?: string
  componentName: string
  componentPackId: string
  bounds: { x: number; y: number; width: number; height: number }
  props: Record<string, unknown>
  componentBinding: ComponentBinding
  runtimeSource: {
    componentJs?: string
    componentCss?: string
    formControl?: string
  }
}
```

内部 Runtime 节点必须标记：

```text
runtime-owned
componentInstanceId
sourceNodeId
runtime.domPath
```

这些字段表示来源和编辑映射，不表示页面代码中的独立节点。

## 4. 编译 Pass

### 4.1 Normalize Pass

统一处理所有框架共用的数据：

- px 坐标、尺寸和圆角
- 行高单位
- 颜色格式
- opacity 和 zIndex
- 父子关系
- 空节点和无效尺寸
- Asset 引用

Compiler 不得自行猜测 `lineHeight`、颜色或尺寸的单位。

### 4.2 Layout Pass

```text
Horizontal Auto Layout -> display: flex
Vertical Auto Layout   -> display: flex; flex-direction: column
Grid                   -> display: grid
Fixed                  -> position: absolute
Fill                   -> flex: 1
Hug                    -> auto / fit-content
Min/Max                -> min-* / max-*
Breakpoint             -> @media
```

无法安全转换的布局可以保留绝对定位，但必须输出 `pixel-accurate` 诊断，不能伪装成可维护的流式布局。

### 4.3 Semantic Pass

根据 `type`、`designRole`、绑定和内容确定标签：

```text
heading -> h1/h2/h3
text    -> p/span
button  -> button
input   -> input
image   -> img
page    -> main/section
```

证据不足时使用安全标签，并记录诊断。

### 4.4 Component Pass

Runtime Component 转换为：

```text
组件 import 或 Runtime mount descriptor
Props 配置
组件依赖
组件资源策略
```

组件内部 DOM、CSS 和 Runtime Inspector 节点不进入 Native HTML/CSS 输出。

### 4.5 Asset Pass

统一完成：

- Data URI 落盘
- 远程图片下载
- SHA-256 去重
- 稳定文件名
- 页面资源和组件资源分离
- 字体与远程依赖清单
- 资源失效诊断

## 5. Code IR

Scene Graph 不直接拼接 JSX 或模板字符串，增加统一中间表示：

```ts
interface CodeDocument {
  version: 1
  framework: 'html' | 'react' | 'vue'
  entryFile: string
  files: CodeFile[]
  assets: CodeAsset[]
  dependencies: CodeDependency[]
  diagnostics: CodeDiagnostic[]
  sourceMap: CodeSourceMap[]
}

interface CodeFile {
  path: string
  language: 'html' | 'tsx' | 'vue' | 'css' | 'ts' | 'json'
  content: string
}
```

Code IR 统一管理文件结构、className、资源地址、依赖、诊断和 Source Map，后续增加 Svelte 或小程序时不修改 Scene Graph。

`CodeDocument.root` 与 `CodeNode` 即 Render IR 的 `RenderBox`——节点样式的唯一真源是 `src/features/editor/render/render-box.ts`，编辑画布、静态快照和三个 compiler 共用同一棵树。编译器只负责把 IR 打印成目标框架语法，不得自行解释 `DesignElement` 的视觉。详见 [`unified-render-ir.md`](unified-render-ir.md)。

## 6. 框架输出

### 6.1 HTML/CSS

```text
index.html
styles.css
assets/
components.manifest.json
validation-report.json
```

Native 节点生成静态 DOM。Runtime Component 必须使用 Custom Element、Runtime Mount Adapter 或外部脚本声明。没有 HTML Adapter 时必须标记 `runtime-required`，不能生成假的内部 DOM。

### 6.2 React 19

```text
src/App.tsx
src/components/
src/styles/
src/assets/
props/
package.json
```

Native 节点生成 JSX：

```tsx
<button className="node-draw-one">抽一次</button>
```

Runtime Component 生成：

```tsx
<EraLottery {...lotteryProps} styleConfig={styleConfig} />
```

只有存在真实 Component Adapter 时才生成业务组件 import，否则输出原生节点和 `runtime-required` 诊断。

### 6.3 Vue 3

```text
src/App.vue
src/components/
src/styles/
src/assets/
props/
package.json
vite.config.ts
```

Native 节点生成 Vue Template；Runtime Component 由 Vue Adapter 输出：

```vue
<EraLottery :style-config="styleConfig" v-bind="lotteryProps" />
```

没有变量或交互定义时，不得擅自生成 `v-if`、`v-for`、`ref` 或接口请求。

## 7. Props 与资源依赖

组件导出只负责引用组件、传入 Props、导出配置、声明依赖和复用组件 JS/CSS：

```text
src/components/EraLottery.ts
props/era-lottery.json
components.manifest.json
```

资源策略分为：

```text
remote   -> 保留远程 URL，适合开发预览
download -> 下载到导出包，适合可复现交付
package  -> 作为 npm/本地依赖，适合生产工程
```

Props 只能来自 Component Pack Schema、已有实例 Props、用户明确修改或经过 Schema 校验的 Props Patch。禁止从 thumbnail 猜测线上业务字段。

## 8. 交互逻辑

设计稿外观不等于业务逻辑。交互必须显式记录：

```ts
interface InteractionSpec {
  event: 'click' | 'change' | 'submit'
  action: 'navigate' | 'toggle' | 'open' | 'set-state' | 'request'
  targetId?: string
  payload?: Record<string, unknown>
}
```

没有 `InteractionSpec` 时生成静态 UI；有交互定义时才生成 React/Vue 事件和最小状态；组件事件由 Component Pack Adapter 负责输出。

## 9. Source Map

```ts
interface CodeSourceMap {
  sceneNodeId: string
  file: string
  line: number
  column: number
  componentInstanceId?: string
  generatedBy: 'native-compiler' | 'runtime-component'
}
```

用途：画布节点定位代码、代码定位画布节点、构建错误回溯 Scene、Props 错误定位组件实例，以及局部重新生成。

## 10. 验证闭环

```text
Code IR
  -> 格式化
  -> 语法/类型检查
  -> 依赖检查
  -> Preview Runtime
  -> DOM 节点和资源检查
  -> 截图
  -> 结构/像素对比
```

必须验证：代码可解析、React/Vue 构建成功、资源存在、组件依赖可解析、Text 不丢失、页面尺寸一致、组件边界一致、组件 CSS 未被页面重复注入，以及未注册组件被标记为 `runtime-required`。

## 11. 推荐目录

```text
src/features/codegen/
  types.ts
  code-ir.ts
  compiler-registry.ts
  normalize-scene.ts
  layout-pass.ts
  semantic-pass.ts
  component-pass.ts
  asset-pass.ts
  compilers/html-compiler.ts
  compilers/react-compiler.ts
  compilers/vue-compiler.ts
  validators/code-validator.ts
  export-code-package.ts

electron/runtime/codegen/
  preview-runner.mjs
  package-validator.mjs
  dependency-resolver.mjs
```

## 12. 实施阶段

### P1：HTML/CSS Native Compiler

Code IR、Native 节点编译、Asset Pass、静态预览、Source Map 和 ZIP 导出。

### P2：React 19 Compiler

JSX/TSX、React 项目模板、Runtime Component Adapter、Props 配置和 TypeScript 构建验证。

### P3：Vue 3 Compiler

SFC、`script setup`、Vue Component Adapter 和 Vue 构建验证。

### P4：响应式代码

Auto Layout 转 Flex/Grid、Breakpoint 转 Media Query、Fill/Hug/Min/Max 转 CSS 约束。

### P5：真实组件交付

Component Pack 依赖安装、真实 React/Vue Bundle、组件事件 Adapter、Runtime Props 验证和运行截图回归。

## 13. 风险控制

| 风险 | 控制方式 |
| --- | --- |
| 业务组件被错误拆成 HTML | Runtime Component 强制作为黑盒 |
| 页面代码过度绝对定位 | 输出 `pixel-accurate` 诊断 |
| 组件 CSS 污染页面 | Component Pack 隔离管理 |
| AI 伪造业务逻辑 | 没有 InteractionSpec 不生成逻辑 |
| 远程资源失效 | Asset Manifest 和资源固化策略 |
| React/Vue 输出不一致 | 所有 Compiler 共用 Code IR |
| 代码无法运行 | Preview Build 和构建门禁 |
| 没有真实 Bundle 却声称成功 | 明确标记 `runtime-required` 或 `unsupported` |

## 14. 验收标准

1. 同一 Scene Graph 生成 HTML、React、Vue 时节点、文案和资源一致。
2. Runtime Component 内部 HTML/CSS 不进入页面代码。
3. Runtime Component 只输出引用、Props 和依赖声明。
4. Native Node 可生成可运行的 HTML/CSS、React 或 Vue 代码。
5. 代码生成后可执行对应框架构建验证。
6. 画布节点和代码行可双向定位。
7. 资源可复现，不能依赖未声明的远程地址。
8. 没有真实 Bundle 时，导出结果显示 `runtime-required`。
9. 页面布局和组件内部布局职责分离。
10. 新增其他框架时只需增加 Compiler，不修改 AI 设计流程。

## 15. 结论

最终代码生成器由以下部分组成：

```text
页面布局编译器
  + Native Scene Node Compiler
  + Runtime Component Mount Adapter
  + Props 配置导出器
  + Asset Dependency Manager
  + Preview/Build Validator
```

已有组件负责自己的内部 DOM 和 CSS；设计工具负责页面外壳、组件编排、Props、资源依赖和验证。这是通用设计能力、业务组件复用和前端工程可维护性之间的合理边界。
