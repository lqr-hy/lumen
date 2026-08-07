import type { ComponentEditScope } from '../../ai/types'
import type { DesignDocument, DesignElement } from '../types'

export function isComponentRootElement(element?: DesignElement): boolean {
  return element?.componentBinding?.renderMode === 'root'
}

export function canRegenerateComponentSlot(element?: DesignElement): boolean {
  return Boolean(
    element?.type === 'image' &&
    element.componentBinding?.slotId &&
    element.componentBinding.bindings.image,
  )
}

export function createComponentSlotRegenerationText(element: DesignElement): string {
  const regionName = element.componentBinding?.regionId || element.name || '图片'
  return `仅重新生成选中的 ${regionName} 素材`
}

export function createComponentEditScope(
  document: DesignDocument,
  selectedElementIds: string[],
): ComponentEditScope | undefined {
  if (selectedElementIds.length !== 1) return undefined
  const element = document.elements.find((item) => item.id === selectedElementIds[0])
  if (element?.designRole === 'page-shell' && element.type === 'image' && element.artboardId) {
    return {
      type: 'page-shell',
      elementId: element.id,
      artboardId: element.artboardId,
      targetSize: { width: element.width, height: element.height },
      currentImage: element.src,
    }
  }
  const binding = element?.componentBinding
  if (!element || !binding) {
    return undefined
  }
  if (element.type !== 'image' || !binding.slotId || !binding.bindings.image) {
    return {
      type: 'component-instance',
      elementId: binding.rootElementId,
      instanceId: binding.instanceId,
      componentName: binding.componentName,
      profile: binding.profile,
      pageSectionId: binding.pageSectionId,
      locked: element.locked === true,
    }
  }
  const design = document.componentInstances?.[binding.instanceId]?.design
  const task = design?.assetTasks.find((item) => item.slotId === binding.slotId)
  return {
    type: 'component-region',
    elementId: element.id,
    instanceId: binding.instanceId,
    componentName: binding.componentName,
    profile: binding.profile,
    regionId: binding.regionId,
    slotId: binding.slotId,
    propPath: binding.bindings.image,
    fallbackPath: task?.fallbackPath,
    targetSize: {
      width: Math.max(1, Math.round(element.width)),
      height: Math.max(1, Math.round(element.height)),
    },
    exactText: task?.exactText,
    currentImage: element.src,
  }
}
