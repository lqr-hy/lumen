# AI 设计稿生成工具技术方案

## 1. 产品目标

本项目目标是实现一个类似即梦的 AI 设计稿生成工具，基于 Vite + React 构建 Web 应用。用户可以通过自然语言描述设计需求，生成活动页、营销落地页、Banner、海报、社媒封面等设计稿，并在一个接近 Figma 的无限画布中继续编辑、调整、导出和二次生成。

第一阶段重点不是做完整的 Figma 替代品，而是打通以下核心闭环：

- 用户输入设计需求。
- AI 生成结构化设计稿。
- 前端在无限画布中渲染设计稿。
- 用户可以选中、拖拽、缩放、编辑元素。
- 支持局部 AI 修改。
- 支持导出图片、JSON、HTML 或 React 代码。

## 2. 技术栈

### 2.1 前端

- Vite
- React
- TypeScript
- React Router
- Zustand
- Tailwind CSS
- dnd-kit
- Framer Motion
- lucide-react
- html2canvas
- Canvas API / DOM 混合渲染

### 2.2 后端建议

- Node.js
- NestJS 或 Express
- PostgreSQL
- Redis
- BullMQ
- S3 / OSS / COS 对象存储

### 2.3 AI 能力

- 大模型：负责理解需求、生成设计结构 JSON、局部修改设计稿。
- 文生图模型：负责生成背景图、商品图、插画、视觉素材。
- 多模态模型：负责理解参考图、识别风格、提取布局。

### 2.4 桌面端打包预留

当前方案以 Vite + React Web 应用为核心，后期可以演进为 macOS 桌面应用并打包成 `.dmg`。推荐路线是在 Web 应用稳定后增加 Electron 或 Tauri 桌面壳：

- Electron：生态成熟，适合需要本地文件读写、系统菜单、窗口管理、离线导出等能力的桌面设计工具，可使用 `electron-builder` 生成 `.dmg`。
- Tauri：安装包体积更小，性能和系统资源占用更好，但需要 Rust 工具链，适合前端为主、本地能力较轻的版本。

第一阶段不需要直接引入桌面框架，但需要提前保持 Web 应用和平台能力解耦：

- AI 接口、密钥、素材生成、对象存储等能力仍放在后端，避免把密钥暴露在桌面客户端。
- 文件读写、导出、本地缓存、项目保存等能力通过适配层封装，后续可以分别接入浏览器 API、Electron Main Process、Tauri Command。
- 前端业务逻辑不要直接依赖 Electron 或 Tauri API，避免影响 Web 版本部署。
- 如果需要离线可用，后续可以增加 IndexedDB、SQLite 或本地文件项目包。

## 3. 核心设计原则

AI 不直接生成不可编辑的图片，也不直接生成自由 HTML。核心产物应是一个结构化的设计文档 `DesignDocument`。

这样做的好处：

- 可以编辑。
- 可以存储。
- 可以版本管理。
- 可以做撤销和重做。
- 可以导出多种格式。
- 可以做局部 AI 修改。
- 可以接近 Figma 的编辑体验。

## 4. 整体架构

```txt
用户输入 Prompt
  ↓
前端生成 GenerateRequest
  ↓
后端创建 AI 生成任务
  ↓
大模型生成 DesignDocument JSON
  ↓
文生图模型生成图片素材
  ↓
前端加载设计文档
  ↓
无限画布渲染和编辑
  ↓
导出 / 保存 / 二次生成
```

后期桌面版可以复用同一套前端核心：

```txt
Vite + React 应用
  ↓
Web 部署：浏览器访问后端 API
  ↓
桌面部署：Electron / Tauri 加载前端构建产物
  ↓
macOS 打包：生成 .app 和 .dmg 安装包
```

桌面端不改变 `DesignDocument`、无限画布、编辑器状态管理和导出渲染等核心模型，只增加平台适配层。这样可以同时保留 Web 版本和 macOS DMG 版本。

## 5. 页面规划

