import type { Point, ViewportState } from '../types'

export function screenToWorld(point: Point, viewport: ViewportState): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
}

export function worldToScreen(point: Point, viewport: ViewportState): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
}

export function clampZoom(value: number) {
  return Math.min(8, Math.max(0.05, value))
}

export function zoomAtPoint(
  viewport: ViewportState,
  screenPoint: Point,
  nextZoom: number,
): ViewportState {
  const zoom = clampZoom(nextZoom)
  const before = screenToWorld(screenPoint, viewport)
  const after = worldToScreen(before, { ...viewport, zoom })

  return {
    x: viewport.x + screenPoint.x - after.x,
    y: viewport.y + screenPoint.y - after.y,
    zoom,
  }
}
