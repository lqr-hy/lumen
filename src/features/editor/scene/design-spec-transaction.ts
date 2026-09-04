import type { Artboard, DesignElement, DesignSpec } from '../types'
import { compileDesignSpecToSceneCommit } from './design-spec-adapter'
import type { SceneTransactionCommit } from './scene-graph'

interface CompileDesignSpecTransactionOptions {
  artboard: Artboard
  renderSchema: DesignSpec
  comparisonSchema?: DesignSpec
  previousSchema?: DesignSpec
  currentElements: DesignElement[]
  desiredBlockIds?: readonly string[]
  forceBlockIds?: readonly string[]
  replaceAll?: boolean
}

export function compileDesignSpecSceneTransaction(
  options: CompileDesignSpecTransactionOptions,
): SceneTransactionCommit {
  const comparisonSchema = options.comparisonSchema ?? options.renderSchema
  const desiredBlockIds =
    options.desiredBlockIds ?? comparisonSchema.blocks.map((block) => block.id)
  const desiredIds = new Set(desiredBlockIds)
  if (desiredIds.size !== desiredBlockIds.length)
    throw new Error('Scene Transaction 包含重复 Region ID。')
  if (desiredBlockIds.some((id) => !comparisonSchema.blocks.some((block) => block.id === id))) {
    throw new Error('Scene Transaction 包含 DesignSpec 中不存在的 Region。')
  }

  const { commit } = compileDesignSpecToSceneCommit(options.renderSchema, options.artboard, {
    includeBlockIds: desiredIds,
  })
  const incomingBlocks = groupElementsByBlock(commit.elements)
  const existingBlocks = groupElementsByBlock(
    options.currentElements.filter(
      (element) => element.artboardId === options.artboard.id && element.designBlockId,
    ),
  )
  const previousRegionIds = [...existingBlocks.keys()]
  const removedRegionIds = previousRegionIds.filter((id) => !desiredIds.has(id))
  const removedElementIds = removedRegionIds.flatMap(
    (id) => existingBlocks.get(id)?.map((element) => element.id) ?? [],
  )
  const layoutContextChanged =
    !options.previousSchema || !sameLayoutContext(options.previousSchema, comparisonSchema)
  const forcedIds = new Set(options.forceBlockIds ?? [])
  const affectedRegionIds = comparisonSchema.blocks
    .filter((block) => desiredIds.has(block.id))
    .filter((block) => {
      if (options.replaceAll || forcedIds.has(block.id) || layoutContextChanged) return true
      const existing = existingBlocks.get(block.id) ?? []
      const incoming = incomingBlocks.get(block.id) ?? []
      const existingRoot = findBlockRoot(existing)
      const incomingRoot = findBlockRoot(incoming)
      const previousBlock = options.previousSchema?.blocks.find(
        (candidate) => candidate.id === block.id,
      )
      return (
        !existingRoot ||
        !incomingRoot ||
        JSON.stringify(previousBlock) !== JSON.stringify(block) ||
        !sameBounds(existingRoot, incomingRoot)
      )
    })
    .map((block) => block.id)
  const affectedIds = new Set(affectedRegionIds)
  const shellElements = commit.elements.filter((element) => !element.designBlockId)
  const shellIds = new Set(shellElements.map((element) => element.id))
  const retainedElements = options.currentElements.filter(
    (element) =>
      element.artboardId !== options.artboard.id || !isManagedSceneElement(element, shellIds),
  )
  const regionElements = comparisonSchema.blocks
    .filter((block) => desiredIds.has(block.id))
    .flatMap((block) =>
      affectedIds.has(block.id)
        ? (incomingBlocks.get(block.id) ?? [])
        : (existingBlocks.get(block.id) ?? []),
    )
  const nextElements = [...retainedElements, ...shellElements, ...regionElements]
  const affectedElementIds = [
    ...removedElementIds,
    ...affectedRegionIds.flatMap(
      (id) => incomingBlocks.get(id)?.map((element) => element.id) ?? [],
    ),
  ]
  const blockRootIds = Object.fromEntries(
    [...incomingBlocks].flatMap(([id, elements]) => {
      const root = findBlockRoot(elements)
      return root ? [[id, root.id]] : []
    }),
  )

  return {
    ...commit,
    transactionId: `scene-tx:design-spec:${options.artboard.id}`,
    kind: options.replaceAll ? 'replace' : 'merge-regions',
    nextElements,
    affectedElementIds,
    affectedRegionIds,
    removedRegionIds,
    blockRootIds,
  }
}

function groupElementsByBlock(elements: DesignElement[]) {
  const groups = new Map<string, DesignElement[]>()
  for (const element of elements) {
    if (!element.designBlockId) continue
    const group = groups.get(element.designBlockId) ?? []
    group.push(element)
    groups.set(element.designBlockId, group)
  }
  return groups
}

function findBlockRoot(elements: DesignElement[]) {
  return elements.find((element) => element.designRole === 'design-block')
}

function sameBounds(left: DesignElement, right: DesignElement) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

function sameLayoutContext(left: DesignSpec, right: DesignSpec) {
  return (
    left.surfaceKind === right.surfaceKind &&
    JSON.stringify(left.viewport) === JSON.stringify(right.viewport) &&
    JSON.stringify(left.theme) === JSON.stringify(right.theme) &&
    JSON.stringify(left.layout) === JSON.stringify(right.layout)
  )
}

function isManagedSceneElement(element: DesignElement, shellIds: ReadonlySet<string>) {
  return (
    Boolean(element.designBlockId) || element.designRole === 'container' || shellIds.has(element.id)
  )
}
