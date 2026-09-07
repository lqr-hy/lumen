import type {
  CanvasWriteObservation,
  IncrementalCanvasDeliverable,
  IncrementalPageComponentDeliverable,
} from '../../ai/types'
import type { ChatArtboardTarget } from '../store/editor-store'
import { useEditorStore } from '../store/editor-store'
import { appendMutationLedger, findMutationObservation } from './mutation-ledger'
import { rebaseDesignSpecPatch } from './design-spec-patch'
import { computeSelectionTargetHash } from './selection-scope'
import { prepareRuntimeSceneForArtboard } from '../scene/runtime-scene'

export function applyIncrementalCanvasDeliverable(
  target: ChatArtboardTarget,
  deliverable: IncrementalCanvasDeliverable,
): CanvasWriteObservation {
  const previous = findMutationObservation(useEditorStore.getState().mutationLedger, deliverable.id)
  if (previous) return { ...previous, summary: `${previous.summary}（重复交付已忽略）` }
  let observation: CanvasWriteObservation
  if (deliverable.kind === 'page-shell') {
    observation = applyIncrementalPageShell(target, deliverable)
  } else if (deliverable.kind === 'page-component') {
    observation = applyIncrementalPageComponent(target, deliverable)
  } else if (deliverable.kind === 'image' || deliverable.kind === 'asset-set') {
    observation = applyImages(target, deliverable)
  } else if (deliverable.kind === 'component') {
    observation = applyComponent(target, deliverable)
  } else if (deliverable.kind === 'component-slot') {
    observation = applyComponentSlot(deliverable)
  } else if (deliverable.kind === 'component-slot-batch') {
    observation = applyComponentSlotBatch(deliverable)
  } else if (deliverable.kind === 'page-shell-edit') {
    observation = applyPageShellEdit(deliverable)
  } else if (deliverable.kind === 'generic-ui') {
    observation = applyGenericUi(target, deliverable)
  } else if (deliverable.kind === 'generic-ui-runtime') {
    observation = applyGenericUiRuntime(target, deliverable)
  } else if (deliverable.kind === 'generic-ui-section') {
    observation = applyGenericUiSection(target, deliverable)
  } else if (deliverable.kind === 'generic-ui-finalize') {
    observation = finalizeGenericUi(target, deliverable)
  } else if (deliverable.kind === 'design-spec-patch') {
    observation = applyDesignSpecStructurePatch(target, deliverable)
  } else if (deliverable.kind === 'design-patch') {
    observation = applyDesignPatch(deliverable)
  } else {
    observation = finalizePage(target, deliverable)
  }
  if (observation.status === 'success') {
    const state = useEditorStore.getState()
    state.setMutationLedger(appendMutationLedger(state.mutationLedger, deliverable, observation))
  }
  return observation
}

function applyGenericUiRuntime(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'generic-ui-runtime' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', 'Runtime UI 的目标画板与当前任务不一致。')
  }
  if (
    !deliverable.sceneGraph?.nodes?.length ||
    deliverable.expectedNodeCount !== deliverable.sceneGraph.nodes.length
  ) {
    return failed('CANVAS_RUNTIME_SCENE_COUNT_MISMATCH', 'Runtime Scene 节点数量与交付契约不一致。')
  }
  const before = useEditorStore.getState()
  const artboard = before.document?.artboards.find((item) => item.id === target.artboardId)
  if (!artboard) return failed('CANVAS_ARTBOARD_MISSING', 'Runtime UI 的目标画板不存在。')
  try {
    const prepared = prepareRuntimeSceneForArtboard(deliverable.sceneGraph, artboard)
    const result = useEditorStore.getState().applyGenericUiRuntimeScene(target, prepared)
    const document = useEditorStore.getState().document
    const nextArtboard = document?.artboards.find((item) => item.id === target.artboardId)
    const elements =
      document?.elements.filter((element) => element.artboardId === target.artboardId) ?? []
    const expectedIds = new Set(prepared.nodes.map((node) => node.id))
    if (
      !result ||
      result.elementCount !== deliverable.expectedNodeCount ||
      elements.length !== deliverable.expectedNodeCount ||
      elements.some((element) => !expectedIds.has(element.id)) ||
      !elements.some((element) => element.id === result.rootId) ||
      nextArtboard?.runtimeScene?.graphId !== prepared.id ||
      nextArtboard?.designSpec ||
      nextArtboard?.genericUiSchema ||
      document?.version !== (before.document?.version ?? 0) + 1
    ) {
      return failed(
        'CANVAS_RUNTIME_SCENE_POSTCONDITION_FAILED',
        'Runtime Scene 没有完整写入目标画板。',
      )
    }
    return {
      status: 'success',
      summary: `Runtime UI 已写入目标画板，共 ${result.elementCount} 个原生节点，其中 ${result.editableNodeCount} 个内容节点可直接编辑。`,
      data: {
        artboardId: target.artboardId,
        rootElementId: result.rootId,
        elementCount: result.elementCount,
        editableNodeCount: result.editableNodeCount,
        sourceAdapterId: result.sourceAdapterId,
        replacedArtboard: true,
        artboardWidth: prepared.surface.width,
        artboardHeight: prepared.surface.height,
        documentRevision: result.documentRevision,
        affectedElementIds: elements.map((element) => element.id),
        elements: elements.slice(0, 80).map((element) => ({
          id: element.id,
          type: element.type,
          name: element.name,
          designRole: element.designRole,
          designBlockId: element.designBlockId,
          parentId: element.parentId,
          bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
        })),
      },
    }
  } catch (error) {
    return failed(
      'CANVAS_RUNTIME_SCENE_INVALID',
      error instanceof Error
        ? `Runtime Scene 无法提交：${error.message}`
        : 'Runtime Scene 无法提交。',
    )
  }
}

