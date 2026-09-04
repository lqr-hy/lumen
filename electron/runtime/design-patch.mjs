import { createRuntimeError } from './providers.mjs'

const OPERATION_KINDS = new Set([
  'update',
  'semantic-update',
  'move',
  'delete',
  'add',
  'replace-image',
  'replace-text-range',
  'replace-image-region',
])
const ADD_ELEMENT_TYPES = new Set(['section', 'shape', 'text', 'button'])
const COMMON_CHANGES = new Set([
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'zIndex',
])
const TYPE_CHANGES = {
  section: new Set(['label', 'clipContent', 'autoLayout']),
  shape: new Set(['shape', 'fill', 'stroke', 'strokeWidth', 'borderRadius']),
  text: new Set(['content', 'style']),
  button: new Set(['content', 'style']),
  image: new Set(['objectFit', 'objectPosition', 'borderRadius']),
}

export function normalizeDesignPatch(input, context = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const normalizedOperations = Array.isArray(source.operations)
    ? source.operations
        .slice(0, 24)
        .map((operation, index) => normalizeOperation(operation, index))
        .filter(Boolean)
    : []
  const operations = context.textRange
    ? constrainTextRangeOperations(normalizedOperations, context.textRange)
    : context.imageRegion
      ? constrainImageRegionOperations(normalizedOperations, context.imageRegion)
      : normalizedOperations
  return {
    version: 1,
    baseRevision:
      finiteInteger(source.baseRevision) ?? finiteInteger(context.documentRevision) ?? 0,
    artboardId: cleanText(source.artboardId, context.artboardId),
    ...(cleanText(context.scopeId) ? { scopeId: cleanText(context.scopeId) } : {}),
    ...(cleanText(context.targetHash) ? { targetHash: cleanText(context.targetHash) } : {}),
    ...(Array.isArray(context.targetElementIds)
      ? {
          targetElementIds: [
            ...new Set(
              context.targetElementIds.filter((id) => typeof id === 'string' && id.trim()),
            ),
          ],
        }
      : {}),
    summary: cleanText(source.summary, cleanText(context.goal, '局部修改设计稿')),
    operations,
  }
}

export function validateDesignPatch(patch, canvasSnapshot) {
  const issues = []
  const elements = new Map((canvasSnapshot?.elements ?? []).map((element) => [element.id, element]))
  const allowedTargets =
    Array.isArray(patch?.targetElementIds) && patch.targetElementIds.length
      ? new Set(patch.targetElementIds)
      : undefined
  if (patch?.version !== 1) issues.push('version 必须为 1')
  if (!patch?.artboardId || patch.artboardId !== canvasSnapshot?.artboardId)
    issues.push('artboardId 与目标画板不一致')
  if (!Number.isInteger(patch?.baseRevision)) issues.push('baseRevision 无效')
  if (!Array.isArray(patch?.operations) || !patch.operations.length)
    issues.push('缺少 Patch Operation')
  for (const operation of patch?.operations ?? []) {
    if (!OPERATION_KINDS.has(operation.kind)) {
      issues.push(`${operation.id} 的操作类型无效`)
      continue
    }
    if (operation.kind === 'add') {
      if (!ADD_ELEMENT_TYPES.has(operation.element?.type))
        issues.push(`${operation.id} 的新增节点类型无效`)
      if (operation.element?.parentId && !elements.has(operation.element.parentId))
        issues.push(`${operation.id} 的 parentId 不存在`)
      if (
        allowedTargets &&
        (!operation.element?.parentId || !allowedTargets.has(operation.element.parentId))
      ) {
        issues.push(`${operation.id} 的新增节点超出当前选区`)
      }
      continue
    }
    if (allowedTargets && !allowedTargets.has(operation.elementId)) {
      issues.push(`${operation.id} 的目标节点超出当前选区`)
      continue
    }
    const target = elements.get(operation.elementId)
    if (!target) {
      issues.push(`${operation.id} 的目标节点不存在`)
      continue
    }
    const canEditBoundImageRegion =
      operation.kind === 'replace-image-region' &&
      target.type === 'image' &&
      target.componentImageBinding === true
    if (
      target.designRole === 'page-shell' ||
      ((target.componentName || target.instanceId) && !canEditBoundImageRegion)
    ) {
      issues.push(`${operation.id} 不能修改业务组件或 Page Shell`)
    }
    if (
      operation.kind === 'update' &&
      operation.elementType &&
      operation.elementType !== target.type
    ) {
      issues.push(`${operation.id} 声明的节点类型与目标节点不一致`)
    }
    if (operation.kind === 'replace-image' && target.type !== 'image') {
      issues.push(`${operation.id} 只能替换图片节点`)
    }
    if (operation.kind === 'replace-image-region' && target.type !== 'image') {
      issues.push(`${operation.id} 只能局部替换图片节点`)
    }
    if (operation.kind === 'replace-image-region' && !operation.normalizedRect) {
      issues.push(`${operation.id} 缺少有效的图片局部范围`)
    }
    if (operation.kind === 'replace-text-range') {
      const content =
        typeof target.properties?.content === 'string'
          ? target.properties.content
          : typeof target.content === 'string'
            ? target.content
            : undefined
      if (target.type !== 'text') {
        issues.push(`${operation.id} 只能替换文本节点的局部范围`)
      } else if (
        typeof content !== 'string' ||
        !Number.isInteger(operation.start) ||
        !Number.isInteger(operation.end) ||
        operation.start < 0 ||
        operation.end <= operation.start ||
        operation.end > content.length ||
        content.slice(operation.start, operation.end) !== operation.expectedText
      ) {
        issues.push(`${operation.id} 的文本范围与当前节点内容不一致`)
      }
    }
  }
  return issues
}

