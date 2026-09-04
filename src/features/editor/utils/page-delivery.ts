import type { DeliveryStatus, DesignDocument, DesignQualityReview } from '../types'
import { buildComponentExportPackage } from './component-export'
import { createZip, type ZipEntry } from './zip'
import { sha256Bytes } from './sha256'
import { resolveTextLineHeightPixels } from './design-properties'

export interface PageDeliveryOptions {
  previews?: { oneX: Uint8Array; twoX: Uint8Array }
}

export function buildPageDeliveryPackage(
  document: DesignDocument,
  artboardId: string,
  options: PageDeliveryOptions = {},
) {
  const artboard = document.artboards.find((item) => item.id === artboardId)
  if (!artboard) throw new Error(`画板不存在：${artboardId}`)
  const instances = Object.values(document.componentInstances ?? {}).filter(
    (instance) => instance.artboardId === artboardId,
  )
  const elements = document.elements.filter((element) => element.artboardId === artboardId)
  const entries: ZipEntry[] = []
  const exportedDocument = structuredClone({
    ...document,
    artboards: [artboard],
    elements,
    componentInstances: Object.fromEntries(instances.map((instance) => [instance.id, instance])),
  })
  const assetManifest: Array<{
    elementId: string
    file: string
    checksum: string
    bytes: number
  }> = []
  const assetFilesByChecksum = new Map<string, string>()

  for (const element of exportedDocument.elements) {
    if (element.type !== 'image' || !element.src.startsWith('data:')) continue
    const data = decodeDataUri(element.src)
    const checksum = `sha256:${sha256Bytes(data)}`
    const existingFile = assetFilesByChecksum.get(checksum)
    const file =
      existingFile ??
      `page-assets/${safeName(element.name || element.id)}-${checksum.slice(-8)}.${dataUriExtension(element.src)}`
    if (!existingFile) {
      entries.push({ name: file, data })
      assetFilesByChecksum.set(checksum, file)
    }
    element.src = file
    assetManifest.push({ elementId: element.id, file, checksum, bytes: data.length })
  }
  exportedDocument.assets = []
  exportedDocument.componentInstances = replaceEmbeddedDataUris(
    exportedDocument.componentInstances,
  ) as NonNullable<DesignDocument['componentInstances']>

  for (const instance of instances) {
    entries.push({
      name: `components/${safeName(instance.id)}/component.zip`,
      data: buildComponentExportPackage(document, instance.id),
    })
  }
  if (options.previews) {
    entries.push(
      { name: 'previews/page@1x.png', data: options.previews.oneX },
      { name: 'previews/page@2x.png', data: options.previews.twoX },
    )
  }

  const qualityReview = reviewPageDelivery(document, artboardId)
  const runtimeValidation = instances.map((instance) => ({
    instanceId: instance.id,
    componentName: instance.componentName,
    result: instance.design.runtimeValidation ?? unsupportedRuntime(instance.componentName),
  }))
  const themes = instances.map((instance) => instance.design.blueprint.visualTheme).filter(Boolean)
  const deliveryStatus = resolveDeliveryStatus(
    qualityReview,
    runtimeValidation.map((item) => item.result.status as 'passed' | 'failed' | 'unsupported'),
  )
  const manifest = {
    schemaVersion: 3,
    documentId: document.id,
    artboardId,
    title: document.title,
    logicalSize: { width: artboard.width, height: artboard.height },
    componentInstances: instances.map((instance) => ({
      instanceId: instance.id,
      componentName: instance.componentName,
      profile: instance.profile,
      sourceHash: instance.design.sourceHash,
      file: `components/${safeName(instance.id)}/component.zip`,
    })),
    assets: assetManifest,
    previews: options.previews
      ? {
          oneX: 'previews/page@1x.png',
          twoX: 'previews/page@2x.png',
        }
      : undefined,
    resources: collectResourceDependencies(elements),
    deliveryStatus,
    designDeliverable: deliveryStatus === 'design-ready' || deliveryStatus === 'runtime-verified',
    deliverable: deliveryStatus === 'runtime-verified',
  }

  entries.unshift(
    jsonEntry('manifest.json', manifest),
    jsonEntry('design-document.json', exportedDocument),
    jsonEntry(
      'page.blueprint.json',
      artboard.pageDesign?.blueprint ?? artboard.generationMeta?.blueprint ?? null,
    ),
    jsonEntry('theme.tokens.json', themes),
    jsonEntry('quality.review.json', qualityReview),
    jsonEntry('runtime.validation.json', runtimeValidation),
  )
  return createZip(entries)
}