```txt
/
  工作台首页

/generate
  AI 生成页

/editor/:projectId
  无限画布编辑器

/projects
  项目列表

/templates
  模板库

/assets
  素材库
```

## 6. 项目目录建议

```txt
src/
  app/
    router.tsx
    providers.tsx

  pages/
    HomePage.tsx
    GeneratePage.tsx
    EditorPage.tsx
    ProjectsPage.tsx
    TemplatesPage.tsx

  features/
    ai/
      api.ts
      prompt-builder.ts
      types.ts

    editor/
      components/
        InfiniteCanvas.tsx
        CanvasViewport.tsx
        CanvasGrid.tsx
        ArtboardRenderer.tsx
        ElementRenderer.tsx
        SelectionBox.tsx
        TransformHandles.tsx
        Ruler.tsx
        GuideLines.tsx
        Toolbar.tsx
        LayerPanel.tsx
        PropertyPanel.tsx
      store/
        editor-store.ts
      utils/
        coordinates.ts
        hit-test.ts
        snapping.ts
        transform.ts
      types.ts

    projects/
      api.ts
      types.ts

    templates/
      api.ts
      types.ts

  components/
    ui/
    layout/

  lib/
    http.ts
    cn.ts
    storage.ts

  styles/
    globals.css
```

## 7. 设计文档数据模型

### 7.1 DesignDocument

```ts
interface DesignDocument {
  id: string
  title: string
  version: number
  viewport?: ViewportState
  artboards: Artboard[]
  elements: DesignElement[]
  assets: DesignAsset[]
  createdAt: string
  updatedAt: string
}
```

### 7.2 无限画布视口

```ts
interface ViewportState {
  x: number
  y: number
  zoom: number
}
```

`x` 和 `y` 表示画布世界坐标相对屏幕视口的平移偏移。`zoom` 表示缩放比例。

### 7.3 画板

无限画布上可以存在多个画板。每个画板类似 Figma 中的 Frame。

```ts
interface Artboard {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  background: string
  borderRadius?: number
  overflow?: 'visible' | 'hidden'
}
```

### 7.4 元素

```ts
type DesignElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | ButtonElement
  | GroupElement
```

```ts
interface BaseElement {
  id: string
  artboardId?: string
  parentId?: string
  type: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  locked?: boolean
  visible?: boolean
  zIndex: number
}
```

```ts
interface TextElement extends BaseElement {
  type: 'text'
  content: string
  style: {
    fontSize: number
    fontWeight?: number
    color: string
    lineHeight?: number
    textAlign?: 'left' | 'center' | 'right'
    fontFamily?: string
  }
}
```

```ts
interface ImageElement extends BaseElement {
  type: 'image'
  src: string
  objectFit?: 'cover' | 'contain' | 'fill'
  borderRadius?: number
}
```

```ts
interface ShapeElement extends BaseElement {
  type: 'shape'
  shape: 'rect' | 'circle'
  fill: string
  stroke?: string
  strokeWidth?: number
  borderRadius?: number
}
```

## 8. 无限画布技术设计

### 8.1 目标体验

画布需要接近 Figma 的基础体验：

- 鼠标滚轮或触控板平移。
- `Ctrl` / `Command` + 滚轮缩放。
- 空格按住拖动画布。
- 支持多画板。
- 支持选中元素。
- 支持拖拽移动元素。
- 支持拖拽缩放元素。
- 支持框选。
- 支持图层面板定位元素。
- 支持快捷键删除、复制、粘贴、撤销、重做。
- 支持缩放到适合屏幕。
- 支持居中当前画板。
- 支持辅助线和吸附。

### 8.2 坐标系统

无限画布需要区分两套坐标：

- Screen 坐标：浏览器窗口中的像素坐标。
- World 坐标：无限画布中的设计坐标。

转换方法：

```ts
function screenToWorld(point: Point, viewport: ViewportState): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
}

function worldToScreen(point: Point, viewport: ViewportState): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
}
```

所有设计数据都应该存储为 World 坐标。屏幕坐标只用于交互计算和渲染转换。

