import type { DesignElement } from '../types'

export interface LayerIndex {
  rootsByArtboard: Map<string | undefined, DesignElement[]>
  childrenByParent: Map<string, DesignElement[]>
}

/** 为图层面板建立一次性索引，避免每个递归节点反复扫描完整 elements。 */
export function buildLayerIndex(elements: DesignElement[]): LayerIndex {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const rootsByArtboard = new Map<string | undefined, DesignElement[]>()
  const childrenByParent = new Map<string, DesignElement[]>()

  for (const element of elements) {
    const parent = element.parentId ? byId.get(element.parentId) : undefined
    if (parent && parent.artboardId === element.artboardId) {
      const children = childrenByParent.get(parent.id) ?? []
      children.push(element)
      childrenByParent.set(parent.id, children)
      continue
    }

    const roots = rootsByArtboard.get(element.artboardId) ?? []
    roots.push(element)
    rootsByArtboard.set(element.artboardId, roots)
  }

  for (const roots of rootsByArtboard.values()) roots.sort(descendingLayerOrder)
  for (const children of childrenByParent.values()) children.sort(descendingLayerOrder)
  return { rootsByArtboard, childrenByParent }
}

function descendingLayerOrder(a: DesignElement, b: DesignElement) {
  return b.zIndex - a.zIndex
}
