import type { SelectionScope, SelectionScopeBase } from '../../ai/types'
import type { EditorImageRegionSelection, EditorTextRangeSelection } from '../store/editor-store'
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

export function isComponentSlotRegenerationReference(reference: {
  text: string
  elementId?: string
  kind?: string
}): boolean {
  return (
    reference.kind === 'component-region-regeneration' ||
    (Boolean(reference.elementId) && /^仅重新生成选中的 .+ 素材$/.test(reference.text.trim()))
  )
}

export function isAssetRegenerationPrompt(prompt: string) {
  const value = prompt.trim()
  if (!value) return false
  if (/(?:样式|颜色|背景色|尺寸|大小|宽度|高度|圆角|字号|字体|间距|文案|统一.*按钮)/i.test(value))
    return false
  return /(?:重新生成|重生成|换图|替换(?:图片|素材)|生成(?:图片|素材|按钮图)|重做素材)/i.test(value)
}

export function createComponentRegionBatchScope(
  document: DesignDocument,
  elementIds: string[],
): Extract<SelectionScope, { type: 'component-region-batch' }> | undefined {
  const ids = [...new Set(elementIds)]
  if (!ids.length) return undefined
  const targets = ids.map((elementId) => createSelectionScope(document, [elementId]))
  if (targets.some((scope) => scope?.type !== 'component-region')) return undefined
  const componentTargets = targets as Array<Extract<SelectionScope, { type: 'component-region' }>>
  const artboardId = componentTargets[0].artboardId
  if (componentTargets.some((scope) => scope.artboardId !== artboardId)) return undefined
  const elements = ids
    .map((id) => document.elements.find((element) => element.id === id))
    .filter((element): element is DesignElement => Boolean(element))
  const base = createScopeBase(document, artboardId, elements, elements)
  return {
    ...base,
    type: 'component-region-batch',
    elementIds: ids,
    targets: componentTargets,
  }
}

