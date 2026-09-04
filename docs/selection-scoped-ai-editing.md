# AI 局部选区编辑架构

> 状态：P0-P4 已实现  
> 更新日期：2026-08-20

## 1. 目标

将普通节点 Patch、组件 Slot 重生成、组件实例修订和 Page Shell 重生成统一为 `SelectionScope`。当一次任务携带 Scope 时，Agent 只能修改 Scope 指定目标，不能降级为整页、整图或新画板生成。

核心原则：

1. 画布选择是结构化执行边界，不是普通提示词附件。
2. 发送时冻结 Scope，执行期间后续选择变化不能改变目标。
3. Runtime 负责选择工作流，Renderer 负责最终目标白名单校验。
4. 所有局部写入都使用 Revision 检查、原子提交和 Mutation Ledger。
5. 无法解析或已失效的 Scope 必须失败，禁止生成整图兜底。

## 2. 统一协议

```ts
type SelectionScope =
  | GenericNodeSelectionScope
  | MultiNodeSelectionScope
  | ComponentRegionSelectionScope
  | ComponentRegionBatchSelectionScope
  | ComponentInstanceSelectionScope
  | PageShellSelectionScope
  | TextRangeSelectionScope       // P2
  | ImageRegionSelectionScope     // P3

interface SelectionScopeBase {
  scopeId: string
  type: string
  artboardId: string
  documentRevision: number
  targetHash: string
}
```

`scopeId` 标识本轮冻结选区，`documentRevision` 检测画布并发变化，`targetHash` 检测目标节点内容或尺寸变化。

P0 / P1 支持的范围：

| Scope | 目标 | 工作流 |
|---|---|---|
| `generic-node` | 单个普通节点 | `revise-design` |
| `multi-node` | 同画板多个普通节点 | `revise-design` |
| `component-region` | 组件图片 Slot | `regenerate-slot` |
| `component-region-batch` | 同画板一个或多个组件图片 Slot | `regenerate-slots` |
| `component-instance` | 整个业务组件实例 | `revise-component` |
| `page-shell` | 页面视觉外壳 | `revise-page-shell` |
| `text-range` | 文本节点中的冻结字符范围 | `revise-design / replace-text-range` |
| `image-region` | 普通图片节点中的矩形 Mask | `revise-design / replace-image-region` |

## 3. Design Patch 约束

Runtime 生成的 `DesignPatch` 必须携带：

```ts
interface DesignPatchScopeContract {
  scopeId: string
  targetHash: string
  targetElementIds: string[]
}
```

执行双重校验：

1. Runtime 校验所有 `update / move / delete / replace-image` 的目标都在白名单内。
2. Renderer 应用 Patch 前再次校验 Scope 身份、目标 ID 和 Revision。
3. `add` 只能添加到选中的普通容器节点中，不能越过业务组件或 Page Shell。
4. 多个 Operation 任一失败时拒绝整个 Patch。

## 4. 交互

- 画布存在有效选择时，Composer 显示“修改范围”Chip。
- “局部重生成”是结构化 Composer Action，不再作为普通 `@` 文本引用表达。
- 连续选择多个组件素材时合并为“局部重生成 · N 个组件素材”，支持展开、定位、逐项移除和全部清除。
- 单选显示节点名称；多选显示节点数量；组件 Slot 和 Page Shell 显示领域名称。
- Chip 可定位目标并清除选择。
- 发送时创建不可变 Scope 快照，不读取后续实时选择。
- Run Timeline 保留本轮 Scope 标识和实际写入结果。

## 5. Agent 路由

携带 Scope 的执行型请求必须使用局部工作流：

```text
generic-node / multi-node -> revise-design
text-range               -> revise-design
image-region             -> revise-design
component-region          -> regenerate-slot
component-region-batch    -> regenerate-slots
component-instance        -> revise-component
page-shell                -> revise-page-shell
```

Pi 调用 `create-page / create-ui / create-image / create-component` 时，Runtime 返回 `SELECTION_WORKFLOW_REQUIRED`，不允许静默改成其他输出。

咨询、分析和询问方案仍走普通 `chat`，不会因为当前选中了节点而修改画布。

## 6. 阶段

### P0：统一 Scope

- [x] 新增 `SelectionScope` 公共类型。
- [x] 将 `createComponentEditScope` 重构为 `createSelectionScope`，删除旧文件。
- [x] 为现有五类 Scope 增加 ID、Revision、Hash、目标白名单和 Artboard。
- [x] Composer 展示有效/无效选区 Chip，并支持定位与清除。
- [x] Runtime 禁止局部任务降级。
- [x] 首次执行、确认继续和失败重试复用冻结 Scope。

### P1：多节点 Patch

- [x] 同画板普通节点多选生成 `multi-node` Scope。
- [x] 普通容器 Scope 自动包含可编辑子树，业务组件和 Page Shell 不进入通用白名单。
- [x] Patch 注入目标白名单。
- [x] Runtime 与 Renderer 双重校验目标及目标 Hash。
- [x] 保持单次 Revision 的原子提交和统一撤销。
- [x] 跨画板和业务组件混合多选明确阻止发送，不按无 Scope 请求降级。

### P2：文本 Range

- [x] 捕获文本节点中的起止 Offset、选中文字和前后文。
- [x] 新增 `replace-text-range` Operation。
- [x] Runtime 强制覆盖目标节点、Offset 和原文，只允许模型提供 replacement。
- [x] Renderer 校验 Revision、Target Hash、Offset 和 expectedText；变化时原子拒绝并提示重新选择。

