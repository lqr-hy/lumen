import type { ImageElement } from '../types'
import { findEditableMaskBounds } from './image-mask'
import type { MaskStroke, WorldRect } from './canvas-interaction'

export function createStrokePath(stroke: MaskStroke, source: ImageElement) {
  const points = stroke.points.map((point) => ({ x: point.x - source.x, y: point.y - source.y }))
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
}

export function createImageRegionSelection(
  source: ImageElement,
  rect: WorldRect | null,
  strokes: MaskStroke[],
  feather: number,
  currentImage: string,
) {
  const targetSize = {
    width: Math.max(1, Math.round(source.width)),
    height: Math.max(1, Math.round(source.height)),
  }
  const padding = Math.ceil(Math.max(0, feather) * 3)
  const working = globalThis.document.createElement('canvas')
  working.width = targetSize.width + padding * 2
  working.height = targetSize.height + padding * 2
  const context = working.getContext('2d')
  if (!context) throw new Error('无法创建图片局部编辑 Mask。')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, working.width, working.height)

  if (rect && rect.width > 0 && rect.height > 0) {
    const x = clampNumber(Math.round(rect.left - source.x), 0, targetSize.width)
    const y = clampNumber(Math.round(rect.top - source.y), 0, targetSize.height)
    const width = clampNumber(Math.round(rect.width), 0, targetSize.width - x)
    const height = clampNumber(Math.round(rect.height), 0, targetSize.height - y)
    context.clearRect(padding + x, padding + y, width, height)
  }

  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    context.save()
    context.globalCompositeOperation = stroke.mode === 'brush' ? 'destination-out' : 'source-over'
    context.strokeStyle = '#000000'
    context.fillStyle = '#000000'
    context.lineWidth = Math.max(1, stroke.size)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const points = stroke.points.map((point) => ({
      x: padding + ((point.x - source.x) / source.width) * targetSize.width,
      y: padding + ((point.y - source.y) / source.height) * targetSize.height,
    }))
    if (points.length === 1) {
      context.beginPath()
      context.arc(points[0].x, points[0].y, Math.max(0.5, stroke.size / 2), 0, Math.PI * 2)
      context.fill()
    } else {
      context.beginPath()
      context.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.stroke()
    }
    context.restore()
  }

  const softened = globalThis.document.createElement('canvas')
  softened.width = working.width
  softened.height = working.height
  const softenedContext = softened.getContext('2d')
  if (!softenedContext) throw new Error('无法处理 Mask 羽化。')
  softenedContext.filter = feather > 0 ? `blur(${feather}px)` : 'none'
  softenedContext.drawImage(working, 0, 0)

  const canvas = globalThis.document.createElement('canvas')
  canvas.width = targetSize.width
  canvas.height = targetSize.height
  const outputContext = canvas.getContext('2d', { willReadFrequently: true })
  if (!outputContext) throw new Error('无法输出图片局部编辑 Mask。')
  outputContext.drawImage(
    softened,
    padding,
    padding,
    targetSize.width,
    targetSize.height,
    0,
    0,
    targetSize.width,
    targetSize.height,
  )
  const pixels = outputContext.getImageData(0, 0, targetSize.width, targetSize.height)
  const bounds = findEditableMaskBounds(pixels)
  if (!bounds) return null
  return {
    elementId: source.id,
    sourceSrc: source.src,
    normalizedRect: {
      x: bounds.x / targetSize.width,
      y: bounds.y / targetSize.height,
      width: bounds.width / targetSize.width,
      height: bounds.height / targetSize.height,
    },
    pixelRect: bounds,
    targetSize,
    currentImage,
    maskImage: canvas.toDataURL('image/png'),
  }
}

export async function createImageSlice(
  source: ImageElement,
  renderedSrc: string,
  rect: WorldRect,
  options?: { zIndex?: number },
): Promise<ImageElement | null> {
  const bitmap = await loadImage(renderedSrc)
  const pixelWidth = bitmap.naturalWidth || bitmap.width
  const pixelHeight = bitmap.naturalHeight || bitmap.height
  const timestamp = Date.now()

  const clampedLeft = Math.min(source.x + source.width, Math.max(source.x, rect.left))
  const clampedTop = Math.min(source.y + source.height, Math.max(source.y, rect.top))
  const clampedRight = Math.min(source.x + source.width, Math.max(source.x, rect.left + rect.width))
  const clampedBottom = Math.min(
    source.y + source.height,
    Math.max(source.y, rect.top + rect.height),
  )
  const width = Math.round(clampedRight - clampedLeft)
  const height = Math.round(clampedBottom - clampedTop)
  if (width < 1 || height < 1) return null

  const sourceX = Math.round(((clampedLeft - source.x) / source.width) * pixelWidth)
  const sourceY = Math.round(((clampedTop - source.y) / source.height) * pixelHeight)
  const sourceWidth = Math.max(1, Math.round((width / source.width) * pixelWidth))
  const sourceHeight = Math.max(1, Math.round((height / source.height) * pixelHeight))
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  )

  return {
    ...source,
    id: `${source.id}-slice-${timestamp}`,
    name: `${source.name || '图片'} 切图`,
    x: Math.round(clampedLeft),
    y: Math.round(clampedTop),
    width,
    height,
    src: canvas.toDataURL('image/png'),
    objectFit: 'fill',
    borderRadius: 0,
    zIndex: options?.zIndex ?? source.zIndex + 1,
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}
