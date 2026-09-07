import type { DesignPatch, GeneratedCanvasImage } from '../../ai/types'
import type { DesignDocument, DesignElement } from '../types'
import { computeSelectionTargetHash } from './selection-scope'
import { reviewScopedVisualQuality, type DesignGateReport } from './visual-quality-gate'

export const MAX_GATE_REPAIR_ATTEMPTS = 2

export type DesignPatchApplyResult =
  | {
      ok: true
      document: DesignDocument
      beforeSnapshot: DesignDocument
      affectedElementIds: string[]
      qualityReport: DesignGateReport
    }
  | { ok: false; errorCode: string; message: string; qualityReport?: DesignGateReport }

export function applyDesignPatchToDocument(
  document: DesignDocument,
  patch: DesignPatch,
  images: Record<string, GeneratedCanvasImage>,
): DesignPatchApplyResult {
  const beforeSnapshot = structuredClone(document)
  if (document.version !== patch.baseRevision) {
    return failed(
      'DOCUMENT_REVISION_CONFLICT',
      `画布已从 revision ${patch.baseRevision} 更新到 ${document.version}，局部修改未应用。`,
    )
  }
  if (!document.artboards.some((artboard) => artboard.id === patch.artboardId)) {
    return failed('DESIGN_PATCH_ARTBOARD_MISSING', 'DesignPatch 的目标画板不存在。')
  }
  const allowedTargets = patch.targetElementIds?.length
    ? new Set(patch.targetElementIds)
    : undefined
  if (allowedTargets && patch.targetHash) {
    const currentTargetHash = computeSelectionTargetHash(document, patch.targetElementIds!)
    if (!currentTargetHash || currentTargetHash !== patch.targetHash) {
      return failed('SELECTION_TARGET_CONFLICT', '局部修改目标已经变化，请重新选择后执行。')
    }
  }

  let elements = [...document.elements]
  const affected = new Set<string>()
  for (const operation of patch.operations) {
    if (operation.kind === 'add-image') {
      if (
        allowedTargets &&
        (!operation.element.parentId || !allowedTargets.has(operation.element.parentId))
      ) {
        return failed(
          'DESIGN_PATCH_SCOPE_VIOLATION',
          `新增图片超出当前选区：${operation.element.id}`,
        )
      }
      if (!images[operation.id]) {
        return failed('DESIGN_PATCH_IMAGE_INVALID', `新增图片结果无效：${operation.id}`)
      }
      if (elements.some((element) => element.id === operation.element.id)) {
        return failed('DESIGN_PATCH_ID_CONFLICT', `新增节点 ID 已存在：${operation.element.id}`)
      }
      const parent = elements.find((element) => element.id === operation.element.parentId)
      if (!parent) {
        return failed(
          'DESIGN_PATCH_PARENT_MISSING',
          `新增图片父级不存在：${operation.element.parentId}`,
        )
      }
      if (parent.designRole !== 'design-block') {
        return failed(
          'DESIGN_PATCH_TARGET_FORBIDDEN',
          `只能向设计模块新增图片：${operation.element.parentId}`,
        )
      }
      if (!containsBounds(parent, operation.element)) {
        return failed(
          'DESIGN_PATCH_SCOPE_VIOLATION',
          `新增图片超出目标模块边界：${operation.element.id}`,
        )
      }
      const added = {
        ...operation.element,
        artboardId: patch.artboardId,
        src: images[operation.id].src,
      } as DesignElement
      if (!isValidElement(added))
        return failed('DESIGN_PATCH_ELEMENT_INVALID', `新增图片节点无效：${operation.element.id}`)
      elements.push(added)
      affected.add(added.id)
      continue
    }
    if (operation.kind === 'add') {
      if (
        allowedTargets &&
        (!operation.element.parentId || !allowedTargets.has(operation.element.parentId))
      ) {
        return failed(
          'DESIGN_PATCH_SCOPE_VIOLATION',
          `新增节点超出当前选区：${operation.element.id}`,
        )
      }
      if (elements.some((element) => element.id === operation.element.id)) {
        return failed('DESIGN_PATCH_ID_CONFLICT', `新增节点 ID 已存在：${operation.element.id}`)
      }
      if (
        operation.element.parentId &&
        !elements.some((element) => element.id === operation.element.parentId)
      ) {
        return failed(
          'DESIGN_PATCH_PARENT_MISSING',
          `新增节点父级不存在：${operation.element.parentId}`,
        )
      }
      const added = { ...operation.element, artboardId: patch.artboardId } as DesignElement
      if (!isValidElement(added))
        return failed('DESIGN_PATCH_ELEMENT_INVALID', `新增节点无效：${operation.element.id}`)
      elements.push(added)
      affected.add(added.id)
      continue
    }

    const index = elements.findIndex((element) => element.id === operation.elementId)
    if (index < 0)
      return failed('DESIGN_PATCH_TARGET_MISSING', `目标节点不存在：${operation.elementId}`)
    if (allowedTargets && !allowedTargets.has(operation.elementId)) {
      return failed(
        'DESIGN_PATCH_SCOPE_VIOLATION',
        `Patch 试图修改选区外节点：${operation.elementId}`,
      )
    }
    const target = elements[index]
    const canEditBoundImageRegion =
      operation.kind === 'replace-image-region' &&
      target.type === 'image' &&
      Boolean(target.componentBinding?.bindings.image)
    if (
      target.artboardId !== patch.artboardId ||
      target.designRole === 'page-shell' ||
      (Boolean(target.componentBinding) && !canEditBoundImageRegion)
    ) {
      return failed('DESIGN_PATCH_TARGET_FORBIDDEN', `目标节点不允许通用 Patch 修改：${target.id}`)
    }

    if (operation.kind === 'delete') {
      const removalIds = collectDescendants(elements, target.id)
      elements = elements.filter((element) => !removalIds.has(element.id))
      removalIds.forEach((id) => affected.add(id))
      continue
    }
    if (operation.kind === 'move') {
      if (operation.parentId && !elements.some((element) => element.id === operation.parentId)) {
        return failed('DESIGN_PATCH_PARENT_MISSING', `移动目标父级不存在：${operation.parentId}`)
      }
      elements[index] = {
        ...target,
        ...(Number.isFinite(operation.x) ? { x: operation.x } : {}),
        ...(Number.isFinite(operation.y) ? { y: operation.y } : {}),
        ...(operation.parentId ? { parentId: operation.parentId } : {}),
      }
    } else if (operation.kind === 'replace-text-range') {
      if (target.type !== 'text') {
        return failed('DESIGN_PATCH_TEXT_RANGE_INVALID', `文本范围目标不是文本节点：${target.id}`)
      }
      if (
        !Number.isInteger(operation.start) ||
        !Number.isInteger(operation.end) ||
        operation.start < 0 ||
        operation.end <= operation.start ||
        operation.end > target.content.length ||
        target.content.slice(operation.start, operation.end) !== operation.expectedText
      ) {
        return failed('DESIGN_PATCH_TEXT_RANGE_CONFLICT', `文本选区已经变化：${target.id}`)
      }
      elements[index] = {
        ...target,
        content:
          target.content.slice(0, operation.start) +
          operation.replacement +
          target.content.slice(operation.end),
      }
    } else if (operation.kind === 'replace-image' || operation.kind === 'replace-image-region') {
      if (target.type !== 'image' || !images[operation.id]) {
        return failed('DESIGN_PATCH_IMAGE_INVALID', `图片替换结果无效：${operation.id}`)
      }
      elements[index] = { ...target, src: images[operation.id].src }
    } else if (operation.kind === 'semantic-update') {
      elements[index] = applySemanticChanges(target, operation.semantic)
    } else {
      elements[index] = mergeElementChanges(target, operation.changes)
    }
    affected.add(target.id)
  }

  let nextDocument: DesignDocument = {
    ...document,
    version: document.version + 1,
    elements,
    updatedAt: new Date().toISOString(),
  }
  const artboard = document.artboards.find((item) => item.id === patch.artboardId)!
  const targetIds = [...affected]
  const expectedDeletedIds = patch.operations
    .filter((operation) => operation.kind === 'delete')
    .map((operation) => operation.elementId)
  let repairCount = 0
  let qualityReport = reviewScopedVisualQuality(nextDocument, artboard, targetIds, 'operation', {
    beforeDocument: beforeSnapshot,
    expectedDeletedIds,
    repairCount,
  })
  while (!qualityReport.passed && repairCount < MAX_GATE_REPAIR_ATTEMPTS) {
    const repaired = applySafeGateRepairs(nextDocument, artboard, qualityReport, new Set(targetIds))
    if (!repaired) break
    repairCount += 1
    nextDocument = repaired
    qualityReport = reviewScopedVisualQuality(nextDocument, artboard, targetIds, 'operation', {
      beforeDocument: beforeSnapshot,
      expectedDeletedIds,
      repairCount,
    })
  }
  if (!qualityReport.passed) {
    return {
      ok: false,
      errorCode: 'DESIGN_GATE_FAILED',
      message: `设计门禁未通过：${qualityReport.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；')}`,
      qualityReport,
    }
  }
  return {
    ok: true,
    beforeSnapshot,
    affectedElementIds: [...affected],
    document: nextDocument,
    qualityReport,
  }
}