function applyDesignSpecStructurePatch(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'design-spec-patch' }>,
): CanvasWriteObservation {
  const before = useEditorStore.getState()
  const document = before.document
  const artboard = document?.artboards.find((item) => item.id === target.artboardId)
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed(
      'CANVAS_DELIVERY_TARGET_MISMATCH',
      'DesignSpec Patch 的目标画板与当前任务不一致。',
    )
  }
  if (!document || !artboard?.designSpec) {
    return failed('CANVAS_DESIGN_SPEC_MISSING', '目标画板没有可修改的 DesignSpec。')
  }
  if (deliverable.patch.artboardId !== target.artboardId) {
    return failed(
      'CANVAS_DESIGN_SPEC_PATCH_TARGET_MISMATCH',
      'DesignSpec Patch 的 artboardId 不一致。',
    )
  }
  let effectivePatch = deliverable.patch
  let effectiveSpec = deliverable.nextDesignSpec
  let rebaseMeta: { rebasedFromRevision: number; rebasedToRevision: number } | undefined
  if (deliverable.patch.baseRevision !== document.version) {
    const rebased = rebaseDesignSpecPatch(
      deliverable.baseDesignSpec,
      artboard.designSpec,
      deliverable.patch,
      document.version,
    )
    if (!rebased.ok) {
      return failed(
        'CANVAS_DESIGN_SPEC_REVISION_CONFLICT',
        `DesignSpec 并发修改冲突：${rebased.conflictingBlockIds.join('、')}。`,
        {
          artboardId: target.artboardId,
          documentRevision: document.version,
          designSpecConflicts: rebased.conflicts,
          designSpecConflictResolution: {
            artboardId: target.artboardId,
            currentRevision: document.version,
            patch: deliverable.patch,
            conflicts: rebased.conflicts,
          },
        },
      )
    }
    effectivePatch = rebased.patch
    effectiveSpec = rebased.nextDesignSpec
    rebaseMeta = {
      rebasedFromRevision: rebased.rebasedFromRevision,
      rebasedToRevision: rebased.rebasedToRevision,
    }
  }
  const nextBlockIds = effectiveSpec.blocks.map((block) => block.id)
  if (
    !nextBlockIds.length ||
    nextBlockIds.length > 24 ||
    new Set(nextBlockIds).size !== nextBlockIds.length
  ) {
    return failed('CANVAS_DESIGN_SPEC_PATCH_INVALID', 'DesignSpec Patch 结果包含无效或重复 Block。')
  }
  const previousBlockIds = [
    ...new Set(
      document.elements
        .filter((element) => element.artboardId === target.artboardId && element.designBlockId)
        .map((element) => element.designBlockId!),
    ),
  ]
  const previousElementIds = new Map(
    previousBlockIds.map((blockId) => [
      blockId,
      document.elements
        .filter((element) => element.designBlockId === blockId)
        .map((element) => element.id)
        .sort(),
    ]),
  )
  const result = useEditorStore
    .getState()
    .applyGenericUiStructure(target, effectiveSpec, effectivePatch.baseRevision)
  const nextDocument = useEditorStore.getState().document
  const nextArtboard = nextDocument?.artboards.find((item) => item.id === target.artboardId)
  const nextElements =
    nextDocument?.elements.filter((element) => element.artboardId === target.artboardId) ?? []
  const unaffectedStable = Array.from(previousElementIds)
    .filter(
      ([blockId]) =>
        !result?.affectedBlockIds.includes(blockId) && !result?.removedBlockIds.includes(blockId),
    )
    .every(([blockId, ids]) => {
      const current = nextElements
        .filter((element) => element.designBlockId === blockId)
        .map((element) => element.id)
        .sort()
      return ids.length === current.length && ids.every((id, index) => id === current[index])
    })
  if (
    !result ||
    nextDocument?.version !== effectivePatch.baseRevision + 1 ||
    JSON.stringify(nextArtboard?.designSpec) !== JSON.stringify(effectiveSpec) ||
    !nextElements.some((element) => element.id === result.rootId) ||
    !unaffectedStable ||
    result.affectedBlockIds.some(
      (blockId) =>
        !nextElements.some(
          (element) => element.designBlockId === blockId && element.designRole === 'design-block',
        ),
    ) ||
    result.removedBlockIds.some((blockId) =>
      nextElements.some((element) => element.designBlockId === blockId),
    )
  ) {
    return failed(
      'CANVAS_DESIGN_SPEC_PATCH_POSTCONDITION_FAILED',
      'DesignSpec 结构修改没有完整提交。',
    )
  }
  return {
    status: 'success',
    summary: `DesignSpec 结构修改已提交：更新 ${result.affectedBlockIds.length} 个 Block，移除 ${result.removedBlockIds.length} 个 Block${rebaseMeta ? `，已从 Revision ${rebaseMeta.rebasedFromRevision} 自动重基到 ${rebaseMeta.rebasedToRevision}` : ''}。`,
    data: {
      artboardId: target.artboardId,
      rootElementId: result.rootId,
      elementCount: nextElements.length,
      documentRevision: nextDocument.version,
      affectedElementIds: result.affectedElementIds,
      affectedBlockIds: result.affectedBlockIds,
      removedBlockIds: result.removedBlockIds,
      deliveredSectionCount: nextBlockIds.length,
      designSpec: effectiveSpec,
      ...rebaseMeta,
    },
  }
}

