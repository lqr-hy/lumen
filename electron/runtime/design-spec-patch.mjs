import { createRuntimeError } from './providers.mjs'
import { assertGenericUiSchema, normalizeDesignBlock } from './generic-ui.mjs'

const OPERATION_KINDS = new Set(['insert-block', 'update-block', 'remove-block', 'move-block'])
const BLOCK_CHANGE_KEYS = new Set([
  'label',
  'title',
  'items',
  'fields',
  'actions',
  'columns',
  'rows',
  'children',
  'media',
  'layout',
])

export function normalizeDesignSpecPatch(input, context = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const operations = Array.isArray(source.operations)
    ? source.operations.slice(0, 12).map(normalizeOperation).filter(Boolean)
    : []
  return {
    version: 1,
    baseRevision:
      finiteInteger(source.baseRevision) ?? finiteInteger(context.documentRevision) ?? 0,
    artboardId: cleanText(source.artboardId, context.artboardId),
    summary: cleanText(source.summary, cleanText(context.goal, '调整页面结构')),
    operations,
  }
}

export function applyDesignSpecPatch(spec, patch) {
  let blocks = spec.blocks.map(cloneBlock)
  for (const operation of patch.operations) {
    if (operation.kind === 'insert-block') {
      if (blocks.some((block) => block.id === operation.block.id)) {
        throw new Error(`Block ID 已存在：${operation.block.id}`)
      }
      const index = resolveInsertionIndex(blocks, operation)
      blocks.splice(index, 0, operation.block)
      continue
    }
    const currentIndex = blocks.findIndex((block) => block.id === operation.blockId)
    if (currentIndex < 0) throw new Error(`目标 Block 不存在：${operation.blockId}`)
    if (operation.kind === 'remove-block') {
      blocks.splice(currentIndex, 1)
      continue
    }
    if (operation.kind === 'update-block') {
      blocks[currentIndex] = { ...blocks[currentIndex], ...operation.changes }
      continue
    }
    const [moving] = blocks.splice(currentIndex, 1)
    const index = resolveInsertionIndex(blocks, operation)
    blocks.splice(index, 0, moving)
  }
  const next = { ...spec, blocks }
  assertGenericUiSchema(next)
  return next
}

export function validateDesignSpecPatch(patch, canvasSnapshot) {
  const issues = []
  if (patch?.version !== 1) issues.push('version 必须为 1')
  if (!patch?.artboardId || patch.artboardId !== canvasSnapshot?.artboardId)
    issues.push('artboardId 与目标画板不一致')
  if (!Number.isInteger(patch?.baseRevision)) issues.push('baseRevision 无效')
  if (patch?.baseRevision !== canvasSnapshot?.documentRevision)
    issues.push('baseRevision 与当前文档 Revision 不一致')
  if (!canvasSnapshot?.designSpec) issues.push('目标画板缺少 DesignSpec')
  if (!Array.isArray(patch?.operations) || !patch.operations.length)
    issues.push('缺少结构 Patch Operation')
  for (const operation of patch?.operations ?? []) {
    if (!OPERATION_KINDS.has(operation.kind)) issues.push(`${operation.id} 的操作类型无效`)
    if (operation.beforeBlockId && operation.afterBlockId)
      issues.push(`${operation.id} 不能同时指定 beforeBlockId 和 afterBlockId`)
    if (
      operation.blockId &&
      [operation.beforeBlockId, operation.afterBlockId].includes(operation.blockId)
    ) {
      issues.push(`${operation.id} 不能相对自身移动`)
    }
  }
  if (!issues.length) {
    try {
      const next = applyDesignSpecPatch(canvasSnapshot.designSpec, patch)
      if (!next.blocks.length) issues.push('结构 Patch 不能删除全部 Block')
      if (next.blocks.length > 24) issues.push('DesignSpec Block 不能超过 24 个')
    } catch (error) {
      issues.push(error instanceof Error ? error.message : '结构 Patch 无法应用')
    }
  }
  return issues
}

export function assertDesignSpecPatch(patch, canvasSnapshot) {
  const issues = validateDesignSpecPatch(patch, canvasSnapshot)
  if (issues.length) throw createRuntimeError('DESIGN_SPEC_PATCH_INVALID', issues.join('；'))
  return patch
}

function normalizeOperation(value, index) {
  if (!value || typeof value !== 'object' || !OPERATION_KINDS.has(value.kind)) return undefined
  const base = {
    id: cleanText(value.id, `spec-operation-${index + 1}`),
    kind: value.kind,
    ...(typeof value.beforeBlockId === 'string' && value.beforeBlockId.trim()
      ? { beforeBlockId: value.beforeBlockId.trim() }
      : {}),
    ...(typeof value.afterBlockId === 'string' && value.afterBlockId.trim()
      ? { afterBlockId: value.afterBlockId.trim() }
      : {}),
  }
  if (value.kind === 'insert-block') {
    const block = normalizeDesignBlock(value.block, index)
    return block ? { ...base, block } : undefined
  }
  const blockId = cleanText(value.blockId)
  if (!blockId) return undefined
  if (value.kind === 'update-block') {
    const changes = normalizeBlockChanges(value.changes)
    return Object.keys(changes).length ? { ...base, blockId, changes } : undefined
  }
  return { ...base, blockId }
}

function normalizeBlockChanges(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => BLOCK_CHANGE_KEYS.has(key))
      .map(([key, item]) => {
        if (key === 'rows') {
          const rows = Array.isArray(item)
            ? item.slice(0, 10).map((row) => stringArray(row, 12))
            : undefined
          return [key, rows]
        }
        if (['items', 'fields', 'actions', 'columns'].includes(key))
          return [key, stringArray(item, 12)]
        if (key === 'children') {
          return [
            key,
            Array.isArray(item)
              ? item.slice(0, 12).map(normalizeDesignBlock).filter(Boolean)
              : undefined,
          ]
        }
        if (key === 'media' || key === 'layout')
          return [key, item && typeof item === 'object' ? item : undefined]
        return [key, typeof item === 'string' ? item.trim().slice(0, 200) : undefined]
      })
      .filter(([, item]) => item !== undefined),
  )
}

function cloneBlock(block) {
  return {
    ...block,
    rows: block.rows.map((row) => [...row]),
    children: block.children?.map(cloneBlock),
    media: block.media ? { ...block.media } : undefined,
    layout: block.layout ? { ...block.layout } : undefined,
  }
}

function resolveInsertionIndex(blocks, operation) {
  if (operation.beforeBlockId) {
    const index = blocks.findIndex((block) => block.id === operation.beforeBlockId)
    if (index < 0) throw new Error(`beforeBlockId 不存在：${operation.beforeBlockId}`)
    return index
  }
  if (operation.afterBlockId) {
    const index = blocks.findIndex((block) => block.id === operation.afterBlockId)
    if (index < 0) throw new Error(`afterBlockId 不存在：${operation.afterBlockId}`)
    return index + 1
  }
  return blocks.length
}

function stringArray(value, limit) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim().slice(0, 500))
        .slice(0, limit)
    : []
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function finiteInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) ? number : undefined
}
