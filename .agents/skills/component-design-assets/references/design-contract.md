# 设计契约参考

## 目录

1. 两阶段解析架构
2. 属性分类
3. Profile、继承和 Adapter
4. Blueprint 映射
5. 素材规划
6. EraLottery 映射
7. 校验清单

## 1. 两阶段解析架构

核心读取器只提取事实，不理解具体组件：

```bash
node scripts/extract_component_facts.mjs <component.json>
```

事实包含完整路径、父路径、名称、标签、值类型、编辑器类型、默认值、显隐和自定义控制器。

契约解析器再使用规则注册表生成设计属性、Profile、Slot、置信度和证据：

```bash
node scripts/resolve_design_contract.mjs <component.json>
```

存在基础组件继承时，按从低到高的优先级传入一个或多个基础组件：

```bash
node scripts/resolve_design_contract.mjs child.json --base base.json --base mixin.json
```

后传入的基础层覆盖前一层，当前组件最后覆盖。输出属性保留 `source` 和 `sourceName`。

需要特殊组件语义时加载外部 Adapter：

```bash
node scripts/resolve_design_contract.mjs <component.json> --adapter ./my-adapter.mjs
```

Adapter 接口：

```js
export default {
  name: 'component-family-adapter',
  supports(component, facts) {
    return component.framework === 'Vue@2'
  },
  rules: [],
  refineContract(contract, context) {
    return contract
  }
}
```

禁止在通用 `component-design.mjs` 中加入组件名称判断。

## 2. 属性分类

先根据 `valueTypeMap` 分类，再使用 `name` 和 `label` 判断语义。

| 编辑器/值类型 | 名称或标签模式 | 结果 |
| --- | --- | --- |
| image | 任意 | image |
| color | 任意 | color |
| number | width/宽度 | width |
| number | height/高度 | height |
| number | left/x/横向 | x |
| number | top/y/纵向 | y |
| number/array | padding/margin/间距 | spacing |
| number/array | radius/圆角 | radius |
| switch/boolean | open/show/visible/enable/开启/展示 | visibility |

不能确定语义的设计候选进入 `unresolved`。禁止把任意数字直接识别为几何属性。

所有规则必须返回 `confidence` 和 `evidence`。无法确定的设计候选进入 `unresolved`，不得直接写入 Props。

## 3. Profile、继承和 Adapter

将包含多项设计叶子属性的根对象识别为候选 Profile，不依赖固定字段名。`styleConfig` 与 `freeStyleConfig` 只是示例：

```text
styleConfig -> normal
freeStyleConfig -> free, active when freeMode=true
```

按以下优先级解析完整路径值：

```text
global-default < base-component < mixin < component-default
< instance < ai-generated < user
```

保留值来源。只生成增量 Props Patch，禁止输出替换整个 Props 的对象。

组件或组件族的特殊 Profile 选择器、继承映射和 Slot 关系应由 Adapter 修正。

## 4. Blueprint 映射

使用缩略图估算边界和层级。按以下证据将视觉区域映射到素材槽位：

1. 区域语义，例如按钮、背景、装饰或空状态。
2. Prop 标签和完整路径。
3. 图片属性所在独立子对象中的宽高绑定。
4. 具有相同语义标记的位置属性。
5. 显隐控制属性。

每个生成区域必须包含 `slotId`、`propBindings`、边界、渲染模式和置信度。生成最终素材前先渲染灰阶原型供校验。

## 5. 素材规划

为当前 Profile 中每个图片 Prop 创建一个任务：

```json
{
  "id": "draw-one",
  "propPath": "freeStyleConfig.draw_one_btn.image",
  "role": "button",
  "targetSize": { "width": 150, "height": 52 },
  "transparent": true,
  "exactText": "抽一次"
}
```

先生成不带文字的按钮底图，再确定性渲染准确文字。只有兜底图确实需要不同视觉时才单独生成，否则允许同一份已确认素材写入两个路径。

## 6. EraLottery 映射

自由模式素材路径：

```text
freeStyleConfig.draw_one_btn.image
freeStyleConfig.draw_one_btn.static_image
freeStyleConfig.draw_ten_btn.image
freeStyleConfig.draw_ten_btn.static_image
freeStyleConfig.thanks_pic
freeStyleConfig.open_lottery_animation
```

普通模式素材路径：

```text
styleConfig.draw_one_pic
styleConfig.draw_ten_pic
styleConfig.thanks_pic
```

几何与结构属性示例：

```text
freeStyleConfig.draw_one_btn.width
freeStyleConfig.draw_one_btn.height
freeStyleConfig.oneBtnLeftPosition
freeStyleConfig.oneBtnTopPosition
freeStyleConfig.open_lottery_ten_btn
freeStyleConfig.open_wlist
```

在获得自定义控制器 Schema 前，将 `config` 和 `customConfig` 作为不透明配置保留。

EraLottery 映射是校验样例，不允许复制进通用读取器。

## 7. 校验清单

- 已明确选择当前 Profile。
- 每个图片素材都有一个完整 Prop 路径。
- 没有使用整组件位图替代独立素材槽位。
- 颜色和几何值作为配置处理，没有生成图片。
- 现有用户值保持最高优先级。
- 缺少 Schema 时未修改自定义控制器字段。
- 按钮文字准确。
- 素材尺寸匹配 Blueprint 边界。
- 透明要求匹配素材槽位。
- Props Patch 只包含发生变化的设计字段。
- 每个自动绑定包含置信度和证据。
- `unresolved` 在 Adapter、thumbnail 或用户确认前不进入生成阶段。