export function assertDesignPatch(patch, canvasSnapshot) {
  const issues = validateDesignPatch(patch, canvasSnapshot)
  if (issues.length) throw createRuntimeError('DESIGN_PATCH_INVALID', issues.join('；'))
  return patch
}

function normalizeOperation(value, index) {
  if (!value || typeof value !== 'object' || !OPERATION_KINDS.has(value.kind)) return undefined
  const id = cleanText(value.id, `operation-${index + 1}`)
  if (value.kind === 'add') {
    const element = normalizeAddedElement(value.element, index)
    return element ? { id, kind: 'add', element } : undefined
  }
  const elementId = cleanText(value.elementId)
  if (!elementId) return undefined
  if (value.kind === 'delete') return { id, kind: 'delete', elementId }
  if (value.kind === 'move') {
    return {
      id,
      kind: 'move',
      elementId,
      x: finiteNumber(value.x),
      y: finiteNumber(value.y),
      ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {}),
    }
  }
  if (value.kind === 'replace-image') {
    return {
      id,
      kind: 'replace-image',
      elementId,
      prompt: cleanText(value.prompt, '重新生成当前图片'),
    }
  }
  if (value.kind === 'replace-image-region') {
    return {
      id,
      kind: 'replace-image-region',
      elementId,
      prompt: cleanText(value.prompt, '重新绘制当前图片的选中区域'),
      normalizedRect: normalizeUnitRect(value.normalizedRect),
    }
  }
  if (value.kind === 'replace-text-range') {
    return {
      id,
      kind: 'replace-text-range',
      elementId,
      start: finiteInteger(value.start),
      end: finiteInteger(value.end),
      expectedText: typeof value.expectedText === 'string' ? value.expectedText : '',
      replacement: typeof value.replacement === 'string' ? value.replacement.slice(0, 4000) : '',
    }
  }
  if (value.kind === 'semantic-update') {
    return {
      id,
      kind: 'semantic-update',
      elementId,
      semantic: normalizeSemanticChanges(value.semantic),
    }
  }
  const elementType = cleanText(value.elementType)
  return {
    id,
    kind: 'update',
    elementId,
    elementType,
    changes: normalizeChanges(value.changes, elementType),
  }
}

function constrainTextRangeOperations(operations, scope) {
  const candidate = operations.find((operation) => operation.kind === 'replace-text-range')
  if (!candidate || typeof candidate.replacement !== 'string') return []
  return [
    {
      id: candidate.id,
      kind: 'replace-text-range',
      elementId: scope.elementId,
      start: scope.start,
      end: scope.end,
      expectedText: scope.selectedText,
      replacement: candidate.replacement,
    },
  ]
}

