import type { DesignElement, SectionElement } from '../types'

export type LayerDropPosition = 'before' | 'inside' | 'after'
export type LayerOrderAction = 'forward' | 'backward' | 'front' | 'back'

export interface LayerMutationResult {
  changed: boolean
  elements: DesignElement[]
  selectedElementIds: string[]
}

/** 普通手工图层允许重组；生成结构和组件绑定节点继续由各自的源协议维护。 */
export function isLayerStructureEditable(element: DesignElement | undefined) {
  return Boolean(
    element &&
    !element.locked &&
    !element.componentBinding &&
    !element.designBlockId &&
    !element.designRole,
  )
}

export function isGroupElement(
  element: DesignElement | undefined,
): element is SectionElement & { containerKind: 'group' } {
  return element?.type === 'section' && element.containerKind === 'group'
}

export function canContainLayers(element: DesignElement | undefined) {
  return element?.type === 'section' && isLayerStructureEditable(element)
}

/** 返回指定节点及全部后代，供画布整体移动持久 Group。 */
export function collectLayerSubtreeElements(elements: DesignElement[], rootIds: string[]) {
  const byParent = indexByParent(elements)
  const collected = new Set<string>()
  const visit = (id: string) => {
    if (collected.has(id)) return
    collected.add(id)
    for (const child of byParent.get(id) ?? []) visit(child.id)
  }
  rootIds.forEach(visit)
  return elements.filter((element) => collected.has(element.id))
}

/**
 * 按树的兄弟顺序计算编辑画布的平铺绘制顺序。
 * 这样父容器及其后代保持为连续堆叠单元，与静态快照和代码导出的嵌套顺序一致。
 */
export function flattenElementsForPainting(elements: DesignElement[]) {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const byParent = indexByParent(elements)
  const visited = new Set<string>()
  const ordered: DesignElement[] = []
  const skipSubtree = (element: DesignElement) => {
    for (const child of byParent.get(element.id) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      skipSubtree(child)
    }
  }
  const visit = (element: DesignElement, inheritedLocked = false) => {
    if (visited.has(element.id)) return
    visited.add(element.id)
    const effectiveElement =
      inheritedLocked && !element.locked ? ({ ...element, locked: true } as DesignElement) : element
    ordered.push(effectiveElement)
    if (element.visible === false) {
      // 后代属于已处理的隐藏子树，不能被末尾的损坏结构兜底再次加入绘制队列。
      skipSubtree(element)
      return
    }
    for (const child of sortLayers(byParent.get(element.id) ?? [], elements)) {
      visit(child, inheritedLocked || element.locked === true)
    }
  }
  const roots = elements.filter((element) => !element.parentId || !byId.has(element.parentId))
  for (const root of sortLayers(roots, elements)) visit(root)
  // 损坏项目中的循环节点仍需可见；Validator 会负责报告结构错误。
  for (const element of sortLayers(elements, elements)) visit(element)
  return ordered
}

export function groupLayerElements(
  elements: DesignElement[],
  elementIds: string[],
  groupId: string,
): LayerMutationResult {
  const uniqueIds = [...new Set(elementIds)]
  const selected = uniqueIds
    .map((id) => elements.find((element) => element.id === id))
    .filter((element): element is DesignElement => Boolean(element))
  if (selected.length < 2 || selected.some((element) => !isLayerStructureEditable(element))) {
    return unchanged(elements, elementIds)
  }
  const artboardId = selected[0].artboardId
  const parentId = selected[0].parentId
  if (
    selected.some(
      (element) => element.artboardId !== artboardId || element.parentId !== parentId,
    ) ||
    !isEditableParent(elements, parentId)
  ) {
    return unchanged(elements, elementIds)
  }

  const siblings = orderedSiblings(elements, artboardId, parentId)
  const selectedSet = new Set(selected.map((element) => element.id))
  const selectedSiblings = siblings.filter((element) => selectedSet.has(element.id))
  if (selectedSiblings.length !== selected.length) return unchanged(elements, elementIds)

  const minX = Math.min(...selected.map((element) => element.x))
  const minY = Math.min(...selected.map((element) => element.y))
  const maxX = Math.max(...selected.map((element) => element.x + element.width))
  const maxY = Math.max(...selected.map((element) => element.y + element.height))
  const highestSelectedIndex = Math.max(
    ...siblings.map((element, index) => (selectedSet.has(element.id) ? index : -1)),
  )
  const remaining = siblings.filter((element) => !selectedSet.has(element.id))
  const insertionIndex = siblings
    .slice(0, highestSelectedIndex + 1)
    .filter((element) => !selectedSet.has(element.id)).length
  const group: SectionElement = {
    id: groupId,
    artboardId,
    parentId,
    type: 'section',
    containerKind: 'group',
    name: '编组',
    label: '编组',
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    zIndex: 0,
  }
  const nextSiblings = [...remaining]
  nextSiblings.splice(insertionIndex, 0, group)
  const siblingOrder = orderMap(nextSiblings)
  const childOrder = orderMap(selectedSiblings)
  const nextElements = elements.map((element) => {
    if (selectedSet.has(element.id)) {
      return {
        ...element,
        parentId: groupId,
        zIndex: childOrder.get(element.id) ?? element.zIndex,
      } as DesignElement
    }
    const nextZIndex = siblingOrder.get(element.id)
    return nextZIndex === undefined
      ? element
      : ({ ...element, zIndex: nextZIndex } as DesignElement)
  })
  group.zIndex = siblingOrder.get(groupId) ?? insertionIndex
  return {
    changed: true,
    elements: [...nextElements, group],
    selectedElementIds: [groupId],
  }
}