### 8.3 渲染方式

第一阶段建议使用 DOM 渲染设计元素，用 CSS transform 控制无限画布：

```tsx
<div className="editor-viewport">
  <div
    className="canvas-world"
    style={{
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0',
    }}
  >
    {artboards.map(renderArtboard)}
    {elements.map(renderElement)}
  </div>
</div>
```

原因：

- DOM 元素更容易编辑文本。
- 更容易导出 HTML / React。
- 更容易做属性面板联动。
- 对营销页、海报、Banner 这类设计稿足够实用。

后续如果元素数量变多，可以把网格、参考线、选区等改为 Canvas 渲染，设计元素仍然使用 DOM 渲染。

### 8.4 平移

触发方式：

- 按住空格 + 鼠标拖拽。
- 鼠标中键拖拽。
- 触控板双指移动。

状态：

```ts
interface PanState {
  isPanning: boolean
  startScreenX: number
  startScreenY: number
  startViewportX: number
  startViewportY: number
}
```

### 8.5 缩放

缩放必须以鼠标所在位置为中心，而不是以左上角为中心。

```ts
function zoomAtPoint(
  viewport: ViewportState,
  screenPoint: Point,
  nextZoom: number,
): ViewportState {
  const before = screenToWorld(screenPoint, viewport)

  const nextViewport = {
    ...viewport,
    zoom: nextZoom,
  }

  const after = worldToScreen(before, nextViewport)

  return {
    x: viewport.x + screenPoint.x - after.x,
    y: viewport.y + screenPoint.y - after.y,
    zoom: nextZoom,
  }
}
```

缩放范围建议：

```txt
最小：0.05
最大：8
默认：1
```

### 8.6 网格

无限画布需要背景网格辅助定位。

实现方式：

- 小缩放比例下显示粗网格。
- 中等缩放比例显示普通网格。
- 高缩放比例显示细网格。

网格不参与设计导出，只属于编辑器 UI。

### 8.7 画板

每个 AI 生成结果默认落到一个画板内。后续用户可以在同一个无限画布中生成多个版本。

示例：

```txt
画板 A：春节活动页方案 1
画板 B：春节活动页方案 2
画板 C：春节活动页方案 3
```

画板能力：

- 新建画板。
- 重命名画板。
- 复制画板。
- 删除画板。
- 导出单个画板。
- 将当前视图聚焦到画板。

### 8.8 元素选择

选择能力：

- 单击选择元素。
- `Shift` 多选。
- 点击空白取消选择。
- 拖拽框选。
- 图层面板选择。

选择框应该渲染在独立 overlay 层，避免受到元素层级影响。

```txt
editor-viewport
  canvas-world
    artboards
    elements
  overlay-layer
    selection-box
    transform-handles
    guide-lines
```

### 8.9 拖拽移动

移动元素时需要：

- 使用 World 坐标计算移动距离。
- 支持多选一起移动。
- 支持吸附到画板边缘。
- 支持吸附到其他元素边缘和中心线。
- 支持按住 Shift 限制水平或垂直移动。

### 8.10 缩放和旋转

第一阶段实现：

- 四角缩放。
- 四边缩放。
- 按住 Shift 等比缩放。

第二阶段实现：

- 旋转手柄。
- 多选组合缩放。
- 约束比例。

### 8.11 吸附和辅助线

吸附目标：

- 画板边缘。
- 画板中心线。
- 元素边缘。
- 元素中心线。
- 网格。

吸附阈值：

```txt
5px 到 8px，按 screen 坐标计算。
```

吸附结果要转换回 World 坐标，避免不同缩放比例下手感不一致。

### 8.12 快捷键

```txt
Command/Ctrl + Z：撤销
Command/Ctrl + Shift + Z：重做
Command/Ctrl + C：复制
Command/Ctrl + V：粘贴
Delete / Backspace：删除
Command/Ctrl + D：复制并粘贴
Command/Ctrl + A：全选当前画板元素
0：缩放到 100%
1：适配当前画板
Space：临时平移工具
```

