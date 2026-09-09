import type { Artboard, DesignDocument, DesignElement } from '../types'
import { layoutSection } from './auto-layout'
import { collectLayerSubtreeElements } from './layer-tree'
import { resolveElementLayoutSize, resolveLayoutSizing } from './design-properties'

export function setNestedPatchValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.').filter(Boolean)
  if (!segments.length) return
  let current: Record<string, unknown> = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const existing = current[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
  current[segments.at(-1)!] = value
}

export function applyElementPatches(
  elements: DesignElement[],
  patches: Array<{ id: string; patch: Partial<DesignElement> }>,
) {
  const patchMap = new Map(patches.map((item) => [item.id, item.patch]))
  for (const item of patches) {
    const root = elements.find((element) => element.id === item.id)
    if (!root || root.type !== 'section' || root.autoLayout) continue
    const nextX = Number.isFinite(item.patch.x) ? item.patch.x! : root.x
    const nextY = Number.isFinite(item.patch.y) ? item.patch.y! : root.y
    const nextWidth = Number.isFinite(item.patch.width)
      ? Math.max(1, item.patch.width!)
      : root.width
    const nextHeight = Number.isFinite(item.patch.height)
      ? Math.max(1, item.patch.height!)
      : root.height
    const scaleX = nextWidth / Math.max(1, root.width)
    const scaleY = nextHeight / Math.max(1, root.height)
    for (const child of collectLayerSubtreeElements(elements, [root.id]).filter(
      (element) => element.id !== root.id,
    )) {
      if (patchMap.has(child.id)) continue
      patchMap.set(child.id, {
        x: nextX + (child.x - root.x) * scaleX,
        y: nextY + (child.y - root.y) * scaleY,
        width: Math.max(1, child.width * scaleX),
        height: Math.max(1, child.height * scaleY),
      })
    }
  }
  let nextElements = elements.map((element) => {
    const patch = patchMap.get(element.id)
    return patch ? ({ ...element, ...patch } as DesignElement) : element
  })
  const affected = new Set(patches.map((item) => item.id))
  nextElements = nextElements.map((element) => {
    if (!affected.has(element.id) || element.type === 'section') return element
    const sizing = resolveLayoutSizing(element)
    return sizing.widthMode === 'hug' || sizing.heightMode === 'hug'
      ? ({ ...element, ...resolveElementLayoutSize(element) } as DesignElement)
      : element
  })
  for (let pass = 0; pass < 4; pass += 1) {
    const sections = nextElements.filter(
      (element): element is import('../types').SectionElement =>
        element.type === 'section' &&
        Boolean(element.autoLayout) &&
        (affected.has(element.id) ||
          nextElements.some((child) => child.parentId === element.id && affected.has(child.id))),
    )
    if (!sections.length) break
    for (const section of sections) {
      const laidOut = applySectionAutoLayoutToElements(nextElements, section.id, section.autoLayout)
      if (laidOut) nextElements = laidOut
      affected.add(section.id)
    }
  }
  return nextElements
}

export function relayoutLayerParents(
  elements: DesignElement[],
  parentIds: Array<string | undefined>,
) {
  let nextElements = elements
  for (const parentId of [...new Set(parentIds.filter((id): id is string => Boolean(id)))]) {
    const parent = nextElements.find((element) => element.id === parentId)
    if (parent?.type !== 'section' || !parent.autoLayout) continue
    const laidOut = applySectionAutoLayoutToElements(nextElements, parent.id, parent.autoLayout)
    if (laidOut) nextElements = laidOut
  }
  return nextElements
}

export function applySectionAutoLayoutToElements(
  elements: DesignElement[],
  elementId: string,
  autoLayout: import('../types').SectionElement['autoLayout'],
) {
  const section = elements.find((element) => element.id === elementId)
  if (!section || section.type !== 'section') return undefined
  const nextSection = { ...section, autoLayout }
  const result = layoutSection(nextSection, elements)
  const patches = new Map(result.childPatches.map((item) => [item.id, item.patch]))
  return elements.map((element) =>
    element.id === elementId
      ? { ...nextSection, ...result.sectionPatch }
      : patches.has(element.id)
        ? { ...element, ...patches.get(element.id) }
        : element,
  ) as DesignElement[]
}

export function syncComponentInstancesFromElements(
  componentInstances: NonNullable<DesignDocument['componentInstances']>,
  elements: DesignElement[],
  changedIds: Set<string>,
) {
  return Object.fromEntries(
    Object.entries(componentInstances).map(([instanceId, instance]) => {
      const designElements = elements.filter(
        (element) =>
          changedIds.has(element.id) &&
          element.componentBinding?.instanceId === instanceId &&
          element.componentBinding.renderMode !== 'root',
      )
      if (!designElements.length) return [instanceId, instance]
      const propsPatch = structuredClone(instance.design.propsPatch)
      for (const element of designElements) {
        const binding = element.componentBinding!
        const root = elements.find((item) => item.id === binding.rootElementId)
        if (!root) continue
        const scaleX = root.width / Math.max(1, instance.design.blueprint.width)
        const scaleY = root.height / Math.max(1, instance.design.blueprint.height)
        if (binding.bindings.x)
          setNestedPatchValue(propsPatch, binding.bindings.x, (element.x - root.x) / scaleX)
        if (binding.bindings.y)
          setNestedPatchValue(propsPatch, binding.bindings.y, (element.y - root.y) / scaleY)
        if (binding.bindings.width)
          setNestedPatchValue(propsPatch, binding.bindings.width, element.width / scaleX)
        if (binding.bindings.height)
          setNestedPatchValue(propsPatch, binding.bindings.height, element.height / scaleY)
        if (binding.bindings.visible)
          setNestedPatchValue(propsPatch, binding.bindings.visible, element.visible !== false)
        if (binding.bindings.image && element.type === 'image')
          setNestedPatchValue(propsPatch, binding.bindings.image, element.src)
        if (binding.bindings.color) {
          const color = getElementColor(element)
          if (color) setNestedPatchValue(propsPatch, binding.bindings.color, color)
        }
      }
      return [instanceId, { ...instance, design: { ...instance.design, propsPatch } }]
    }),
  )
}

function getElementColor(element: DesignElement) {
  if (element.type === 'shape') return element.fill
  if (element.type === 'text') return element.style.color
  if (element.type === 'button') return element.style.background
  return undefined
}

export function constrainElementsToArtboard(elements: DesignElement[], artboard: Artboard) {
  return elements.map((element) => {
    if (element.artboardId !== artboard.id) return element
    const maxX = Math.max(artboard.x, artboard.x + artboard.width - Math.max(1, element.width))
    return {
      ...element,
      x: Math.max(artboard.x, Math.min(element.x, maxX)),
      y: Math.max(artboard.y, element.y),
    }
  })
}