export function ungroupLayerElement(
  elements: DesignElement[],
  groupId: string,
): LayerMutationResult {
  const group = elements.find((element) => element.id === groupId)
  if (!isGroupElement(group) || !isLayerStructureEditable(group)) {
    return unchanged(elements, [groupId])
  }
  const children = orderedSiblings(elements, group.artboardId, group.id)
  const siblings = orderedSiblings(elements, group.artboardId, group.parentId)
  const groupIndex = siblings.findIndex((element) => element.id === group.id)
  if (groupIndex < 0) return unchanged(elements, [groupId])

  const nextSiblings = siblings.filter((element) => element.id !== group.id)
  nextSiblings.splice(groupIndex, 0, ...children)
  const siblingOrder = orderMap(nextSiblings)
  const childIds = new Set(children.map((element) => element.id))
  const nextElements = elements
    .filter((element) => element.id !== group.id)
    .map((element) => {
      if (childIds.has(element.id)) {
        return {
          ...element,
          parentId: group.parentId,
          zIndex: siblingOrder.get(element.id) ?? element.zIndex,
        } as DesignElement
      }
      const nextZIndex = siblingOrder.get(element.id)
      return nextZIndex === undefined
        ? element
        : ({ ...element, zIndex: nextZIndex } as DesignElement)
    })
  return {
    changed: true,
    elements: nextElements,
    selectedElementIds: children.map((element) => element.id),
  }
}

export function moveLayerElement(
  elements: DesignElement[],
  draggedId: string,
  targetId: string,
  position: LayerDropPosition,
): LayerMutationResult {
  const dragged = elements.find((element) => element.id === draggedId)
  const target = elements.find((element) => element.id === targetId)
  if (
    !dragged ||
    !target ||
    dragged.id === target.id ||
    dragged.artboardId !== target.artboardId ||
    !isLayerStructureEditable(dragged) ||
    !isLayerStructureEditable(target) ||
    hasProtectedAncestor(elements, dragged) ||
    hasProtectedAncestor(elements, target)
  ) {
    return unchanged(elements, [draggedId])
  }
  const descendants = new Set(
    collectLayerSubtreeElements(elements, [dragged.id]).map((element) => element.id),
  )
  if (descendants.has(target.id)) return unchanged(elements, [draggedId])

  const nextParentId = position === 'inside' ? target.id : target.parentId
  if (
    (position === 'inside' && !canContainLayers(target)) ||
    !isEditableParent(elements, nextParentId)
  ) {
    return unchanged(elements, [draggedId])
  }

  const oldSiblings = orderedSiblings(elements, dragged.artboardId, dragged.parentId).filter(
    (element) => element.id !== dragged.id,
  )
  const destination =
    nextParentId === dragged.parentId
      ? [...oldSiblings]
      : orderedSiblings(elements, dragged.artboardId, nextParentId).filter(
          (element) => element.id !== dragged.id,
        )
  let insertionIndex = destination.length
  if (position !== 'inside') {
    const targetIndex = destination.findIndex((element) => element.id === target.id)
    if (targetIndex < 0) return unchanged(elements, [draggedId])
    // 图层面板按从前到后展示，因此面板中的 before 对应更高的 zIndex。
    insertionIndex = targetIndex + (position === 'before' ? 1 : 0)
  }
  destination.splice(insertionIndex, 0, dragged)

  const currentDestination = orderedSiblings(elements, dragged.artboardId, nextParentId)
  if (
    dragged.parentId === nextParentId &&
    currentDestination.length === destination.length &&
    currentDestination.every((element, index) => element.id === destination[index].id)
  ) {
    return unchanged(elements, [draggedId])
  }

  const oldOrder = orderMap(oldSiblings)
  const nextOrder = orderMap(destination)
  const nextElements = elements.map((element) => {
    if (element.id === dragged.id) {
      return {
        ...element,
        parentId: nextParentId,
        zIndex: nextOrder.get(element.id) ?? element.zIndex,
      } as DesignElement
    }
    if (element.artboardId !== dragged.artboardId) return element
    if (element.parentId === dragged.parentId && dragged.parentId !== nextParentId) {
      const nextZIndex = oldOrder.get(element.id)
      return nextZIndex === undefined
        ? element
        : ({ ...element, zIndex: nextZIndex } as DesignElement)
    }
    if (element.parentId === nextParentId) {
      const nextZIndex = nextOrder.get(element.id)
      return nextZIndex === undefined
        ? element
        : ({ ...element, zIndex: nextZIndex } as DesignElement)
    }
    return element
  })
  return { changed: true, elements: nextElements, selectedElementIds: [dragged.id] }
}