export function createSelectionScope(
  document: DesignDocument,
  selectedElementIds: string[],
  textRangeSelection?: EditorTextRangeSelection,
  imageRegionSelection?: EditorImageRegionSelection,
): SelectionScope | undefined {
  const uniqueIds = [...new Set(selectedElementIds)]
  const elements = uniqueIds
    .map((id) => document.elements.find((element) => element.id === id))
    .filter((element): element is DesignElement => Boolean(element))
  if (!elements.length || elements.length !== uniqueIds.length) return undefined
  const artboardId = elements[0].artboardId
  if (!artboardId || elements.some((element) => element.artboardId !== artboardId)) return undefined

  if (elements.length > 1) {
    if (elements.some((element) => element.componentBinding || element.designRole === 'page-shell'))
      return undefined
    const targetElements = collectEditableSubtrees(document.elements, elements)
    return {
      ...createScopeBase(document, artboardId, elements, targetElements),
      type: 'multi-node',
      elementIds: elements.map((element) => element.id),
      names: elements.map((element) => element.name),
      bounds: unionBounds(elements),
    }
  }

  const element = elements[0]
  const base = createScopeBase(
    document,
    artboardId,
    elements,
    !element.componentBinding && element.designRole !== 'page-shell'
      ? collectEditableRegion(document.elements, element)
      : elements,
  )
  if (textRangeSelection?.elementId === element.id) {
    if (element.type !== 'text' || !isValidTextRange(element.content, textRangeSelection))
      return undefined
    return {
      ...base,
      type: 'text-range',
      elementId: element.id,
      elementType: 'text',
      name: element.name,
      start: textRangeSelection.start,
      end: textRangeSelection.end,
      selectedText: textRangeSelection.selectedText,
      prefix: textRangeSelection.prefix,
      suffix: textRangeSelection.suffix,
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
    }
  }
  if (imageRegionSelection?.elementId === element.id) {
    if (element.type !== 'image' || !isValidImageRegion(element, imageRegionSelection))
      return undefined
    return {
      ...base,
      type: 'image-region',
      elementId: element.id,
      elementType: 'image',
      name: element.name,
      normalizedRect: imageRegionSelection.normalizedRect,
      pixelRect: imageRegionSelection.pixelRect,
      targetSize: imageRegionSelection.targetSize,
      currentImage: imageRegionSelection.currentImage,
      maskImage: imageRegionSelection.maskImage,
    }
  }
  if (element.designRole === 'page-shell' && element.type === 'image') {
    return {
      ...base,
      type: 'page-shell',
      elementId: element.id,
      targetSize: { width: element.width, height: element.height },
      currentImage: element.src,
    }
  }

  const designBlockRoot = resolveDesignBlockRoot(document.elements, element)
  if (designBlockRoot) {
    const targetElements = collectEditableRegion(document.elements, designBlockRoot)
    return {
      ...createScopeBase(document, artboardId, [designBlockRoot], targetElements),
      type: 'design-block',
      elementId: designBlockRoot.id,
      blockId: designBlockRoot.designBlockId || designBlockRoot.id,
      name: designBlockRoot.name,
      bounds: {
        x: designBlockRoot.x,
        y: designBlockRoot.y,
        width: designBlockRoot.width,
        height: designBlockRoot.height,
      },
      imageElementIds: targetElements
        .filter((target) => target.type === 'image')
        .map((target) => target.id),
    }
  }

  const binding = element.componentBinding
  if (!binding) {
    return {
      ...base,
      type: 'generic-node',
      elementId: element.id,
      elementType: element.type,
      name: element.name,
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
    }
  }

  if (element.type !== 'image' || !binding.slotId || !binding.bindings.image) {
    const instanceElements = document.elements.filter(
      (item) =>
        item.artboardId === artboardId && item.componentBinding?.instanceId === binding.instanceId,
    )
    const instanceRoot = instanceElements.find((item) => item.id === binding.rootElementId)
    return {
      ...createScopeBase(
        document,
        artboardId,
        elements,
        instanceElements.length ? instanceElements : elements,
      ),
      type: 'component-instance',
      elementId: binding.rootElementId,
      instanceId: binding.instanceId,
      componentName: binding.componentName,
      profile: binding.profile,
      pageSectionId: binding.pageSectionId,
      locked: instanceRoot?.locked === true,
    }
  }

  const design = document.componentInstances?.[binding.instanceId]?.design
  const task = design?.assetTasks.find((item) => item.slotId === binding.slotId)
  return {
    ...base,
    type: 'component-region',
    elementId: element.id,
    instanceId: binding.instanceId,
    componentName: binding.componentName,
    profile: binding.profile,
    regionId: binding.regionId,
    repeaterPath: binding.repeaterPath,
    repeatIndex: binding.repeatIndex,
    templateId: binding.templateId,
    slotId: binding.slotId,
    propPath: binding.bindings.image,
    fallbackPath: task?.fallbackPath,
    targetSize: {
      width: Math.max(1, Math.round(element.width)),
      height: Math.max(1, Math.round(element.height)),
    },
    transparent: task?.transparent === true,
    exactText: task?.exactText,
    assetRole: task?.role,
    currentImage: element.src,
    visualTheme: design?.blueprint.visualTheme,
  }
}

export function getSelectionScopeElementIds(scope: SelectionScope) {
  return scope.type === 'multi-node' || scope.type === 'component-region-batch'
    ? scope.elementIds
    : [scope.elementId]
}

export function getSelectionScopeLabel(scope: SelectionScope) {
  if (scope.type === 'multi-node') return `${scope.elementIds.length} 个节点`
  if (scope.type === 'component-region-batch')
    return scope.targets.length === 1
      ? `${scope.targets[0].componentName} / ${scope.targets[0].regionId}`
      : `${scope.targets.length} 个组件素材`
  if (scope.type === 'component-region') return `${scope.componentName} / ${scope.regionId}`
  if (scope.type === 'component-instance') return scope.componentName
  if (scope.type === 'page-shell') return '页面视觉外壳'
  if (scope.type === 'design-block') return scope.name
  if (scope.type === 'text-range') return `“${scope.selectedText}”`
  if (scope.type === 'image-region') return `${scope.name} / 局部区域`
  return scope.name
}

function resolveDesignBlockRoot(allElements: DesignElement[], element: DesignElement) {
  if (element.designRole === 'design-block') return element
  if (element.type !== 'shape' || !element.designBlockId) return undefined
  const root = allElements.find(
    (candidate) =>
      candidate.artboardId === element.artboardId &&
      candidate.designRole === 'design-block' &&
      candidate.designBlockId === element.designBlockId,
  )
  if (!root || element.parentId !== root.id || !hasSameBounds(root, element)) return undefined
  return root
}

