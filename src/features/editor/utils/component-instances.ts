import type {
  ComponentDesignMeta,
  ComponentInstance,
  DesignDocument,
  DesignElement,
} from '../types'

export function normalizeComponentInstances(document: DesignDocument): DesignDocument {
  const componentInstances = { ...(document.componentInstances ?? {}) }

  for (const artboard of document.artboards) {
    const legacyDesigns = artboard.componentDesigns ?? (
      artboard.componentDesign ? [artboard.componentDesign] : []
    )
    for (const design of legacyDesigns) {
      const instanceId = design.instanceId
      if (!instanceId || componentInstances[instanceId]) continue
      const root = findInstanceRoot(document.elements, instanceId)
      if (!root) continue
      componentInstances[instanceId] = createComponentInstance(
        design,
        artboard.id,
        root.id,
        instanceId,
      )
    }
  }

  return {
    ...document,
    componentInstances,
    artboards: document.artboards.map((item) => {
      const artboard = { ...item }
      delete artboard.componentDesign
      delete artboard.componentDesigns
      return artboard
    }),
  }
}

export function createComponentInstance(
  design: ComponentDesignMeta,
  artboardId: string,
  rootElementId: string,
  instanceId: string,
): ComponentInstance {
  const normalizedDesign = design.instanceId === instanceId ? design : { ...design, instanceId }
  return {
    id: instanceId,
    artboardId,
    rootElementId,
    componentName: normalizedDesign.componentName,
    profile: normalizedDesign.profile,
    design: normalizedDesign,
  }
}

export function resolveComponentInstance(
  document: DesignDocument,
  selectedElementIds: string[],
): ComponentInstance | undefined {
  for (const elementId of selectedElementIds) {
    const element = document.elements.find((item) => item.id === elementId)
    const instanceId = element?.componentBinding?.instanceId
    if (instanceId) return document.componentInstances?.[instanceId]
  }
  return undefined
}

export function findInstanceRoot(elements: DesignElement[], instanceId: string) {
  return elements.find((element) => (
    element.componentBinding?.instanceId === instanceId &&
    element.componentBinding.renderMode === 'root'
  ))
}
