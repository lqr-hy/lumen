import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'component-canvas-test-'))
const outputFile = path.join(outputDirectory, 'editor-store.mjs')

try {
  await build({
    stdin: {
      contents: [
        "export { useEditorStore } from './src/features/editor/store/editor-store.ts'",
        "export { applyIncrementalCanvasDeliverable, applyIncrementalPageComponent } from './src/features/editor/utils/incremental-delivery.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'component-canvas-test-entry.ts',
    },
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })

  const { useEditorStore, applyIncrementalCanvasDeliverable, applyIncrementalPageComponent } = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)
  const artboardId = 'artboard-component-test'
  useEditorStore.getState().setDocument(createDocument(artboardId))
  useEditorStore.getState().selectArtboard(artboardId)
  useEditorStore.setState({ viewport: { x: 0, y: 0, zoom: 0.15 } })
  const conversationTarget = useEditorStore.getState().ensureChatThreadArtboard(
    'panel-thread-default',
    'append-section',
  )
  assert.equal(conversationTarget?.artboardId, artboardId)
  assert.equal(useEditorStore.getState().viewport.zoom, 0.75, '对话画板应从过低缩放自动聚焦')

  const rootId = useEditorStore.getState().applyComponentDesign(
    { artboardId, created: false, mode: 'append-section' },
    createComponentDesign(),
    [createGeneratedImage('data:image/svg+xml;base64,initial')],
    createVisualShellImage(),
  )
  assert.ok(rootId, '组件设计应创建 Section 根节点')

  let document = getDocument(useEditorStore)
  const createdInstanceId = findElement(document, rootId).componentBinding?.instanceId
  assert.ok(document.componentInstances?.[createdInstanceId], '组件生成后应注册文档级实例')
  assert.equal(document.artboards[0].componentDesign, undefined, 'Props Patch 不得挂在画板上')
  assert.equal(document.artboards[0].componentDesigns, undefined, '组件列表不得挂在画板上')
  const root = findElement(document, rootId)
  const image = findBoundElement(document, 'draw-one')
  const visualShell = findBoundElement(document, 'visual-shell')
  const shape = findBoundElement(document, 'panel-background')
  const runtime = findBoundElement(document, 'runtime-content')

  assert.equal(root.type, 'section')
  assert.equal(image.type, 'image')
  assert.equal(visualShell.type, 'image')
  assert.equal(shape.type, 'shape')
  assert.equal(runtime.type, 'runtime-placeholder')
  assert.equal(document.elements.length, 5, '应创建 Section、视觉外壳与三个原生 Region 图层')
  assert.ok(document.elements.every((element) => element.componentBinding), '组件节点必须保留绑定信息')
  assert.equal(document.elements.some((element) => element.name === 'EraLottery 组件预览'), false)

  useEditorStore.getState().updateElements([
    { id: image.id, patch: { x: image.x + 12, width: image.width + 20, visible: false } },
    { id: shape.id, patch: { fill: '#123456' } },
  ])
  document = getDocument(useEditorStore)
  let design = getComponentDesign(document, artboardId)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.left'), 32)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.width'), 120)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.visible'), false)
  assert.equal(readPath(design.propsPatch, 'styleConfig.panel.color'), '#123456')

  const imageBeforeSectionResize = findElement(document, image.id)
  const rootBeforeResize = findElement(document, rootId)
  useEditorStore.getState().updateElement(rootId, {
    x: rootBeforeResize.x + 25,
    width: rootBeforeResize.width * 2,
  })
  document = getDocument(useEditorStore)
  const imageAfterSectionResize = findElement(document, image.id)
  assert.equal(imageAfterSectionResize.x, rootBeforeResize.x + 25 + (imageBeforeSectionResize.x - rootBeforeResize.x) * 2)
  assert.equal(imageAfterSectionResize.width, imageBeforeSectionResize.width * 2)
  design = getComponentDesign(document, artboardId)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.left'), 32)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.width'), 120)

  const elementCount = document.elements.length
  const replacement = createGeneratedImage('data:image/svg+xml;base64,replacement')
  assert.equal(useEditorStore.getState().applyComponentSlotImage(image.id, replacement), true)
  document = getDocument(useEditorStore)
  assert.equal(document.elements.length, elementCount, '局部重生成不得新增图层')
  assert.equal(findElement(document, image.id).src, replacement.src, '局部重生成应保留 elementId')
  design = getComponentDesign(document, artboardId)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.image'), replacement.src)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.fallback'), replacement.src)

  const instanceId = findElement(document, rootId).componentBinding?.instanceId
  assert.ok(instanceId, '组件根节点缺少 instanceId')
  const revisedRootId = useEditorStore.getState().applyComponentDesign(
    { artboardId, created: false, mode: 'append-section' },
    createComponentDesign(),
    [createGeneratedImage('data:image/svg+xml;base64,revised')],
    { ...createVisualShellImage(), src: 'data:image/svg+xml;base64,revised-shell' },
    instanceId,
  )
  assert.equal(revisedRootId, rootId, '组件整体修订应保留根 elementId')
  document = getDocument(useEditorStore)
  assert.equal(document.elements.length, elementCount, '组件整体修订不得追加重复实例')
  assert.equal(
    document.elements.filter((element) => element.componentBinding?.instanceId === instanceId).length,
    elementCount,
    '原组件实例图层没有被完整替换',
  )
  assert.equal(findBoundElement(document, 'draw-one').src, 'data:image/svg+xml;base64,revised')

  const variantTarget = useEditorStore.getState().ensureChatThreadArtboard(
    'panel-thread-default',
    'duplicate-variant',
  )
  assert.ok(variantTarget?.artboardId, '复制变体应创建新画板')
  document = getDocument(useEditorStore)
  const variantRoots = document.elements.filter((element) => (
    element.artboardId === variantTarget.artboardId &&
    element.componentBinding?.renderMode === 'root'
  ))
  assert.equal(variantRoots.length, 1)
  const variantInstanceId = variantRoots[0].componentBinding?.instanceId
  assert.ok(variantInstanceId && variantInstanceId !== instanceId, '复制变体必须创建独立实例 ID')
  assert.ok(document.componentInstances?.[variantInstanceId], '复制变体缺少实例注册记录')
  assert.ok(document.elements
    .filter((element) => element.artboardId === variantTarget.artboardId && element.parentId)
    .every((element) => element.parentId === variantRoots[0].id), '复制变体子节点父 ID 未重映射')
  useEditorStore.getState().removeArtboard(variantTarget.artboardId)

  useEditorStore.getState().removeElements([rootId])
  document = getDocument(useEditorStore)
  assert.equal(document.elements.length, 0, '删除 Section 应级联删除所有 Region')
  assert.equal(Object.keys(document.componentInstances ?? {}).length, 0, '删除 Section 应清理组件实例元数据')

  const incrementalTarget = { artboardId, created: false, mode: 'append-section' }
  const incrementalShell = {
    id: 'delivery-page-shell-first',
    kind: 'page-shell',
    sessionId: 'component-canvas-session',
    runId: 'component-canvas-run',
    stepId: 'generate-page-shell',
    target: { artboardId, width: 375, height: 812, placementMode: 'new-artboard' },
    blueprint: createPageDesign().blueprint,
    pageShell: {
      src: 'data:image/svg+xml;base64,incremental-shell',
      width: 375,
      height: 624,
      name: 'incremental-page-shell.svg',
      placement: 'asset',
    },
  }
  const firstShellObservation = applyIncrementalCanvasDeliverable(incrementalTarget, incrementalShell)
  assert.equal(firstShellObservation.status, 'success')
  const incrementalShellId = firstShellObservation.data.shellElementId
  const repairedShellObservation = applyIncrementalCanvasDeliverable(incrementalTarget, {
    ...incrementalShell,
    id: 'delivery-page-shell-repair',
    pageShell: { ...incrementalShell.pageShell, src: 'data:image/svg+xml;base64,repaired-shell' },
  })
  assert.equal(repairedShellObservation.data.shellElementId, incrementalShellId, 'page-shell Repair 应保留 elementId')
  assert.equal(
    getDocument(useEditorStore).elements.filter((element) => element.designRole === 'page-shell').length,
    1,
    'page-shell Repair 不得创建重复外壳',
  )
  const firstIncrementalObservation = applyIncrementalPageComponent(incrementalTarget, {
    id: 'delivery-section-0-first',
    kind: 'page-component',
    sessionId: 'component-canvas-session',
    runId: 'component-canvas-run',
    stepId: 'generate-page-component-1',
    target: { artboardId, width: 375, height: 812, placementMode: 'new-artboard' },
    component: {
      index: 0,
      pageSectionId: 'section-0',
      bounds: { x: 0, y: 80, width: 375, height: 500 },
      componentDesign: { ...createComponentDesign(), sourceHash: 'incremental-section-0' },
      images: [createGeneratedImage('data:image/svg+xml;base64,incremental-0')],
      visualShell: createVisualShellImage(),
    },
  })
  assert.equal(firstIncrementalObservation.status, 'success')
  const incrementalRootId = firstIncrementalObservation.data.rootElementId
  const incrementalInstanceId = firstIncrementalObservation.data.instanceId
  assert.ok(incrementalInstanceId, '增量页面组件没有创建实例')
  assert.equal(findElement(getDocument(useEditorStore), incrementalRootId).y, 80, '增量组件没有按 Blueprint bounds 定位')
  const replacementObservation = applyIncrementalPageComponent(incrementalTarget, {
    id: 'delivery-section-0-repair',
    kind: 'page-component',
    sessionId: 'component-canvas-session',
    runId: 'component-canvas-run',
    stepId: 'generate-page-component-1',
    target: { artboardId, width: 375, height: 812, placementMode: 'new-artboard' },
    component: {
      index: 0,
      pageSectionId: 'section-0',
      bounds: { x: 0, y: 80, width: 375, height: 500 },
      componentDesign: { ...createComponentDesign(), sourceHash: 'incremental-section-0-repair' },
      images: [createGeneratedImage('data:image/svg+xml;base64,incremental-repair')],
      visualShell: createVisualShellImage(),
    },
  })
  assert.equal(replacementObservation.data.rootElementId, incrementalRootId, 'Repair 应原位替换增量组件 Root')
  assert.equal(replacementObservation.data.instanceId, incrementalInstanceId, 'Repair 应保留增量组件实例 ID')

  const pageRoots = useEditorStore.getState().applyPageDesign(
    { artboardId, created: false, mode: 'new-artboard' },
    createPageDesign(),
    [0, 1].map((index) => ({
      index,
      pageSectionId: `section-${index}`,
      componentDesign: { ...createComponentDesign(), sourceHash: `page-component-${index}` },
      assets: [createGeneratedImage(`data:image/svg+xml;base64,page-${index}`)],
      visualShell: createVisualShellImage(),
    })),
    {
      src: 'data:image/svg+xml;base64,page-shell',
      width: 375,
      height: 624,
      name: 'page-shell.svg',
      placement: 'asset',
    },
  )
  document = getDocument(useEditorStore)
  const pageShell = document.elements.find((element) => element.designRole === 'page-shell')
  assert.equal(pageRoots.length, 2, '完整页面应保留两个独立组件 Root')
  assert.equal(Object.keys(document.componentInstances ?? {}).length, 2, '完整页面应注册两个组件实例')
  assert.equal(pageRoots[0], incrementalRootId, '最终页面交付应原位复用已增量写入的 Section Root')
  assert.equal(
    findElement(document, pageRoots[0]).componentBinding?.instanceId,
    incrementalInstanceId,
    '最终页面交付不应重复创建已增量写入的组件实例',
  )
  assert.ok(pageShell, '完整页面缺少独立页面视觉外壳')
  assert.equal(pageShell.id, incrementalShellId, '最终页面交付应复用增量 page-shell elementId')
  assert.equal(document.elements.filter((element) => element.designRole === 'page-shell').length, 1, '最终页面存在重复 page-shell')
  assert.ok(pageShell.zIndex < Math.min(...pageRoots.map((id) => findElement(document, id).zIndex)), '页面外壳必须位于组件下方')
  assert.equal(document.artboards[0].pageDesign?.blueprint.sections.length, 2, 'Artboard 没有保存页面 Blueprint')
  const firstPageRoot = findElement(document, pageRoots[0])
  const firstPageSectionId = firstPageRoot.componentBinding?.pageSectionId
  const firstPageInstanceId = firstPageRoot.componentBinding?.instanceId
  assert.equal(firstPageSectionId, 'section-0', '页面组件 Root 缺少 Section 绑定')
  useEditorStore.getState().setPageSectionLocked(firstPageSectionId, true)
  document = getDocument(useEditorStore)
  assert.ok(document.elements
    .filter((element) => element.componentBinding?.instanceId === firstPageInstanceId)
    .every((element) => element.locked), '锁定页面模块必须覆盖整个组件实例')
  assert.equal(document.artboards[0].pageDesign?.blueprint.sections[0].locked, true, 'Blueprint 没有同步锁定状态')
  useEditorStore.getState().setPageSectionLocked(firstPageSectionId, false)
  useEditorStore.getState().applyComponentDesign(
    { artboardId, created: false, mode: 'append-section' },
    { ...createComponentDesign(), sourceHash: 'page-section-revision' },
    [createGeneratedImage('data:image/svg+xml;base64,page-section-revision')],
    createVisualShellImage(),
    firstPageInstanceId,
  )
  document = getDocument(useEditorStore)
  assert.equal(
    document.elements.find((element) => element.componentBinding?.instanceId === firstPageInstanceId && element.componentBinding.renderMode === 'root')?.componentBinding?.pageSectionId,
    firstPageSectionId,
    '页面模块局部修订后丢失 Section 绑定',
  )

  console.log(JSON.stringify({
    nativeLayers: ['section', 'image', 'shape', 'runtime-placeholder'],
    visualShellLayer: true,
    propsPatchSync: true,
    sectionTransform: true,
    slotReplacement: true,
    instanceRevision: true,
    variantInstanceIsolation: true,
    cascadeDelete: true,
    conversationCanvasFocus: true,
    editablePageComposition: true,
    pageShellBehindComponents: true,
    pageSectionLocking: true,
    pageSectionRevision: true,
    incrementalPageDeduplication: true,
    incrementalPageShellReplacement: true,
  }, null, 2))
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function createDocument(artboardId) {
  const now = new Date().toISOString()
  return {
    id: 'component-canvas-document',
    title: 'Component Canvas Test',
    version: 1,
    artboards: [{
      id: artboardId,
      name: '组件设计',
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      background: '#ffffff',
    }],
    elements: [],
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createComponentDesign() {
  return {
    componentName: 'EraLottery',
    profile: 'style-config',
    sourceHash: 'canvas-test',
    blueprint: {
      version: 1,
      componentName: 'EraLottery',
      profile: 'style-config',
      width: 375,
      height: 300,
      regions: [
        {
          id: 'panel-background',
          role: '面板背景',
          bounds: { x: 0, y: 0, width: 375, height: 300 },
          propBindings: ['styleConfig.panel.color'],
          renderMode: 'color',
          confidence: 1,
        },
        {
          id: 'draw-one',
          role: '抽一次按钮',
          bounds: { x: 20, y: 210, width: 100, height: 48 },
          slotId: 'draw-one-slot',
          propBindings: [
            'styleConfig.drawOne.left',
            'styleConfig.drawOne.width',
            'styleConfig.drawOne.visible',
          ],
          renderMode: 'generated-asset',
          confidence: 1,
        },
        {
          id: 'runtime-content',
          role: '运行时奖品内容',
          bounds: { x: 24, y: 50, width: 327, height: 130 },
          propBindings: [],
          renderMode: 'runtime',
          confidence: 1,
        },
      ],
      propertyValues: { 'styleConfig.panel.color': '#eeeeee' },
      diagnostics: [],
    },
    assetTasks: [{
      id: 'asset-draw-one',
      slotId: 'draw-one-slot',
      label: '抽一次按钮',
      propPath: 'styleConfig.drawOne.image',
      fallbackPath: 'styleConfig.drawOne.fallback',
      role: 'button',
      targetSize: { width: 100, height: 48 },
      transparent: true,
      exactText: '抽一次',
    }],
    propsPatch: {},
    properties: [
      { path: 'styleConfig.panel.color', kind: 'color' },
      { path: 'styleConfig.drawOne.left', kind: 'x' },
      { path: 'styleConfig.drawOne.width', kind: 'width' },
      { path: 'styleConfig.drawOne.visible', kind: 'visibility' },
    ],
    unresolved: [],
    diagnostics: [],
  }
}

function createGeneratedImage(src) {
  return { src, width: 100, height: 48, name: 'draw-one.svg', placement: 'asset' }
}

function createVisualShellImage() {
  return {
    src: 'data:image/svg+xml;base64,visual-shell',
    width: 375,
    height: 300,
    name: 'visual-shell.svg',
    placement: 'asset',
  }
}

function createPageDesign() {
  return {
    blueprint: {
      version: 1,
      width: 375,
      estimatedHeight: 624,
      sections: [0, 1].map((index) => ({
        id: `section-${index}`,
        role: `组件 ${index + 1}`,
        kind: 'component-instance',
        bounds: { x: 0, y: index * 324, width: 375, height: 300 },
        source: 'component-thumbnail',
        component: { componentName: 'EraLottery', profile: 'style-config' },
      })),
      constraints: [{ type: 'vertical-gap', from: 'section-0', to: 'section-1', value: 24 }],
    },
    qualityReview: {
      passed: true,
      scores: { structure: 1, theme: 0.8, readability: 1, completeness: 1, developmentReadiness: 0.8 },
      issues: [],
      repairCount: 0,
    },
  }
}

function getDocument(store) {
  const document = store.getState().document
  assert.ok(document)
  return document
}

function findElement(document, id) {
  const element = document.elements.find((item) => item.id === id)
  assert.ok(element, `缺少元素 ${id}`)
  return element
}

function findBoundElement(document, regionId) {
  const element = document.elements.find((item) => item.componentBinding?.regionId === regionId)
  assert.ok(element, `缺少 Region ${regionId}`)
  return element
}

function getComponentDesign(document, artboardId) {
  const design = Object.values(document.componentInstances ?? {})
    .filter((instance) => instance.artboardId === artboardId)
    .at(-1)?.design
  assert.ok(design, '缺少组件实例元数据')
  return design
}

function readPath(target, pathValue) {
  return pathValue.split('.').reduce((value, segment) => value?.[segment], target)
}
