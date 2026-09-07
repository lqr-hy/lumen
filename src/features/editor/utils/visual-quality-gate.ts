import type { Artboard, DesignDocument } from '../types'

export interface VisualQualityIssue {
  code:
    | 'overflow'
    | 'missing-image'
    | 'missing-cta'
    | 'text-truncated'
    | 'contrast'
    | 'button-size-mismatch'
    | 'button-spacing-mismatch'
    | 'empty-scope'
    | 'invalid-size'
    | 'target-missing'
    | 'non-target-modified'
  message: string
  severity: 'error' | 'warning'
  elementIds?: string[]
}

export type VisualQualityGateScope = 'operation' | 'module' | 'artboard'

export type DesignRepairActionKind =
  | 'normalize-layout'
  | 'normalize-button-style'
  | 'normalize-button-size'
  | 'normalize-button-spacing'
  | 'repair-text'
  | 'repair-asset'
  | 'repair-component-props'
  | 'manual-review'

export interface DesignGateReport {
  version: 1
  passed: boolean
  scope: VisualQualityGateScope
  score: number
  targetIds: string[]
  issues: VisualQualityIssue[]
  repairPlan: Array<{
    code: VisualQualityIssue['code']
    elementIds: string[]
    action: DesignRepairActionKind
  }>
  repairCount: number
}

/** @deprecated 使用 DesignGateReport。 */
export type ScopedVisualQualityGateResult = DesignGateReport

/**
 * 对一次修改涉及的局部范围做轻量门禁。
 *
 * 该门禁只检查可由 DesignDocument 确定判断的结构/几何事实，不读取截图，
 * 因此可在每次 Patch 后同步执行；像素级对比仍由 Runtime/视觉评审负责。
 */