## 9. 编辑器状态管理

使用 Zustand 管理编辑器状态。

```ts
interface EditorState {
  document: DesignDocument | null
  viewport: ViewportState
  selectedElementIds: string[]
  activeArtboardId?: string
  tool: 'select' | 'hand' | 'text' | 'shape' | 'image'
  history: DesignDocument[]
  future: DesignDocument[]

  setDocument: (document: DesignDocument) => void
  setViewport: (viewport: ViewportState) => void
  selectElement: (id: string, options?: { append?: boolean }) => void
  clearSelection: () => void
  updateElement: (id: string, patch: Partial<DesignElement>) => void
  updateElements: (patches: Array<{ id: string; patch: Partial<DesignElement> }>) => void
  addElement: (element: DesignElement) => void
  removeElements: (ids: string[]) => void
  undo: () => void
  redo: () => void
}
```

需要注意：

- 视口变化不进入撤销历史。
- 选择变化不进入撤销历史。
- 元素新增、删除、移动、缩放、属性修改进入撤销历史。
- 拖拽过程中不要每一帧都写入历史，只在拖拽结束时提交一次。

## 10. AI 生成模块

### 10.1 生成请求

```ts
interface GenerateRequest {
  prompt: string
  type: 'landing-page' | 'poster' | 'banner' | 'social-cover'
  size: {
    width: number
    height: number
  }
  style?: string
  industry?: string
  referenceImages?: string[]
}
```

### 10.2 生成结果

```ts
interface GenerateResult {
  projectId: string
  document: DesignDocument
}
```

### 10.3 Prompt 策略

要求 AI 输出结构化 JSON，而不是 Markdown 或解释性文字。

基本约束：

```txt
你是一个专业视觉设计师。
请根据用户需求生成一个结构化设计稿 JSON。
必须包含 artboards、elements、assets。
所有元素必须有 id、type、x、y、width、height、zIndex。
所有坐标都使用无限画布的 world 坐标。
不要输出 Markdown。
不要解释。
只输出 JSON。
```

## 11. AI 局部修改

用户可以选择某个元素或某个画板，然后输入修改指令。

示例：

```txt
把标题改得更有科技感
让背景更像 B 站活动视觉
增加一个 CTA 按钮
把整体改成夏日促销风格
生成三个不同风格版本放到右侧
```

局部修改不要每次返回完整文档，优先返回 patch。

```ts
interface DesignPatch {
  operations: Array<{
    type: 'add' | 'update' | 'delete'
    targetId?: string
    payload?: unknown
  }>
}
```

Patch 应用流程：

```txt
当前 DesignDocument
  ↓
选中上下文 selectedElementIds / activeArtboardId
  ↓
用户指令
  ↓
AI 返回 DesignPatch
  ↓
前端校验 patch
  ↓
应用到 document
  ↓
写入历史记录
```

### 11.1 长期 AI 编排协议

长期方案不能只把 AI 当成普通问答接口，也不能让 AI 每次直接重写完整 `DesignDocument`。推荐采用“AI 理解局部 `DesignDocument`，返回受限 `operations`，前端确定性校验和执行”的协议。

核心原则：

- `DesignDocument` 是画布唯一真实状态。
- AI 请求需要携带任务相关的局部上下文，而不是盲目发送或覆盖完整文档。
- AI 可以理解设计文档结构，但不能直接作为最终执行者修改内存状态。
- 画布修改必须通过受限 operation 列表表达。
- 前端或后端必须校验 operation，再应用到 `DesignDocument`。

一次 AI 编辑请求建议包含：

```ts
interface AiEditContext {
  instruction: string
  documentVersion: number
  selectedElementIds: string[]
  activeArtboardId?: string
  selectedElements: DesignElement[]
  nearbyElements: DesignElement[]
  parentGroups?: DesignElement[]
  assets: Array<Pick<DesignAsset, 'id' | 'type' | 'name' | 'src'>>
  styleTokens?: {
    colors: string[]
    fonts: string[]
    spacing: number[]
  }
}
```