function constrainImageRegionOperations(operations, scope) {
  const candidate = operations.find((operation) => operation.kind === 'replace-image-region')
  if (!candidate) return []
  return [
    {
      id: candidate.id,
      kind: 'replace-image-region',
      elementId: scope.elementId,
      prompt: candidate.prompt,
      normalizedRect: { ...scope.normalizedRect },
    },
  ]
}

function normalizeUnitRect(value) {
  if (!value || typeof value !== 'object') return undefined
  const x = clamp(finiteNumber(value.x), 0, 1)
  const y = clamp(finiteNumber(value.y), 0, 1)
  const width = clamp(finiteNumber(value.width), 0, 1 - (x ?? 0))
  const height = clamp(finiteNumber(value.height), 0, 1 - (y ?? 0))
  return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
    ? { x, y, width, height }
    : undefined
}

function normalizeSemanticChanges(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const layout = source.layout && typeof source.layout === 'object' ? source.layout : {}
  const appearance =
    source.appearance && typeof source.appearance === 'object' ? source.appearance : {}
  const sizeModes = new Set(['fixed', 'hug', 'fill'])
  const horizontalConstraints = new Set(['left', 'center', 'right', 'stretch'])
  const verticalConstraints = new Set(['top', 'center', 'bottom', 'stretch'])
  return {
    layout: {
      ...(sizeModes.has(layout.widthMode) ? { widthMode: layout.widthMode } : {}),
      ...(sizeModes.has(layout.heightMode) ? { heightMode: layout.heightMode } : {}),
      ...(Number.isFinite(Number(layout.minWidth))
        ? { minWidth: clamp(Number(layout.minWidth), 0, 10000) }
        : {}),
      ...(Number.isFinite(Number(layout.maxWidth))
        ? { maxWidth: clamp(Number(layout.maxWidth), 0, 10000) }
        : {}),
      ...(Number.isFinite(Number(layout.minHeight))
        ? { minHeight: clamp(Number(layout.minHeight), 0, 10000) }
        : {}),
      ...(Number.isFinite(Number(layout.maxHeight))
        ? { maxHeight: clamp(Number(layout.maxHeight), 0, 10000) }
        : {}),
      ...(horizontalConstraints.has(layout.horizontalConstraint)
        ? { horizontalConstraint: layout.horizontalConstraint }
        : {}),
      ...(verticalConstraints.has(layout.verticalConstraint)
        ? { verticalConstraint: layout.verticalConstraint }
        : {}),
      ...(Number.isFinite(Number(layout.gap)) ? { gap: clamp(Number(layout.gap), 0, 1000) } : {}),
      ...(normalizeFourValues(layout.padding, ['top', 'right', 'bottom', 'left'])
        ? { padding: normalizeFourValues(layout.padding, ['top', 'right', 'bottom', 'left']) }
        : {}),
      ...(typeof layout.alignment === 'string' ? { alignment: layout.alignment.slice(0, 40) } : {}),
    },
    appearance: {
      ...(Number.isFinite(Number(appearance.opacity))
        ? { opacity: clamp(Number(appearance.opacity), 0, 1) }
        : {}),
      ...(normalizeFourValues(appearance.cornerRadii, [
        'topLeft',
        'topRight',
        'bottomRight',
        'bottomLeft',
      ])
        ? {
            cornerRadii: normalizeFourValues(appearance.cornerRadii, [
              'topLeft',
              'topRight',
              'bottomRight',
              'bottomLeft',
            ]),
          }
        : {}),
    },
  }
}

function normalizeFourValues(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = keys.map((key) => [key, clamp(finiteNumber(value[key]), 0, 1000)])
  return entries.every(([, item]) => item !== undefined) ? Object.fromEntries(entries) : undefined
}

function normalizeChanges(value, elementType) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const allowed = new Set([...COMMON_CHANGES, ...(TYPE_CHANGES[elementType] ?? [])])
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => allowed.has(key))
      .map(([key, item]) => [key, normalizeChangeValue(key, item, elementType)])
      .filter(([, item]) => item !== undefined),
  )
}