function applySafeGateRepairs(
  document: DesignDocument,
  artboard: DesignDocument['artboards'][number],
  report: DesignGateReport,
  allowedTargets: Set<string>,
): DesignDocument | undefined {
  const repairableIds = new Set(
    report.issues
      .filter((issue) => issue.code === 'overflow' || issue.code === 'invalid-size')
      .flatMap((issue) => issue.elementIds ?? [])
      .filter((id) => allowedTargets.has(id)),
  )
  if (!repairableIds.size) return undefined
  return {
    ...document,
    elements: document.elements.map((element) => {
      if (!repairableIds.has(element.id)) return element
      const width = Math.min(
        Math.max(1, Number.isFinite(element.width) ? element.width : 1),
        artboard.width,
      )
      const height = Math.min(
        Math.max(1, Number.isFinite(element.height) ? element.height : 1),
        artboard.height,
      )
      return {
        ...element,
        width,
        height,
        x: Math.min(Math.max(artboard.x, element.x), artboard.x + artboard.width - width),
        y: Math.min(Math.max(artboard.y, element.y), artboard.y + artboard.height - height),
      } as DesignElement
    }),
  }
}

function applySemanticChanges(
  element: DesignElement,
  semantic: Extract<DesignPatch['operations'][number], { kind: 'semantic-update' }>['semantic'],
): DesignElement {
  const layout = semantic.layout
  const appearance = semantic.appearance
  let next: DesignElement = {
    ...element,
    ...(appearance?.opacity !== undefined ? { opacity: appearance.opacity } : {}),
    ...(appearance?.cornerRadii ? { cornerRadii: appearance.cornerRadii } : {}),
    ...(layout?.widthMode || layout?.heightMode
      ? {
          layoutSizing: {
            widthMode: layout.widthMode ?? element.layoutSizing?.widthMode ?? 'fixed',
            heightMode: layout.heightMode ?? element.layoutSizing?.heightMode ?? 'fixed',
            minWidth: layout.minWidth ?? element.layoutSizing?.minWidth,
            maxWidth: layout.maxWidth ?? element.layoutSizing?.maxWidth,
            minHeight: layout.minHeight ?? element.layoutSizing?.minHeight,
            maxHeight: layout.maxHeight ?? element.layoutSizing?.maxHeight,
          },
        }
      : {}),
    ...(layout?.horizontalConstraint || layout?.verticalConstraint
      ? {
          layoutConstraints: {
            horizontal:
              layout.horizontalConstraint ?? element.layoutConstraints?.horizontal ?? 'left',
            vertical: layout.verticalConstraint ?? element.layoutConstraints?.vertical ?? 'top',
          },
        }
      : {}),
  } as DesignElement
  if (next.type === 'section' && next.autoLayout && layout) {
    const [justify, align] = String(layout.alignment ?? '').split(':')
    next = {
      ...next,
      autoLayout: {
        ...next.autoLayout,
        ...(layout.gap !== undefined ? { gap: layout.gap } : {}),
        ...(layout.padding ? { padding: layout.padding } : {}),
        ...(['start', 'center', 'end'].includes(justify)
          ? { justify: justify as 'start' | 'center' | 'end' }
          : {}),
        ...(['start', 'center', 'end'].includes(align)
          ? { align: align as 'start' | 'center' | 'end' }
          : {}),
      },
    }
  }
  return next
}

