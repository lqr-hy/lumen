import type { DesignElement, SectionElement } from '../types'
import {
  clampSize,
  resolveElementLayoutSize,
  resolveLayoutSizing,
  resolveSectionLayoutSize,
} from './design-properties'

export function layoutSection(section: SectionElement, elements: DesignElement[]) {
  const children = elements
    .filter((element) => element.parentId === section.id)
    .sort((left, right) => left.zIndex - right.zIndex)
  const size = resolveSectionLayoutSize(section, children)
  const resolvedSection = { ...section, ...size }
  return {
    sectionPatch: size,
    childPatches: layoutResolvedSectionChildren(resolvedSection, children),
  }
}

export function layoutSectionChildren(section: SectionElement, elements: DesignElement[]) {
  const layout = section.autoLayout
  if (!layout) return []
  const children = elements
    .filter((element) => element.parentId === section.id)
    .sort((left, right) => left.zIndex - right.zIndex)
  const size = resolveSectionLayoutSize(section, children)
  return layoutResolvedSectionChildren({ ...section, ...size }, children)
}

function layoutResolvedSectionChildren(section: SectionElement, children: DesignElement[]) {
  const layout = section.autoLayout
  if (!layout) return []
  const horizontal = layout.direction === 'horizontal'
  const padding = layout.padding
  const mainStart = horizontal ? padding.left : padding.top
  const mainEnd = horizontal ? padding.right : padding.bottom
  const crossStart = horizontal ? padding.top : padding.left
  const crossEnd = horizontal ? padding.bottom : padding.right
  const mainAvailable = (horizontal ? section.width : section.height) - mainStart - mainEnd
  const crossAvailable = (horizontal ? section.height : section.width) - crossStart - crossEnd
  const fixedMain = children.reduce((total, child) => {
    const sizing = resolveLayoutSizing(child)
    const fill = horizontal ? sizing.widthMode === 'fill' : sizing.heightMode === 'fill'
    const size = resolveElementLayoutSize(child)
    return total + (fill ? 0 : horizontal ? size.width : size.height)
  }, 0)
  const fillChildren = children.filter((child) => {
    const sizing = resolveLayoutSizing(child)
    return horizontal ? sizing.widthMode === 'fill' : sizing.heightMode === 'fill'
  })
  const gapTotal = Math.max(0, children.length - 1) * layout.gap
  const fillSize = Math.max(
    1,
    (mainAvailable - fixedMain - gapTotal) / Math.max(1, fillChildren.length),
  )
  const occupiedMain = fixedMain + fillSize * fillChildren.length + gapTotal
  const distributedGap =
    layout.justify === 'space-between' && children.length > 1
      ? Math.max(
          layout.gap,
          (mainAvailable - fixedMain - fillSize * fillChildren.length) / (children.length - 1),
        )
      : layout.gap
  let cursor =
    mainStart +
    (layout.justify === 'center'
      ? Math.max(0, (mainAvailable - occupiedMain) / 2)
      : layout.justify === 'end'
        ? Math.max(0, mainAvailable - occupiedMain)
        : 0)
  return children.map((child) => {
    const sizing = resolveLayoutSizing(child)
    const mainFill = horizontal ? sizing.widthMode === 'fill' : sizing.heightMode === 'fill'
    const crossFill = horizontal ? sizing.heightMode === 'fill' : sizing.widthMode === 'fill'
    const naturalSize = resolveElementLayoutSize(child)
    const mainSize = mainFill
      ? clampSize(
          fillSize,
          horizontal ? sizing.minWidth : sizing.minHeight,
          horizontal ? sizing.maxWidth : sizing.maxHeight,
        )
      : horizontal
        ? naturalSize.width
        : naturalSize.height
    const crossSize = crossFill
      ? clampSize(
          crossAvailable,
          horizontal ? sizing.minHeight : sizing.minWidth,
          horizontal ? sizing.maxHeight : sizing.maxWidth,
        )
      : horizontal
        ? naturalSize.height
        : naturalSize.width
    const cross =
      layout.align === 'start'
        ? crossStart
        : layout.align === 'end'
          ? Math.max(crossStart, crossStart + crossAvailable - crossSize)
          : Math.max(crossStart, crossStart + (crossAvailable - crossSize) / 2)
    const patch = horizontal
      ? { x: section.x + cursor, y: section.y + cross, width: mainSize, height: crossSize }
      : { x: section.x + cross, y: section.y + cursor, width: crossSize, height: mainSize }
    cursor += mainSize + distributedGap
    return { id: child.id, patch }
  })
}
