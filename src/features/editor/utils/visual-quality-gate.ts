import type { Artboard, DesignDocument } from '../types'

export interface VisualQualityIssue {
  code: 'overflow' | 'missing-image' | 'missing-cta' | 'text-truncated' | 'contrast'
  message: string
  severity: 'error' | 'warning'
  elementIds?: string[]
}

export function reviewVisualVariant(document: DesignDocument, artboard: Artboard) {
  const elements = document.elements.filter(
    (element) => element.artboardId === artboard.id && element.visible !== false,
  )
  const issues: VisualQualityIssue[] = []
  const outOfBounds = elements.filter(
    (element) =>
      element.x < artboard.x ||
      element.y < artboard.y ||
      element.x + element.width > artboard.x + artboard.width ||
      element.y + element.height > artboard.y + artboard.height,
  )
  if (outOfBounds.length) {
    issues.push({
      code: 'overflow',
      severity: 'error',
      message: `${outOfBounds.length} 个节点超出画板边界`,
      elementIds: outOfBounds.map((item) => item.id),
    })
  }
  const missingImages = elements.filter(
    (element) => element.type === 'image' && !element.src?.trim(),
  )
  if (missingImages.length) {
    issues.push({
      code: 'missing-image',
      severity: 'error',
      message: `${missingImages.length} 张图片缺少有效来源`,
      elementIds: missingImages.map((item) => item.id),
    })
  }
  const hasCta = elements.some(
    (element) =>
      element.type === 'button' || /cta|行动|购买|报名|立即|开始|了解更多/i.test(element.name),
  )
  if (!hasCta)
    issues.push({
      code: 'missing-cta',
      severity: 'warning',
      message: '未检测到明确的 CTA 按钮或行动入口',
    })
  const truncated = elements.filter(
    (element) =>
      (element.type === 'text' || element.type === 'button') &&
      /…|\.\.\.$/.test(element.content.trim()),
  )
  if (truncated.length)
    issues.push({
      code: 'text-truncated',
      severity: 'warning',
      message: `${truncated.length} 个文本节点疑似被截断`,
      elementIds: truncated.map((item) => item.id),
    })
  const lowContrast = elements.filter((element) => {
    if (element.type !== 'text' && element.type !== 'button') return false
    const foreground = element.style.color
    const background = element.type === 'button' ? element.style.background : artboard.background
    return contrastRatio(foreground, background) < 3
  })
  if (lowContrast.length)
    issues.push({
      code: 'contrast',
      severity: 'warning',
      message: `${lowContrast.length} 个文本节点与背景对比度偏低`,
    })
  return { passed: !issues.some((issue) => issue.severity === 'error'), issues }
}

export function buildSafeVisualQualityFixes(document: DesignDocument, artboard: Artboard) {
  return document.elements
    .filter((element) => element.artboardId === artboard.id && element.visible !== false)
    .filter(
      (element) =>
        element.x < artboard.x ||
        element.y < artboard.y ||
        element.x + element.width > artboard.x + artboard.width ||
        element.y + element.height > artboard.y + artboard.height,
    )
    .map((element) => ({
      id: element.id,
      patch: {
        x: Math.max(
          artboard.x,
          Math.min(element.x, artboard.x + Math.max(0, artboard.width - element.width)),
        ),
        y: Math.max(
          artboard.y,
          Math.min(element.y, artboard.y + Math.max(0, artboard.height - element.height)),
        ),
        width: Math.min(element.width, artboard.width),
        height: Math.min(element.height, artboard.height),
      },
    }))
}

function contrastRatio(first: string, second: string) {
  const a = luminance(first)
  const b = luminance(second)
  if (a === undefined || b === undefined) return 4.5
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function luminance(value: string) {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return undefined
  const hex =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((char) => char + char)
          .join('')
      : match[1]
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}