function applyGenericUiSection(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'generic-ui-section' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '通用 UI Section 的目标画板与当前任务不一致。')
  }
  const sectionBlock = deliverable.uiSchema.blocks[deliverable.section.index]
  if (!sectionBlock || sectionBlock.id !== deliverable.section.id) {
    return failed('CANVAS_GENERIC_UI_SECTION_MISSING', '完整 DesignSpec 不包含当前 Section。')
  }
  if (!deliverable.deliveredBlockIds.includes(deliverable.section.id)) {
    return failed('CANVAS_GENERIC_UI_SECTION_NOT_DELIVERED', '当前 Section 不在成功交付列表中。')
  }
  const before = useEditorStore.getState()
  const previousRevision = before.document?.version
  const previousRootId = before.document?.elements.find(
    (element) =>
      element.artboardId === target.artboardId &&
      element.designRole === 'container' &&
      !element.parentId,
  )?.id
  const previousBlockElementIds = new Map(
    deliverable.deliveredBlockIds.map((id) => [
      id,
      before.document?.elements
        .filter(
          (element) => element.artboardId === target.artboardId && element.designBlockId === id,
        )
        .map((element) => element.id)
        .sort() ?? [],
    ]),
  )
  const patch = useEditorStore
    .getState()
    .applyGenericUiBlock(
      target,
      deliverable.uiSchema,
      deliverable.section.index,
      deliverable.deliveredBlockIds,
    )
  const document = useEditorStore.getState().document
  const artboard = document?.artboards.find((item) => item.id === target.artboardId)
  const elements =
    document?.elements.filter((element) => element.artboardId === target.artboardId) ?? []
  const actualBlockIds = artboard?.designSpec?.blocks.map((block) => block.id) ?? []
  const currentBlockElements = elements.filter(
    (element) => element.designBlockId === deliverable.section.id,
  )
  const previousBlocksStable = Array.from(previousBlockElementIds)
    .filter(([blockId]) => !patch?.affectedBlockIds.includes(blockId))
    .every(([blockId, ids]) => {
      const currentIds = elements
        .filter((element) => element.designBlockId === blockId)
        .map((element) => element.id)
        .sort()
      return (
        ids.length > 0 &&
        ids.length === currentIds.length &&
        ids.every((id, index) => id === currentIds[index])
      )
    })
  const affectedBlocksPresent = patch?.affectedBlockIds.every((blockId) =>
    elements.some(
      (element) => element.designBlockId === blockId && element.designRole === 'design-block',
    ),
  )
  const removedBlocksAbsent = patch?.removedBlockIds.every((blockId) =>
    elements.every((element) => element.designBlockId !== blockId),
  )
  if (
    !patch ||
    !elements.some((element) => element.id === patch.rootId) ||
    !currentBlockElements.some(
      (element) => element.id === patch.blockRootId && element.designRole === 'design-block',
    ) ||
    currentBlockElements.some((element) => element.designBlockId !== deliverable.section.id) ||
    deliverable.deliveredBlockIds.length !== actualBlockIds.length ||
    deliverable.deliveredBlockIds.some((id, index) => actualBlockIds[index] !== id) ||
    !previousBlocksStable ||
    !affectedBlocksPresent ||
    !removedBlocksAbsent ||
    (previousRootId && previousRootId !== patch.rootId) ||
    document?.version !== (previousRevision ?? 0) + 1
  ) {
    return failed(
      'CANVAS_GENERIC_UI_SECTION_POSTCONDITION_FAILED',
      `${deliverable.section.label} 未完整写入目标画板。`,
    )
  }
  return {
    status: 'success',
    summary: `${deliverable.section.label} 已通过结构 Patch 写入，更新 ${patch.affectedBlockIds.length} 个 Block，移除 ${patch.removedBlockIds.length} 个 Block。`,
    data: {
      artboardId: target.artboardId,
      rootElementId: patch.rootId,
      blockRootElementId: patch.blockRootId,
      affectedElementIds: patch.affectedElementIds,
      affectedBlockIds: patch.affectedBlockIds,
      removedBlockIds: patch.removedBlockIds,
      elementCount: elements.length,
      documentRevision: document?.version,
      sectionId: deliverable.section.id,
      sectionIndex: deliverable.section.index,
      deliveredSectionCount: actualBlockIds.length,
    },
  }
}

