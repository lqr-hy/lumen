import type { ResizeHandle } from '../components/SelectionBox'
import type { DesignElement, Point } from '../types'
import { collectLayerSubtreeElements } from './layer-tree'

export interface WorldRect {
  left: number
  top: number
  width: number
  height: number
}

export interface MaskStroke {
  mode: 'brush' | 'erase'
  size: number
  points: Point[]
}

export function expandLayerSelection(elements: DesignElement[], selected: DesignElement[]) {
  const selectedIds = new Set(selected.map((element) => element.id))
  const roots = selected.filter(
    (element) => !element.parentId || !selectedIds.has(element.parentId),
  )
  return collectLayerSubtreeElements(
    elements,
    roots.map((element) => element.id),
  )
}

export function resizeRect<T extends { x: number; y: number; width: number; height: number }>(
  target: T,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minSize: number,
): T {
  let { x, y, width, height } = target

  if (handle.includes('e')) width += deltaX
  if (handle.includes('s')) height += deltaY
  if (handle.includes('w')) {
    x += deltaX
    width -= deltaX
  }
  if (handle.includes('n')) {
    y += deltaY
    height -= deltaY
  }

  if (width < minSize) {
    if (handle.includes('w')) x -= minSize - width
    width = minSize
  }
  if (height < minSize) {
    if (handle.includes('n')) y -= minSize - height
    height = minSize
  }

  return {
    ...target,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

export function clampPointToRect(
  point: Point,
  rect: { x: number; y: number; width: number; height: number },
) {
  return {
    x: Math.min(rect.x + rect.width, Math.max(rect.x, point.x)),
    y: Math.min(rect.y + rect.height, Math.max(rect.y, point.y)),
  }
}

export function createRectFromPoints(start: Point, end: Point): WorldRect {
  return {
    left: Math.round(Math.min(start.x, end.x)),
    top: Math.round(Math.min(start.y, end.y)),
    width: Math.round(Math.abs(end.x - start.x)),
    height: Math.round(Math.abs(end.y - start.y)),
  }
}
