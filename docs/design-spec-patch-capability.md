# DesignSpec 结构修改能力

> 状态：已实现  
> 更新日期：2026-08-14

## 1. 目标

用户可以通过自然语言修改已有通用 UI 的 Block 结构，例如插入指标区、删除筛选区、更新表格内容或调整分页顺序。该流程不重新生成整页，也不使用普通节点 `DesignPatch` 修改 DesignSpec 管理的结构。

## 2. 工作流

```text
CanvasSnapshot(designSpec + documentRevision)
  -> Intent Router: revise-ui-structure
  -> design.spec-patch.plan
  -> design.spec-patch.validate
  -> canvas.present-spec-patch
  -> Renderer 原子结构事务
  -> Canvas ACK(documentRevision + 1)
```

Pi RuntimeContext 只暴露 DesignSpec 是否存在及 Block 的 `id/kind/label` 摘要。领域 Tool 在结构规划阶段取得完整 DesignSpec，并限制模型只能返回协议允许的 Operation。

## 3. 协议

```ts
interface DesignSpecPatch {
  version: 1
  baseRevision: number
  artboardId: string
  summary: string
  operations: Array<
    | { kind: 'insert-block'; block: DesignBlock; beforeBlockId?: string; afterBlockId?: string }
    | { kind: 'update-block'; blockId: string; changes: Partial<DesignBlock> }
    | { kind: 'remove-block'; blockId: string }
    | { kind: 'move-block'; blockId: string; beforeBlockId?: string; afterBlockId?: string }
  >
}
```

新增 Block 只能使用 Catalog kind；`update-block` 不能修改 `id/kind`；单个 Operation 不能同时指定 `beforeBlockId` 与 `afterBlockId`；Patch 不能删除全部 Block，也不能产生重复 ID 或超过 24 个 Block。

## 4. 事务与冲突

Runtime 使用当前 Snapshot 执行一次纯函数预演并校验结果。Renderer 再次校验目标画板、`baseRevision`、Block ID 和结果 Spec，然后只重编新增、内容变化及布局受影响的 Block。未受影响 Block ID、普通手工节点和有效选择保持不变。

提交后 `DesignDocument.version` 精确增加一次，并通过 Observation 返回 `affectedBlockIds`、`removedBlockIds`、`affectedElementIds` 和新 DesignSpec。

当 Renderer Revision 高于 Patch 的 `baseRevision` 时，会以 Deliverable 携带的 `baseDesignSpec` 执行三方检查。并发修改未触碰当前 Operation 的目标 Block、插入 ID 或 before/after 锚点时，Patch 自动重放到最新 DesignSpec，并返回 `rebasedFromRevision / rebasedToRevision`。目标内容已变化、目标被删除、插入 ID 已存在或移动相对关系变化时明确返回冲突，不写入部分结果。

冲突 Observation 返回 `blockId / operationId / reason`，原因区分节点变化、节点删除、ID 碰撞、锚点变化、锚点删除和相对顺序变化。聊天时间线按 Block 展示冲突，默认选择“保留当前”；用户可逐项切换为“采用 AI”并提交。合并器从最新 DesignSpec 开始，只重放选择允许的 Operation；提交前再次校验当前 Revision，文档再次变化时拒绝提交。解决结果仍通过 `applyGenericUiStructure` 原子写入并保持未受影响节点 ID。

## 5. 修改边界

- Block 插入、删除、顺序和 Block 数据：使用 `DesignSpecPatch`。
- 普通 Text、Shape、Button、Image 的位置和样式：使用 `DesignPatch`。
- 业务组件 Props 和素材：使用 Component Pack 工作流。
- Page Shell 图片：使用 Page Shell Edit 工作流。

## 6. 验证

```bash
npm run test:design-spec-patch
npm run test:generic-ui-incremental
```

测试覆盖自然语言路由、协议白名单、Runtime 预演、Renderer 原子提交、插入和重排、未受影响 ID 稳定、安全自动重基、结构化冲突原因及节点级冲突合并。
