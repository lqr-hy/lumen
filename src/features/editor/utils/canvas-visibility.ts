import type { Artboard, DesignElement, ViewportState } from '../types'

export interface CanvasViewportSize {
  width: number
  height: number
}

export interface CanvasWorldBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 把屏幕视口换算为画布世界坐标，并在屏幕四周保留 overscan。
 * overscan 使用屏幕像素，缩放后仍能保持稳定的预加载距离。
 */
export function resolveVisibleWorldBounds(
  viewport: ViewportState,
  size: CanvasViewportSize,
  overscanPx = 600,
): CanvasWorldBounds | undefined {
  if (size.width <= 0 || size.height <= 0 || viewport.zoom <= 0) return undefined
  return {
    left: (-viewport.x - overscanPx) / viewport.zoom,
    top: (-viewport.y - overscanPx) / viewport.zoom,
    right: (size.width - viewport.x + overscanPx) / viewport.zoom,
    bottom: (size.height - viewport.y + overscanPx) / viewport.zoom,
  }
}

export function rectIntersectsWorldBounds(
  rect: Pick<Artboard | DesignElement, 'x' | 'y' | 'width' | 'height'>,
  bounds: CanvasWorldBounds,
) {
  return (
    rect.x + rect.width >= bounds.left &&
    rect.x <= bounds.right &&
    rect.y + rect.height >= bounds.top &&
    rect.y <= bounds.bottom
  )
}

/** 首次测量前返回全部画板，避免首帧空白；测量完成后只保留可见和强制保活画板。 */
export function resolveVisibleArtboards(
  artboards: Artboard[],
  bounds: CanvasWorldBounds | undefined,
  retainedIds: ReadonlySet<string>,
) {
  if (!bounds) return artboards
  return artboards.filter(
    (artboard) => retainedIds.has(artboard.id) || rectIntersectsWorldBounds(artboard, bounds),
  )
}