function finalizeGenericUi(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'generic-ui-finalize' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '通用 UI 终态目标画板与当前任务不一致。')
  }
  const document = useEditorStore.getState().document
  const artboard = document?.artboards.find((item) => item.id === target.artboardId)
  const elements =
    document?.elements.filter((element) => element.artboardId === target.artboardId) ?? []
  const actualBlockIds = artboard?.designSpec?.blocks.map((block) => block.id) ?? []
  const root = elements.find(
    (element) =>
      element.type === 'section' && !element.parentId && element.designRole === 'container',
  )
  if (
    !root ||
    !deliverable.expectedBlockIds.length ||
    deliverable.expectedBlockIds.length !== actualBlockIds.length ||
    deliverable.expectedBlockIds.some((id, index) => actualBlockIds[index] !== id)
  ) {
    return failed('CANVAS_GENERIC_UI_FINALIZE_FAILED', '通用 UI 终态与已成功 Section 不一致。')
  }
  return {
    status: 'success',
    summary: `通用 UI 终态校验通过：${actualBlockIds.length} 个 Section，${elements.length} 个节点。`,
    data: {
      artboardId: target.artboardId,
      rootElementId: root.id,
      elementCount: elements.length,
      documentRevision: document?.version,
      deliveredSectionCount: actualBlockIds.length,
      failedSectionCount: deliverable.failedSectionIndexes.length,
    },
  }
}