AI 返回结果建议拆成自然语言回复和结构化操作：

```ts
interface AiEditResult {
  message: string
  operations: DesignOperation[]
}

type DesignOperation =
  | { type: 'createArtboard'; payload: Artboard }
  | { type: 'createElement'; payload: DesignElement }
  | { type: 'updateElement'; targetId: string; patch: Partial<DesignElement> }
  | { type: 'moveElement'; targetId: string; x: number; y: number }
  | { type: 'deleteElement'; targetId: string }
  | { type: 'replaceImage'; targetId: string; assetId?: string; src?: string }
```

执行流程：

```txt
用户指令 / 选中节点 / 引用图片
  ↓
构建 AiEditContext
  ↓
模型理解 DesignDocument 局部结构
  ↓
返回 message + operations
  ↓
JSON Schema 校验
  ↓
节点 ID、类型、层级、尺寸、边界和权限校验
  ↓
检查 documentVersion，处理冲突
  ↓
应用 operation 到 DesignDocument
  ↓
写入 undo / redo 历史
  ↓
渲染变更并反馈结果
```

校验要求：

- 禁止模型返回任意字段或执行任意代码。
- `targetId` 必须存在，节点类型必须匹配 operation。
- 尺寸、坐标、层级、资源引用必须在合理范围内。
- 批量操作可以先生成 diff / preview，再由用户确认。
- 所有成功执行的 operation 需要记录审计信息，方便回滚和排查。

图片生成、原型图生成设计稿、设计稿发布上线需要作为独立能力编排：

- 聊天模型负责理解意图并产出 `operations` 或 tool call。
- 文生图服务负责生成真实图片资源，返回 `assetId` / `url`。
- 发布服务负责把 `DesignDocument` 转为 HTML / React / 静态资源包。
- AI 不直接把一段自然语言当成画布修改结果。

浏览器版本和 DMG 版本应该共用同一套协议：

- 浏览器走部署后的后端 API。
- DMG 可以由 Electron Main Process 读取本地配置或代理请求，但返回格式仍然必须是 `AiEditResult`。
- 两端差异只在密钥读取、文件读写和请求转发层，不影响 `DesignDocument` 与 operation 执行层。

推荐分阶段落地：

1. 先跑通稳定的普通聊天链路。
2. 增加只读 `DesignDocument` 上下文，让 AI 能解释当前画布。
3. 增加 operation schema，但先只展示 diff，不直接执行。
4. 启用前端校验后的局部画布修改。
5. 接入图片生成、原型图识别和发布上线能力。

## 12. 属性面板

属性面板根据选中元素类型动态展示。

文本元素：

- 内容
- 字体
- 字号
- 字重
- 行高
- 颜色
- 对齐方式
- 透明度

图片元素：

- 图片地址
- 替换图片
- 裁剪方式
- 圆角
- 透明度
- 滤镜

形状元素：

- 填充色
- 边框色
- 边框宽度
- 圆角
- 透明度

画板：

- 名称
- 尺寸
- 背景色
- 是否裁剪溢出内容

## 13. 图层面板

图层面板能力：

- 展示画板。
- 展示画板下元素。
- 支持拖拽排序。
- 支持显示/隐藏。
- 支持锁定/解锁。
- 支持重命名。
- 支持定位到画布中元素。

图层顺序应该与 `zIndex` 或数组顺序保持一致。

## 14. 导出能力

第一阶段：

- 导出 PNG。
- 导出 JPG。
- 导出 JSON。

第二阶段：

- 导出 HTML。
- 导出 React 组件。
- 导出 PDF。
- 保存为模板。

导出图片可以使用 `html2canvas`。导出时只导出目标画板，不导出无限画布背景、网格、选择框和编辑器 UI。

## 15. 性能策略

第一阶段目标是保证几十到几百个元素可流畅编辑。

关键策略：

