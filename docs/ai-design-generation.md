# AI 设计稿生成闭环技术方案

> 实现状态：普通图片已切换为 Runtime 本地 GenerationBrief；业务组件组合页面仍保留 Page Blueprint。SVG/位图确定性审查、双模型路由、图片 Provider、生成元数据和 1x/2x 导出已经接入。

## 1. 目标

将现有“模型生成 SVG 并放入画布”的能力升级为可追踪、可检查、可修正和可导出的设计稿生成闭环。

首阶段交付范围：

1. 参考图按 KV、原型、视觉参考等角色进入 Session。
2. Runtime 在本地建立 `GenerationBrief`，不请求推理模型规划普通图片。
3. 根据 Brief 生成完整页面图片、局部模块或独立素材。
4. Runtime 对 SVG/位图执行确定性质量审查。
5. 审查失败时携带问题列表自动修正一次。
6. 通过审查后写入画布，并保存生成来源。
7. 支持按 375px 逻辑宽度导出 1x 或 2x PNG。

真实图片模型已通过独立 `imageProvider/imageModel` 接入；区域蒙版编辑和视觉语义评分仍属于后续能力。

## 2. 生成流程

```text
reference.prepare
  -> design.brief
  -> design.generate
  -> artifact.review
  -> design.refine（审查通过时直接透传，失败时最多重生成一次）
  -> artifact.validate
  -> canvas.present
```

独立素材仍使用现有多 Artifact 流程，不与整页流程混用。

## 3. GenerationBrief

```ts
interface GenerationBrief {
  version: 1
  goal: string
  outputKind: 'full-image' | 'section' | 'asset'
  target: { width: number; height: number; placementMode: string }
  references: Array<{ id: string; name: string; role: string; responsibility: string }>
  constraints: string[]
}
```

规则：

- 原型图存在时，它是页面模块和顺序的唯一结构来源。
- KV 只影响色彩、材质、装饰、字体气质和视觉层级，不增加业务模块。
- `append-section` 只描述本次新增模块，不能重复整页结构。
- Brief 保存到 Agent Session，继续、失败重试和生成变体可以复用。
- Brief 是确定性生成契约，不直接转换为 DesignDocument 节点。
- Page Blueprint 仅保留给明确指定多个业务组件的组合页面。

## 4. 图片质量审查

首阶段使用确定性检查，不宣称具备完整视觉理解：

| 检查项 | 失败条件 |
| --- | --- |
| 根节点 | 缺少完整 `<svg>` 根节点 |
| 尺寸 | width、height 或 viewBox 缺失、非正数、超出安全范围 |
| 页面宽度 | 完整页面宽度明显偏离 375 或 750 设计基准 |
| 可见内容 | 没有 image、path、rect、text 等可见节点 |
| 安全性 | 包含 script、foreignObject、事件处理器或外部 URL |
| 内容量 | SVG 过小，疑似空白占位；或超过 8MB |
| 结构模式 | `append-section` 输出异常超长，疑似误生成完整页面 |

审查输出包含 `passed`、问题列表以及宽高、可见节点、文本节点和字节数。存在 error 时，`design.refine` 将 GenerationBrief、原任务和问题列表重新交给 Provider，只允许自动修正一次。第二次仍有 error 时任务失败，不把问题制品放入画布。

位图额外检查 MIME 白名单、Base64、字节上限和宽高安全范围。当前位图主题相似度由 Provider 契约暂记为稳定分数，不能替代后续像素级 Vision Review。

## 5. 生成元数据

每个 AI 画板保存轻量元数据：

```ts
interface GenerationMeta {
  sessionId: string
  prompt: string
  provider: string
  model: string
  placementMode: string
  parentArtboardId?: string
  createdAt: string
  refined: boolean
  blueprint?: DesignBlueprint
  qualityReview?: ArtifactQualityReview
}
```

元数据用于版本追踪、问题定位、重新生成、变体比较和后续局部编辑，不得保存 API Key 或环境变量。

## 6. 导出

- 1x：按画板逻辑尺寸导出，例如 375px 宽。
- 2x：按两倍像素密度导出，例如 750px 宽。
- 选中独立图片时保持其透明背景和自身边界。
- 完整画板导出使用画板背景、裁剪和当前元素顺序。
- 文件名追加 `@2x`，避免覆盖 1x 文件。

## 7. 后续能力边界

### 7.1 双模型生成（已实现）

```text
Codex / Claude：需求理解、Blueprint、文案和结构
图片模型：人物、插画、复杂背景和装饰素材
Renderer：确定性文字和布局合成
```

`design.generate` 和各组件/页面素材 Tool 已通过 `imageTasks[]` 调用图片 Provider。多个 Props Slot 分别请求，禁止拼图；精确文字仍由确定性图层负责。

### 7.2 视觉模型审查

后续在确定性审查之后增加 `vision.review`：将 SVG 渲染成 PNG，检查文字重叠、视觉空白、原型结构一致性和 KV 风格相似度。视觉审查结果不能替代安全校验。

### 7.3 局部编辑

通用页面的区域蒙版编辑仍使用规划中的 `EditScope`：

```ts
type EditScope =
  | { type: 'whole-artboard'; artboardId: string }
  | { type: 'element'; elementId: string }
  | { type: 'region'; artboardId: string; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'section'; sectionId: string }
```

区域编辑必须提供当前区域截图或可编辑结构，禁止在没有输入制品的情况下声称“只改局部且其他像素不变”。

组件设计已实现受约束的 Slot 局部编辑。画布选中带 `ComponentBinding` 的图片 Region 后，Renderer 会提交 `SelectionScope(type=component-region)`，Planner 执行：

```text
reference.prepare
  -> component.regenerate-slot
  -> component.validate-slot
  -> canvas.present-slot
```

成功素材在原 elementId 上替换，并同步图片 Prop 与 fallback Prop；其他 Region 不变。该能力针对明确的组件图片 Slot，不等同于任意整页图片的像素级蒙版编辑。

普通节点、多节点、组件实例和 Page Shell 也已使用同一 `SelectionScope`，详见 `selection-scoped-ai-editing.md`。

## 8. 验收标准

1. 整页任务的 Agent Plan 中包含 Blueprint、审查和修正步骤。
2. Blueprint 不合法时停止生成，不产生画布节点。
3. 空白、危险、尺寸异常 SVG 不进入画布。
4. 第一次审查失败会自动修正一次，第二次失败明确结束任务。
5. 成功画板保存 Prompt、模型、Placement、Blueprint 和审查结果。
6. 当前画板可以分别导出 1x 和 2x PNG。
7. 独立素材生成与导出行为保持兼容。
8. 组件 Blueprint 结果以 Section 和原生 Region 图层进入画布，编辑后同步 Props Patch。
9. 组件图片 Slot 可局部重生成并原位替换。