function applyDesignPatch(
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'design-patch' }>,
): CanvasWriteObservation {
  const result = useEditorStore.getState().applyDesignPatch(deliverable.patch, deliverable.images)
  if (!result.ok) return failed(result.errorCode, result.message)
  const affected = result.affectedElementIds.filter((id) =>
    result.document.elements.some((element) => element.id === id),
  )
  return {
    status: 'success',
    summary: `已原子应用 ${deliverable.patch.operations.length} 个局部修改。`,
    data: {
      artboardId: deliverable.patch.artboardId,
      rootElementId: affected[0],
      elementCount: result.document.elements.filter(
        (element) => element.artboardId === deliverable.patch.artboardId,
      ).length,
      documentRevision: result.document.version,
      affectedElementIds: result.affectedElementIds,
      qualityReport: result.qualityReport,
    },
  }
}

function applyGenericUi(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'generic-ui' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '通用 UI 的目标画板与当前任务不一致。')
  }
  const rootElementId = useEditorStore.getState().applyGenericUiDesign(target, deliverable.uiSchema)
  const document = useEditorStore.getState().document
  const elements =
    document?.elements.filter((element) => element.artboardId === target.artboardId) ?? []
  if (
    !rootElementId ||
    !elements.some((element) => element.id === rootElementId) ||
    elements.length < 10
  ) {
    return failed(
      'CANVAS_GENERIC_UI_POSTCONDITION_FAILED',
      '通用 UI 原生节点没有完整写入目标画板。',
    )
  }
  return {
    status: 'success',
    summary: `通用 UI 已写入目标画板，共 ${elements.length} 个可编辑节点。`,
    data: { artboardId: target.artboardId, rootElementId, elementCount: elements.length },
  }
}

function applyImages(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'image' | 'asset-set' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '图片素材的目标画板与当前任务不一致。')
  }
  const elementIds = deliverable.images.map((image) =>
    useEditorStore.getState().applyGeneratedImage(target, image),
  )
  const document = useEditorStore.getState().document
  const validIds = elementIds.filter((id): id is string => Boolean(id))
  if (
    validIds.length !== deliverable.images.length ||
    validIds.some(
      (id) =>
        !document?.elements.some(
          (element) => element.id === id && element.artboardId === target.artboardId,
        ),
    )
  ) {
    return failed('CANVAS_IMAGE_POSTCONDITION_FAILED', '图片素材未完整写入目标画板。')
  }
  return {
    status: 'success',
    summary: `${validIds.length} 个图片素材已写入目标画板。`,
    data: {
      artboardId: target.artboardId,
      rootElementId: validIds[0],
      elementCount: document?.elements.filter((element) => element.artboardId === target.artboardId)
        .length,
    },
  }
}

function applyComponent(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'component' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '组件的目标画板与当前任务不一致。')
  }
  const replaceInstanceId =
    deliverable.editScope?.type === 'component-instance'
      ? deliverable.editScope.instanceId
      : undefined
  const rootElementId = useEditorStore
    .getState()
    .applyComponentDesign(
      target,
      deliverable.componentDesign,
      deliverable.images,
      replaceInstanceId,
    )
  const document = useEditorStore.getState().document
  const root = document?.elements.find(
    (element) =>
      element.id === rootElementId &&
      element.artboardId === target.artboardId &&
      element.componentBinding?.renderMode === 'root',
  )
  const instanceId = root?.componentBinding?.instanceId
  if (!rootElementId || !root || !instanceId || !document?.componentInstances?.[instanceId]) {
    return failed('CANVAS_COMPONENT_POSTCONDITION_FAILED', '组件未完整写入目标画板。')
  }
  return {
    status: 'success',
    summary: `${deliverable.componentDesign.componentName} 已写入目标画板。`,
    data: {
      artboardId: target.artboardId,
      rootElementId,
      instanceId,
      elementCount: document.elements.filter(
        (element) => element.componentBinding?.instanceId === instanceId,
      ).length,
      componentCount: Object.values(document.componentInstances ?? {}).filter(
        (instance) => instance.artboardId === target.artboardId,
      ).length,
    },
  }
}

function applyComponentSlot(
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'component-slot' }>,
): CanvasWriteObservation {
  if (deliverable.editScope.type !== 'component-region') {
    return failed('CANVAS_COMPONENT_SLOT_SCOPE_INVALID', '组件素材缺少有效的局部编辑范围。')
  }
  const scope = deliverable.editScope
  const applied = useEditorStore
    .getState()
    .applyComponentSlotImage(scope.elementId, deliverable.image)
  const element = useEditorStore
    .getState()
    .document?.elements.find((item) => item.id === scope.elementId && item.type === 'image')
  if (!applied || !element) {
    return failed('CANVAS_COMPONENT_SLOT_POSTCONDITION_FAILED', '组件素材没有替换原图片图层。')
  }
  return {
    status: 'success',
    summary: `${scope.slotId} 素材已替换。`,
    data: { artboardId: element.artboardId, rootElementId: element.id, elementCount: 1 },
  }
}