- 画布整体使用 CSS transform 做平移和缩放。
- 拖拽过程中使用临时 transform，结束后再提交坐标。
- 网格和辅助线单独渲染，不进入设计文档。
- 选区 overlay 与元素渲染分离。
- 属性面板修改使用局部更新。
- 大图资源使用缩略图预览。
- 历史记录可以使用 patch 或快照压缩。

后续优化：

- 元素虚拟化。
- Canvas 渲染网格和辅助线。
- Web Worker 计算复杂吸附。
- 使用 IndexedDB 缓存项目和素材。

## 16. MVP 里程碑

### 阶段 1：基础工程

- 初始化 Vite + React + TypeScript。
- 配置路由。
- 配置 Tailwind CSS。
- 建立基础布局。
- 建立 Zustand store。

### 阶段 2：无限画布

- 实现画布平移。
- 实现鼠标位置缩放。
- 实现背景网格。
- 实现画板渲染。
- 实现画板居中和适配屏幕。

### 阶段 3：元素渲染和编辑

- 渲染文本、图片、形状、按钮。
- 实现元素选中。
- 实现拖拽移动。
- 实现缩放控制点。
- 实现属性面板编辑。
- 实现图层面板。

### 阶段 4：AI 生成闭环

- 先使用 mock AI 返回设计 JSON。
- 实现 Prompt 表单。
- 生成结果进入编辑器。
- 支持同一无限画布内生成多个方案。
- 接入真实 AI 接口。

### 阶段 5：导出和保存

- 本地保存项目。
- 导出 JSON。
- 导出 PNG。
- 导出 HTML / React 代码。

## 17. 第一版建议取舍

第一版必须做：

- 无限画布。
- 多画板。
- AI 生成设计 JSON。
- 元素选中、移动、缩放。
- 属性编辑。
- 图层面板。
- PNG 导出。

第一版可以暂缓：

- 多人协作。
- Figma 文件导入。
- 复杂自动布局。
- 布尔运算。
- 高级钢笔工具。
- 复杂矢量编辑。
- 插件系统。

## 18. 风险点

### 18.1 AI 输出不稳定

解决方案：

- 使用 JSON Schema 校验。
- 对 AI 输出做修复。
- 不允许模型自由发挥字段。
- 对设计元素数量和尺寸做约束。

### 18.2 无限画布交互复杂

解决方案：

- 严格区分 Screen 坐标和 World 坐标。
- 所有数据存 World 坐标。
- 交互计算统一走 `coordinates.ts`。
- 先完成基础手感，再做吸附和高级能力。

### 18.3 DOM 元素过多导致性能下降

解决方案：

- 第一版限制单画板元素数量。
- 后续做元素虚拟化。
- 网格、辅助线使用 Canvas。
- 大图使用压缩预览。

### 18.4 导出结果和编辑器显示不一致

解决方案：

- 设计元素使用统一 renderer。
- 编辑器 UI 和设计内容分层。
- 导出时只渲染目标画板内容。

## 19. 推荐实现顺序

1. 搭建 Vite + React 项目基础。
2. 定义 `DesignDocument`、`Artboard`、`DesignElement` 类型。
3. 实现 `screenToWorld` 和 `worldToScreen`。
4. 实现无限画布平移。
5. 实现鼠标位置缩放。
6. 实现画板渲染。
7. 实现元素渲染。
8. 实现元素选中。
9. 实现拖拽移动。
10. 实现属性面板。
11. 实现图层面板。
12. 接入 mock AI 生成。
13. 实现 PNG 导出。
14. 接入真实 AI 接口。

## 20. 结论

这个项目的关键不是简单生成一张图，而是建立一个以 `DesignDocument` 为核心的可编辑设计系统。AI 负责生成和修改结构化设计稿，React 负责渲染和交互，无限画布负责承载多画板、多版本和专业编辑体验。

第一版应该把重点放在“无限画布 + 结构化设计稿 + 可编辑闭环”上。只要这条主线稳定，后续模板库、局部重绘、品牌资产、代码导出和协作能力都可以自然扩展。
