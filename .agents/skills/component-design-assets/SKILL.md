---
name: component-design-assets
description: 从活动组件 JSON 中提取设计契约，优先使用真实 Runtime DOM 作为结构原型，并结合 thumbnail、KV、props、配置模式和继承关系生成完整组件设计图及安全的 Props 增量配置。
---

# 组件设计素材

只有当前消息明确指定组件 JSON 文件、`componentsJson/<name>.json`、Era 组件名或要求组件 Props/素材导出时才激活本 Skill。普通 Web、H5、App、后台、海报、KV 和未绑定业务组件的页面不得激活，也不得扫描 `componentsJson`。

默认把组件视为“AI 氛围底图 + 声明式 Props 图片 Slot + Runtime 原生 UI 节点 + Props Patch”。首次设计生成一张不含 UI 结构的氛围底图，并为当前 Profile 明确声明的图片 Slot 生成独立素材；Runtime Surface、Progress、文字、非图片按钮和业务图片节点作为前景写入画布。

## 执行流程

1. 读取组件 JSON，定位 `name`、`thumbnail`、`props`、`valueTypeMap`、嵌套的 `objectChildrenShape`、默认值、显隐信息和自定义控制器。
2. 在正式 Electron/DMG Runtime 中调用 `component-design-assets.extract-facts`，以结构化 `component` 或 `json` 输入提取不带业务判断的属性事实。
3. 调用 `component-design-assets.resolve-contract` 使用通用规则解析设计契约。继续执行前检查 `unresolved` 和 `diagnostics`。存在继承时，将基础组件按从低到高的优先级放入结构化 `bases` 数组，当前组件始终最后覆盖。
   正式链路必须通过 Agent Tool Registry 执行 Runtime Tool，不得启动系统 `node` 子进程。
4. 解析当前配置模式。将包含多项设计属性的对象识别为 Profile，禁止把不同 Profile 合并成一套输出。
5. 组件声明 `componentJs/componentCss/framework` 时，优先通过隔离 Runtime DOM Source Adapter 提取真实层级、边界、文本、字号和样式，同时捕获裁切后的 Runtime PNG。Runtime PNG 是布局和文案的最高优先级 Prototype；不支持、失败或无 Bundle 时才使用 thumbnail Vision。
6. thumbnail 仅作为次级参考。它与 Runtime DOM 在节点、位置、文案或尺寸上冲突时必须服从 Runtime，禁止把 thumbnail Vision 节点和 Runtime 节点混合到最终画布。
7. 首次设计创建一个 `component-backdrop` 任务，并为当前 Profile 中 `generationPolicy=generate` 的非动效图片 Slot 分别创建 `component-slot-*` 任务。所有任务只携带 KV/Visual；背景任务禁止 Runtime PNG、thumbnail、结构摘要和任何 UI，Slot 任务只能输出对应 Prop 的单个素材。
8. 用户提供 KV 或视觉参考图时，必须先提取 `visualTheme`（来源图片序号、主色板、明暗关系和视觉语言）。组件默认颜色不得覆盖 KV；氛围底图、Runtime 原生 UI 与颜色 Props 必须共享同一 `visualTheme`。Runtime 还必须从 KV 像素计算独立色板证据；模型色板与像素证据明显冲突时，以像素证据校准颜色，并保留模型给出的字体、材质和装饰语义。
9. 生图 Prompt 禁止携带 Runtime 结构摘要、节点边界和可见文字。AI 只生成不含 UI 结构的氛围底图；Runtime 原生节点确定性承载卡片、按钮、进度、业务图片和文字，避免两套近似坐标叠加。
10. 图片 Prop 承载完整按钮或标签时，使用 `model-exact` 直接生成包含准确文案的完整图片，画布不得再叠加同文案 Text。用户局部修改氛围时编辑 `component-backdrop`；选择 Runtime 原生节点或 Props 图片时分别进入属性编辑或 Slot 重生成。
11. 校验氛围底图与 Props 图片的尺寸、位图有效性、结构所有权、重复文字、透明度和参考主题一致性。氛围底图超时可回退为 VisualTheme 确定性纯背景；Props 图片失败时直接失败，禁止伪造可写回组件配置的素材。
12. 输出设计契约、Runtime DesignTree 元数据、完整图片任务、最小 Props Patch、诊断信息，以及画布中的“组件根节点 + 视觉外壳 + 可编辑前景节点”。

## 强制约束

- 使用 `freeStyleConfig.draw_one_btn.image` 这样的完整路径绑定配置，禁止只使用叶子字段名 `image`。
- 将未知业务字段、事件、接口、奖品、任务和自定义控制器字段作为不透明数据原样保留。
- JSON 只提供自定义控制器名称而没有公开 Schema 时，禁止推断其内部结构。
- 禁止为颜色、数字、位置、圆角、间距或显隐字段单独生成图片；它们仍写入 Props Patch，并作为完整生图的视觉约束。
- 主题提取请求只能携带 `kv/visual` 图片，禁止携带 thumbnail；附件序号必须相对当前请求计算，禁止复用合并引用列表中的序号。
- 主题质量门禁必须检查氛围底图和 Runtime 原生 UI 与 KV 像素证据的亲和度；显式 Slot 导出时再检查独立素材，禁止只拿模型自己返回的色板做自洽检查。
- AI 氛围底图拥有底色、纹理、光效和边缘装饰所有权；Runtime 原生节点拥有卡片、按钮、进度、文字和业务图片所有权。
- Runtime 原始颜色不得直接覆盖 KV 主题；Surface、Progress、Text 和 Button 必须使用主题 Token 重着色并检查文字对比度。
- 保留继承值来源，并按以下优先级覆盖：全局默认 < 基础组件 < Mixin < 组件默认 < 实例配置 < AI Patch < 用户修改。
- 区域与槽位映射置信度不足时，输出歧义诊断并在素材生成前停止。
- 通用规则不足时，通过 `--adapter <adapter.mjs>` 加载组件或组件族 Adapter，禁止在核心读取器中硬编码组件名。
- 除非用户明确要求多个变体，否则只生成当前激活 Profile 的素材。
- 只输出发生变化的设计属性，禁止输出或覆盖完整业务 Props。
- 局部或批量重生成图片 Slot 时，透明度默认继承原 `assetTask.transparent`；同批同级素材共享视觉一致性契约，但包含不同准确文案的图片必须分别生成。

## 开发调试

只有在 Skill 开发、回归测试或人工排查时，才使用以下 CLI：

```bash
node scripts/extract_component_facts.mjs <component.json>
node scripts/resolve_design_contract.mjs <component.json>
```

原命令 `extract_design_contract.mjs` 仅作为兼容入口保留。正式应用和 DMG 不依赖用户安装 Node。

## 输出格式

结构化结果统一使用以下顶层字段：

```json
{
  "contract": {},
  "blueprint": {},
  "assetTasks": [{ "id": "component-backdrop" }, { "id": "component-slot-1", "propPath": "..." }],
  "assets": [],
  "propsPatch": {},
  "unresolved": [],
  "diagnostics": []
}
```

实现属性分类、继承解析、Blueprint 映射或 EraLottery 素材槽位时，读取 [设计契约参考](references/design-contract.md)。
