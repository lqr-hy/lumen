import type { DesignElement, SectionElement } from '../types'

export function layoutSectionChildren(section: SectionElement, elements: DesignElement[]) {
  const layout = section.autoLayout
  if (!layout) return []
  const children = elements
    .filter((element) => element.parentId === section.id)
    .sort((left, right) => left.zIndex - right.zIndex)
  let cursor = layout.padding
  return children.map((child) => {
    const horizontal = layout.direction === 'horizontal'
    const crossAvailable = (horizontal ? section.height : section.width) - layout.padding * 2
    const crossSize = horizontal ? child.height : child.width
    const cross = layout.align === 'start'
      ? layout.padding
      : layout.align === 'end'
        ? Math.max(layout.padding, crossAvailable - crossSize + layout.padding)
        : Math.max(layout.padding, (horizontal ? section.height : section.width) / 2 - crossSize / 2)
    const patch = horizontal
      ? { x: section.x + cursor, y: section.y + cross }
      : { x: section.x + cross, y: section.y + cursor }
    cursor += (horizontal ? child.width : child.height) + layout.gap
    return { id: child.id, patch }
  })
}
