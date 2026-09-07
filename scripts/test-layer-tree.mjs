import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'ai-campaign-layer-tree-'))
const outputFile = path.join(outputDirectory, 'layer-tree.mjs')

try {
  await build({
    stdin: {
      contents: "export * from './src/features/editor/utils/layer-tree.ts'",
      resolveDir: process.cwd(),
      sourcefile: 'layer-tree-test-entry.ts',
    },
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const {
    changeLayerOrder,
    flattenElementsForPainting,
    groupLayerElements,
    moveLayerElement,
    ungroupLayerElement,
  } = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)

  const original = [
    shape('background', 0, 0, 200, 200, 0),
    shape('card', 20, 20, 120, 80, 1),
    text('title', 32, 32, 80, 24, 2),
    shape('badge', 110, 28, 20, 20, 3),
  ]
  const grouped = groupLayerElements(original, ['card', 'title'], 'group-card')
  assert.equal(grouped.changed, true)
  const group = grouped.elements.find((element) => element.id === 'group-card')
  assert.equal(group?.containerKind, 'group')
  assert.deepEqual(
    { x: group.x, y: group.y, width: group.width, height: group.height },
    { x: 20, y: 20, width: 120, height: 80 },
  )
  assert.equal(grouped.elements.find((element) => element.id === 'card')?.parentId, 'group-card')
  assert.equal(grouped.elements.find((element) => element.id === 'title')?.parentId, 'group-card')
  assert.deepEqual(grouped.selectedElementIds, ['group-card'])

  const paintOrder = flattenElementsForPainting(grouped.elements).map((element) => element.id)
  const groupIndex = paintOrder.indexOf('group-card')
  assert.deepEqual(paintOrder.slice(groupIndex, groupIndex + 3), ['group-card', 'card', 'title'])

  const hiddenPaintOrder = flattenElementsForPainting(
    grouped.elements.map((element) =>
      element.id === 'group-card' ? { ...element, visible: false } : element,
    ),
  ).map((element) => element.id)
  assert.equal(hiddenPaintOrder.includes('group-card'), true)
  assert.equal(hiddenPaintOrder.includes('card'), false)
  assert.equal(hiddenPaintOrder.includes('title'), false)

  const lockedPaintElements = flattenElementsForPainting(
    grouped.elements.map((element) =>
      element.id === 'group-card' ? { ...element, locked: true } : element,
    ),
  )
  assert.equal(lockedPaintElements.find((element) => element.id === 'card')?.locked, true)
  assert.equal(lockedPaintElements.find((element) => element.id === 'title')?.locked, true)

  const ungrouped = ungroupLayerElement(grouped.elements, 'group-card')
  assert.equal(ungrouped.changed, true)
  assert.equal(
    ungrouped.elements.some((element) => element.id === 'group-card'),
    false,
  )
  assert.equal(ungrouped.elements.find((element) => element.id === 'card')?.parentId, undefined)
  assert.equal(ungrouped.elements.find((element) => element.id === 'title')?.x, 32)

  const container = {
    id: 'manual-frame',
    type: 'section',
    containerKind: 'frame',
    label: 'Frame',
    name: 'Frame',
    artboardId: 'board',
    x: 0,
    y: 0,
    width: 300,
    height: 300,
    zIndex: 0,
  }
  const movable = shape('movable', 40, 50, 30, 30, 1)
  const movedInside = moveLayerElement([container, movable], 'movable', 'manual-frame', 'inside')
  assert.equal(movedInside.changed, true)
  assert.equal(
    movedInside.elements.find((element) => element.id === 'movable')?.parentId,
    'manual-frame',
  )
  assert.equal(movedInside.elements.find((element) => element.id === 'movable')?.x, 40)

  const alreadyOrdered = moveLayerElement(original, 'badge', 'title', 'before')
  assert.equal(alreadyOrdered.changed, false)

  const protectedFrame = { ...container, id: 'generated-frame', designRole: 'container' }
  const rejected = moveLayerElement(
    [protectedFrame, movable],
    'movable',
    'generated-frame',
    'inside',
  )
  assert.equal(rejected.changed, false)

  const cycleGroup = groupLayerElements(original, ['card', 'title'], 'cycle-group')
  const cycleRejected = moveLayerElement(cycleGroup.elements, 'cycle-group', 'card', 'inside')
  assert.equal(cycleRejected.changed, false)

  const forward = changeLayerOrder(original, ['card'], 'forward')
  assert.equal(forward.changed, true)
  assert.deepEqual(rootOrder(forward.elements), ['background', 'title', 'card', 'badge'])
  const front = changeLayerOrder(original, ['card', 'title'], 'front')
  assert.deepEqual(rootOrder(front.elements), ['background', 'badge', 'card', 'title'])
  const backward = changeLayerOrder(original, ['badge'], 'backward')
  assert.deepEqual(rootOrder(backward.elements), ['background', 'card', 'badge', 'title'])

  console.log(
    JSON.stringify(
      {
        groupAndUngroup: true,
        hierarchyPaintOrder: true,
        groupVisibilityAndLockInheritance: true,
        reparentAndCycleGuard: true,
        noOpDropGuard: true,
        generatedOwnershipGuard: true,
        siblingLayerOrdering: true,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function shape(id, x, y, width, height, zIndex) {
  return {
    id,
    type: 'shape',
    name: id,
    artboardId: 'board',
    x,
    y,
    width,
    height,
    zIndex,
    shape: 'rect',
    fill: '#fff',
  }
}

function text(id, x, y, width, height, zIndex) {
  return {
    id,
    type: 'text',
    name: id,
    artboardId: 'board',
    x,
    y,
    width,
    height,
    zIndex,
    content: id,
    style: { fontSize: 16, color: '#111' },
  }
}

function rootOrder(elements) {
  return elements
    .filter((element) => !element.parentId)
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((element) => element.id)
}
