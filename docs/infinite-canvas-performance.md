# 无限画布多画板性能方案

## 1. 背景与目标

当一个项目包含多个画板、数千个设计节点和大量图片时，画布的平移、缩放、选择和拖拽会出现明显掉帧。问题不来自单次 AI 生成，而来自编辑器把完整文档同时作为 React 树和浏览器渲染树维护。

本方案的目标是让交互成本主要取决于“当前可见内容”，而不是“整个项目内容”。优化不能改变 DesignDocument、Render IR、导出快照和画布交互语义。

## 2. 优化前的主要瓶颈

### 2.1 高频 viewport 更新扩大到整个页面

`EditorPage` 原先直接订阅 `viewport`，因此平移和缩放会让顶部栏、工具栏、左右面板和画布一起进入 React 更新。项目保存也和组件渲染订阅耦合。

### 2.2 所有画板和节点始终挂载

`InfiniteCanvas` 原先无条件渲染 `artboards` 与 `paintElements`。即使画板距离当前视口很远，其节点仍会构建 Render IR、参与 React reconciliation、创建 DOM 和图片，并占用浏览器布局与绘制资源。

### 2.3 高频交互重复执行全量计算

节点拖拽通过 `document.elements.map` 更新预览，并在每个节点上用 `startElements.find` 查找起始节点；容器缩放还会在每次 pointermove 重新遍历层级树。

### 2.4 图层树存在递归全表扫描

图层面板按画板过滤全量节点，每个 `LayerRow` 又过滤一次全部兄弟节点，深层或大规模文档会接近二次复杂度。

## 3. 总体架构

```text
DesignDocument（完整、可持久化）
        │
        ├── LayerIndex（文档变更时重建）──> 图层树
        │
        └── Paint Order（文档变更时重建）
                  │
Viewport + Canvas Size ──> World Bounds + 600px Overscan
                  │
                  └── Visible Artboards / Visible Elements
                                │
                                └── React Compiler ──> Canvas DOM
```

完整文档始终保留在 Store 中。视口裁剪只影响交互画布的 DOM 挂载，不裁剪选择计算、文档数据、撤销历史、导出和 AI 上下文。

## 4. 已实现方案

### 4.1 React Compiler

Vite 构建接入 `babel-plugin-react-compiler`，目标为 React 19。Compiler 自动缓存纯组件和表达式，减少人工散布 `useMemo`、`useCallback` 与 `React.memo`。

Compiler 是渲染优化的基础层，不替代视口裁剪。它不能主动卸载屏幕外 DOM，也不能减少图片解码和浏览器绘制成本。

### 4.2 持久化与渲染订阅解耦

`EditorPage` 不再直接订阅 viewport、聊天线程和变更账本来触发保存。持久化改为订阅 Store，在 800ms 静默窗口后读取最新快照。

收益：平移和缩放不再连带重渲染整个编辑器外壳，同时仍能保存最后一次 viewport。

### 4.3 高频 viewport 合帧

滚轮、触控缩放和平移使用 `requestAnimationFrame` 合并，同一个浏览器帧最多向 Store 提交一次 viewport。交互结束时刷新最后一个待提交位置，避免丢失尾帧。

### 4.4 两级视口裁剪

画布通过容器尺寸和 viewport 计算世界坐标可见区域，并在四周增加 600 屏幕像素 Overscan：

```text
worldLeft   = (-viewport.x - overscan) / zoom
worldRight  = (canvasWidth - viewport.x + overscan) / zoom
worldTop    = (-viewport.y - overscan) / zoom
worldBottom = (canvasHeight - viewport.y + overscan) / zoom
```

挂载规则：

1. 与可见世界区域相交的画板正常挂载；
2. 当前活动画板始终保活，避免拖动到边界时突然卸载；
3. 选中或正在拖拽的节点及其所属画板始终保活；
4. 自由画布节点按自身包围盒裁剪；
5. 首次取得容器尺寸之前保守渲染全部内容，避免首帧空白。