function applyComponentSlotBatch(
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'component-slot-batch' }>,
): CanvasWriteObservation {
  const scope = deliverable.editScope
  if (
    scope.type !== 'component-region-batch' ||
    !scope.targets.length ||
    !deliverable.items.length
  ) {
    return failed('CANVAS_COMPONENT_SLOT_BATCH_SCOPE_INVALID', '批量组件素材缺少有效目标。')
  }
  const document = useEditorStore.getState().document
  if (!document || document.version !== scope.documentRevision) {
    return failed('DOCUMENT_REVISION_CONFLICT', '画布已变化，请重新选择批量素材后执行。')
  }
  const currentHash = computeSelectionTargetHash(document, scope.targetElementIds)
  if (!currentHash || currentHash !== scope.targetHash) {
    return failed('SELECTION_TARGET_CONFLICT', '批量素材目标已经变化，请重新选择后执行。')
  }
  const scopeByElementId = new Map(scope.targets.map((target) => [target.elementId, target]))
  if (
    deliverable.items.length !== scope.targets.length ||
    deliverable.items.some(
      (item) => scopeByElementId.get(item.editScope.elementId)?.slotId !== item.editScope.slotId,
    )
  ) {
    return failed('CANVAS_COMPONENT_SLOT_BATCH_RESULT_MISMATCH', '批量生成结果与冻结目标不一致。')
  }
  const result = useEditorStore.getState().applyComponentSlotImages(
    deliverable.items.map((item) => ({
      scope: item.editScope,
      image: item.image,
    })),
  )
  if (!result.ok || result.affectedElementIds.length !== scope.targets.length) {
    return failed(
      'CANVAS_COMPONENT_SLOT_BATCH_POSTCONDITION_FAILED',
      '批量组件素材未能原子写入画布。',
    )
  }
  const nextDocument = useEditorStore.getState().document
  return {
    status: 'success',
    summary: `${result.affectedElementIds.length} 个组件素材已批量替换。`,
    data: {
      artboardId: scope.artboardId,
      rootElementId: result.affectedElementIds[0],
      elementCount: result.affectedElementIds.length,
      documentRevision: nextDocument?.version,
      affectedElementIds: result.affectedElementIds,
    },
  }
}

function applyPageShellEdit(
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'page-shell-edit' }>,
): CanvasWriteObservation {
  if (deliverable.editScope.type !== 'page-shell') {
    return failed('CANVAS_PAGE_SHELL_SCOPE_INVALID', '页面外壳缺少有效的局部编辑范围。')
  }
  const scope = deliverable.editScope
  const applied = useEditorStore.getState().applyPageShellImage(scope.elementId, deliverable.image)
  const element = useEditorStore
    .getState()
    .document?.elements.find(
      (item) => item.id === scope.elementId && item.designRole === 'page-shell',
    )
  if (!applied || !element) {
    return failed('CANVAS_PAGE_SHELL_POSTCONDITION_FAILED', '页面视觉外壳没有原位替换。')
  }
  return {
    status: 'success',
    summary: '页面视觉外壳已原位替换。',
    data: {
      artboardId: element.artboardId,
      shellElementId: element.id,
      hasPageShell: true,
      elementCount: 1,
    },
  }
}

