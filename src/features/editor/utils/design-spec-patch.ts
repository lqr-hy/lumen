import type { DesignBlock, DesignSpec } from '../types'
import type { DesignSpecPatch } from '../../ai/types'

export type DesignSpecConflictReason =
  | 'block-changed'
  | 'block-deleted'
  | 'block-id-collision'
  | 'anchor-changed'
  | 'anchor-deleted'
  | 'relative-order-changed'
  | 'invalid-result'

export interface DesignSpecConflict {
  blockId: string
  operationId: string
  reason: DesignSpecConflictReason
}

export type DesignSpecRebaseResult =
  | {
      ok: true
      patch: DesignSpecPatch
      nextDesignSpec: DesignSpec
      rebasedFromRevision: number
      rebasedToRevision: number
    }
  | { ok: false; conflictingBlockIds: string[]; conflicts: DesignSpecConflict[] }

export function rebaseDesignSpecPatch(
  baseSpec: DesignSpec,
  currentSpec: DesignSpec,
  patch: DesignSpecPatch,
  currentRevision: number,
): DesignSpecRebaseResult {
  const baseBlocks = new Map(baseSpec.blocks.map((block) => [block.id, block]))
  const currentBlocks = new Map(currentSpec.blocks.map((block) => [block.id, block]))
  const conflicts = new Map<string, DesignSpecConflict>()
  for (const operation of patch.operations) {
    if (operation.kind === 'insert-block') {
      if (currentBlocks.has(operation.block.id))
        addConflict(conflicts, operation.block.id, operation.id, 'block-id-collision')
      checkAnchor(operation.beforeBlockId, operation.id, baseBlocks, currentBlocks, conflicts)
      checkAnchor(operation.afterBlockId, operation.id, baseBlocks, currentBlocks, conflicts)
      continue
    }
    const base = baseBlocks.get(operation.blockId)
    const current = currentBlocks.get(operation.blockId)
    if (!current) addConflict(conflicts, operation.blockId, operation.id, 'block-deleted')
    else if (!base || JSON.stringify(base) !== JSON.stringify(current)) {
      addConflict(conflicts, operation.blockId, operation.id, 'block-changed')
    }
    if (operation.kind === 'move-block') {
      checkAnchor(operation.beforeBlockId, operation.id, baseBlocks, currentBlocks, conflicts)
      checkAnchor(operation.afterBlockId, operation.id, baseBlocks, currentBlocks, conflicts)
      const anchorId = operation.beforeBlockId ?? operation.afterBlockId
      if (
        anchorId &&
        relativeOrder(baseSpec, operation.blockId, anchorId) !==
          relativeOrder(currentSpec, operation.blockId, anchorId)
      ) {
        addConflict(conflicts, operation.blockId, operation.id, 'relative-order-changed')
        addConflict(conflicts, anchorId, operation.id, 'relative-order-changed')
      }
    }
  }
  if (conflicts.size) {
    const values = [...conflicts.values()]
    return {
      ok: false,
      conflictingBlockIds: [...new Set(values.map((item) => item.blockId))],
      conflicts: values,
    }
  }
  try {
    const rebasedPatch = { ...patch, baseRevision: currentRevision }
    return {
      ok: true,
      patch: rebasedPatch,
      nextDesignSpec: applyPatch(currentSpec, rebasedPatch),
      rebasedFromRevision: patch.baseRevision,
      rebasedToRevision: currentRevision,
    }
  } catch {
    const invalid = [
      { blockId: 'design-spec', operationId: 'patch', reason: 'invalid-result' as const },
    ]
    return { ok: false, conflictingBlockIds: ['design-spec'], conflicts: invalid }
  }
}

