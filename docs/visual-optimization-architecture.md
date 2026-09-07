# 视觉优化 Variant 技术方案

## 目标

视觉优化入口必须把用户选择的 `imagery`（无图、Hero、Hero+配图）作为结构化执行约束，而不是只拼接到自然语言 Prompt。页面结构、页面外壳、Hero 和内容配图各自承担明确职责，交付前完成尺寸、数量、角色和渲染校验。

## 任务协议

视觉优化入口继续使用现有 `visualOptimizationDraft`，并在请求中补充：

```ts
visualBrief: VisualRedesignBrief
visualAssetPlan: VisualAssetPlan
```

`VisualAssetPlan` 由 `buildVisualAssetPlan` 从 Brief 和源画板尺寸生成。计划包含稳定的素材 id、角色、目标尺寸、放置方式、是否需要 Slot 以及是否允许文字/按钮。

## 路由优先级

带有 `visualBrief` 的请求被视为来自视觉优化入口，放置操作固定为 `variant`，目标为当前源画板并保留原稿。该结构化上下文优先于 H5、页面、重新设计等 Prompt 关键词，避免误分流到普通页面创建或图片生成流程。普通聊天、从零 UI、组件设计和独立素材入口不受影响。

## 图片职责

- `page-shell`：页面级背景、跨章节色晕和纹理；不承载业务文字。
- `hero`：首屏主视觉；按画板宽度计算有限高度，禁止使用整页高度。
- `content-image`：内容区独立图片 Slot；不重复 Hero 构图。
- 文案、按钮、卡片：始终由原生可编辑 Scene 节点表达。

## 兼容策略

现有 `generic-ui` Runtime 仍作为页面结构和 DOM Scene 的兼容执行器；视觉优化上下文会把 Brief 和 Asset Plan 注入结构规划与 Runtime 生成阶段。`ui.transform` 在 DOM Scene 生成后按 Asset Plan 串行调用图片 Provider，将 Raster Artifact 转为 data URI 并绑定到对应 `img[data-asset-slot]` 节点，随后才进入 `ui.validate` 和画布提交。因此图片生成失败、Slot 不足或绑定缺失都会阻止“设计完成”状态。

## 校验与日志

`ui.validate` 已执行以下硬校验：图片数量与 `imagery` 计划匹配、规划资产必须绑定真实 `data:image/*` 来源、Hero 高度不得接近整页高度。日志记录 `taskKind`、`imagery`、目标 viewport、计划数量、生成数量和绑定数量。生成提示明确禁止在位图中烘焙标题、按钮和业务文案，DOM 文本/按钮仍保持可编辑。

## 入口兼容性

编辑器顶部“视觉优化”入口仍调用 `onCreateVariant`，新建设计入口仍调用 `onCreateVisualDesign`。本次改动只扩展 Chat 请求字段和 Runtime 路由，不改变入口按钮、对话确认和 Variant 对比流程。

## 端到端执行时序

```text
VisualOptimizationDialog
  -> visualOptimizationDraft(Brief)
  -> buildVisualAssetPlan(源画板尺寸)
  -> ChatEditRequest(visualBrief + visualAssetPlan)
  -> resolveWorkflowDecision(固定 variant + 保留原画板)
  -> generic-ui Source Adapter
       reference.prepare
       ui.plan       规划 DesignSpec
       ui.transform  生成 HTML/CSS + DOM Scene
                      串行生成 Hero/内容配图
                      绑定 img[data-asset-slot] -> data:image/*
       ui.validate   数量、来源、Hero 尺寸硬校验
       canvas.present-ui -> canvas.commit
  -> applyGenericUiRuntimeScene(可编辑文字/按钮 + 独立图片节点)
```

## 失败与重试策略

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `VISUAL_ASSET_SLOT_MISSING` | Runtime 未返回足够图片区域 | 根据计划合成安全 Slot；仍保留诊断信息 |
| `VISUAL_ASSET_GENERATION_FAILED` | Provider 未返回有效 Raster | 任务失败，不显示“设计完成” |
| `VISUAL_ASSET_BINDING_MISSING` | 计划图片没有真实 data URI | 阻止画布提交 |
| `VISUAL_HERO_OVERSIZED` | Hero 高度接近整张画板 | 阻止提交，避免整页长图 |
| `VISUAL_ASSET_PLAN_UNSATISFIED` | 交付前图片节点数量不足 | 阻止提交并记录计划/实际数量 |

Provider 仍沿用统一 `generate_image` 路由和现有图片模型选择，不新增活动专用 API。图片按计划串行生成，降低峰值内存和上游限流风险；单张失败会让整轮 Variant 失败，用户可通过既有“重试”入口重新执行。

## 可观测性

Runtime 会输出 `visual-assets:bound` 结构化日志，至少包含：`taskKind`、`imagery`、`plannedCount`、`generatedCount`、`boundCount`、`targetViewport`。交付数据同时携带 `visualAssetReport`，便于前端时间线、问题定位和后续埋点统计。

## 通用性边界

- 通过 `visualBrief`/`visualAssetPlan` 判定视觉优化，不依赖“活动名、H5、重新设计”等自然语言关键词。
- 计划项只有 `page-shell`、`hero`、`content-image` 三类角色；未来可扩展 `gallery-image`、`avatar` 等角色而不改入口协议。
- 图片节点使用统一 `SceneNode.asset.source` 和 `visual.assetId` Binding；现有组件素材、DesignPatch、页面组件工作流不受影响。
- 文案、按钮、输入框始终由 Runtime DOM 转换为原生 Scene 节点，图片只承担视觉内容，避免不可编辑的整页海报。

## 验证清单

- `imagery=none`：不触发生图，Variant 仍可正常提交。
- `imagery=hero`：恰好 1 个 Hero，目标高度小于长画板 80%。
- `imagery=hero-and-content`：1 个 Hero + 2 个内容配图，均有独立 Binding 和 data URI。
- Prompt 同时含“页面/H5/生成图片”：仍由结构化视觉上下文路由到 Variant。
- 图片 Provider 失败、图片数量不足、Hero 超高：任务失败且不显示完成态。
- `npm run build`、`npm run test:page-agent`、`node scripts/test-generic-ui-flow.mjs`、`node scripts/test-visual-brief.mjs` 全部通过。