function mergeElementChanges(
  element: DesignElement,
  changes: Record<string, unknown>,
): DesignElement {
  if (
    (element.type === 'text' || element.type === 'button' || element.type === 'input') &&
    changes.style &&
    typeof changes.style === 'object'
  ) {
    return {
      ...element,
      ...changes,
      style: { ...element.style, ...changes.style },
    } as DesignElement
  }
  if (element.type === 'section' && changes.autoLayout && typeof changes.autoLayout === 'object') {
    return {
      ...element,
      ...changes,
      autoLayout: { ...element.autoLayout, ...changes.autoLayout },
    } as DesignElement
  }
  return { ...element, ...changes } as DesignElement
}

function collectDescendants(elements: DesignElement[], rootId: string) {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const element of elements) {
      if (element.parentId && ids.has(element.parentId) && !ids.has(element.id)) {
        ids.add(element.id)
        changed = true
      }
    }
  }
  return ids
}

function isValidElement(element: DesignElement) {
  return Boolean(
    element.id &&
    element.name &&
    element.artboardId &&
    ['section', 'shape', 'text', 'button', 'image'].includes(element.type) &&
    Number.isFinite(element.x) &&
    Number.isFinite(element.y) &&
    Number.isFinite(element.width) &&
    element.width > 0 &&
    Number.isFinite(element.height) &&
    element.height > 0,
  )
}

function containsBounds(parent: DesignElement, child: { x?: number; y?: number; width?: number; height?: number }) {
  if (
    !Number.isFinite(child.x) ||
    !Number.isFinite(child.y) ||
    !Number.isFinite(child.width) ||
    !Number.isFinite(child.height)
  )
    return false
  const epsilon = 0.5
  return (
    child.x! >= parent.x - epsilon &&
    child.y! >= parent.y - epsilon &&
    child.x! + child.width! <= parent.x + parent.width + epsilon &&
    child.y! + child.height! <= parent.y + parent.height + epsilon
  )
}

function failed(errorCode: string, message: string): DesignPatchApplyResult {
  return { ok: false, errorCode, message }
}
