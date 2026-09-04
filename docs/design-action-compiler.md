# 局部设计动作编译与 Patch 工作流

## 1. 目标

局部设计编辑必须以当前画布和当前选区为唯一执行依据。当前流程采用 **AI DesignAction 优先、Runtime Patch 编译兜底**：AI 负责从选区节点树中识别真实目标，Runtime 负责 Scope、节点类型、属性和 Revision 校验。这样可以覆盖后台卡片、表单、导航、营销模块等不同结构，不依赖组件名称或固定中文关键词。

```text
SelectionScope + 节点树
        -> AI DesignAction
        -> Runtime Action Compiler
        -> DesignPatch
        -> Revision/Scope 校验
        -> 画布事务
```

DesignAction 允许的通用动作包括：`replace-text`、`set-style`、`set-layout`、`move`、`set-visibility`、`replace-image`。

## 2. 当前问题

旧流程固定执行：

```text
Pi -> revise-design -> design.patch.plan -> 模型生成 Patch -> generate-images -> validate -> present
```

存在以下问题：

- 文本修改也会经过模型规划，模型返回空结构时显示“缺少 Patch Operation”。
- 所有局部 Patch 都显示并尝试执行“生成替换图片”。
- 重试复用旧 Run、旧 Scope 和旧计划，不能保证使用当前文档 Revision。
- 只显示 `generic-node` 和节点名称，用户无法知道目标节点类型及可编辑属性。
- “背景改成红色”在文本节点上没有明确的目标属性诊断。

## 3. 新流程

```text
当前用户消息
  + 当前 DesignDocument
  + 当前 SelectionScope
  + 当前 CanvasSnapshot
       |
       v
Selection Context Builder
  |-- 构造选区根节点、子节点、父子关系、内容和语义角色
  v
AI DesignAction Planner
  |-- 选择真实目标节点
  |-- 返回结构化 DesignAction
  |-- 有歧义时请求澄清
  v
Action Compiler
  |-- 将 Action 编译为受限 DesignPatch
  |-- Action 无效时回退到 Patch Planner
  |-- 快速规则仅作为最后兜底
       |
       v
Patch Normalize -> Validate -> Canvas Present -> Renderer ACK
```

Action Compiler 位于 `electron/runtime/design-action-compiler.mjs`。

## 4. 确定性动作

### 4.1 文本替换

仅当满足以下条件时直接执行：

- Scope 类型为 `generic-node`。
- 当前节点类型为 `text`。
- 用户使用“改成、改为、换成、替换为、修改为”等明确替换表达。
- 指令没有混合移动、颜色、背景、圆角、边框等其他意图。

输出单个 `update`：

```json
{
  "kind": "update",
  "elementType": "text",
  "changes": { "content": "本月到期" }
}
```

### 4.2 属性目标约束

| 节点 | 可编辑示例 |
|---|---|
| text | content、style.color、style.fontSize、style.fontWeight |
| button | content、style.background、style.color、style.borderRadius |
| shape | fill、stroke、borderRadius、opacity |
| image | objectFit、objectPosition、borderRadius、图片替换 |
| section | layout、padding、gap、autoLayout |

文本节点收到“背景、底色、填充、圆角、边框”等请求时，不能让模型猜测父节点，必须提示用户选择对应的 Shape 或卡片背景节点。

## 5. AI DesignAction

AI 不直接修改画布，也不直接拥有 Patch 写入权限。它只能从 `writableNodeIds` 中选择目标：

```json
{
  "action": "replace-text",
  "target": { "nodeId": "text-metric-value" },
  "value": "15%"
}
```

卡片选区会提供完整节点树，包含背景 Shape、标题、指标值、按钮等节点。模型可以根据内容和语义角色选择真正要修改的文本，而不是把外层 Shape 当作最终目标。

## 6. 模型 Patch

Action Compiler 无法确定时，才调用 `design.patch.plan`。模型结果统一通过 `extractDesignPatch()` 提取，兼容以下结构：

- `result.designPatch`
- `result.data.designPatch`
- `result.data.operations`
- `result.operations`

其他结构都视为无效结果，不能直接应用。

## 7. 动态执行步骤

初始计划可以包含完整步骤，但 `design.patch.plan` 成功后必须根据操作类型裁剪：

```text
纯文本 / 属性 / 布局 Patch：
  plan -> validate -> present

包含 replace-image / replace-image-region：
  plan -> generate-images -> validate -> present
```

文本修改不再展示“生成替换图片”。计划发生裁剪时必须重新发送 `plan.updated` 事件。

## 8. 重试协议

重试不是继续旧 Patch，而是重新冻结当前上下文：

1. 读取原始用户目标，不使用“重试”作为业务目标。
2. 读取当前 DesignDocument 和当前 Revision。
3. 普通节点和多节点重新生成 SelectionScope、targetHash。
4. 文本范围和图片 Mask 保留原始范围，但通过当前 Revision 做冲突校验。
5. 创建新的执行消息，清理旧的失败计划和 Checkpoint。
6. 从 `design.patch.plan` 重新开始。

旧失败 Run 只用于展示诊断，不作为新的 Patch 来源。

## 9. 错误分类

错误不能统一显示为“缺少 Patch Operation”：

- `PATCH_RESPONSE_EMPTY`：模型没有返回结构。
- `PATCH_RESPONSE_INVALID`：返回结构无法解析。
- `DESIGN_PATCH_TARGET_PROPERTY_UNSUPPORTED`：目标节点不支持请求属性。
- `SELECTION_TARGET_CONFLICT`：选区内容或 Revision 已变化。
- `DESIGN_PATCH_SCOPE_VIOLATION`：Patch 修改了选区外节点。
- `DESIGN_PATCH_IMAGE_MISSING`：图片替换操作缺少图片制品。

## 10. 验收案例

| 输入 | 预期 |
|---|---|
| 选中文本“本周到期”，改成本月到期 | 直接文本 Patch，不调用模型，不生成图片 |
| 选中 Shape，背景改成红色 | 属性 Patch，校验后写入 Shape |
| 选中文本，背景改成红色 | 明确提示选择背景 Shape，不发送空 Patch |
| 选中图片，重新生成主体 | 进入图片替换流程，执行生图步骤 |
| 复杂指令“改标题并下移、调整圆角” | 进入模型 Patch，保留完整校验链 |
| 失败后点击重试 | 使用原始目标、当前 Revision 和重新冻结的 Scope |

## 11. 实现状态

- [x] Action Compiler 基础文本替换。
- [x] CanvasSnapshot 强制保留当前选区节点，不受前 80 个节点截断影响。
- [x] 统一 Patch 提取入口。
- [x] 非图片 Patch 不再预置生图步骤；只有明确包含图片替换 Operation 时动态插入生图步骤。
- [x] 计划裁剪后发送 `plan.updated`。
- [x] 重试恢复原始用户目标。
- [x] 普通节点和多节点重试重新计算 Scope。
- [ ] 完整的颜色、尺寸和布局确定性编译器。
- [x] Runtime 诊断输出 Action Compiler 版本、Scope、目标节点和 Revision。
- [x] Selection Context Builder 输出选区节点树、父子关系和通用语义角色。
- [x] AI DesignAction 优先规划并由 Runtime 编译为 DesignPatch。
- [x] Shape/Button/Text/Image 的通用 Style Action 编译与属性校验。
- [x] AI Action 失败时回退到结构化 Patch/快速编译路径。
- [ ] Timeline 展示目标节点类型和可编辑属性。
