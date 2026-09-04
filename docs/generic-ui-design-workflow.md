# 通用 UI 设计工作流

## 目标

通用后台、网站、桌面工具、Dashboard、工作台和移动端 UI 不依赖 `componentsJson`。当前主流程采用 Render First：模型先生成可在浏览器中运行的静态 HTML/CSS 设计稿，Electron 沙箱读取真实 DOM、ComputedStyle 和 Bounds，再转换为 Canonical Scene Graph 并一次性写入画布原生节点。

`DesignSpec` 仍会先生成，但只作为内容清单、目标 Surface 和 Runtime Draft 失败时的确定性降级，不再作为正常流程的布局渲染器。图片模型只负责插画或业务图片，不替代文本、按钮、输入框、面板等 UI 结构节点。

当本轮包含 KV 或视觉参考图时，Runtime 会先执行 `ui.extract-theme`，将图片提取为结构化 `VisualThemeContract`。Prototype 和 Edit Base 不参与主题提取。最终 DesignSpec 会再次合并该主题；模型没有返回有效 Block 时只允许进行一次结构修复，修复仍失败则明确终止，禁止静默交付默认后台模板。

主题解析兼容 `visualTheme/theme` 包裹、`colors/palette/dominantColors` 和数组或对象形式的 `colorTokens`，`visualStyle` 缺失时由 Runtime 补全。若主题模型仍未返回任何有效颜色，`ui.extract-theme` 立即降级为 `design-spec-direct-vision`，后续 `ui.plan` 直接携带参考图规划结构和主题；该降级不重试、不终止工作流。

## 工作流

```text
Pi Agent
  -> create-ui
  -> reference.prepare
  -> ui.extract-theme / extract_visual_theme
  -> ui.plan / generate_ui_schema（语义内容清单）
  -> ui.transform / generate_ui_runtime
     -> Static HTML/CSS Runtime Draft
     -> Electron Sandbox Render
     -> DOM + ComputedStyle + Bounds Inspection
     -> Canonical Scene Graph
  -> ui.validate（节点深度、可编辑叶子与 Scene 所有权）
  -> canvas.present-ui
     -> generic-ui-runtime
     -> Renderer 原子替换目标画板
     -> Canvas ACK 后置条件校验

Runtime Draft 失败时：
  -> DesignSpec Renderer
  -> 动态 canvas.present-ui-section[]
  -> generic-ui-finalize
```

业务组件 JSON 仍走 `create-component`，多组件活动页走 `create-page`。三者最终都通过统一画布交付协议写入 `DesignDocument`，但不共享生成器和提示词。

## Runtime Draft 契约

```ts
interface StaticUiRuntimeDraft {
  version: 1
  title: string
  viewport: { width: number; height: number }
  html: string
  css: string
}
```

`html` 只包含 body 内静态语义结构。重要区域使用唯一的 `data-region-id`，按钮、输入框、图片和文字必须使用对应语义标签。`css` 负责最终 Grid、Flex、面板、工作区、工具栏、检查器、层级和视觉风格；因此低代码编辑器、IDE 等界面不再受固定 Block 布局限制。

Runtime Draft 当前不允许 JavaScript 和真实业务交互。以下内容会在渲染前直接拒绝：`script/iframe/object/embed/link/base/meta`、事件属性、`javascript:`、CSS `@import` 和 `expression()`。HTML/CSS 分别限制为 512 KiB。

## Electron 沙箱与 DOM Scene

Runtime Draft 在临时 Electron `BrowserWindow` 中渲染：`sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`，CSP 使用 `script-src 'none'` 和 `connect-src 'none'`。禁止导航和新窗口；网络只放行公网 HTTPS 图片、字体和媒体，窗口销毁后删除临时文档。

Inspector 读取可见 DOM 的语义类型、父子关系、文本、图片源、ComputedStyle 和实际 Bounds。纯包装节点会压缩；表面、文本、按钮、输入框和图片转换为 Canonical Scene Graph。正常通用 UI 最多接收 600 个 Scene 节点，质量门禁要求至少 8 个节点和至少 3 个可编辑内容叶子。