export function reviewPageDelivery(
  document: DesignDocument,
  artboardId: string,
): DesignQualityReview {
  const artboard = document.artboards.find((item) => item.id === artboardId)
  if (!artboard) throw new Error(`画板不存在：${artboardId}`)
  const elements = document.elements.filter((element) => element.artboardId === artboardId)
  const roots = elements.filter(
    (element) =>
      !element.parentId && element.visible !== false && element.designRole !== 'page-shell',
  )
  const instances = Object.values(document.componentInstances ?? {}).filter(
    (instance) => instance.artboardId === artboardId,
  )
  const issues: DesignQualityReview['issues'] = []
  const inBounds = roots.filter(
    (element) =>
      element.x >= artboard.x &&
      element.y >= artboard.y &&
      element.x + element.width <= artboard.x + artboard.width + 1 &&
      element.y + element.height <= artboard.y + artboard.height + 1,
  ).length
  const structure = roots.length ? inBounds / roots.length : 0
  const overlaps = countRootOverlaps(roots)
  const overflowingText = elements.filter(
    (element) => element.type === 'text' && textLikelyOverflows(element),
  )
  const readabilityPenalty = overlaps + overflowingText.length
  const readability = readabilityPenalty
    ? Math.max(
        0,
        1 -
          readabilityPenalty /
            Math.max(
              1,
              roots.length + elements.filter((element) => element.type === 'text').length,
            ),
      )
    : 1
  const componentReviews = instances.map((instance) => instance.design.qualityReview)
  const theme = average(componentReviews.map((review) => review?.scores.theme ?? 0.75))
  const completeness = instances.length
    ? instances.filter((instance) =>
        instance.design.assetTasks.every((task) =>
          elements.some((element) => element.componentBinding?.slotId === task.slotId),
        ),
      ).length / instances.length
    : elements.length
      ? 1
      : 0
  const runtimeStatuses = instances.map(
    (instance) => instance.design.runtimeValidation?.status ?? 'unsupported',
  )
  const developmentReadiness =
    average(
      runtimeStatuses.map((status) =>
        status === 'passed' ? 1 : status === 'unsupported' ? 0.5 : 0,
      ),
    ) || (elements.length ? 0.5 : 0)
  addIssue(issues, structure, 0.9, 'PAGE_STRUCTURE_INVALID', '页面存在越界根图层。')
  addIssue(issues, theme, 0.75, 'PAGE_THEME_INCONSISTENT', '组件主题一致性不足。')
  addIssue(issues, readability, 0.85, 'PAGE_ROOT_OVERLAP', '页面根模块存在非预期重叠。')
  if (overflowingText.length) {
    issues.push({
      code: 'PAGE_TEXT_OVERFLOW',
      severity: 'error',
      scope: 'page',
      targetId: overflowingText[0].id,
      message: `${overflowingText.length} 个文字图层可能超出容器。`,
      repairAction: '调整文字容器高度、字号、行高或溢出策略。',
    })
  }
  addIssue(issues, completeness, 1, 'PAGE_COMPONENT_INCOMPLETE', '页面组件或 Slot 不完整。')
  if (runtimeStatuses.some((status) => status === 'failed')) {
    issues.push({
      code: 'PAGE_RUNTIME_FAILED',
      severity: 'error',
      scope: 'runtime',
      message: '至少一个组件没有通过真实 Runtime 验证。',
      repairAction: '修复组件 Props、素材或 Runtime 错误后重新验证。',
    })
  } else if (runtimeStatuses.some((status) => status === 'unsupported')) {
    issues.push({
      code: 'PAGE_RUNTIME_UNSUPPORTED',
      severity: 'warning',
      scope: 'runtime',
      message: '页面设计可交付，但尚未配置全部真实组件 Runtime。',
      repairAction: '接入组件 Bundle Adapter 后升级为 runtime-verified。',
    })
  }
  const passed = !issues.some((issue) => issue.severity === 'error')
  const deliveryStatus = resolveDeliveryStatus({ passed }, runtimeStatuses)
  const editableCoverage =
    average(
      componentReviews.map(
        (review) =>
          review?.dimensions?.editableCoverage ??
          review?.scores.editableCoverage ??
          review?.scores.developmentReadiness ??
          0,
      ),
    ) || (elements.length ? 0.5 : 0)
  const dimensions = {
    themeAlignment: round(theme),
    layoutCompleteness: round(average([structure, completeness])),
    componentIntegrity: round(
      average([
        completeness,
        average(componentReviews.map((review) => (review?.passed === false ? 0 : 1))),
      ]),
    ),
    editableCoverage: round(editableCoverage),
    readability: round(readability),
  }
  const overall = round(
    dimensions.themeAlignment * 0.25 +
      dimensions.layoutCompleteness * 0.25 +
      dimensions.componentIntegrity * 0.2 +
      dimensions.editableCoverage * 0.2 +
      dimensions.readability * 0.1,
  )
  return {
    evalVersion: 1,
    passed,
    deliveryStatus,
    overall,
    dimensions,
    thresholds: {
      themeAlignment: 0.75,
      layoutCompleteness: 0.9,
      componentIntegrity: 0.9,
      editableCoverage: 0.8,
      readability: 0.85,
    },
    scores: {
      structure: round(structure),
      theme: round(theme),
      readability: round(readability),
      completeness: round(completeness),
      developmentReadiness: round(developmentReadiness),
      editableCoverage: round(editableCoverage),
    },
    issues,
    repairPlan: createDeliveryRepairPlan(issues),
    repairCount: componentReviews.reduce((total, review) => total + (review?.repairCount ?? 0), 0),
  }
}