当前刻意不自动重定位：同一段文字重复出现时，上下文推断可能改错目标。后续若增加重定位，必须做到唯一匹配才可提交。

### P3：图片 Mask

- [x] 复用画布切图框选，增加普通图片及具有 Image Prop 绑定的组件图片 AI Mask 模式。
- [x] 新增 `image-region` Scope 和 `replace-image-region` Operation。
- [x] 图片 Provider 通过 `images/edits` 分别接收 `image[]` 原图和 `mask` PNG。
- [x] Runtime 本地重新合成生成图与原图，逐像素保证 Mask 外内容保持不变。
- [x] 缺少原图、Mask 或 Provider 编辑能力时明确失败，禁止整图降级。
- [x] 增加矩形、画笔、擦除、笔刷大小、0-32px 羽化、重置、取消和完成工具栏。

Mask 工作台在点击“完成”前不会冻结 Scope。矩形与画笔可以叠加；画笔增加编辑区，擦除恢复保护区；羽化只改变 Mask Alpha 过渡。Runtime 仍以最终 Mask 为像素保护边界。

### P4：质量与可观测性

- [x] Timeline 展示冻结 Scope、工具、Patch Operation、影响节点和提交 Revision。
- [x] 文本 Range 展示替换前后文案，图片 Mask 展示编辑前后预览。
- [x] Revision、Target Hash、文本 Range 与 Scope 越界冲突不再直接重试过期任务，改为定位并提示重新选择。
- [x] 通过 `test:chat-run`、`test:design-patch`、`test:component-actions` 和 `test:raster-analysis` 建立局部编辑契约基线。

本阶段不增加 Playwright 用例。交互层继续复用已有编辑器测试，核心边界由不依赖浏览器进程的确定性契约测试覆盖。

### P5：组件素材批量重生成

- [x] 将 Scope（修改哪里）、Action（执行什么）和 Prompt（期望效果）从 Composer 数据中分离。
- [x] 新增 `component-region-regeneration` Composer Action 和 `component-region-batch` Scope。
- [x] 多目标动作不再拼接为自然语言引用，结构化目标直接进入确定性 Runtime 工作流。
- [x] 新增 `component.regenerate-slots -> component.validate-slots -> canvas.present-slots` 批量链路。
- [x] 图片生成并发上限为 2；每个目标独立携带 Slot、Prop Path、尺寸和当前图片。
- [x] Renderer 在提交前统一校验 Revision、Target Hash、实例、Slot、Prop Path 和当前图片。
- [x] 所有目标通过后使用一次 Store 事务替换图片、同步 Props/Fallback、写入 Assets，并只增加一次 Revision。
- [x] Composer 展示与实际执行目标数量一致，提交后不残留已执行动作。
- [x] 局部重生成动作跟随当前可见 Composer：右侧聊天面板打开时进入面板，否则进入画布底部输入框。
- [x] 同一节点的局部重生成采用幂等 Upsert；已有普通引用会升级为结构化动作，重复触发不会意外取消。
- [x] 参考图走 `images/edits` 时按 Provider 能力省略不支持的 `background=transparent` 参数，同时保留 Alpha Prompt、PNG 归一化和透明度质量门禁。
- [x] Scope 在发送时即被消费；画布可继续保持选中，但 Agent 交付选中不会自动绑定为下一轮修改范围。
- [x] 带确定性文字包装的组件素材同时保留原始位图，必须先通过真实 Alpha/伪棋盘格门禁；失败时节点内纠正重试两次，仍失败则整批拒绝写入。
- [x] 同组件、同 Profile、同视觉区域族、同尺寸且仅文案不同的 Slot 共享一个无文字视觉母版，再分别确定性叠加文案，避免批量并发生图产生按钮风格漂移。
- [x] 局部重生成默认按普通图片处理；仅用户明确提出透明、去背景或 Alpha 要求时启用透明门禁，避免“调整尺寸/统一样式”被无关透明校验阻断。
- [x] 局部组件重生成默认不回传画布当前图片，避免旧素材的白底/棋盘格污染新任务；仅用户明确要求基于当前图修改时才允许进入 Edit Base 流程。
- [x] 底部 Composer 与右侧聊天面板绑定同一个活动 `EditorChatThread`，统一草稿、附件、Mention、局部动作、消息和 Run，不再发送时复制临时会话。

当前采用严格原子策略：任一目标生成、质量验证或 Renderer 前置校验失败时整批不写入。失败重试会重新执行整批；“仅重试失败项”的部分提交模型尚未启用，避免出现设计稿与 Props Patch 的混合版本。

## 7. 验收

P0-P3 必须满足：

1. 选择普通节点并要求修改时，不创建画板或整图。
2. 多选三个节点时，Patch 不得修改第四个节点。
3. 发送后切换选择，不影响正在运行任务。
4. 目标节点或 Revision 改变后，旧 Patch 原子拒绝。
5. 组件 Slot、组件实例和 Page Shell 保持原有领域工作流。
6. 清除 Scope 后恢复正常自然语言生成能力。
7. 文本 Range 任务只能改变冻结子串，Offset 或原文变化后必须失败。
8. 图片区域任务只能替换普通图片或具有 Image Prop 绑定的组件图片，最终图片的 Mask 外像素必须与编辑底图一致。
9. 批量组件素材任务展示 N 个目标时，Runtime 和 Deliverable 必须同样包含 N 个目标。
10. 批量目标任一失效时不得部分写入；成功时文档 Revision 只能增加一次。
