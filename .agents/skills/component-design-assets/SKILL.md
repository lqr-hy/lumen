---
name: component-design-assets
description: 从活动组件 JSON 中提取面向设计的能力契约，并结合 thumbnail、props、valueTypeMap、配置模式和继承关系，规划可独立生成的画布素材及安全的 Props 增量配置。处理 EraLottery、EraTasklist 等组件元数据，生成缩略图原型、识别宽度/高度/位置/颜色/图片/显隐属性、拆分按钮与背景等独立素材，或在不修改业务属性的前提下生成组件设计配置时使用。
---

# 组件设计素材

始终把组件视为“结构 + 设计配置 + 独立素材槽位”，禁止把整个组件生成为一张截图。

## 执行流程

1. 读取组件 JSON，定位 `name`、`thumbnail`、`props`、`valueTypeMap`、嵌套的 `objectChildrenShape`、默认值、显隐信息和自定义控制器。
2. 在正式 Electron/DMG Runtime 中调用 `component-design-assets.extract-facts`，以结构化 `component` 或 `json` 输入提取不带业务判断的属性事实。
3. 调用 `component-design-assets.resolve-contract` 使用通用规则解析设计契约。继续执行前检查 `unresolved` 和 `diagnostics`。存在继承时，将基础组件按从低到高的优先级放入结构化 `bases` 数组，当前组件始终最后覆盖。
   正式链路必须通过 Agent Tool Registry 执行 Runtime Tool，不得启动系统 `node` 子进程。
4. 解析当前配置模式。将包含多项设计属性的对象识别为 Profile，禁止把不同 Profile 合并成一套输出。
5. 只使用缩略图识别区域层级、边界和区域与素材槽位的映射。生成结构化 Blueprint，并在最终素材生成前渲染一份灰阶原型图。
6. 生成一个设计稿专用的 Component Visual Shell，只包含组件背景、容器、边框、光效和静态装饰；不得包含按钮、准确文字、运行时内容或任何 Props 图片槽位，也不得把它写入 Props。
7. 为当前 Profile 中的每个图片槽位创建独立素材任务。颜色、尺寸、位置和显隐直接写入 Props，不要为它们生成位图。
8. 用户提供 KV 或视觉参考图时，必须先提取 `visualTheme`（来源图片序号、主色板、明暗关系和视觉语言）。thumbnail 只约束结构，组件默认颜色不得覆盖 KV；所有颜色 Props、视觉外壳和独立素材必须共享同一 `visualTheme`。
8. 分别生成按钮、背景、装饰、空状态和动效素材。不同完整 Prop 路径必须对应独立画布素材。
9. 优先生成不带文字的按钮底图，再使用本地 SVG 或 Canvas 确定性渲染准确中文。禁止依赖图片模型生成精确按钮文字。
10. 按槽位尺寸、透明要求、素材角色、精确文字和完整 Prop 路径逐项校验。
11. 输出设计契约、Blueprint、Visual Shell、素材任务、素材清单、最小 Props Patch、诊断信息和独立画布节点。

## 强制约束

- 使用 `freeStyleConfig.draw_one_btn.image` 这样的完整路径绑定配置，禁止只使用叶子字段名 `image`。
- 将未知业务字段、事件、接口、奖品、任务和自定义控制器字段作为不透明数据原样保留。
- JSON 只提供自定义控制器名称而没有公开 Schema 时，禁止推断其内部结构。
- 禁止为颜色、数字、位置、圆角、间距或显隐字段生成图片。
- 禁止使用整组件位图替代所有独立图片槽位。
- Component Visual Shell 是上述规则的唯一例外，但它只能作为设计稿底层视觉，必须与 Props Slot 分离，且不能包含可配置图片、精确文字或动态业务内容。
- 保留继承值来源，并按以下优先级覆盖：全局默认 < 基础组件 < Mixin < 组件默认 < 实例配置 < AI Patch < 用户修改。
- 区域与槽位映射置信度不足时，输出歧义诊断并在素材生成前停止。
- 通用规则不足时，通过 `--adapter <adapter.mjs>` 加载组件或组件族 Adapter，禁止在核心读取器中硬编码组件名。
- 除非用户明确要求多个变体，否则只生成当前激活 Profile 的素材。
- 只输出发生变化的设计属性，禁止输出或覆盖完整业务 Props。

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
  "visualShell": {},
  "assetTasks": [],
  "assets": [],
  "propsPatch": {},
  "unresolved": [],
  "diagnostics": []
}
```

实现属性分类、继承解析、Blueprint 映射或 EraLottery 素材槽位时，读取 [设计契约参考](references/design-contract.md)。