function finalizePage(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'page-finalize' }>,
): CanvasWriteObservation {
  const document = useEditorStore.getState().document
  const shells =
    document?.elements.filter(
      (element) => element.artboardId === target.artboardId && element.designRole === 'page-shell',
    ) ?? []
  const roots =
    document?.elements.filter(
      (element) =>
        element.artboardId === target.artboardId &&
        element.componentBinding?.renderMode === 'root' &&
        element.componentBinding.pageSectionId,
    ) ?? []
  const sectionIds = new Set(roots.map((element) => element.componentBinding!.pageSectionId!))
  const artboard = document?.artboards.find((item) => item.id === target.artboardId)
  const shell = shells[0]
  const shellVisible = Boolean(
    shell &&
    artboard &&
    shell.zIndex >= 0 &&
    shell.x <= artboard.x &&
    shell.y <= artboard.y &&
    shell.width >= artboard.width &&
    shell.height >= artboard.height &&
    roots.every((root) => root.zIndex > shell.zIndex),
  )
  const expectedSectionIds = new Set(deliverable.expectedPageSectionIds ?? [])
  const expectedSections = (deliverable.blueprint?.sections ?? []).filter(
    (section) => section.kind === 'component-instance' && expectedSectionIds.has(section.id),
  )
  const componentNamesMatch = expectedSections.every((section) => {
    if (section.kind !== 'component-instance') return true
    const root = roots.find((item) => item.componentBinding?.pageSectionId === section.id)
    return root?.componentBinding?.componentName === section.component?.componentName
  })
  if (
    shells.length !== 1 ||
    !shellVisible ||
    !componentNamesMatch ||
    deliverable.expectedComponentCount < 1 ||
    expectedSectionIds.size !== deliverable.expectedComponentCount ||
    [...expectedSectionIds].some((sectionId) => !sectionIds.has(sectionId))
  ) {
    const missingSectionIds = [...expectedSectionIds].filter(
      (sectionId) => !sectionIds.has(sectionId),
    )
    return failed(
      'CANVAS_PAGE_FINALIZE_FAILED',
      `页面外壳或成功组件没有完整写入目标画板${missingSectionIds.length ? `；缺失 Section：${missingSectionIds.join('、')}` : ''}。`,
      {
        artboardId: target.artboardId,
        hasPageShell: shellVisible,
        componentCount: sectionIds.size,
      },
    )
  }
  return {
    status: 'success',
    summary: '完整页面已通过画布交付校验。',
    data: {
      artboardId: target.artboardId,
      shellElementId: shells[0].id,
      hasPageShell: true,
      componentCount: sectionIds.size,
      elementCount: document?.elements.filter((element) => element.artboardId === target.artboardId)
        .length,
    },
  }
}

function applyIncrementalPageShell(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'page-shell' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '页面外壳的目标画板与当前任务不一致。')
  }
  const shellElementId = useEditorStore
    .getState()
    .applyIncrementalPageShell(target, deliverable.blueprint, deliverable.pageShell)
  const document = useEditorStore.getState().document
  const shells =
    document?.elements.filter(
      (element) => element.artboardId === target.artboardId && element.designRole === 'page-shell',
    ) ?? []
  const shell = shells.find((element) => element.id === shellElementId)
  if (!shellElementId || !shell || shells.length !== 1) {
    return failed('CANVAS_SHELL_POSTCONDITION_FAILED', '页面外壳未唯一写入目标画板。')
  }
  return {
    status: 'success',
    summary: '页面视觉外壳已增量写入目标画板。',
    data: {
      artboardId: target.artboardId,
      shellElementId,
      hasPageShell: true,
      elementCount: document?.elements.filter((element) => element.artboardId === target.artboardId)
        .length,
      componentCount: Object.values(document?.componentInstances ?? {}).filter(
        (instance) => instance.artboardId === target.artboardId,
      ).length,
      elements: [summarizeElement(shell)],
    },
  }
}