export function resolveDesignSpecPatchConflicts(
  currentSpec: DesignSpec,
  patch: DesignSpecPatch,
  conflicts: DesignSpecConflict[],
  choices: Record<string, 'current' | 'incoming'>,
) {
  const conflictIds = new Set(conflicts.map((item) => item.blockId))
  const operations = patch.operations.filter((operation) => {
    const relatedIds =
      operation.kind === 'insert-block'
        ? [operation.block.id, operation.beforeBlockId, operation.afterBlockId]
        : [
            operation.blockId,
            operation.kind === 'move-block' ? operation.beforeBlockId : undefined,
            operation.kind === 'move-block' ? operation.afterBlockId : undefined,
          ]
    return relatedIds
      .filter((id): id is string => Boolean(id) && conflictIds.has(id!))
      .every((id) => choices[id] === 'incoming')
  })
  const blocks = currentSpec.blocks.map(cloneBlock)
  for (const operation of operations) {
    if (operation.kind === 'insert-block') {
      const duplicate = blocks.findIndex((block) => block.id === operation.block.id)
      if (duplicate >= 0) blocks.splice(duplicate, 1)
      blocks.splice(
        safeInsertionIndex(blocks, operation.beforeBlockId, operation.afterBlockId),
        0,
        cloneBlock(operation.block),
      )
      continue
    }
    const index = blocks.findIndex((block) => block.id === operation.blockId)
    if (operation.kind === 'remove-block') {
      if (index >= 0) blocks.splice(index, 1)
    } else if (operation.kind === 'update-block') {
      if (index >= 0) blocks[index] = { ...blocks[index], ...operation.changes }
    } else if (index >= 0) {
      const [moving] = blocks.splice(index, 1)
      blocks.splice(
        safeInsertionIndex(blocks, operation.beforeBlockId, operation.afterBlockId),
        0,
        moving,
      )
    }
  }
  if (
    !blocks.length ||
    blocks.length > 24 ||
    new Set(blocks.map((block) => block.id)).size !== blocks.length
  ) {
    throw new Error('冲突解决结果包含无效 Block。')
  }
  return { ...currentSpec, blocks }
}

function applyPatch(spec: DesignSpec, patch: DesignSpecPatch): DesignSpec {
  const blocks: DesignBlock[] = spec.blocks.map(cloneBlock)
  for (const operation of patch.operations) {
    if (operation.kind === 'insert-block') {
      if (blocks.some((block) => block.id === operation.block.id))
        throw new Error('duplicate block')
      blocks.splice(
        insertionIndex(blocks, operation.beforeBlockId, operation.afterBlockId),
        0,
        operation.block,
      )
      continue
    }
    const index = blocks.findIndex((block) => block.id === operation.blockId)
    if (index < 0) throw new Error('missing block')
    if (operation.kind === 'remove-block') {
      blocks.splice(index, 1)
    } else if (operation.kind === 'update-block') {
      blocks[index] = { ...blocks[index], ...operation.changes }
    } else {
      const [moving] = blocks.splice(index, 1)
      blocks.splice(
        insertionIndex(blocks, operation.beforeBlockId, operation.afterBlockId),
        0,
        moving,
      )
    }
  }
  if (!blocks.length || blocks.length > 24) throw new Error('invalid block count')
  return { ...spec, blocks }
}

function insertionIndex(blocks: DesignBlock[], beforeBlockId?: string, afterBlockId?: string) {
  const anchorId = beforeBlockId ?? afterBlockId
  if (!anchorId) return blocks.length
  const index = blocks.findIndex((block) => block.id === anchorId)
  if (index < 0) throw new Error('missing anchor')
  return beforeBlockId ? index : index + 1
}

function checkAnchor(
  id: string | undefined,
  operationId: string,
  base: Map<string, DesignBlock>,
  current: Map<string, DesignBlock>,
  conflicts: Map<string, DesignSpecConflict>,
) {
  if (!id) return
  const baseBlock = base.get(id)
  const currentBlock = current.get(id)
  if (!currentBlock) addConflict(conflicts, id, operationId, 'anchor-deleted')
  else if (!baseBlock || JSON.stringify(baseBlock) !== JSON.stringify(currentBlock)) {
    addConflict(conflicts, id, operationId, 'anchor-changed')
  }
}

function addConflict(
  conflicts: Map<string, DesignSpecConflict>,
  blockId: string,
  operationId: string,
  reason: DesignSpecConflictReason,
) {
  conflicts.set(`${operationId}:${blockId}:${reason}`, { blockId, operationId, reason })
}

function cloneBlock(block: DesignBlock): DesignBlock {
  return {
    ...block,
    rows: block.rows.map((row) => [...row]),
    children: block.children?.map(cloneBlock),
    media: block.media ? { ...block.media } : undefined,
    layout: block.layout ? { ...block.layout } : undefined,
  }
}

function safeInsertionIndex(blocks: DesignBlock[], beforeBlockId?: string, afterBlockId?: string) {
  const anchorId = beforeBlockId ?? afterBlockId
  if (!anchorId) return blocks.length
  const index = blocks.findIndex((block) => block.id === anchorId)
  if (index < 0) return blocks.length
  return beforeBlockId ? index : index + 1
}

function relativeOrder(spec: DesignSpec, firstId: string, secondId: string) {
  return Math.sign(
    spec.blocks.findIndex((block) => block.id === firstId) -
      spec.blocks.findIndex((block) => block.id === secondId),
  )
}
