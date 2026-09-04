# 视觉方向发散能力

## 问题

同一个画板反复执行"视觉优化"，产出高度相似；四个内置 Brief 模板互相切换后，输出仍像同一套设计。根因有三处，都在 Brief 编译层，与模型能力无关。

### 1. 视觉 Token 是常量而非风格的函数

`compileVisualDirectionPrompt` 对每一次从零生成都追加同一句约束：

```
使用硬阴影（x=8、y=8、blur=0），描边不超过 3px，圆角不超过 8px；
禁止渐变阴影、毛玻璃和无意义的大色块。
```

这是新粗野主义的一套具体 Token。写具体 Token 本身是对的——业界共识正是"给契约而不是给形容词"。问题在于这套 Token 与用户选择无关：无论选"深色沉浸"还是"数据后台"，材质语言都被钉死在同一处。默认 `antiPatterns` 里的"模糊投影"又把柔性阴影这条备选路径堵死。

### 2. 生成后的归一化会抹平差异

`buildVisualNormalizationPatches` 把 shadow 强制改写为 `x:8, y:8, blur:0`，`strokeWidth` 截到 3，`borderRadius` 截到 8。模型偶然产生的变化会被这一步拉回同一组值。

该函数还与已有 Style Pack 直接冲突：`style-packs/bili-live-ranking/style.json` 声明 `surfaces.radius: 12`，归一化会把它压到 8。Style Pack 声明的表面语言实际上无法生效。

### 3. Brief 只能表达收敛目标，不能表达发散意图

现有八个维度（`pageType` / `density` / `exploration` / `imagery` / `componentSurface` / `layoutRhythm` / `signaturePlacement` / `paletteRoles`）控制的都是**布局节奏与信息密度**，没有一个控制**视觉词汇**：字体配对、圆角语言、描边策略、材质纹理、深度模型。

且每个维度都是**固定目标值**（`density: 'balanced'`），唯一近似"幅度"的是全局单档 `exploration`。用户无法表达"构图大胆、配色克制"这种分轴意图。模板换的是枚举值，表达能力没变，所以产出仍然收敛到同一点。

### 4. Workflow 层只有收敛修复，没有并行发散

`page.review` 走 `selectAutomaticRepair` → `repairContext` → `invalidateStepIds` → 最多 2 次重试。同一 Brief 修两次只会越来越靠近同一个点。系统任何时刻都不存在两个方向不同的候选，用户的审美判断无法进入回路。

## 业界做法对照

| 模式 | 业界实践 | 本项目现状 |
| --- | --- | --- |
| Token 先行 | 提取 spacing base、type-scale 比例、语义色表（含算出的对比度）作为契约，而非形容词 | 已给具体 Token，但是全局常量 |
| 具名设计系统包 | Aurora / Sakura / Coral 这类整套可挂载系统，agent 每次生成都引用 | `style-packs/` 结构已具备，仅 1 个包，且被归一化覆盖 |
| 并行多版 + 选优 | 一次并行出 N 版，用户挑一版再精修，取代 retry 循环 | 只有收敛 repair 循环 |
| 发散意图参数化 | IdeaBlocks 把发散拆为 Property / Direction / Range，可分轴控制 | 仅全局单档 `exploration` |
| 多视角评审 | persona 评审团取代单一 LLM-as-judge | `reviewPageVision` 为单 judge |

参考来源见本文末尾。

## 方案

分三阶段。阶段一、二只动前端 Brief 编译层（Brief 从不进入 Runtime，只编译成 prompt 文本），风险可控；阶段三动 Workflow 结构。

### 阶段一：设计语言包（Design Language Pack）

引入 `designLanguage` 维度，把散落的材质 Token 收敛成具名包。每个包声明完整 Token 组，而不只是几个枚举值。

```ts
interface DesignLanguageTokens {
  cornerStyle: string        // 圆角语言
  cornerRadius: number       // 归一化上限
  strokeWidth: number        // 描边上限
  shadow: { x; y; blur; opacity } | null  // null = 该语言不使用投影
  typographyContrast: string // 字重与尺度对比策略
  texture: string            // 材质与纹理
  depthModel: string         // 深度表达方式
  motif: string              // 图形母题
  antiPatterns: string[]     // 该语言专属禁止项
}
```

内置六种语言，覆盖差异明确的审美区间：

| id | 名称 | 深度模型 | 圆角 | 投影 |
| --- | --- | --- | --- | --- |
| `neo-brutalist` | 新粗野 | 硬边偏移 | 0–8 直角 | 硬阴影 8/8/0 |
| `soft-depth` | 柔性层叠 | 柔和高斯投影 | 16 大圆角 | 柔性 0/12/32 |
| `flat-geometric` | 平面几何 | 纯色块并置，无深度 | 4 | 无 |
| `editorial-serif` | 编辑印刷 | 分隔线与留白 | 2 | 无 |
| `luminous-dark` | 深色发光 | 内外发光与色晕 | 12 | 发光 0/0/40 |
| `tactile-paper` | 纸质拼贴 | 纸张层叠与轻微旋转 | 6 | 极轻 2/4/8 |

`designLanguage: 'auto'` 时不注入任何材质约束，由模型按页面类型自行判断——这是保留给"不想被限制"的场景。