export function applyIncrementalPageComponent(
  target: ChatArtboardTarget,
  deliverable: IncrementalPageComponentDeliverable,
): CanvasWriteObservation {
  if (deliverable.kind !== 'page-component') {
    return failed('CANVAS_DELIVERY_KIND_UNSUPPORTED', '不支持的增量交付类型。')
  }
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '增量组件的目标画板与当前任务不一致。')
  }
  const pageSectionId = deliverable.component.pageSectionId
  if (!pageSectionId) {
    return failed('CANVAS_DELIVERY_SECTION_MISSING', '增量页面组件缺少 pageSectionId。')
  }
  const before = useEditorStore.getState().document
  const existingRoot = before?.elements.find(
    (element) =>
      element.artboardId === target.artboardId &&
      element.componentBinding?.pageSectionId === pageSectionId &&
      element.componentBinding.renderMode === 'root',
  )
  const replaceInstanceId = existingRoot?.componentBinding?.instanceId
  const rootElementId = useEditorStore
    .getState()
    .applyComponentDesign(
      { ...target, created: false, mode: 'append-section' },
      deliverable.component.componentDesign,
      deliverable.component.images,
      replaceInstanceId,
      pageSectionId,
    )
  const artboard = useEditorStore
    .getState()
    .document?.artboards.find((item) => item.id === target.artboardId)
  if (rootElementId && artboard && deliverable.component.bounds) {
    const state = useEditorStore.getState()
    const sourceRoot = state.document?.elements.find((element) => element.id === rootElementId)
    const instanceId = sourceRoot?.componentBinding?.instanceId
    if (sourceRoot && instanceId) {
      const targetBounds = {
        x: artboard.x + deliverable.component.bounds.x,
        y: artboard.y + deliverable.component.bounds.y,
        width: deliverable.component.bounds.width,
        height: deliverable.component.bounds.height,
      }
      const scaleX = targetBounds.width / sourceRoot.width
      const scaleY = targetBounds.height / sourceRoot.height
      const patches = (state.document?.elements ?? [])
        .filter((element) => element.componentBinding?.instanceId === instanceId)
        .map((element) => ({
          id: element.id,
          patch:
            element.id === sourceRoot.id
              ? targetBounds
              : {
                  x: targetBounds.x + (element.x - sourceRoot.x) * scaleX,
                  y: targetBounds.y + (element.y - sourceRoot.y) * scaleY,
                  width: Math.max(1, element.width * scaleX),
                  height: Math.max(1, element.height * scaleY),
                },
        }))
      state.updateElements(patches)
      const pageShell = state.document?.elements.find(
        (element) => element.artboardId === artboard.id && element.designRole === 'page-shell',
      )
      const sectionBottom = targetBounds.y - artboard.y + targetBounds.height
      state.updateArtboard(artboard.id, {
        // Variant 必须保持源画板宽度；page-shell 可能使用模型默认的 375px，不能反向改窄画板。
        width:
          target.mode === 'duplicate-variant'
            ? artboard.width
            : (pageShell?.width ?? artboard.width),
        height: Math.max(pageShell?.height ?? artboard.height, sectionBottom),
        autoHeight: true,
      })
    }
  }
  const document = useEditorStore.getState().document
  const root = document?.elements.find(
    (element) =>
      element.id === rootElementId &&
      element.artboardId === target.artboardId &&
      element.componentBinding?.pageSectionId === pageSectionId &&
      element.componentBinding.renderMode === 'root',
  )
  const instanceId = root?.componentBinding?.instanceId
  const instance = instanceId ? document?.componentInstances?.[instanceId] : undefined
  if (!rootElementId || !root || !instanceId || !instance) {
    return failed('CANVAS_DELIVERY_POSTCONDITION_FAILED', '页面组件未完整写入目标画板。')
  }
  const elementCount =
    document?.elements.filter((element) => element.componentBinding?.instanceId === instanceId)
      .length ?? 0
  if (elementCount < 1) {
    return failed('CANVAS_DELIVERY_EMPTY_INSTANCE', '页面组件实例没有可编辑元素。')
  }
  return {
    status: 'success',
    summary: `${deliverable.component.componentDesign.componentName} 已增量写入目标画板。`,
    data: {
      artboardId: target.artboardId,
      rootElementId,
      instanceId,
      pageSectionId,
      elementCount,
      componentCount: Object.values(document?.componentInstances ?? {}).filter(
        (item) => item.artboardId === target.artboardId,
      ).length,
      hasPageShell: document?.elements.some(
        (element) =>
          element.artboardId === target.artboardId && element.designRole === 'page-shell',
      ),
      elements: document?.elements
        .filter((element) => element.componentBinding?.instanceId === instanceId)
        .map(summarizeElement),
    },
  }
}

function failed(
  errorCode: string,
  summary: string,
  data?: CanvasWriteObservation['data'],
): CanvasWriteObservation {
  return { status: 'failed', errorCode, summary, data }
}

function summarizeElement(
  element: NonNullable<ReturnType<typeof useEditorStore.getState>['document']>['elements'][number],
) {
  return {
    id: element.id,
    type: element.type,
    name: element.name,
    designRole: element.designRole,
    designBlockId: element.designBlockId,
    parentId: element.parentId,
    componentName: element.componentBinding?.componentName,
    instanceId: element.componentBinding?.instanceId,
    pageSectionId: element.componentBinding?.pageSectionId,
    renderMode: element.componentBinding?.renderMode,
    componentImageBinding: Boolean(element.componentBinding?.bindings.image),
    bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
  }
}
