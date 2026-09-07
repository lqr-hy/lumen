# 图层层级、拖拽与 Group 技术方案

> 状态：第一阶段已实现  
> 范围：图层排序、持久 Group、取消组合、拖拽 Reparent、画布绘制顺序、Undo/Redo 和生成结构保护

## 1. 背景与目标

项目原有 `DesignElement` 已包含 `parentId` 和 `zIndex`，AI 生成的 Scene、组件 Root 和 Design Block
也会形成嵌套结构，但手工创建的文本、图片和形状默认都是画板根层节点。图层面板只能展示和选择，无法调整
顺序、创建 Group 或改变父级。

本方案解决以下问题：

1. 用户可以调整同一父级内的前后遮挡顺序。
2. 多个普通图层可以形成持久 Group，而不是仅在一次多选拖动中临时同行。
3. 图层可以拖入普通 Group、Frame 或 Section，也可以通过拖拽调整同级顺序。
4. Group 的移动、缩放、隐藏、锁定、复制和删除作用于完整子树。
5. 编辑画布、静态快照和代码导出遵守同一棵层级树的绘制顺序。
6. 组件绑定、Page Shell 和 DesignSpec Block 不允许被普通图层操作破坏。

## 2. 概念模型

### 2.1 嵌套结构与 Group

`parentId` 是通用的树结构能力，Group 是其中一种轻量容器语义：

```text
DesignElement Tree
  ├── Group：手工组合，不自动排版
  ├── Frame：具有容器边界，可承载子节点
  ├── Auto Layout：根据顺序重新计算子节点坐标
  ├── Design Block：由 DesignSpec 维护
  └── Component Root：由组件实例和 Props Binding 维护
```

Group 复用已有的 `section` 节点，不新增另一套渲染模型：

```ts
interface SectionElement {
  type: 'section'
  containerKind?: 'group' | 'frame' | 'auto-layout' | 'design-block' | 'component-root'
}
```

旧项目没有 `containerKind` 时仍按普通 Section 读取，不需要数据迁移。

### 2.2 坐标与层级顺序

- 节点的 `x/y` 始终保存世界绝对坐标。
- `parentId` 表达逻辑父级和导出嵌套关系，不改变存储坐标系。
- `zIndex` 解释为同一 `parentId` 下的兄弟顺序，数值越大越靠前。
- Group 自身的 `zIndex` 决定整个 Group 在父级中的顺序。
- Group 内部子节点的 `zIndex` 只决定 Group 内部的顺序。

这种设计使 Reparent 不需要换算坐标；只有 Auto Layout 会根据新顺序重新写回绝对坐标。

## 3. 用户交互

### 3.1 图层面板拖拽

图层面板继续按从前到后显示，即高 `zIndex` 位于上方。

拖拽目标被划分为三个区域：

- 上部：将图层放到目标前面。
- 中部：目标是可编辑 Section 时，将图层放入目标容器。
- 下部：将图层放到目标后面。

交互反馈：

- `drop-before`：顶部插入线。
- `drop-after`：底部插入线。
- `drop-inside`：整个目标行高亮。
- `dragging`：降低源图层透明度。

拖入容器成功后自动展开目标容器。

### 3.2 Group 与 Ungroup

组合入口：

- 多选普通同级图层，右键选择“组合”。
- 快捷键：`⌘/Ctrl + G`。

取消组合入口：

- 选择 Group，右键选择“取消组合”。
- 快捷键：`⌘/Ctrl + Shift + G`。

组合行为：

1. 要求至少两个节点、同一画板、同一父级。
2. Group Bounds 取所有选中节点的包围盒。
3. 子节点世界坐标保持不变。
4. 子节点按原有前后顺序成为 Group 的直接子节点。
5. Group 在原父级中占据最高选中节点的位置。
6. 创建完成后只选中 Group。

取消组合行为：

1. 删除 Group 容器。
2. 直接子节点提升到 Group 原来的父级。
3. 子节点世界坐标和内部顺序保持不变。
4. 子节点占据 Group 原来的顺序区间。
5. 取消后选中被提升的子节点。

### 3.3 图层顺序命令

右键菜单和快捷键同时提供：

| 操作     | 快捷键               | 行为                           |
| -------- | -------------------- | ------------------------------ |
| 置于顶层 | `⌘/Ctrl + Shift + ]` | 移到当前父级可编辑图层的最前方 |
| 上移一层 | `⌘/Ctrl + ]`         | 向前移动一个可编辑位置         |
| 下移一层 | `⌘/Ctrl + [`         | 向后移动一个可编辑位置         |
| 置于底层 | `⌘/Ctrl + Shift + [` | 移到当前父级可编辑图层的最后方 |

多选时保持选中节点之间的相对顺序，将它们作为一个顺序块移动。

## 4. 安全边界

普通图层操作只作用于满足以下条件的节点：

```text
未锁定
AND 不含 componentBinding
AND 不含 designBlockId
AND 不含 designRole
AND 所有祖先也属于可编辑普通容器
```

因此以下节点不能通过普通 Group 或 Reparent 修改结构：

- Page Shell。
- Component Root 和组件 Props 绑定节点。
- DesignSpec Block Root 和编译生成节点。
- 被锁定的页面 Section。
- 位于受保护生成结构中的后代。

这些结构的顺序必须由对应源协议修改，例如 DesignSpec Patch、页面 Section 操作或组件编辑工具。
这样可以避免用户拖拽结果在下一次 AI 重编时被静默覆盖。

## 5. 核心算法

### 5.1 Group