export function reviewScopedVisualQuality(
  document: DesignDocument,
  artboard: Artboard,
  targetIds: string[],
  scope: VisualQualityGateScope = 'operation',
  options: {
    beforeDocument?: DesignDocument
    repairCount?: number
    expectedDeletedIds?: string[]
  } = {},
): ScopedVisualQualityGateResult {
  const uniqueTargetIds = [...new Set(targetIds)]
  const artboardElements = document.elements.filter((element) => element.artboardId === artboard.id)
  const targets = artboardElements.filter((element) => uniqueTargetIds.includes(element.id))
  const issues: VisualQualityIssue[] = []
  const expectedDeleted = new Set(options.expectedDeletedIds ?? [])
  if (!uniqueTargetIds.length) {
    issues.push({
      code: 'empty-scope',
      severity: 'error',
      message: '当前修改范围没有找到可见节点。',
      elementIds: uniqueTargetIds,
    })
  }

  const missingTargets = uniqueTargetIds.filter(
    (id) => !targets.some((element) => element.id === id) && !expectedDeleted.has(id),
  )
  if (missingTargets.length) {
    issues.push({
      code: 'target-missing',
      severity: 'error',
      message: `${missingTargets.length} 个修改目标在提交后不存在。`,
      elementIds: missingTargets,
    })
  }

  const invalidSize = targets.filter(
    (element) =>
      !Number.isFinite(element.width) ||
      !Number.isFinite(element.height) ||
      element.width <= 0 ||
      element.height <= 0,
  )
  if (invalidSize.length) {
    issues.push({
      code: 'invalid-size',
      severity: 'error',
      message: `${invalidSize.length} 个目标节点尺寸非法。`,
      elementIds: invalidSize.map((element) => element.id),
    })
  }

  const beforeElements = new Map(
    (options.beforeDocument?.elements ?? []).map((element) => [element.id, element]),
  )
  const isOutOfBounds = (element: DesignDocument['elements'][number]) =>
    element.x < artboard.x ||
    element.y < artboard.y ||
    element.x + element.width > artboard.x + artboard.width ||
    element.y + element.height > artboard.y + artboard.height
  const outOfBounds = targets.filter((element) => {
    if (element.visible === false) return false
    if (!isOutOfBounds(element)) return false
    const previous = beforeElements.get(element.id)
    return (
      !previous ||
      !isOutOfBounds(previous) ||
      previous.x !== element.x ||
      previous.y !== element.y ||
      previous.width !== element.width ||
      previous.height !== element.height
    )
  })
  if (outOfBounds.length) {
    issues.push({
      code: 'overflow',
      severity: 'error',
      message: `${outOfBounds.length} 个目标节点超出画板边界。`,
      elementIds: outOfBounds.map((element) => element.id),
    })
  }

  if (options.beforeDocument) {
    const before = new Map(options.beforeDocument.elements.map((element) => [element.id, element]))
    const targetSet = new Set(uniqueTargetIds)
    const changedOutsideScope = artboardElements.filter((element) => {
      if (targetSet.has(element.id)) return false
      const previous = before.get(element.id)
      return previous && JSON.stringify(previous) !== JSON.stringify(element)
    })
    if (changedOutsideScope.length) {
      issues.push({
        code: 'non-target-modified',
        severity: 'error',
        message: `${changedOutsideScope.length} 个 Scope 外节点被修改。`,
        elementIds: changedOutsideScope.map((element) => element.id),
      })
    }
  }

  const buttons = targets.filter(isButtonLike)
  if (buttons.length >= 2) {
    const widths = buttons.map((button) => button.width)
    const heights = buttons.map((button) => button.height)
    const widthRatio = Math.max(...widths) / Math.max(1, Math.min(...widths))
    const heightRatio = Math.max(...heights) / Math.max(1, Math.min(...heights))
    if (widthRatio > 1.1 || heightRatio > 1.1) {
      issues.push({
        code: 'button-size-mismatch',
        severity: 'warning',
        message: '目标按钮尺寸差异超过 10%，可能出现视觉不一致。',
        elementIds: buttons.map((button) => button.id),
      })
    }
    const sorted = [...buttons].sort((a, b) => a.x - b.x || a.y - b.y)
    const gaps = sorted.slice(1).map((button, index) => {
      const previous = sorted[index]
      return Math.max(
        button.x - (previous.x + previous.width),
        button.y - (previous.y + previous.height),
      )
    })
    if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 8) {
      issues.push({
        code: 'button-spacing-mismatch',
        severity: 'warning',
        message: '目标按钮间距不一致，差异超过 8px。',
        elementIds: buttons.map((button) => button.id),
      })
    }
  }

  const repairPlan = issues.map((issue) => ({
    code: issue.code,
    elementIds: issue.elementIds ?? [],
    action:
      issue.code === 'button-size-mismatch'
        ? ('normalize-button-size' as const)
        : issue.code === 'button-spacing-mismatch'
          ? ('normalize-button-spacing' as const)
          : issue.code === 'overflow' || issue.code === 'invalid-size'
            ? ('normalize-layout' as const)
            : ('manual-review' as const),
  }))
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.length - errorCount
  return {
    version: 1,
    passed: !issues.some((issue) => issue.severity === 'error'),
    scope,
    score: Math.max(0, Math.round((1 - errorCount * 0.25 - warningCount * 0.05) * 100) / 100),
    targetIds: uniqueTargetIds,
    issues,
    repairPlan,
    repairCount: options.repairCount ?? 0,
  }
}

function isButtonLike(element: DesignDocument['elements'][number]) {
  return element.type === 'button' || /按钮|draw[-_ ]?(one|ten)|抽一次|抽十次/i.test(element.name)
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
  const errors = issues.filter((issue) => issue.severity === 'error').length
  return {
    version: 1 as const,
    scope: 'artboard' as const,
    passed: errors === 0,
    score: Math.max(
      0,
      Math.round((1 - errors * 0.2 - (issues.length - errors) * 0.05) * 100) / 100,
    ),
    targetIds: elements.map((element) => element.id),
    issues,
    repairPlan: issues.map((issue) => ({
      code: issue.code,
      elementIds: issue.elementIds ?? [],
      action:
        issue.code === 'overflow' ? ('normalize-layout' as const) : ('manual-review' as const),
    })),
    repairCount: 0,
  }
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