export function changeLayerOrder(
  elements: DesignElement[],
  elementIds: string[],
  action: LayerOrderAction,
): LayerMutationResult {
  const selectedSet = new Set(elementIds)
  const selected = elements.filter((element) => selectedSet.has(element.id))
  if (
    !selected.length ||
    selected.some((element) => !isLayerStructureEditable(element)) ||
    selected.some(
      (element) =>
        element.artboardId !== selected[0].artboardId || element.parentId !== selected[0].parentId,
    ) ||
    !isEditableParent(elements, selected[0].parentId)
  ) {
    return unchanged(elements, elementIds)
  }
  const siblings = orderedSiblings(elements, selected[0].artboardId, selected[0].parentId)
  const editableSlots = siblings
    .map((element, index) => (isLayerStructureEditable(element) ? index : -1))
    .filter((index) => index >= 0)
  const editable = editableSlots.map((index) => siblings[index])
  if (!selected.every((element) => editable.some((item) => item.id === element.id))) {
    return unchanged(elements, elementIds)
  }
  const reordered = reorderSelected(editable, selectedSet, action)
  if (reordered.every((element, index) => element.id === editable[index].id)) {
    return unchanged(elements, elementIds)
  }
  const nextSiblings = [...siblings]
  editableSlots.forEach((slot, index) => {
    nextSiblings[slot] = reordered[index]
  })
  const nextOrder = orderMap(nextSiblings)
  return {
    changed: true,
    elements: elements.map((element) => {
      const nextZIndex = nextOrder.get(element.id)
      return nextZIndex === undefined
        ? element
        : ({ ...element, zIndex: nextZIndex } as DesignElement)
    }),
    selectedElementIds: selected.map((element) => element.id),
  }
}

function reorderSelected(
  elements: DesignElement[],
  selected: Set<string>,
  action: LayerOrderAction,
) {
  const result = [...elements]
  if (action === 'front' || action === 'back') {
    const moving = result.filter((element) => selected.has(element.id))
    const remaining = result.filter((element) => !selected.has(element.id))
    return action === 'front' ? [...remaining, ...moving] : [...moving, ...remaining]
  }
  if (action === 'forward') {
    for (let index = result.length - 2; index >= 0; index -= 1) {
      if (selected.has(result[index].id) && !selected.has(result[index + 1].id)) {
        ;[result[index], result[index + 1]] = [result[index + 1], result[index]]
      }
    }
    return result
  }
  for (let index = 1; index < result.length; index += 1) {
    if (selected.has(result[index].id) && !selected.has(result[index - 1].id)) {
      ;[result[index], result[index - 1]] = [result[index - 1], result[index]]
    }
  }
  return result
}

function orderedSiblings(
  elements: DesignElement[],
  artboardId: string | undefined,
  parentId: string | undefined,
) {
  return sortLayers(
    elements.filter(
      (element) => element.artboardId === artboardId && element.parentId === parentId,
    ),
    elements,
  )
}

function sortLayers(layers: DesignElement[], source: DesignElement[]) {
  const sourceOrder = new Map(source.map((element, index) => [element.id, index]))
  return [...layers].sort(
    (left, right) =>
      left.zIndex - right.zIndex ||
      (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0),
  )
}

function orderMap(elements: DesignElement[]) {
  return new Map(elements.map((element, index) => [element.id, index]))
}

function indexByParent(elements: DesignElement[]) {
  const result = new Map<string, DesignElement[]>()
  for (const element of elements) {
    if (!element.parentId) continue
    const children = result.get(element.parentId) ?? []
    children.push(element)
    result.set(element.parentId, children)
  }
  return result
}

function isEditableParent(elements: DesignElement[], parentId: string | undefined) {
  return !parentId || isLayerStructureEditable(elements.find((element) => element.id === parentId))
}

function hasProtectedAncestor(elements: DesignElement[], element: DesignElement) {
  const byId = new Map(elements.map((item) => [item.id, item]))
  const visited = new Set<string>()
  let parentId = element.parentId
  while (parentId) {
    if (visited.has(parentId)) return true
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent || !isLayerStructureEditable(parent)) return true
    parentId = parent.parentId
  }
  return false
}

function unchanged(elements: DesignElement[], selectedElementIds: string[]): LayerMutationResult {
  return { changed: false, elements, selectedElementIds }
}
