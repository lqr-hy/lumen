import { normalizeDesignPatch } from './design-patch.mjs'

const ACTIONS = new Set([
  'replace-text',
  'set-style',
  'set-layout',
  'move',
  'set-visibility',
  'replace-image',
])

export function extractDesignAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  return (
    input.designAction ||
    input.data?.designAction ||
    input.data?.action ||
    (ACTIONS.has(input.action) ? input : undefined)
  )
}

export function compileDesignActionResult(action, { snapshot, scope, goal }) {
  if (!action || !ACTIONS.has(action.action)) return undefined
  const targetId =
    typeof action.target?.nodeId === 'string' ? action.target.nodeId : action.elementId
  if (!targetId || !scope?.targetElementIds?.includes(targetId)) return undefined
  const target = snapshot?.elements?.find((element) => element.id === targetId)
  if (!target || !isActionTargetValid(action, target)) return undefined
  const operation = toOperation(action, target)
  if (!operation) return undefined
  const patch = normalizeDesignPatch(
    {
      version: 1,
      baseRevision: snapshot.documentRevision,
      artboardId: snapshot.artboardId,
      summary: action.summary || `根据用户要求修改${target.name || target.id}`,
      operations: [operation],
    },
    {
      documentRevision: snapshot.documentRevision,
      artboardId: snapshot.artboardId,
      goal,
      scopeId: scope.scopeId,
      targetHash: scope.targetHash,
      targetElementIds: scope.targetElementIds,
    },
  )
  return { patch, actionKind: action.action, targetId, summary: patch.summary }
}

function isActionTargetValid(action, target) {
  if (action.action === 'replace-text')
    return target.type === 'text' && typeof action.value === 'string'
  if (action.action === 'replace-image') return target.type === 'image'
  if (action.action === 'set-style')
    return ['shape', 'button', 'text', 'image'].includes(target.type)
  if (
    action.action === 'set-layout' ||
    action.action === 'move' ||
    action.action === 'set-visibility'
  )
    return true
  return false
}

function toOperation(action, target) {
  const id = `ai-action-${action.action}`
  if (action.action === 'replace-text')
    return {
      id,
      kind: 'update',
      elementId: target.id,
      elementType: 'text',
      changes: { content: action.value },
    }
  if (action.action === 'replace-image')
    return {
      id,
      kind: 'replace-image',
      elementId: target.id,
      prompt: action.prompt || '重新生成当前图片',
    }
  if (action.action === 'move')
    return { id, kind: 'move', elementId: target.id, x: action.x, y: action.y }
  if (action.action === 'set-visibility')
    return {
      id,
      kind: 'update',
      elementId: target.id,
      elementType: target.type,
      changes: { visible: action.visible === true },
    }
  if (action.action === 'set-layout')
    return {
      id,
      kind: 'semantic-update',
      elementId: target.id,
      semantic: { layout: action.layout || {} },
    }
  if (action.action === 'set-style') {
    if (target.type === 'shape') {
      const property = ['fill', 'stroke', 'borderRadius', 'strokeWidth', 'opacity'].includes(
        action.property,
      )
        ? action.property
        : 'fill'
      return {
        id,
        kind: 'update',
        elementId: target.id,
        elementType: target.type,
        changes: { [property]: action.value },
      }
    }
    if (target.type === 'button' || target.type === 'text') {
      const property =
        target.type === 'button'
          ? ['background', 'color', 'fontSize', 'fontWeight', 'borderRadius'].includes(
              action.property,
            )
            ? action.property
            : 'background'
          : [
                'color',
                'fontSize',
                'fontWeight',
                'lineHeight',
                'textAlign',
                'fontFamily',
                'overflow',
              ].includes(action.property)
            ? action.property
            : 'color'
      return {
        id,
        kind: 'update',
        elementId: target.id,
        elementType: target.type,
        changes: { style: { [property]: action.value } },
      }
    }
    if (target.type === 'image')
      return {
        id,
        kind: 'update',
        elementId: target.id,
        elementType: target.type,
        changes: { borderRadius: action.value },
      }
  }
  return undefined
}
