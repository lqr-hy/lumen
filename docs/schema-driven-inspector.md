# Schema-driven Inspector 技术方案

## 目标

右侧属性栏使用项目自有的 Schema-driven Inspector。它借鉴 Puck 的字段 Schema、GrapesJS 的属性分组和 Penpot 的紧凑 Inspector，但不引入或替换现有编辑器内核。

数据更新仍通过 Zustand Store 的 `updateElement`、`updateElements`、`updateArtboard` 和 `setSectionAutoLayout`，因此修改继续进入现有 History，并与画布编译、组件实例同步逻辑保持一致。

## 已实现

- 画板、单节点和多选分别解析为统一的 `InspectorSectionSchema[]`。
- 支持 text、textarea、number、color、select、segmented、toggle、readonly 和 image 字段。
- 数字字段支持 px、%、deg 单位以及 min/max/step。
- 颜色字段使用 `react-colorful` RGBA Picker 与 CSS 文本值组合，支持 HEX/HEX8、RGBA、Alpha 滑杆和百分比输入、透明棋盘预览、原生 EyeDropper 与最近颜色。
- 图片字段显示缩略预览，并保留 URL、裁剪模式、焦点和圆角配置。
- 文本、按钮、图形、图片、Section Auto Layout、Runtime Placeholder 使用各自的类型字段组。
- 多选支持混合值提示和布局、透明度、显示、锁定的批量更新。
- 组件绑定、Slot 局部重生成、Props Patch、组件/结构导出保留在独立折叠组中。
- DesignSpec Block 在节点上展示类型、名称和结构统计，避免与普通样式属性混杂。
- 右栏宽度为 316px，支持浅色和深色编辑器主题。

## Figma 方向第一阶段升级

以下高频编辑能力已经完成：

- Fixed / Hug / Fill 尺寸语义，保留 `width`、`height` 作为画布计算后的几何值。
- Auto Layout 四边 Padding、Gap、主轴与交叉轴九宫格对齐。
- Auto Layout 子节点 Fill 剩余空间分配和 Min/Max Size 限制。
- 图片、按钮、图形使用四角独立 Radius，可切换四角联动。
- Opacity、Padding、Radius 支持 Reset。
- 连续输入使用 Property Transaction：输入过程只预览，结束后原子提交一条 History，Escape 取消。
- AI DesignPatch 增加 `semantic-update`，AI 通过尺寸模式、约束、间距、对齐、透明度和圆角语义修改设计，不依赖 Inspector 字段路径。

本阶段按新项目模型实施，不提供历史项目数据迁移。`x/y/width/height` 是当前布局结果，不属于历史兼容字段。

### P1.2 固有尺寸与交互

- Text Hug 根据文字行数、字号和行高计算固有尺寸。
- Button Hug 根据文案、字号和按钮内边距计算固有尺寸。
- Section Hug 根据子节点、Gap 和四边 Padding 计算容器尺寸。
- 修改 Hug 节点内容后，向上触发最多四层 Auto Layout 重排，避免嵌套容器无限循环。
- Width/Height 非 Fixed 时只读，避免直接尺寸和尺寸模式产生冲突。
- 非 Fixed 节点提供 Min/Max Width/Height，实际布局统一执行约束。
- 数字字段标签支持左右拖动；Shift 精细调整，Alt 加速调整，整个拖动过程只生成一条 History。
- 取色器拖动复用 Property Transaction，关闭弹层后只生成一条 History；四角 Radius 标签与数值分行展示，高级尺寸入口使用紧凑属性按钮。
- AI `semantic-update.layout` 支持 Min/Max Size，不需要接触 Inspector 字段定义。

### P1.3 上下文属性可见性

- 普通节点、根节点、H5/KV 设计默认隐藏水平与垂直锚点。
- 仅响应式 DesignSpec 中的绝对定位子节点显示“水平锚点/垂直锚点”。
- Auto Layout 子节点隐藏 X/Y 和锚点，由父容器负责位置计算。
- Fill 仅在 Auto Layout 子节点中启用；Text、Button、Section 才启用 Hug。
- Min/Max 仅在响应式 DesignSpec 画板且对应宽度或高度使用 Hug/Fill 时出现；普通 H5、KV、固定画板不展示“高级尺寸”。
- 高级尺寸只提供当前非 Fixed 维度的限制项；切回 Fixed 时清除对应 Min/Max，避免隐藏约束继续影响布局。
- 响应式绝对定位节点的 Stretch 在界面中显示为“左右固定/上下固定”，对应父容器变化时保持两侧距离。

## 代码边界

```text
PropertyPanel.tsx
  -> 解析当前 Selection / Artboard / Component 上下文
  -> inspector-schema.ts
       -> resolveArtboardInspectorSchema
       -> resolveElementInspectorSchema
       -> resolveMultiSelectionSchema
  -> InspectorFields.tsx
       -> InspectorSection
       -> InspectorFieldRenderer
  -> editor-store.ts 更新 API
```

新增节点类型时，优先在 `resolveTypeSection` 注册字段，不在 `PropertyPanel` 中添加表单分支。新增通用字段类型时，在 `InspectorField` 联合类型和 `InspectorFieldRenderer` 中注册。

## 后续边界

以下能力未在本轮伪装成已完成能力：

- DesignSpec Block 当前展示结构信息，直接修改 Block Schema 需要独立的 `updateDesignSpecBlock` Store Action 和增量重编译。
- Token 绑定和 Gradient/Shadow Popover 需要单独的数据模型。
- 多选目前执行相同值批量写入，不包含对齐、分布和相对位移命令。

后续扩展应继续复用 Field Registry，不引入第二套属性表单。
