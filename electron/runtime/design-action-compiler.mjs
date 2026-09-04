import { normalizeDesignPatch } from './design-patch.mjs'

const TEXT_REPLACEMENT_PATTERN =
  /(?:改成|改为|换成|替换为|修改为)\s*[“"「『]?(.+?)[”"」』]?(?:[。.!！?？]|$)/
const STYLE_WORD_PATTERN = /(背景|底色|填充|颜色|色值|透明度|圆角|边框)/
const COLOR_WORDS = {
  红色: '#ef4444',
  蓝色: '#3b82f6',
  绿色: '#22c55e',
  黄色: '#eab308',
  橙色: '#f97316',
  紫色: '#8b5cf6',
  粉色: '#ec4899',
  黑色: '#111827',
  白色: '#ffffff',
  灰色: '#6b7280',
}

/**
 * Compile only unambiguous, low-risk edits. Anything else remains a model task.
 */
export function compileDesignAction({ goal, scope, snapshot }) {
  if (!['generic-node', 'text-range'].includes(scope?.type)) return undefined
  const target = resolveTarget(scope, snapshot, goal)
  const targetType = target?.type || scope.elementType
  // text-range has its own strict replacement protocol and must not be compiled here.
  if (scope?.type !== 'generic-node' || STYLE_WORD_PATTERN.test(String(goal || ''))) {
    return compileColorAction({ goal, scope, snapshot, target })
  }
  if (targetType !== 'text') return undefined

  const currentContent =
    typeof target?.properties?.content === 'string'
      ? target.properties.content
      : typeof target?.content === 'string'
        ? target.content
        : scope.name || ''
  const match = String(goal || '')
    .trim()
    .match(TEXT_REPLACEMENT_PATTERN)
  const replacement = match?.[1]?.trim()
  if (
    !currentContent ||
    !replacement ||
    replacement === currentContent ||
    replacement.length > 4000
  )
    return undefined
  if (/[，,、；;]|并|然后|同时/.test(replacement)) return undefined

  const rawPatch = {
    version: 1,
    baseRevision: snapshot.documentRevision,
    artboardId: snapshot.artboardId,
    summary: `将${target.name || scope.name || '文本'}改为${replacement}`,
    operations: [
      {
        id: 'deterministic-text-update',
        kind: 'update',
        elementId: target.id,
        elementType: 'text',
        changes: { content: replacement },
      },
    ],
  }
  return {
    kind: 'text-content',
    patch: normalizeDesignPatch(rawPatch, {
      documentRevision: snapshot.documentRevision,
      artboardId: snapshot.artboardId,
      scopeId: scope.scopeId,
      targetHash: scope.targetHash,
      targetElementIds: scope.targetElementIds,
    }),
    summary: rawPatch.summary,
  }
}

function compileColorAction({ goal, scope, snapshot, target }) {
  if (!target || !['shape', 'button'].includes(target.type)) return undefined
  const text = String(goal || '')
  if (!STYLE_WORD_PATTERN.test(text)) return undefined
  const color = parseColor(text)
  if (!color) return undefined
  const isButton = target.type === 'button'
  const changes = isButton
    ? { style: { ...target.properties?.style, background: color } }
    : { fill: color }
  const rawPatch = {
    version: 1,
    baseRevision: snapshot.documentRevision,
    artboardId: snapshot.artboardId,
    summary: `将${target.name || scope.name || (isButton ? '按钮' : '图形')}背景改为${color}`,
    operations: [
      {
        id: 'deterministic-color-update',
        kind: 'update',
        elementId: target.id,
        elementType: target.type,
        changes,
      },
    ],
  }
  return {
    kind: 'color-style',
    patch: normalizeDesignPatch(rawPatch, {
      documentRevision: snapshot.documentRevision,
      artboardId: snapshot.artboardId,
      scopeId: scope.scopeId,
      targetHash: scope.targetHash,
      targetElementIds: scope.targetElementIds,
    }),
    summary: rawPatch.summary,
  }
}

function parseColor(value) {
  const hex = String(value || '').match(/#[0-9a-f]{3,8}\b/i)?.[0]
  if (hex) return hex
  const matchedWord = Object.keys(COLOR_WORDS).find((word) => String(value || '').includes(word))
  return matchedWord ? COLOR_WORDS[matchedWord] : undefined
}

export function describeDesignActionContext({ goal, scope, snapshot }) {
  const target = resolveTarget(scope, snapshot, goal)
  return {
    runtimeVersion: 'action-compiler-v2',
    goal: String(goal || ''),
    scopeType: scope?.type,
    scopeElementId: scope?.elementId,
    scopeElementType: scope?.elementType,
    targetId: target?.id,
    targetType: target?.type,
    targetFound: Boolean(target),
    snapshotRevision: snapshot?.documentRevision,
  }
}

function resolveTarget(scope, snapshot, goal = '') {
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : []
  const ids = [
    scope?.elementId,
    ...(Array.isArray(scope?.targetElementIds) ? scope.targetElementIds : []),
  ].filter((id, index, list) => typeof id === 'string' && id && list.indexOf(id) === index)
  const candidates = ids.map((id) => elements.find((element) => element.id === id)).filter(Boolean)
  // Canvas hit testing may freeze the surrounding Shape while the user meant
  // its text child. For an explicit text replacement, prefer that child from
  // the already-frozen editable subtree; never search outside the Scope.
  if (
    /(?:改成|改为|换成|替换为|修改为)/.test(String(goal || '')) &&
    !STYLE_WORD_PATTERN.test(String(goal || ''))
  ) {
    const textTarget = candidates.find((element) => element.type === 'text')
    if (textTarget) return textTarget
  }
  return candidates[0]
}

export function extractDesignPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  if (input.designPatch && typeof input.designPatch === 'object') return input.designPatch
  if (input.data?.designPatch && typeof input.data.designPatch === 'object')
    return input.data.designPatch
  if (input.data && typeof input.data === 'object' && Array.isArray(input.data.operations))
    return input.data
  if (Array.isArray(input.operations)) return input
  return undefined
}