function hasSameBounds(left: DesignElement, right: DesignElement) {
  const epsilon = 0.5
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.width - right.width) <= epsilon &&
    Math.abs(left.height - right.height) <= epsilon
  )
}

function isValidImageRegion(element: DesignElement, selection: EditorImageRegionSelection) {
  if (element.type !== 'image') return false
  const rect = selection.normalizedRect
  return (
    selection.currentImage.startsWith('data:image/') &&
    selection.maskImage.startsWith('data:image/png') &&
    selection.sourceSrc === element.src &&
    selection.targetSize.width === Math.max(1, Math.round(element.width)) &&
    selection.targetSize.height === Math.max(1, Math.round(element.height)) &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1.000001 &&
    rect.y + rect.height <= 1.000001
  )
}

function isValidTextRange(content: string, selection: EditorTextRangeSelection) {
  return (
    Number.isInteger(selection.start) &&
    Number.isInteger(selection.end) &&
    selection.start >= 0 &&
    selection.end > selection.start &&
    selection.end <= content.length &&
    content.slice(selection.start, selection.end) === selection.selectedText
  )
}

function createScopeBase(
  document: DesignDocument,
  artboardId: string,
  elements: DesignElement[],
  targetElements: DesignElement[],
): SelectionScopeBase {
  const elementIds = elements.map((element) => element.id).sort()
  const targetElementIds = targetElements.map((element) => element.id).sort()
  const targetHash = computeTargetHash(targetElements)
  return {
    scopeId: `selection-${document.version}-${stableHash(elementIds)}`,
    artboardId,
    documentRevision: document.version,
    targetHash,
    targetElementIds,
  }
}

export function computeSelectionTargetHash(document: DesignDocument, elementIds: string[]) {
  const idSet = new Set(elementIds)
  const elements = document.elements.filter((element) => idSet.has(element.id))
  if (elements.length !== idSet.size) return undefined
  return computeTargetHash(elements)
}

function computeTargetHash(elements: DesignElement[]) {
  return stableHash(
    elements
      .map((element) => ({
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        content: 'content' in element ? element.content : undefined,
        src: element.type === 'image' ? element.src : undefined,
        binding: element.componentBinding,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
}

function collectEditableSubtrees(allElements: DesignElement[], roots: DesignElement[]) {
  const ids = new Set(roots.map((element) => element.id))
  let changed = true
  while (changed) {
    changed = false
    for (const element of allElements) {
      if (
        element.parentId &&
        ids.has(element.parentId) &&
        !ids.has(element.id) &&
        !element.componentBinding &&
        element.designRole !== 'page-shell'
      ) {
        ids.add(element.id)
        changed = true
      }
    }
  }
  return allElements.filter((element) => ids.has(element.id))
}

function collectEditableRegion(allElements: DesignElement[], root: DesignElement) {
  const subtree = collectEditableSubtrees(allElements, [root])
  const ids = new Set(subtree.map((element) => element.id))
  // Some generated UI nodes have lost parentId during raster/design delivery.
  // Include fully contained editable nodes so AI still receives the module's
  // real text and controls, without allowing neighboring modules into Scope.
  for (const element of allElements) {
    if (
      element.artboardId === root.artboardId &&
      !element.componentBinding &&
      element.designRole !== 'page-shell' &&
      containsBounds(root, element)
    )
      ids.add(element.id)
  }
  return allElements.filter((element) => ids.has(element.id))
}

function containsBounds(parent: DesignElement, child: DesignElement) {
  const epsilon = 0.5
  return (
    child.id !== parent.id &&
    child.x >= parent.x - epsilon &&
    child.y >= parent.y - epsilon &&
    child.x + child.width <= parent.x + parent.width + epsilon &&
    child.y + child.height <= parent.y + parent.height + epsilon
  )
}

function unionBounds(elements: DesignElement[]) {
  const left = Math.min(...elements.map((element) => element.x))
  const top = Math.min(...elements.map((element) => element.y))
  const right = Math.max(...elements.map((element) => element.x + element.width))
  const bottom = Math.max(...elements.map((element) => element.y + element.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function stableHash(value: unknown) {
  const source = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