模型偶尔会返回 `<body>` 包装或 Header、Sidebar、Main 多个顶层兄弟节点。Inspector 会把 body class 迁移到安全 Host，并在存在多个可见顶层节点时以 Host 为 Scene Root，禁止只读取 `firstElementChild`。Scene 宽度至少覆盖 Draft viewport 的 75%，高度至少覆盖 65%；否则视为局部提取失败并自动回退 DesignSpec Renderer。Runtime 主流程不捕获截图，只读取 DOM Scene，减少外部图片造成的等待；显式诊断时才启用 Snapshot。

## 画布原子提交

`generic-ui-runtime` 携带 `sceneGraph` 与 `expectedNodeCount`。Renderer 提交前执行：

1. 校验交付目标画板和节点数量。
2. 使用 `artboardId` 为所有 Scene ID、Parent ID 和 Region ID 添加命名空间。
3. 按画板坐标平移整个 Scene，避免 Variant 或多画板节点 ID/位置冲突。
4. 通过 `compileSceneCommit` 转换为 Text、Button、Input、Image、Shape、Section 原生节点。
5. 在单个 Document Revision 中替换目标画板旧节点，并清理旧 DesignSpec、响应式基线和失效组件实例。
6. 校验根节点、实际节点集合、节点数、Runtime Scene 元数据和 Revision 精确增加一次，成功后才返回 Canvas ACK。

项目只保存 `graphId/sourceAdapterId/nodeCount` 元数据，不保存完整 HTML/CSS，避免 DesignDocument 膨胀。后续局部编辑直接作用于原生节点。

已有 DesignSpec 的后续对话按修改范围分流：明确增删、移动或更新某个 Block 时使用 `revise-ui-structure`；选中节点后的文字、样式和图片调整使用 `revise-design`；“参考图片重新设计、整体重做、整页改版、重新生成整个页面”使用 `create-ui + variant`，重新规划完整 DesignSpec 并复制为新版本画板，保留原稿。领域 Runtime 会纠正 Pi 将整页重设计误判成有限结构 Patch 的结果。

## Schema 与画板

内置 Surface Preset 包括 `desktop-admin`（1440×900）、`desktop-web`（1440×960）和 `mobile`（375×812），模型或 Component Pack 可以覆盖 viewport 与自动高度策略。Registry 包含 `container/stack/grid/hero/text/image/button-group` 等基础节点，导航、表格、表单等产品节点，以及 `chart/tree/timeline/kanban/calendar/map/modal/drawer/toast` 等复杂节点。扩展可通过受校验的 `registerDesignBlockDefinitions` 注册新 kind。

编译器输出 Section、Shape、Text、Button 原生节点，保存 `artboard.designSpec` 作为可重编译设计源，`genericUiSchema` 只用于旧项目兼容。

`sidebar/header/footer` 是全局结构 Block，每种最多一个。内容区标题使用 `section-header`。若模型返回第二个全局结构 Block，Runtime 会在规范化阶段将重复 Header 转为 `section-header`、重复 Sidebar 转为 `content-grid`、重复 Footer 转为 `text`，保留原有标题、内容和操作字段；未经过规范化的重复结构会被 `ui.validate` 拦截。

`ui.validate` 根据 `blocks` 动态插入一个 Block 一个 `canvas.present-ui-section` Step。每个 Step 携带完整 DesignSpec、当前 Block 和此前已成功的 Block ID。完整 Spec 只用于计算 Sidebar、Header、前序内容和 Footer 对当前 Block 坐标的影响；编译器只实例化本次 `includeBlockIds`，未交付 Block 的渲染错误不会拖垮当前 Section，也不会重建此前节点。

编译 ID 由 `artboardId + block.id + 节点语义序号` 确定。Design Root、背景和每个 Block Root 均为稳定 ID；每个 Block 使用 `designRole=design-block` 和 `designBlockId` 建立独立 Wrapper。Renderer 的单次事务仅替换当前 `designBlockId` 节点，保留其他 Block 和用户手工节点，并将成功 Block 按完整 Spec 顺序写入 `artboard.designSpec`。

