# 通用节点局部设计能力

> 状态：P2 已实现  
> 更新日期：2026-08-20

## 1. 目标

用户选中通用 DesignDocument 节点后，可以直接用自然语言修改当前设计，而不重新生成整张画板。业务组件绑定节点、Props Slot 和 Page Shell 继续使用各自领域工作流，不能通过通用 Patch 绕过。

## 2. 执行流程

```text
generic-node EditScope + CanvasSnapshot(documentRevision)
  -> design.patch.plan
  -> design.patch.generate-images
  -> design.patch.validate
  -> canvas.present-patch
  -> Renderer 原子提交
  -> Canvas ACK(documentRevision + 1)
```

当前入口已统一为 `SelectionScope`，支持 `generic-node`、同画板普通节点组成的 `multi-node`、`text-range` 和 `image-region`。Scope 会冻结 `scopeId / targetHash / targetElementIds`；详细协议见 `selection-scoped-ai-editing.md`。

## 3. DesignPatch

```ts
interface DesignPatch {
  version: 1
  baseRevision: number
  artboardId: string
  summary: string
  operations: Array<
    | { kind: 'update'; elementId: string; elementType: string; changes: object }
    | { kind: 'move'; elementId: string; x?: number; y?: number; parentId?: string }
    | { kind: 'delete'; elementId: string }
    | { kind: 'add'; element: DesignElementInput }
    | { kind: 'replace-image'; elementId: string; prompt: string }
    | { kind: 'replace-text-range'; elementId: string; start: number; end: number; expectedText: string; replacement: string }
    | { kind: 'replace-image-region'; elementId: string; prompt: string; normalizedRect: UnitRect }
  >
}
```

模型只负责选择操作、目标节点和受限属性。Runtime 会删除未知字段，限制节点类型、尺寸、透明度和操作数量。文本 Range 和图片 Region 任务会由 Runtime 强制覆盖冻结目标及范围，模型不能扩大选区。`replace-image` 由独立图片 Provider 生成素材；`replace-image-region` 通过原图与 Mask 编辑，并在 Runtime 本地合成以保护 Mask 外像素。

## 4. 原子事务

Renderer 收到 Patch 后执行：

1. 比较当前 `DesignDocument.version` 与 `baseRevision`。
2. 在文档副本中依次校验所有 Operation。
3. 任一节点、父级、图片或属性无效时拒绝整个 Patch。
4. 全部成功后一次替换文档，revision 只增加一次。
5. 项目持久化失败时由 Canvas Bridge 回滚 Document 与 Mutation Ledger。

因此不会出现“前三个操作成功、第四个失败”的半完成设计稿。

## 5. 边界

- 支持 `section / shape / text / button / image` 通用节点。
- 禁止修改带 `componentBinding` 的业务组件节点。
- 禁止修改 `designRole=page-shell` 的页面外壳。
- 普通拖拽、属性编辑、增删节点都会增加 document revision。
- 当前 CanvasSnapshot 最多携带 80 个节点；超大画布的跨截断节点 Patch 尚不支持。
- 当前冲突会明确失败并要求重新执行，还没有自动三方合并。
- Runtime 和 Renderer 都会拒绝目标白名单之外的 Operation。
- 普通容器选区包含其可编辑子树；跨画板、业务组件混合多选会明确阻止发送。

## 6. 验证

```bash
npm run test:design-patch
npm run test:all
```

测试覆盖自然语言路由、属性白名单、Workflow Deliverable、更新、移动、新增、删除、图片替换、文本 Range、图片 Mask、Mask 外像素保护、原子 revision 提交和冲突拒绝。
