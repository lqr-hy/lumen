import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'component-actions-test-'))
const outputFile = path.join(outputDirectory, 'component-actions.mjs')

try {
  await build({
    stdin: {
      contents:
        "export * from './src/features/editor/utils/selection-scope.ts'; export * from './src/features/editor/utils/image-mask.ts'; export * from './src/features/editor/utils/composer-target.ts'",
      resolveDir: process.cwd(),
      sourcefile: 'component-actions-test-entry.ts',
    },
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })

  const actions = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)
  const root = createElement('section', 'root', {})
  const slot = createElement('image', 'generated-asset', { image: 'styleConfig.drawOne.image' })
  const shell = createElement('image', 'shell', {})
  const ordinaryImage = { ...slot, componentBinding: undefined }

  assert.equal(actions.isComponentRootElement(root), true)
  assert.equal(actions.isComponentRootElement(slot), false)
  assert.equal(actions.canRegenerateComponentSlot(slot), true)
  assert.equal(actions.canRegenerateComponentSlot(shell), false)
  assert.equal(actions.canRegenerateComponentSlot(ordinaryImage), false)
  assert.equal(actions.createComponentSlotRegenerationText(slot), '仅重新生成选中的 draw-one 素材')
  assert.equal(
    actions.isComponentSlotRegenerationReference({
      kind: 'component-region-regeneration',
      text: '',
      elementId: slot.id,
    }),
    true,
  )
  assert.equal(actions.resolveComposerQueueTarget(true), 'panel')
  assert.equal(actions.resolveComposerQueueTarget(false), 'bottom')
  assert.equal(actions.resolveComposerQueueTarget(undefined), 'bottom')
  const plainReference = [
    {
      id: 'plain',
      text: '抽一次按钮',
      elementId: slot.id,
      insertOffset: 0,
      kind: 'text',
    },
  ]
  const regeneratedReference = actions.upsertQueuedComposerReference(
    plainReference,
    {
      id: 'regenerate',
      text: '仅重新生成选中的 draw-one 素材',
      elementId: slot.id,
      kind: 'component-region-regeneration',
    },
    4,
  )
  assert.equal(regeneratedReference.length, 1)
  assert.equal(regeneratedReference[0].kind, 'component-region-regeneration')
  assert.equal(regeneratedReference[0].insertOffset, 4)
  assert.deepEqual(
    actions.upsertQueuedComposerReference(regeneratedReference, regeneratedReference[0], 4),
    regeneratedReference,
  )

  const document = createDocument()
  const singleScope = actions.createSelectionScope(document, ['container'])
  assert.equal(singleScope.type, 'generic-node')
  assert.deepEqual(singleScope.targetElementIds, ['container', 'title'])
  assert.equal(typeof singleScope.targetHash, 'string')
  const multiScope = actions.createSelectionScope(document, ['title', 'badge'])
  assert.equal(multiScope.type, 'multi-node')
  assert.deepEqual(multiScope.elementIds, ['title', 'badge'])
  assert.deepEqual(multiScope.targetElementIds, ['badge', 'title'])
  assert.equal(actions.createSelectionScope(document, ['title', 'foreign']), undefined)
  const textRangeScope = actions.createSelectionScope(document, ['title'], {
    elementId: 'title',
    start: 0,
    end: 2,
    selectedText: '标题',
    prefix: '',
    suffix: '',
  })
  assert.equal(textRangeScope.type, 'text-range')
  assert.equal(textRangeScope.selectedText, '标题')
  assert.equal(textRangeScope.targetElementIds.includes('title'), true)
  document.elements.push({
    id: 'ordinary-image',
    artboardId: 'board',
    type: 'image',
    name: '主图',
    src: 'data:image/png;base64,base',
    x: 0,
    y: 400,
    width: 100,
    height: 100,
    zIndex: 4,
  })
  const imageRegionScope = actions.createSelectionScope(document, ['ordinary-image'], undefined, {
    elementId: 'ordinary-image',
    sourceSrc: 'data:image/png;base64,base',
    normalizedRect: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
    pixelRect: { x: 10, y: 20, width: 40, height: 30 },
    targetSize: { width: 100, height: 100 },
    currentImage: 'data:image/png;base64,base',
    maskImage: 'data:image/png;base64,mask',
  })
  assert.equal(imageRegionScope.type, 'image-region')
  assert.deepEqual(imageRegionScope.pixelRect, { x: 10, y: 20, width: 40, height: 30 })
  assert.equal(
    actions.createSelectionScope(document, ['ordinary-image'], undefined, {
      elementId: 'ordinary-image',
      sourceSrc: 'data:image/png;base64,stale',
      normalizedRect: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      pixelRect: { x: 10, y: 20, width: 40, height: 30 },
      targetSize: { width: 100, height: 100 },
      currentImage: 'data:image/png;base64,base',
      maskImage: 'data:image/png;base64,mask',
    }),
    undefined,
  )
  const firstSlot = {
    ...createElement('image', 'generated-asset', { image: 'styleConfig.drawOne.image' }),
    id: 'slot-one',
    src: 'data:image/png;base64,one',
  }
  const secondSlot = {
    ...createElement('image', 'generated-asset', { image: 'styleConfig.drawTen.image' }),
    id: 'slot-ten',
    src: 'data:image/png;base64,ten',
    componentBinding: {
      ...createElement('image', 'generated-asset', { image: 'styleConfig.drawTen.image' })
        .componentBinding,
      regionId: 'draw-ten',
      slotId: 'draw-ten-slot',
      bindings: { image: 'styleConfig.drawTen.image' },
    },
  }
  document.elements.push(firstSlot, secondSlot)
  const batchScope = actions.createComponentRegionBatchScope(document, ['slot-one', 'slot-ten'])
  assert.equal(batchScope.type, 'component-region-batch')
  assert.equal(batchScope.targets.length, 2)
  assert.deepEqual(batchScope.elementIds, ['slot-one', 'slot-ten'])
  assert.equal(actions.getSelectionScopeLabel(batchScope), '2 个组件素材')
  assert.equal(actions.hasEditableImageMask({ width: 20, height: 20 }, []), true)
  assert.equal(actions.hasEditableImageMask(null, [{ mode: 'brush', pointCount: 2 }]), true)
  assert.equal(actions.hasEditableImageMask(null, [{ mode: 'erase', pointCount: 2 }]), false)
  const alpha = new Uint8ClampedArray(4 * 4 * 4).fill(255)
  alpha[(1 * 4 + 2) * 4 + 3] = 0
  alpha[(2 * 4 + 3) * 4 + 3] = 128
  assert.deepEqual(actions.findEditableMaskBounds({ width: 4, height: 4, data: alpha }), {
    x: 2,
    y: 1,
    width: 2,
    height: 2,
  })

  console.log(
    JSON.stringify(
      {
        rootOwnsPropsPatch: true,
        imageSlotRegeneration: true,
        shellExcluded: true,
        ordinaryImageExcluded: true,
        genericSelectionScope: true,
        multiNodeSelectionScope: true,
        crossArtboardSelectionRejected: true,
        textRangeSelectionScope: true,
        imageRegionSelectionScope: true,
        componentRegionBatchScope: true,
        maskBrushEraseContract: true,
        maskAlphaBounds: true,
        composerQueueFollowsVisibleSurface: true,
        regenerationActionUpsertIsIdempotent: true,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function createElement(type, renderMode, bindings) {
  return {
    id: `${renderMode}-element`,
    type,
    name: renderMode,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    artboardId: 'board',
    componentBinding: {
      instanceId: 'instance-1',
      componentName: 'EraLottery',
      profile: 'default',
      regionId: renderMode === 'generated-asset' ? 'draw-one' : renderMode,
      slotId: renderMode === 'root' ? undefined : `${renderMode}-slot`,
      renderMode,
      rootElementId: 'root-element',
      propPaths: Object.values(bindings),
      bindings,
    },
  }
}

function createDocument() {
  const now = new Date().toISOString()
  return {
    id: 'selection-project',
    title: 'Selection',
    version: 3,
    artboards: [
      { id: 'board', name: 'Board', x: 0, y: 0, width: 375, height: 812, background: '#fff' },
      {
        id: 'other-board',
        name: 'Other',
        x: 500,
        y: 0,
        width: 375,
        height: 812,
        background: '#fff',
      },
    ],
    elements: [
      {
        id: 'container',
        artboardId: 'board',
        type: 'section',
        name: '容器',
        label: '容器',
        x: 0,
        y: 0,
        width: 375,
        height: 300,
        zIndex: 1,
      },
      {
        id: 'title',
        artboardId: 'board',
        parentId: 'container',
        type: 'text',
        name: '标题',
        content: '标题',
        x: 20,
        y: 20,
        width: 120,
        height: 30,
        zIndex: 2,
        style: { fontSize: 18, color: '#111' },
      },
      {
        id: 'badge',
        artboardId: 'board',
        type: 'shape',
        name: '标签',
        shape: 'rectangle',
        x: 20,
        y: 340,
        width: 80,
        height: 30,
        zIndex: 3,
        fill: '#f00',
      },
      {
        id: 'foreign',
        artboardId: 'other-board',
        type: 'shape',
        name: '其他画板',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 80,
        height: 30,
        zIndex: 1,
        fill: '#000',
      },
    ],
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}