裁剪结果通过 `data-rendered-artboard-count` 和 `data-rendered-element-count` 暴露，供 E2E 和性能诊断读取。

### 4.5 拖拽与缩放索引

- 拖拽开始时建立 `startElementById`，pointermove 使用 O(1) 查询替代数组 `find`；
- 容器后代集合在 resize 开始时计算一次，不再每帧重建；
- 最终仍只在 pointerup 时提交正式文档事务。

### 4.6 图层树索引

文档节点变化时构建 `rootsByArtboard` 和 `childrenByParent`。递归行直接读取子节点数组，不再为每一行扫描完整 elements。

### 4.7 Figma 式直接操控拖拽

Figma 的公开架构选择自定义 WebGL 渲染器，把设计内容与普通页面 DOM 分开，利用 GPU 完成高频画布绘制。当前项目仍需要保留 DOM/Render IR 以支持文本编辑、快照和代码导出，因此不直接迁移到 WebGL，但采用相同的关键原则：交互预览不能在每一帧重建完整文档。

节点拖拽现在分为两个阶段：

1. pointermove 只通过 `requestAnimationFrame` 更新被拖节点和选框的 `translate3d`，浏览器可以在合成层完成移动；
2. pointerup 恢复临时 transform，并把最终世界坐标作为单个事务写回 DesignDocument。

拖动过程中不再创建完整 `previewElements`，也不会重新执行所有可见节点的 Render IR 构建。旋转与翻转保留在原 transform 中，临时位移只作为前缀组合，结束后完整恢复。

参考：Figma Engineering，[Building a professional design tool on the web](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/)。

## 5. 正确性边界

以下能力必须读取完整文档，不能直接消费裁剪后的节点：

- 框选和跨可见区选择；
- 撤销、重做和项目持久化；
- PNG、页面包与代码导出；
- AI SelectionScope 与画布事务；
- 图层面板的完整结构。

当前快照导出使用独立的离屏渲染路径，因此画布裁剪不会造成导出缺图。画布内针对单个节点的截图要求目标节点已选择；选择保活规则保证该节点存在于 DOM。

## 6. 性能验收

标准压力场景：20 个画板，每个画板 100～200 个节点，混合文本、Shape、图片和 Runtime Placeholder，并至少有一个画板处于视口外且被选中。

验收条件：

1. DOM 中挂载的画板数小于文档总画板数；
2. 选中、拖拽中的屏幕外目标不会被卸载；
3. 平移、缩放每帧最多提交一次 viewport；
4. 节点拖动期间只出现合成层 transform，DesignDocument 在 pointerup 时只提交一次；
5. 切换可见区域后画板能够提前在 Overscan 区域挂载，无明显闪烁；
6. 选择、拖拽、图层树、快照和导出回归通过；
7. `npm run lint`、`npm run build`、可见性单测和编辑器 E2E 通过。

帧率受机器和图片素材影响，不写死为产品正确性条件；开发性能基线建议记录 P95 帧耗时，桌面端目标小于 16.7ms，重型项目可接受上限为 33ms。

## 7. 监控与回退

建议后续在开发模式加入轻量 PerformanceObserver，记录长任务、一次 React Commit 耗时、文档总节点数和实际挂载节点数。不要上传设计内容或图片地址。

若发现某类交互依赖屏幕外 DOM，可临时把对应画板加入 retained 集合，而不是关闭整套裁剪。容器尺寸无效时算法会自动回退为完整渲染。

## 8. 后续阶段

当前实现解决了主要结构性瓶颈。更大规模项目可以继续增加：

- 图层面板虚拟滚动；
- 低缩放比例 LOD，减少文字、阴影和 Runtime Preview 细节；
- 图片缩略图与分级解码；
- 基于 Patch 的撤销历史，替代最多 60 份文档快照；
- Artboard 空间索引，在数百画板时避免线性相交检测。