function normalizeChangeValue(key, value, elementType) {
  if (['x', 'y', 'rotation', 'zIndex', 'strokeWidth', 'borderRadius'].includes(key))
    return finiteNumber(value)
  if (['width', 'height'].includes(key)) return clamp(finiteNumber(value), 1, 10000)
  if (key === 'opacity') return clamp(finiteNumber(value), 0, 1)
  if (key === 'visible' || key === 'clipContent')
    return typeof value === 'boolean' ? value : undefined
  if (key === 'style') return normalizeStylePatch(value, elementType)
  if (key === 'autoLayout') return normalizeAutoLayoutPatch(value)
  return typeof value === 'string' ? value.slice(0, 2000) : undefined
}

function normalizeStylePatch(value, elementType) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const allowed =
    elementType === 'text'
      ? new Set([
          'fontSize',
          'fontWeight',
          'color',
          'lineHeight',
          'textAlign',
          'fontFamily',
          'overflow',
        ])
      : elementType === 'button'
        ? new Set(['background', 'color', 'fontSize', 'fontWeight', 'borderRadius'])
        : new Set()
  const result = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowed.has(key))
      .map(([key, item]) => {
        if (['fontSize', 'fontWeight', 'lineHeight', 'borderRadius'].includes(key))
          return [key, finiteNumber(item)]
        return [key, typeof item === 'string' ? item.slice(0, 500) : undefined]
      })
      .filter(([, item]) => item !== undefined),
  )
  return Object.keys(result).length ? result : undefined
}

function normalizeAutoLayoutPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = {
    ...(['vertical', 'horizontal'].includes(value.direction) ? { direction: value.direction } : {}),
    ...(Number.isFinite(Number(value.gap)) ? { gap: clamp(Number(value.gap), 0, 1000) } : {}),
    ...(normalizeFourValues(value.padding, ['top', 'right', 'bottom', 'left'])
      ? { padding: normalizeFourValues(value.padding, ['top', 'right', 'bottom', 'left']) }
      : {}),
    ...(['start', 'center', 'end'].includes(value.align) ? { align: value.align } : {}),
    ...(['start', 'center', 'end', 'space-between'].includes(value.justify)
      ? { justify: value.justify }
      : {}),
  }
  return Object.keys(result).length ? result : undefined
}

function normalizeAddedElement(value, index) {
  if (!value || !ADD_ELEMENT_TYPES.has(value.type)) return undefined
  const type = value.type
  const base = {
    id: cleanText(value.id, `patch-node-${index + 1}`),
    type,
    name: cleanText(value.name, `新增${type}`),
    parentId: typeof value.parentId === 'string' ? value.parentId : undefined,
    x: finiteNumber(value.x) ?? 0,
    y: finiteNumber(value.y) ?? 0,
    width: clamp(finiteNumber(value.width) ?? 120, 1, 10000),
    height: clamp(finiteNumber(value.height) ?? 40, 1, 10000),
    zIndex: finiteNumber(value.zIndex) ?? 10,
  }
  if (type === 'section') return { ...base, label: cleanText(value.label, base.name) }
  if (type === 'shape')
    return {
      ...base,
      shape: value.shape === 'circle' ? 'circle' : 'rect',
      fill: cleanText(value.fill, '#ffffff'),
    }
  if (type === 'text')
    return {
      ...base,
      content: cleanText(value.content, '文本'),
      style: normalizeTextStyle(value.style),
    }
  if (type === 'button')
    return {
      ...base,
      content: cleanText(value.content, '按钮'),
      style: normalizeButtonStyle(value.style),
    }
  return undefined
}

function normalizeTextStyle(value) {
  return {
    fontSize: clamp(finiteNumber(value?.fontSize) ?? 16, 6, 200),
    color: cleanText(value?.color, '#182230'),
  }
}

function normalizeButtonStyle(value) {
  return {
    background: cleanText(value?.background, '#2563eb'),
    color: cleanText(value?.color, '#ffffff'),
    fontSize: clamp(finiteNumber(value?.fontSize) ?? 14, 6, 100),
    borderRadius: clamp(finiteNumber(value?.borderRadius) ?? 6, 0, 1000),
  }
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function finiteInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : undefined
}

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : undefined
}