Block 子节点使用内容语义 Item Key，而不是纯数组下标。表格插入新行、卡片或操作项重排时，未变化内容继续复用原 ID。插入、删除或重排 Block 后，Store 会比较旧 Spec、Block Wrapper 几何和新 Spec，只重编当前 Block、内容变化 Block及发生位移的后继 Block，并返回 `affectedBlockIds / removedBlockIds`。

Design Root、背景和 Block Wrapper 保存 `layoutConstraints`。用户调整带 DesignSpec 画板的宽、高或位置时，Store 使用更新后的 viewport 重新计算响应式布局；编译节点 ID 保持稳定，画板上的普通手工节点继续保留。

DesignSpec 支持 `responsive.strategy=fluid` 和三档默认 breakpoint：移动端 `375×812`、平板 `768×900`、桌面端 `1440×900`。断点 ID 是可扩展字符串，用户可在工具栏新增、编辑或删除最多 8 个自定义断点，Runtime 会标准化并保留合法名称与 `320..2560 × 320..10000` 尺寸。窄于 1024px 时 Sidebar 折叠；指标卡在平板变为两列、移动端变为单列；卡片网格、内容边距和移动端筛选栏同步 Reflow。

工具栏可以切换同一画板的活动断点，也可以打开同屏并排预览。单档切换会重新编译当前画板但不复制 DesignSpec；并排预览使用临时 Artboard 和编译节点，只读渲染所有断点，不写入 DesignDocument、不增加 Revision、不进入撤销栈。

每个 breakpoint 可通过 `overrides` 覆盖主题和布局，但不复制 Block 内容。当前支持主题主色、圆角、密度，以及内容边距、Block 间距、Sidebar 模式、隐藏 Block 和 Block 列数。`resolveDesignSpecBreakpoint` 只在编译前合并 Override，源 DesignSpec 的全局 theme、layout 和 blocks 保持不变。

并排预览以最宽断点为参考，提示隐藏区块、Sidebar 展开/折叠、区块换列、主色、圆角、边距和间距变化。每个断点可保存独立视觉树基线：基线 fingerprint 覆盖 viewport、合并后的 theme/layout、内容高度及所有编译节点的 ID、类型、几何、颜色、文字和文字样式。相同输入必须产生相同 fingerprint；任一受控视觉属性变化都会标记“发生变化”。基线保存在 Artboard 元数据中，不保存大体积截图。

并排预览支持勾选多个 breakpoint，一次修改主色、圆角、密度、内容边距、Block 间距和 Sidebar 模式。Store 在单个 Revision 中更新全部 Override；当前活动断点属于目标集合时同步重编画布，未受影响语义节点继续复用稳定 ID。差异提示携带 `blockIds / elementIds`，点击提示会在对应预览中框选稳定 Block Wrapper，而不是只显示不可操作的摘要。

视觉树 fingerprint 是快速、确定性的编译回归门禁。项目同时提供固定 `ResponsiveVisualFixturePage`，使用相同 DesignSpec 生成 375/768/1440 三档确定性页面。Playwright Chrome 与 Electron 分别对三个画板执行 Locator Screenshot，保存六张 PNG；阈值 `0.2`、最大差异像素比例 `0.5%`，用于发现 CSS、字体、裁剪、溢出和平台渲染变化。Fixture 不读取项目、不调用模型、不包含随机图片。

像素基线首次生成或确认预期视觉变化后更新：

```bash
npm run test:visual-regression -- --update-snapshots=all
```

日常验证禁止带更新参数：

```bash
npm run test:visual-regression
```

本阶段基线在首次检查中发现并修复了折叠 Sidebar 子节点泄漏、375px 六列表格挤压和移动分页左侧裁剪；这些问题不会被纯 Spec 校验发现。

每次 ACK 校验目标画板、当前 Section、稳定 Design Root、Block Root、旧 Block ID 集合、成功 Block 顺序和文档 Revision 精确 `+1`。Observation 同时返回 `blockRootElementId` 与 `affectedElementIds`，便于时间线、定位和后续局部修改使用。

单个 Section ACK 失败时，该 Step 标记为 `partialFailure` 并在聊天时间线展示失败摘要；后续累积 Spec 排除该 Block 后继续交付。失败写入不会让整个 Run 立即终止，也不会回滚其他已成功 Section。

