import type {
  CanvasWriteObservation,
  IncrementalCanvasDeliverable,
  IncrementalPageComponentDeliverable,
} from '../../ai/types'
import type { ChatArtboardTarget } from '../store/editor-store'
import { useEditorStore } from '../store/editor-store'

export function applyIncrementalCanvasDeliverable(
  target: ChatArtboardTarget,
  deliverable: IncrementalCanvasDeliverable,
): CanvasWriteObservation {
  return deliverable.kind === 'page-shell'
    ? applyIncrementalPageShell(target, deliverable)
    : applyIncrementalPageComponent(target, deliverable)
}

function applyIncrementalPageShell(
  target: ChatArtboardTarget,
  deliverable: Extract<IncrementalCanvasDeliverable, { kind: 'page-shell' }>,
): CanvasWriteObservation {
  if (deliverable.target?.artboardId && deliverable.target.artboardId !== target.artboardId) {
    return failed('CANVAS_DELIVERY_TARGET_MISMATCH', '页面外壳的目标画板与当前任务不一致。')
  }
  const shellElementId = useEditorStore.getState().applyIncrementalPageShell(
    target,
    deliverable.blueprint,
    deliverable.pageShell,
  )
  const document = useEditorStore.getState().document
  const shells = document?.elements.filter((element) => (
    element.artboardId === target.artboardId && element.designRole === 'page-shell'
  )) ?? []
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
      elementCount: document?.elements.filter((element) => element.artboardId === target.artboardId).length,
      componentCount: Object.values(document?.componentInstances ?? {}).filter((instance) => (
        instance.artboardId === target.artboardId
      )).length,
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
  const existingRoot = before?.elements.find((element) => (
    element.artboardId === target.artboardId &&
    element.componentBinding?.pageSectionId === pageSectionId &&
    element.componentBinding.renderMode === 'root'
  ))
  const replaceInstanceId = existingRoot?.componentBinding?.instanceId
  const rootElementId = useEditorStore.getState().applyComponentDesign(
    { ...target, created: false, mode: 'append-section' },
    deliverable.component.componentDesign,
    deliverable.component.images,
    deliverable.component.visualShell,
    replaceInstanceId,
    pageSectionId,
  )
  const artboard = useEditorStore.getState().document?.artboards.find((item) => (
    item.id === target.artboardId
  ))
  if (rootElementId && artboard && deliverable.component.bounds) {
    useEditorStore.getState().updateElement(rootElementId, {
      x: artboard.x + deliverable.component.bounds.x,
      y: artboard.y + deliverable.component.bounds.y,
      width: deliverable.component.bounds.width,
      height: deliverable.component.bounds.height,
    })
  }
  const document = useEditorStore.getState().document
  const root = document?.elements.find((element) => (
    element.id === rootElementId &&
    element.artboardId === target.artboardId &&
    element.componentBinding?.pageSectionId === pageSectionId &&
    element.componentBinding.renderMode === 'root'
  ))
  const instanceId = root?.componentBinding?.instanceId
  const instance = instanceId ? document?.componentInstances?.[instanceId] : undefined
  if (!rootElementId || !root || !instanceId || !instance) {
    return failed('CANVAS_DELIVERY_POSTCONDITION_FAILED', '页面组件未完整写入目标画板。')
  }
  const elementCount = document?.elements.filter((element) => (
    element.componentBinding?.instanceId === instanceId
  )).length ?? 0
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
      componentCount: Object.values(document?.componentInstances ?? {}).filter((item) => (
        item.artboardId === target.artboardId
      )).length,
      hasPageShell: document?.elements.some((element) => (
        element.artboardId === target.artboardId && element.designRole === 'page-shell'
      )),
      elements: document?.elements.filter((element) => (
        element.componentBinding?.instanceId === instanceId
      )).map(summarizeElement),
    },
  }
}

function failed(errorCode: string, summary: string): CanvasWriteObservation {
  return { status: 'failed', errorCode, summary }
}

function summarizeElement(element: NonNullable<ReturnType<typeof useEditorStore.getState>['document']>['elements'][number]) {
  return {
    id: element.id,
    type: element.type,
    name: element.name,
    designRole: element.designRole,
    parentId: element.parentId,
    componentName: element.componentBinding?.componentName,
    instanceId: element.componentBinding?.instanceId,
    pageSectionId: element.componentBinding?.pageSectionId,
    renderMode: element.componentBinding?.renderMode,
    bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
  }
}
