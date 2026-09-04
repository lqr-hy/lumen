export interface ImageMaskRect {
  width: number
  height: number
}

export interface ImageMaskStrokeSummary {
  mode: 'brush' | 'erase'
  pointCount: number
}

export function hasEditableImageMask(
  rect: ImageMaskRect | null,
  strokes: ImageMaskStrokeSummary[],
) {
  return Boolean(
    (rect && rect.width >= 1 && rect.height >= 1) ||
    strokes.some((stroke) => stroke.mode === 'brush' && stroke.pointCount > 0),
  )
}

export function findEditableMaskBounds(
  image: {
    width: number
    height: number
    data: Uint8ClampedArray
  },
  alphaThreshold = 250,
) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] >= alphaThreshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX
    ? undefined
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