最终 `generic-ui-finalize` 不重复写入画布，只验证实际 Block ID 的数量与顺序、Design Root、节点总数和失败 Section 数。所有 Section 都失败时才阻断终态。

## 当前完成范围

- Runtime Draft 优先、DesignSpec 内容清单与失败降级。
- `generate_ui_runtime` Pi 结构化任务及 HTML/CSS 契约。
- Electron Static HTML Sandbox、安全校验和 DOM/ComputedStyle Inspection。
- Runtime DOM 到最多 600 节点 Canonical Scene Graph。
- `generic-ui-runtime` Deliverable、前端协议和时间线名称。
- Scene ID 画板隔离、坐标平移、原子替换和严格 Canvas ACK。
- Text、Button、Input、Image、Shape、Section 原生可编辑节点提交。
- Pi `create-ui` 工具决策和 generic-ui Agent Plan。
- 结构化 Provider 任务 `generate_ui_schema`。
- 通用 Schema 标准化、单次结构修复和失败阻断。
- 全局结构 Block 唯一性、重复 Header 语义修复与增量编译故障隔离。
- 开放 Block Registry、基础布局/媒体节点及扩展注册。
- Pi `surfaceKind / designArchetype` 驱动规划，不再固定为后台信息架构。
- 桌面/移动端目标画板尺寸握手。
- Schema 到原生画布节点编译。
- 动态 Section 渐进交付、失败隔离和 Renderer ACK。
- 稳定编译 ID、Block Wrapper 与真正的 Block 节点 Patch。
- Block 插入、删除、重排及受影响后继 Block 协调。
- 语义 Item Key、响应式约束元数据和画板 Resize Reflow。
- desktop/tablet/mobile breakpoint 协议、工具栏多尺寸预览与窄屏布局适配。
- 自定义 breakpoint 生命周期和同屏只读并排预览。
- breakpoint 主题/布局 Override、跨断点差异提示和视觉树回归基线。
- 跨断点批量 Token、差异节点定位和 Chrome/Electron 六图像素基线。
- Footer 原生节点编译和不同画板 ID 隔离。
- 最终 Block 顺序、根节点与文档 Revision 后置条件。
- Generic UI 与业务组件、页面组合工作流隔离。
- 局部结构修改、节点修改与整页重设计的语义分流；整页重设计默认生成独立 Variant。

## 后续边界

Runtime Draft 当前只表示静态设计态，不执行模型生成脚本，不交付真实表格行为、拖拽逻辑、路由或复杂交互状态。复杂 CSS 伪元素、Canvas/WebGL、SVG 内部结构和 Shadow DOM 还不能完整拆为原生节点。DesignSpec 响应式编辑能力仍只适用于降级路径；Runtime Scene 的跨断点重排需要下一阶段单独建立约束推断。

Agent 已提供受限 DesignSpec Patch Tool，用于 DesignSpec 降级稿的自然语言结构修改。Runtime Scene 进入画布后使用通用节点 DesignPatch 进行文本、样式、位置和图片修改；两类设计源不会同时保留在同一画板。

## 验证

```bash
npm run test:generic-ui
npm run test:generic-ui-incremental
npm run test:design-spec-patch
npm run test:visual-regression
```

专项测试同时覆盖 Runtime 动态 Step、第二个 Section 失败后继续、失败前置校验不污染 Revision、旧 Block ID 保持稳定、同 Block 重做、Block 插入/删除/重排、语义 Item Key、画板 Resize Reflow、自定义断点生命周期、断点 Override、批量 Token 单 Revision、差异节点 ID、fingerprint 稳定与变更检测、移动端 Sidebar/Table/Pagination、手工节点保留、Footer 编译、跨画板 ID 隔离和 Finalize Block 顺序。
## 视觉参考

通用 UI 工作流同样先执行 `reference.prepare`。用户通过上传或 `@` 指定的图片会发送给 `ui.plan`，用于提取色彩、字体气质、圆角、材质和视觉语言；信息架构由用户目标、Pi 输出的 `designArchetype` 及 Block Registry 共同决定，不再默认补充后台模块。
