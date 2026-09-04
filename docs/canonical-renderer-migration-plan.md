# 统一渲染契约迁移计划

## 目标

让编辑画布、版本对比、PNG 导出、响应式预览和代码导出都基于同一份规范化 Scene 与 Style Contract，避免同一份 DesignDocument 在不同出口被重复解释后出现尺寸、坐标、字体、阴影、图片和裁剪差异。

## 实施计划

1. 建立 Canonical Scene/Style Contract：统一画板坐标、节点尺寸、层级、排版、表面、阴影、图片适配和裁剪字段。
2. 建立 Scene Normalize 与边界校验：所有生成结果在写入前统一坐标，并在提交前阻止或收回越界节点。
3. 抽取共享 Artboard Renderer：编辑画布和静态预览复用同一套节点 DOM 结构与样式。
4. 改造版本对比：使用共享 Renderer 生成原稿/Variant 预览，统一缩放、背景、字体和图片加载容错。
5. 对齐响应式预览和 PNG 导出：消费同一 Canonical Scene，不再维护独立的简化渲染逻辑。
6. 对齐代码导出：HTML/React/Vue 编译器消费同一 Style Contract，补齐未覆盖字段。
7. 增加回归验证：多画板、多 Variant、不同画板原点、图片失败、越界节点、对比截图和代码结构测试。

## 当前阶段

- 第 6 条"对齐代码导出"已由 Render IR 完成，详见 [`unified-render-ir.md`](unified-render-ir.md)。此前编辑画布与代码导出各自解释 `DesignElement`，代码生成靠手抄 SCSS 规则追赶，是画布与产物错乱的根因。现在 `buildRenderBox()` 是唯一视觉真源，`scene-visual-contract.ts` 与 `createExportNode()` 已删除，并由 `npm run test:codegen-parity` 做像素级门禁。
- 已完成部分生成写回边界约束和 Variant 宽度继承。
- 已完成 Canonical Scene 第一版、共享静态渲染入口、快照容错、生成写回边界约束，以及代码生成的坐标/阴影/z-index 对齐。
- 版本对比和页面开发包导出已统一调用 `renderArtboardSnapshot`；静态快照复用 `StaticArtboardRenderer` 与 `ElementRenderer`。
- 响应式预览已复用 `ElementRenderer`，并继续使用 DesignSpec 的规范化 Scene Commit。
- 编辑画布的画板外壳已抽取为 `ArtboardFrame`，静态预览使用同一画板契约；节点交互态继续由 `ElementRenderer` 承担。
- 选中元素 PNG 导出也已切换到 `renderArtboardSnapshot`，避免再走旧版手写导出 DOM。
- 响应式预览复用 `ElementRenderer` 和 DesignSpec Scene Commit；代码导出复用 Canonical Scene 坐标和 Style Contract。
- 全部出口已消费同一份 Render IR，不再存在第二套渲染实现。后续新增视觉属性只需改 `render-box.ts`。
- Variant 高度策略已统一：复制源画板时仅继承逻辑宽度，使用 Runtime surface 的初始高度作为最小起点；生成图片、DesignSpec 和 Runtime Scene 写回均保持 `autoHeight`，最终高度由内容提交结果决定，不再把源画板高度当作固定输出高度。