function createDeliveryRepairPlan(
  issues: DesignQualityReview['issues'],
): NonNullable<DesignQualityReview['repairPlan']> {
  return issues.map((issue) => ({
    kind:
      issue.scope === 'runtime'
        ? 'runtime'
        : issue.targetId
          ? 'page-component'
          : issue.code.includes('THEME')
            ? 'page-shell'
            : 'page-layout',
    targetId: issue.targetId,
    issueCodes: [issue.code],
    reason: issue.message,
    action: issue.repairAction,
    automatic: issue.scope !== 'runtime',
  }))
}

function textLikelyOverflows(
  element: Extract<DesignDocument['elements'][number], { type: 'text' }>,
) {
  const fontSize = Math.max(1, element.style.fontSize || 16)
  const lineHeight = resolveTextLineHeightPixels(fontSize, element.style.lineHeight)
  const charactersPerLine = Math.max(1, Math.floor(element.width / (fontSize * 0.58)))
  const explicitLines = element.content.split(/\r?\n/)
  const estimatedLines = explicitLines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)),
    0,
  )
  return estimatedLines * lineHeight > element.height + 1
}

function resolveDeliveryStatus(
  review: Pick<DesignQualityReview, 'passed'>,
  runtimeStatuses: Array<'passed' | 'failed' | 'unsupported'>,
): DeliveryStatus {
  if (!review.passed) return runtimeStatuses.includes('failed') ? 'blocked' : 'diagnostic-only'
  if (runtimeStatuses.length > 0 && runtimeStatuses.every((status) => status === 'passed')) {
    return 'runtime-verified'
  }
  return 'design-ready'
}

function countRootOverlaps(elements: DesignDocument['elements']) {
  let count = 0
  for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
      const left = elements[leftIndex]
      const right = elements[rightIndex]
      if (
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
      )
        count += 1
    }
  }
  return count
}

function addIssue(
  issues: DesignQualityReview['issues'],
  score: number,
  threshold: number,
  code: string,
  message: string,
) {
  if (score >= threshold) return
  issues.push({
    code,
    severity: 'error',
    scope: 'page',
    message,
    repairAction: '修正页面结构后重新审查。',
  })
}

function unsupportedRuntime(componentName: string) {
  return {
    status: 'unsupported',
    consoleErrors: [],
    unknownProps: [],
    missingAssets: [],
    message: `${componentName} 未配置真实组件 Runtime Adapter。`,
  }
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function collectResourceDependencies(elements: DesignDocument['elements']) {
  return {
    remoteImages: Array.from(
      new Set(
        elements.flatMap((element) =>
          element.type === 'image' && /^https?:\/\//i.test(element.src) ? [element.src] : [],
        ),
      ),
    ),
    fonts: Array.from(
      new Set(
        elements.flatMap((element) =>
          element.type === 'text' && element.style.fontFamily ? [element.style.fontFamily] : [],
        ),
      ),
    ),
  }
}

function jsonEntry(name: string, value: unknown): ZipEntry {
  return { name, data: new TextEncoder().encode(JSON.stringify(value, null, 2)) }
}

function decodeDataUri(value: string) {
  const comma = value.indexOf(',')
  if (comma < 0) return new TextEncoder().encode(value)
  const metadata = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  if (!metadata.includes(';base64')) return new TextEncoder().encode(decodeURIComponent(payload))
  const binary = atob(payload)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function dataUriExtension(value: string) {
  const mime = /^data:([^;,]+)/.exec(value)?.[1]
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/svg+xml') return 'svg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

function safeName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
      .replace(/^-|-$/g, '') || 'asset'
  )
}

function replaceEmbeddedDataUris(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith('data:') ? '[packaged in component archive]' : value
  }
  if (Array.isArray(value)) return value.map(replaceEmbeddedDataUris)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, replaceEmbeddedDataUris(child)]),
  )
}