**关键改动**：`compileVisualDirectionPrompt` / `compileVisualRedesignPrompt` 从注入常量改为注入选中语言的 Token；`buildVisualNormalizationPatches` 从全局定值改为读当前语言 Token，并接受 Style Pack 覆盖，修掉 `radius: 12` 被压成 8 的冲突。

归一化的职责由此收窄为"保证同一语言内部一致"，不再规定用哪种语言。

### 阶段二：分轴 Direction + Range

按 IdeaBlocks 的 Property / Direction / Range 拆解，把全局单档 `exploration` 替换为六条独立轴。Property 复用现有 `change` 的六个 key，语义从"是否重设计"升级为"往哪个方向、走多远"。

```ts
interface VisualAxis {
  direction: string   // 该属性的变化方向，'keep' = 不变
  range: 'subtle' | 'moderate' | 'extreme'
}
```

每条轴的 direction 候选：

| 轴 | 方向候选 |
| --- | --- |
| `heroComposition` | 居中对称 / 偏心张力 / 全幅沉浸 / 分割构图 |
| `typography` | 放大标题反差 / 收紧为等级序列 / 混排衬线无衬线 / 超大字重冲击 |
| `componentSurfaces` | 提升卡片实体感 / 融入背景 / 强化边界描边 / 改为分隔线分区 |
| `decoration` | 减到最少 / 母题重复 / 只在区块边界 / 有机形态 |
| `spacingRhythm` | 整体放宽 / 整体收紧 / 疏密交替 / 模块化栅格 |
| `colorRoles` | 加深对比 / 收窄色域 / 迁移强调色 / 反转明暗基调 |

`range` 语义：`subtle` 保持可识别的同一版；`moderate` 明显不同但同源；`extreme` 允许结论性改变。

这样"构图大胆、配色克制"变得可表达：`heroComposition: { direction: '全幅沉浸', range: 'extreme' }` 配 `colorRoles: { direction: 'keep' }`。

**兼容**：旧模板只有 `exploration` 和布尔 `change`，用 `normalizeVisualRedesignBrief` 从旧字段推导出轴（`bold` → `extreme`，`change.x === false` → `direction: 'keep'`），旧模板继续可用。

### 阶段三：并行多版 + 选优（未实现）

把 `page.review` 的收敛 repair 改造成发散选优。需要的改动比前两阶段重，涉及：

- `agent-planner.mjs` 支持 fan-out 步骤：同一 Brief 派生 N 个 variant Brief（各自轴取值不同），并行执行 `page.generate-shell` + `page.generate-component`。
- `canvas-target` 为每个 variant 分配独立画板。`duplicate-variant` placement 与 `variantParentArtboardId`（`editor-store.ts:603`）已有雏形，可复用。
- 选优 UI 复用 `VariantComparisonDialog`，让用户选定一版后，其余 variant 标记为废弃但保留画板。
- `reviewPageVision` 从单 judge 扩展为多 persona 评审，用于给 variant 排序（不替代用户决策，只提供排序建议）。

未在本次实现，原因是它改动 Workflow 状态机与画布事务边界，需要独立的可靠性验证。前两阶段落地后单调问题已显著缓解，此阶段收益是"让用户审美进入回路"，属于下一步。

## 实施状态

| 阶段 | 状态 | 验证 |
| --- | --- | --- |
| 一：设计语言包 | 已实现 | `npm run test:visual-brief` |
| 二：分轴 Direction + Range | 已实现 | `npm run test:visual-brief` |
| 三：并行多版 + 选优 | 未实现 | — |

## 边界

- Brief 不进入 Runtime。前两阶段全部在 `src/features/editor/utils/visual-brief.ts` 编译成 prompt 文本，Runtime 协议不变。
- 设计语言只约束**材质与视觉词汇**，不约束业务内容、信息架构和可编辑结构。`preserve` 的语义不变。
- 归一化仍然只处理未锁定、非组件绑定、非 `page-shell` 的节点，边界与改动前一致。
- Style Pack 优先于设计语言包：Style Pack 是品牌事实，设计语言是审美选择。两者冲突时以 Style Pack 为准。

## 参考

业界做法调研来源：

- [Extract a Design System Before You Prompt an AI Builder](https://www.digitalapplied.com/blog/extract-design-system-ai-app-builder-theming-2026) — Token 先行，形容词不构成契约
- [UI Design Prompts: A Copy-Paste Library for Real Interfaces](https://superdesign.dev/blog/ui-design-prompts) — "给了 label 而不是 brief"
- [Design.md — Design Systems for AI Builders](http://figma.love/) — 具名设计系统包形态
- [Design Token System for AI Agents](https://www.mindstudio.ai/blog/design-token-system-ai-agents-brand-visuals) — Token 以 JSON 形式供 agent 引用
- [IdeaBlocks: Expressing and Reusing Divergent Intents for Graphic Design Exploration](https://arxiv.org/abs/2507.22163) — Property / Direction / Range 发散意图解剖
- [Anima Skill: agents generate multiple UI variants in parallel](https://www.animaapp.com/blog/agentic/ai-agents-can-now-design-explore-and-publish-apps-with-anima/) — 并行多版选优
- [Replace retry loops with choose-best flow](https://gist.github.com/DaveCBeck/04f092252437959539ad84e2d2e06a48) — 选优取代重试
- [Beyond a Single Judge: Simulating Social Persona Panels for Generative UI Evaluation](https://arxiv.org/html/2607.28439) — 多 persona 评审团