```text
校验选区
  -> 按兄弟 zIndex 排序
  -> 计算选中节点包围盒
  -> 创建透明 Section(containerKind=group)
  -> 选中节点 parentId 指向 Group
  -> 规范化 Group 内部 zIndex
  -> 用 Group 替换原父级中的选中顺序区间
  -> 单 Revision 提交并进入 Undo 历史
```

### 5.2 Reparent

```text
校验源、目标和所有权
  -> 禁止跨画板
  -> 禁止拖入自己的后代
  -> before/after：使用目标 parentId
  -> inside：目标必须是可编辑 Section
  -> 从旧兄弟列表删除
  -> 插入新兄弟列表
  -> 同时规范化旧父级和新父级 zIndex
  -> 若父级是 Auto Layout，则重新计算子节点绝对坐标
```

### 5.3 层级绘制顺序

编辑画布为了支持世界坐标拖动，仍使用平铺 DOM，但不再直接按全局 `zIndex` 排序。

```text
查找根节点
  -> 根节点按兄弟 zIndex 排序
  -> 深度优先追加每个根节点的后代
  -> 为平铺 Renderer 分配临时连续 paint zIndex
```

结果是一个 Group 及其后代成为连续绘制单元，不能越过另一个 Group 的堆叠边界。

隐藏 Group 时不遍历其后代；锁定 Group 时向后代传递只读状态。该状态只用于渲染和交互，不回写每个子节点。

### 5.4 子树变换

移动 Group 时，画布预览会展开选中节点的完整子树，使所有后代实时同行。

缩放无 Auto Layout 的 Group 时，对全部后代使用相同的二维缩放：

```text
child.x = group.nextX + (child.x - group.oldX) * scaleX
child.y = group.nextY + (child.y - group.oldY) * scaleY
child.width  *= scaleX
child.height *= scaleY
```

Store 提交时再次基于原始节点递归计算，保证拖拽预览与最终 Document 一致。

## 6. 状态事务

以下操作都由 `editor-store` 在一个 Document Revision 中提交：

- `groupElements(ids)`
- `ungroupElement(id)`
- `moveLayer(draggedId, targetId, position)`
- `changeLayerOrder(ids, action)`

成功提交时统一执行：

1. `document.version + 1`。
2. 更新 `updatedAt`。
3. 写入 Undo History。
4. 清空 Redo Future。
5. 更新选择状态。
6. 结构操作时解除冻结的 AI SelectionScope。

无效操作和顺序未变化的操作返回 `changed=false`，不增加 Revision，也不污染 Undo 历史。

## 7. 复制、删除、隐藏和锁定

- 复制 Group 会复制完整子树并重映射所有内部 `id/parentId`。
- 粘贴和创建副本保持子树结构，并对全部节点施加相同位置偏移。
- 删除 Group 使用已有级联删除逻辑，递归删除全部后代。
- 隐藏 Group 时，编辑画布不绘制其后代。
- 锁定 Group 时，后代在画布中继承锁定状态。
- Layer Panel 仍显示隐藏或锁定 Group 的子节点，用户可以检查结构并从父级恢复状态。

## 8. 代码落点

| 模块                                                | 职责                                                    |
| --------------------------------------------------- | ------------------------------------------------------- |
| `src/features/editor/utils/layer-tree.ts`           | 纯函数层级模型、Group/Ungroup、Reparent、排序和绘制顺序 |
| `src/features/editor/types.ts`                      | `SectionElement.containerKind` 协议                     |
| `src/features/editor/store/editor-store.ts`         | 单 Revision 状态事务、Undo/Redo 和 Auto Layout 联动     |
| `src/features/editor/components/LayerPanel.tsx`     | 拖拽源、投放区域、反馈和自动展开                        |
| `src/features/editor/components/InfiniteCanvas.tsx` | 快捷键、右键菜单、子树变换、复制和层级绘制              |
| `src/features/editor/render/render-box.ts`          | 静态快照与代码导出的隐藏继承、树顺序展平和连续绘制序号  |
| `src/styles/editor/_canvas-legacy.scss`             | 拖拽手柄与投放反馈                                      |
| `scripts/test-layer-tree.mjs`                       | 层级纯函数专项回归                                      |
| `scripts/test-render-ir.mjs`                        | 画布、静态快照与代码导出的层级一致性回归                |

## 9. 验证

专项回归：

```bash
npm run test:layer-tree
npm run test:render-ir
```

覆盖内容：

- Group/Ungroup 结构与坐标保持。
- Group 子树连续绘制。
- Reparent 与循环引用保护。
- 生成结构所有权保护。
- 同级上移、下移、置顶和置底。
- 隐藏与锁定状态对子树的继承。
- 平铺快照中的 Group 连续堆叠和全局绘制序号。
- 隐藏 Group 的后代不会在静态快照或代码导出中重新出现。

提交前完整验证：

```bash
npm run lint
npm run build
git diff --check
```

## 10. 后续扩展

第一阶段没有把生成结构强制转换为普通节点。后续如需让用户完全接管 AI 结构，应单独实现：

1. “解除生成结构”事务，清理 DesignSpec、Component Binding 和生成元数据。
2. Frame 的背景、裁剪和独立坐标原点编辑体验。
3. Auto Layout 拖拽时的占位预览和跨容器尺寸策略。
4. 图层面板的键盘 Reparent 与无障碍拖拽替代操作。
5. 多画板之间的显式复制/移动事务。

这些能力不能通过放宽普通 Reparent 校验直接实现，否则会破坏生成源、Props Binding 和后续增量更新。
