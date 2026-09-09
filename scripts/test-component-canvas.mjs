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
        "export { createDesignTurnCanvasBridge } from './src/features/ai/design-turn-canvas-bridge.ts'",
        "export { createComponentRegionBatchScope } from './src/features/editor/utils/selection-scope.ts'",
        "export { compileComponentDesignToSceneCommit } from './src/features/editor/scene/component-design-adapter.ts'",
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

  const {
    useEditorStore,
    applyIncrementalCanvasDeliverable,
    applyIncrementalPageComponent,
    createDesignTurnCanvasBridge,
    createComponentRegionBatchScope,
    compileComponentDesignToSceneCommit,
  } = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)
  const artboardId = 'artboard-component-test'
  const decoratedDesign = createComponentDesign()
  decoratedDesign.blueprint.regions.unshift({
    id: 'component-decorative-background',
    role: '组件装饰背景',
    bounds: { x: 0, y: 0, width: 375, height: 300 },
    slotId: 'component-decorative-background',
    propBindings: [],
    renderMode: 'generated-asset',
    confidence: 1,
    designOnly: true,
  })
  decoratedDesign.blueprint.regions.push({
    id: 'runtime-prize-image',
    role: '奖品图片',
    bounds: { x: 24, y: 60, width: 72, height: 72 },
    assetSource: 'https://example.com/prize.png',
    propBindings: [],
    renderMode: 'runtime',
    confidence: 1,
  })
  decoratedDesign.blueprint.regions.find((region) => region.id === 'panel-background').style = {
    opacity: 0.86,
  }
  decoratedDesign.assetTasks.push({
    id: 'asset-background',
    slotId: 'component-decorative-background',
    label: '组件装饰背景',
    role: 'decorative-background',
    targetSize: { width: 375, height: 300 },
    transparent: false,
    designOnly: true,
  })
  const decoratedCommit = compileComponentDesignToSceneCommit({
    componentDesign: decoratedDesign,
    assets: [
      createGeneratedImage('data:image/svg+xml;base64,button'),
      { ...createGeneratedImage('data:image/svg+xml;base64,background'), width: 375, height: 300 },
    ],
    artboard: createDocument(artboardId).artboards[0],
    instanceId: 'decorated-instance',
    rootElementId: 'decorated-root',
    originX: 0,
    originY: 0,
    width: 375,
    height: 300,
    scale: 1,
    baseZIndex: 10,
    locked: false,
  }).commit
  const decorativeBackground = decoratedCommit.elements.find(
    (element) => element.designRole === 'component-decoration',
  )
  const translucentPanel = decoratedCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'panel-background',
  )
  const runtimePrize = decoratedCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'runtime-prize-image',
  )
  const generatedButton = decoratedCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'draw-one',
  )
  const editableText = decoratedCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'task-item-0',
  )
  assert.equal(decorativeBackground?.type, 'image', '设计装饰背景没有编译为图片图层')
  assert.equal(
    decorativeBackground?.componentBinding?.bindings.image,
    undefined,
    '设计装饰背景不得绑定组件图片 Prop',
  )
  assert.ok(
    decorativeBackground.zIndex < translucentPanel.zIndex,
    '设计装饰背景必须位于组件内容底层',
  )
  assert.equal(translucentPanel.opacity, 0.86, '大面积 Surface 没有保留背景可见所需的透明度')
  assert.equal(runtimePrize?.type, 'image', 'Runtime 图片源没有编译为真实图片图层')
  assert.equal(runtimePrize?.src, 'https://example.com/prize.png')
  assert.ok(translucentPanel.zIndex < runtimePrize.zIndex, 'Runtime 图片必须绘制在 Surface 之上')
  assert.ok(
    runtimePrize.zIndex < generatedButton.zIndex,
    '生成的 Slot 素材必须绘制在 Runtime 内容之上',
  )
  assert.ok(generatedButton.zIndex < editableText.zIndex, '原生文字必须绘制在按钮底图之上')

  const hybridDesign = createHybridComponentDesign()
  const hybridCommit = compileComponentDesignToSceneCommit({
    componentDesign: hybridDesign,
    assets: [
      { ...createGeneratedImage('data:image/png;base64,hybrid-shell'), width: 375, height: 300 },
      { ...createGeneratedImage('data:image/png;base64,draw-one-slot'), width: 100, height: 48 },
    ],
    artboard: createDocument(artboardId).artboards[0],
    instanceId: 'hybrid-instance',
    rootElementId: 'hybrid-root',
    originX: 0,
    originY: 0,
    width: 375,
    height: 300,
    scale: 1,
    baseZIndex: 20,
    locked: false,
  }).commit
  const hybridShell = hybridCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'component-backdrop',
  )
  const hybridImage = hybridCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'runtime-icon',
  )
  const hybridSlotImage = hybridCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'runtime-slot-action',
  )
  const hybridSurface = hybridCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'runtime-card',
  )
  const hybridButton = hybridCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'runtime-action',
  )
  const hybridText = hybridCommit.elements.find(
    (element) => element.componentBinding?.regionId === 'runtime-title',
  )
  assert.equal(hybridShell?.type, 'image', '混合交付视觉外壳没有编译为背景图片')
  assert.equal(hybridImage?.type, 'image', '混合交付 Runtime 图片没有保留')
  assert.equal(hybridSlotImage?.type, 'image', 'Props 图片 Slot 没有编译为 Image')
  assert.equal(
    hybridSlotImage?.src,
    'data:image/png;base64,draw-one-slot',
    'Props 图片 Slot 错误复用了氛围底图',
  )
  assert.equal(
    hybridSlotImage?.componentBinding?.bindings.image,
    'styleConfig.drawOne.image',
    'Props 图片 Slot 缺少图片绑定路径',
  )
  assert.equal(hybridSurface?.type, 'shape', '混合交付 Runtime Surface 没有编译为 Shape')
  assert.equal(hybridSurface?.fill, '#fff7d6', 'Runtime Surface 的主题色被旧 Props 颜色覆盖')
  assert.equal(hybridButton?.type, 'button', '混合交付按钮没有保留为可编辑按钮')
  assert.equal(hybridButton?.style.background, '#ffbf1f', '混合交付按钮没有使用确定性的主题填充')
  assert.equal(hybridText?.type, 'text', '混合交付文字没有保留为可编辑节点')
  assert.ok(
    hybridShell.zIndex < hybridImage.zIndex &&
      hybridImage.zIndex < hybridButton.zIndex &&
      hybridButton.zIndex < hybridText.zIndex,
    '混合交付图层顺序错误',
  )
  useEditorStore.getState().setDocument(createDocument(artboardId))
  useEditorStore.getState().selectArtboard(artboardId)
  useEditorStore.setState({ viewport: { x: 0, y: 0, zoom: 0.15 } })
  const conversationTarget = useEditorStore
    .getState()
    .ensureChatThreadArtboard('panel-thread-default', 'append-section')
  assert.equal(conversationTarget?.artboardId, artboardId)
  assert.equal(useEditorStore.getState().viewport.zoom, 0.75, '对话画板应从过低缩放自动聚焦')

  const rootId = useEditorStore
    .getState()
    .applyComponentDesign(
      { artboardId, created: false, mode: 'append-section' },
      createComponentDesign(),
      [createGeneratedImage('data:image/svg+xml;base64,initial')],
    )
  assert.ok(rootId, '组件设计应创建 Section 根节点')

  let document = getDocument(useEditorStore)
  const createdInstanceId = findElement(document, rootId).componentBinding?.instanceId
  assert.ok(document.componentInstances?.[createdInstanceId], '组件生成后应注册文档级实例')
  assert.equal(document.artboards[0].componentDesign, undefined, 'Props Patch 不得挂在画板上')
  assert.equal(document.artboards[0].componentDesigns, undefined, '组件列表不得挂在画板上')
  const root = findElement(document, rootId)
  const image = findBoundElement(document, 'draw-one')
  const background = findBoundElement(document, 'panel-background')
  const runtime = findBoundElement(document, 'runtime-content')
  const taskItem = findBoundElement(document, 'task-item-0')

  assert.equal(root.type, 'section')
  assert.equal(image.type, 'image')
  assert.equal(background.type, 'shape')
  assert.equal(runtime.type, 'runtime-placeholder')
  assert.equal(taskItem.componentBinding?.repeaterPath, 'items')
  assert.equal(taskItem.componentBinding?.repeatIndex, 0)
  assert.equal(taskItem.componentBinding?.templateId, 'items[]')
  assert.equal(taskItem.type, 'text')
  assert.equal(taskItem.style.fontSize, 14, 'Runtime 文字应优先保留原始字号，不能按区域高度放大')
  assert.equal(
    document.elements.length,
    5,
    '应通过 Scene Commit 创建 Section 与四个原生 Region 图层',
  )
  assert.equal(
    document.elements.some((element) => element.componentBinding?.renderMode === 'shell'),
    false,
    'Editable Scene 不应写入全尺寸组件 Visual Shell',
  )
  assert.ok(
    document.elements.every((element) => element.componentBinding),
    '组件节点必须保留绑定信息',
  )
  assert.equal(
    document.elements.some((element) => element.name === 'EraLottery 组件预览'),
    false,
  )
  assert.equal(
    useEditorStore.getState().selectionScopeArmed,
    false,
    'Agent 交付后的选中不应自动绑定到 Composer',
  )
  useEditorStore.getState().selectElement(image.id)
  assert.equal(
    useEditorStore.getState().selectionScopeArmed,
    true,
    '用户选择节点后应激活 Composer 修改范围',
  )
  useEditorStore.getState().consumeSelectionScope()
  assert.equal(
    useEditorStore.getState().selectionScopeArmed,
    false,
    '发送后应消费 Composer 修改范围',
  )
  assert.deepEqual(
    useEditorStore.getState().selectedElementIds,
    [image.id],
    '消费修改范围不应清除画布选中',
  )

  useEditorStore
    .getState()
    .updateElements([
      { id: image.id, patch: { x: image.x + 12, width: image.width + 20, visible: false } },
    ])
  document = getDocument(useEditorStore)
  let design = getComponentDesign(document, artboardId)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.left'), 32)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.width'), 120)
  assert.equal(readPath(design.propsPatch, 'styleConfig.drawOne.visible'), false)
  assert.equal(
    readPath(design.propsPatch, 'styleConfig.panel.color'),
    undefined,
    '场景背景应保留可编辑 Shape，未编辑前不应产生额外 Props Patch',
  )

  const maskedImageSrc = 'data:image/png;base64,masked-component-image'
  const maskedPatchResult = useEditorStore.getState().applyDesignPatch(
    {
      version: 1,
      baseRevision: document.version,
      artboardId,
      targetElementIds: [image.id],
      summary: '局部修改组件按钮图',
      operations: [
        {
          id: 'masked-component-image',
          kind: 'replace-image-region',
          elementId: image.id,
          prompt: '修改按钮高光',
          normalizedRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        },
      ],
    },
    {
      'masked-component-image': {
        src: maskedImageSrc,
        width: image.width,
        height: image.height,
        mime: 'image/png',
        name: 'masked-component-image.png',
      },
    },
  )
  assert.equal(maskedPatchResult.ok, true, '组件图片应允许 Mask 局部替换')
  document = getDocument(useEditorStore)
  assert.equal(findElement(document, image.id).src, maskedImageSrc)
  design = getComponentDesign(document, artboardId)
  assert.equal(
    readPath(design.propsPatch, 'styleConfig.drawOne.image'),
    maskedImageSrc,
    'Mask 局部替换后应同步组件 Props Patch',
  )

  const imageBeforeSectionResize = findElement(document, image.id)
  const rootBeforeResize = findElement(document, rootId)
  useEditorStore.getState().updateElement(rootId, {
    x: rootBeforeResize.x + 25,
    width: rootBeforeResize.width * 2,
  })
  document = getDocument(useEditorStore)
  const imageAfterSectionResize = findElement(document, image.id)
  assert.equal(
    imageAfterSectionResize.x,
    rootBeforeResize.x + 25 + (imageBeforeSectionResize.x - rootBeforeResize.x) * 2,
  )
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
  const revisedRootId = useEditorStore
    .getState()
    .applyComponentDesign(
      { artboardId, created: false, mode: 'append-section' },
      createComponentDesign(),
      [createGeneratedImage('data:image/svg+xml;base64,revised')],
      instanceId,
    )
  assert.equal(revisedRootId, rootId, '组件整体修订应保留根 elementId')
  document = getDocument(useEditorStore)
  assert.equal(document.elements.length, elementCount, '组件整体修订不得追加重复实例')
  assert.equal(
    document.elements.filter((element) => element.componentBinding?.instanceId === instanceId)
      .length,
    elementCount,
    '原组件实例图层没有被完整替换',
  )
  assert.equal(findBoundElement(document, 'draw-one').src, 'data:image/svg+xml;base64,revised')
  assert.equal(
    findBoundElement(document, 'draw-one').id,
    image.id,
    'Scene Commit 修订应保持稳定 Region elementId',
  )

  const secondRootId = useEditorStore
    .getState()
    .applyComponentDesign(
      { artboardId, created: false, mode: 'append-section' },
      createComponentDesign(),
      [createGeneratedImage('data:image/svg+xml;base64,second')],
    )
  assert.ok(secondRootId, '批量测试缺少第二个组件实例')
  document = getDocument(useEditorStore)
  const firstBatchImage = document.elements.find(
    (element) =>
      element.type === 'image' &&
      element.componentBinding?.instanceId === instanceId &&
      element.componentBinding.regionId === 'draw-one',
  )
  const secondInstanceId = findElement(document, secondRootId).componentBinding?.instanceId
  const secondBatchImage = document.elements.find(
    (element) =>
      element.type === 'image' &&
      element.componentBinding?.instanceId === secondInstanceId &&
      element.componentBinding.regionId === 'draw-one',
  )
  assert.ok(firstBatchImage && secondBatchImage && secondInstanceId)
  const batchBaseRevision = document.version
  const componentBatchScope = createComponentRegionBatchScope(document, [
    firstBatchImage.id,
    secondBatchImage.id,
  ])
  assert.ok(componentBatchScope)
  const batchObservation = applyIncrementalCanvasDeliverable(
    { artboardId, created: false, mode: 'append-section' },
    {
      id: 'delivery-component-slot-batch',
      kind: 'component-slot-batch',
      sessionId: 'component-batch-session',
      runId: 'component-batch-run',
      stepId: 'present-component-slots',
      editScope: componentBatchScope,
      items: [
        {
          editScope: componentBatchScope.targets.find(
            (target) => target.elementId === firstBatchImage.id,
          ),
          image: createGeneratedImage('data:image/svg+xml;base64,batch-first'),
        },
        {
          editScope: componentBatchScope.targets.find(
            (target) => target.elementId === secondBatchImage.id,
          ),
          image: createGeneratedImage('data:image/svg+xml;base64,batch-second'),
        },
      ],
    },
  )
  assert.equal(batchObservation.status, 'success')
  document = getDocument(useEditorStore)
  assert.equal(document.version, batchBaseRevision + 1, '批量替换只能提交一次 Revision')
  assert.equal(
    findElement(document, firstBatchImage.id).src,
    'data:image/svg+xml;base64,batch-first',
  )
  assert.equal(
    findElement(document, secondBatchImage.id).src,
    'data:image/svg+xml;base64,batch-second',
  )
  assert.equal(
    readPath(
      document.componentInstances[instanceId].design.propsPatch,
      'styleConfig.drawOne.image',
    ),
    'data:image/svg+xml;base64,batch-first',
  )
  assert.equal(
    readPath(
      document.componentInstances[secondInstanceId].design.propsPatch,
      'styleConfig.drawOne.image',
    ),
    'data:image/svg+xml;base64,batch-second',
  )
  useEditorStore.getState().removeElements([secondRootId])

  useEditorStore.getState().updateChatThread('panel-thread-default', (thread) => ({
    ...thread,
    visualOptimizationDraft: {
      sourceArtboardId: artboardId,
      sourceArtboardName: '测试原稿',
      brief: { preserve: { content: true } },
    },
  }))

  const variantTarget = useEditorStore
    .getState()
    .ensureChatThreadArtboard('panel-thread-default', 'duplicate-variant')
  assert.ok(variantTarget?.artboardId, '复制变体应创建新画板')
  document = getDocument(useEditorStore)
  assert.equal(variantTarget.parentArtboardId, artboardId, '变体目标缺少原稿画板关系')
  assert.equal(
    document.artboards.find((item) => item.id === variantTarget.artboardId)
      ?.variantParentArtboardId,
    artboardId,
    '变体画板没有持久化原稿关系',
  )
  assert.equal(
    document.artboards.find((item) => item.id === variantTarget.artboardId)?.variantStatus,
    'candidate',
    '新变体应处于待决策状态',
  )
  assert.equal(
    document.artboards.find((item) => item.id === variantTarget.artboardId)
      ?.visualOptimizationBrief?.preserve.content,
    true,
    '变体画板没有保存质量门禁所需的 Visual Brief',
  )
  const variantRoots = document.elements.filter(
    (element) =>
      element.artboardId === variantTarget.artboardId &&
      element.componentBinding?.renderMode === 'root',
  )
  assert.equal(variantRoots.length, 1)
  const variantInstanceId = variantRoots[0].componentBinding?.instanceId
  assert.ok(variantInstanceId && variantInstanceId !== instanceId, '复制变体必须创建独立实例 ID')
  assert.ok(document.componentInstances?.[variantInstanceId], '复制变体缺少实例注册记录')
  assert.ok(
    document.elements
      .filter((element) => element.artboardId === variantTarget.artboardId && element.parentId)
      .every((element) => element.parentId === variantRoots[0].id),
    '复制变体子节点父 ID 未重映射',
  )
  useEditorStore.getState().removeArtboard(variantTarget.artboardId)

  useEditorStore.getState().removeElements([rootId])
  document = getDocument(useEditorStore)
  assert.equal(document.elements.length, 0, '删除 Section 应级联删除所有 Region')
  assert.equal(
    Object.keys(document.componentInstances ?? {}).length,
    0,
    '删除 Section 应清理组件实例元数据',
  )

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
  const firstShellObservation = applyIncrementalCanvasDeliverable(
    incrementalTarget,
    incrementalShell,
  )
  assert.equal(firstShellObservation.status, 'success')
  const incrementalShellId = firstShellObservation.data.shellElementId
  const persistedLedger = structuredClone(useEditorStore.getState().mutationLedger)
  const persistedDocument = structuredClone(getDocument(useEditorStore))
  const persistedElementCount = persistedDocument.elements.length
  useEditorStore.getState().hydrateWorkspace({
    document: persistedDocument,
    chatThreads: [],
    activeChatThreadId: 'panel-thread-default',
    mutationLedger: persistedLedger,
  })
  const replayObservation = applyIncrementalCanvasDeliverable(incrementalTarget, incrementalShell)
  assert.match(replayObservation.summary, /重复交付已忽略/)
  assert.equal(
    getDocument(useEditorStore).elements.length,
    persistedElementCount,
    '应用重启后重复 Delivery 不得新增节点',
  )
  const stateBeforeFailedCommit = useEditorStore.getState()
  const elementCountBeforeFailedCommit = getDocument(useEditorStore).elements.length
  const ledgerCountBeforeFailedCommit = stateBeforeFailedCommit.mutationLedger.length
  globalThis.window = {
    lumenProjects: {
      save: async () => {
        throw new Error('模拟项目保存失败')
      },
    },
  }
  const bridge = createDesignTurnCanvasBridge({ threadId: 'panel-thread-default' })
  bridge.onCanvasTargetRequest({
    id: 'target-failed-commit',
    turnId: 'turn-failed-commit',
    sessionId: 'session-failed-commit',
    action: 'create-image',
    taskKind: 'design-image',
    operationId: 'operation-failed-commit',
    placement: {
      operation: 'resume',
      scope: 'artboard',
      targetArtboardId: artboardId,
      reason: 'test-failed-persistence',
      confidence: 1,
    },
    preferredArtboardId: artboardId,
    baseDocumentRevision: getDocument(useEditorStore).version,
    logicalSize: { width: 375, initialHeight: 812, autoHeight: true },
  })
  const failedCommit = await bridge.onDeliverable({
    id: 'delivery-failed-commit',
    kind: 'image',
    sessionId: 'session-failed-commit',
    runId: 'run-failed-commit',
    stepId: 'present-failed-commit',
    target: { artboardId, width: 375, height: 812, placementMode: 'append-section' },
    images: [createGeneratedImage('data:image/svg+xml;base64,failed-commit')],
  })
  assert.equal(failedCommit.errorCode, 'CANVAS_MUTATION_PERSIST_FAILED')
  assert.equal(
    getDocument(useEditorStore).elements.length,
    elementCountBeforeFailedCommit,
    '持久化失败后应回滚画布节点',
  )
  assert.equal(
    useEditorStore.getState().mutationLedger.length,
    ledgerCountBeforeFailedCommit,
    '持久化失败后应回滚 Ledger',
  )
  delete globalThis.window
  const repairedShellObservation = applyIncrementalCanvasDeliverable(incrementalTarget, {
    ...incrementalShell,
    id: 'delivery-page-shell-repair',
    pageShell: { ...incrementalShell.pageShell, src: 'data:image/svg+xml;base64,repaired-shell' },
  })
  assert.equal(
    repairedShellObservation.data.shellElementId,
    incrementalShellId,
    'page-shell Repair 应保留 elementId',
  )
  assert.equal(
    getDocument(useEditorStore).elements.filter((element) => element.designRole === 'page-shell')
      .length,
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
      bounds: { x: 16, y: 80, width: 343, height: 500 },
      componentDesign: { ...createComponentDesign(), sourceHash: 'incremental-section-0' },
      images: [createGeneratedImage('data:image/svg+xml;base64,incremental-0')],
    },
  })
  assert.equal(firstIncrementalObservation.status, 'success')
  const incrementalRootId = firstIncrementalObservation.data.rootElementId
  const incrementalInstanceId = firstIncrementalObservation.data.instanceId
  assert.ok(incrementalInstanceId, '增量页面组件没有创建实例')
  const positionedRoot = findElement(getDocument(useEditorStore), incrementalRootId)
  assert.equal(positionedRoot.x, 16, '增量组件没有按 Blueprint bounds 定位')
  assert.equal(positionedRoot.y, 80, '增量组件没有按 Blueprint bounds 定位')
  assert.equal(positionedRoot.width, 343, '增量组件 Root 没有应用 Section 宽度')
  assert.ok(
    getDocument(useEditorStore)
      .elements.filter((element) => element.componentBinding?.instanceId === incrementalInstanceId)
      .every((element) => element.x >= 16 && element.x + element.width <= 359.01),
    '组件子节点没有同步缩放到 Section 边界内',
  )
  assert.equal(
    getDocument(useEditorStore).artboards.find((item) => item.id === artboardId).height,
    812,
    '组件临时布局错误撑高了页面画板',
  )
  assert.ok(
    findElement(getDocument(useEditorStore), incrementalShellId).zIndex >= 0,
    '页面视觉外壳被放到了画板背景之后',
  )
  const partialFinalizeObservation = applyIncrementalCanvasDeliverable(incrementalTarget, {
    id: 'delivery-page-finalize-partial',
    kind: 'page-finalize',
    sessionId: 'component-canvas-session',
    runId: 'component-canvas-run',
    stepId: 'present-page',
    target: { artboardId, width: 375, height: 812, placementMode: 'new-artboard' },
    blueprint: createPageDesign().blueprint,
    expectedComponentCount: 1,
    expectedPageSectionIds: ['section-0'],
  })
  assert.equal(
    partialFinalizeObservation.status,
    'success',
    '失败 Section 不应导致已成功页面组件的最终提交被误判失败',
  )
  const missingSectionObservation = applyIncrementalCanvasDeliverable(incrementalTarget, {
    id: 'delivery-page-finalize-missing',
    kind: 'page-finalize',
    sessionId: 'component-canvas-session',
    runId: 'component-canvas-run',
    stepId: 'present-page-missing',
    target: { artboardId, width: 375, height: 812, placementMode: 'new-artboard' },
    blueprint: createPageDesign().blueprint,
    expectedComponentCount: 1,
    expectedPageSectionIds: ['section-1'],
  })
  assert.equal(missingSectionObservation.status, 'failed')
  assert.match(missingSectionObservation.summary, /section-1/, '终态失败应指出缺失的 Section ID')
  const emptyPageObservation = applyIncrementalCanvasDeliverable(incrementalTarget, {
    id: 'delivery-page-finalize-empty',
    kind: 'page-finalize',
    sessionId: 'component-canvas-session',
    runId: 'component-canvas-run',
    stepId: 'present-page-empty',
    target: { artboardId, width: 375, height: 812, placementMode: 'new-artboard' },
    blueprint: createPageDesign().blueprint,
    expectedComponentCount: 0,
    expectedPageSectionIds: [],
  })
  assert.equal(emptyPageObservation.status, 'failed', '全部组件失败时不得提交只有背景的空页面')
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
      bounds: { x: 16, y: 80, width: 343, height: 500 },
      componentDesign: { ...createComponentDesign(), sourceHash: 'incremental-section-0-repair' },
      images: [createGeneratedImage('data:image/svg+xml;base64,incremental-repair')],
    },
  })
  assert.equal(
    replacementObservation.data.rootElementId,
    incrementalRootId,
    'Repair 应原位替换增量组件 Root',
  )
  assert.equal(
    replacementObservation.data.instanceId,
    incrementalInstanceId,
    'Repair 应保留增量组件实例 ID',
  )

  const pageRoots = useEditorStore.getState().applyPageDesign(
    { artboardId, created: false, mode: 'new-artboard' },
    createPageDesign(),
    [0, 1].map((index) => ({
      index,
      pageSectionId: `section-${index}`,
      componentDesign: { ...createComponentDesign(), sourceHash: `page-component-${index}` },
      assets: [createGeneratedImage(`data:image/svg+xml;base64,page-${index}`)],
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
  assert.equal(
    Object.keys(document.componentInstances ?? {}).length,
    2,
    '完整页面应注册两个组件实例',
  )
  assert.equal(pageRoots[0], incrementalRootId, '最终页面交付应原位复用已增量写入的 Section Root')
  assert.equal(
    findElement(document, pageRoots[0]).componentBinding?.instanceId,
    incrementalInstanceId,
    '最终页面交付不应重复创建已增量写入的组件实例',
  )
  assert.ok(pageShell, '完整页面缺少独立页面视觉外壳')
  assert.equal(pageShell.id, incrementalShellId, '最终页面交付应复用增量 page-shell elementId')
  assert.equal(
    document.elements.filter((element) => element.designRole === 'page-shell').length,
    1,
    '最终页面存在重复 page-shell',
  )
  assert.ok(
    pageShell.zIndex < Math.min(...pageRoots.map((id) => findElement(document, id).zIndex)),
    '页面外壳必须位于组件下方',
  )
  assert.equal(
    document.artboards[0].pageDesign?.blueprint.sections.length,
    2,
    'Artboard 没有保存页面 Blueprint',
  )
  const firstPageRoot = findElement(document, pageRoots[0])
  const firstPageSectionId = firstPageRoot.componentBinding?.pageSectionId
  const firstPageInstanceId = firstPageRoot.componentBinding?.instanceId
  assert.equal(firstPageSectionId, 'section-0', '页面组件 Root 缺少 Section 绑定')
  useEditorStore.getState().setPageSectionLocked(firstPageSectionId, true)
  document = getDocument(useEditorStore)
  assert.ok(
    document.elements
      .filter((element) => element.componentBinding?.instanceId === firstPageInstanceId)
      .every((element) => element.locked),
    '锁定页面模块必须覆盖整个组件实例',
  )
  assert.equal(
    document.artboards[0].pageDesign?.blueprint.sections[0].locked,
    true,
    'Blueprint 没有同步锁定状态',
  )
  useEditorStore.getState().setPageSectionLocked(firstPageSectionId, false)
  useEditorStore
    .getState()
    .applyComponentDesign(
      { artboardId, created: false, mode: 'append-section' },
      { ...createComponentDesign(), sourceHash: 'page-section-revision' },
      [createGeneratedImage('data:image/svg+xml;base64,page-section-revision')],
      firstPageInstanceId,
    )
  document = getDocument(useEditorStore)
  assert.equal(
    document.elements.find(
      (element) =>
        element.componentBinding?.instanceId === firstPageInstanceId &&
        element.componentBinding.renderMode === 'root',
    )?.componentBinding?.pageSectionId,
    firstPageSectionId,
    '页面模块局部修订后丢失 Section 绑定',
  )

  console.log(
    JSON.stringify(
      {
        nativeLayers: ['section', 'image', 'shape', 'runtime-placeholder'],
        componentSceneCommit: true,
        componentVisualShellRemoved: true,
        designOnlyBackgroundLayer: true,
        runtimeImageSourcePreserved: true,
        semanticLayerOrdering: true,
        propsPatchSync: true,
        sectionTransform: true,
        slotReplacement: true,
        atomicBatchSlotReplacement: true,
        instanceRevision: true,
        variantInstanceIsolation: true,
        cascadeDelete: true,
        conversationCanvasFocus: true,
        editablePageComposition: true,
        pageShellBehindComponents: true,
        pageSectionLocking: true,
        pageSectionRevision: true,
        incrementalPageDeduplication: true,
        persistentMutationLedger: true,
        incrementalPageShellReplacement: true,
        partialPageFinalize: true,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}

function createDocument(artboardId) {
  const now = new Date().toISOString()
  return {
    id: 'component-canvas-document',
    title: 'Component Canvas Test',
    version: 1,
    artboards: [
      {
        id: artboardId,
        name: '组件设计',
        x: 0,
        y: 0,
        width: 375,
        height: 812,
        background: '#ffffff',
      },
    ],
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
        {
          id: 'task-item-0',
          role: '任务项',
          bounds: { x: 24, y: 50, width: 327, height: 56 },
          repeaterPath: 'items',
          repeatIndex: 0,
          templateId: 'items[]',
          propBindings: [],
          renderMode: 'text',
          confidence: 1,
          style: { fontSize: 14, fontWeight: 400, lineHeight: 20 },
        },
      ],
      propertyValues: { 'styleConfig.panel.color': '#eeeeee' },
      diagnostics: [],
    },
    assetTasks: [
      {
        id: 'asset-draw-one',
        slotId: 'draw-one-slot',
        label: '抽一次按钮',
        propPath: 'styleConfig.drawOne.image',
        fallbackPath: 'styleConfig.drawOne.fallback',
        role: 'button',
        targetSize: { width: 100, height: 48 },
        transparent: true,
        exactText: '抽一次',
      },
    ],
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

function createHybridComponentDesign() {
  return {
    ...createComponentDesign(),
    deliveryMode: 'hybrid-component',
    blueprint: {
      ...createComponentDesign().blueprint,
      regions: [
        {
          id: 'component-backdrop',
          role: '氛围底图',
          bounds: { x: 0, y: 0, width: 375, height: 300 },
          slotId: 'component-backdrop',
          propBindings: [],
          renderMode: 'generated-asset',
          designOnly: true,
          confidence: 1,
        },
        {
          id: 'runtime-card',
          role: '内容卡片',
          bounds: { x: 12, y: 24, width: 351, height: 252 },
          propBindings: ['styleConfig.panel.color'],
          renderMode: 'color',
          confidence: 1,
          style: { fill: '#fff7d6', radius: 12 },
        },
        {
          id: 'runtime-icon',
          role: '任务图标',
          bounds: { x: 20, y: 40, width: 48, height: 48 },
          assetSource: 'https://example.com/icon.png',
          propBindings: [],
          renderMode: 'runtime',
          confidence: 1,
        },
        {
          id: 'runtime-slot-action',
          role: '抽一次',
          bounds: { x: 80, y: 120, width: 100, height: 48 },
          slotId: 'draw-one-slot',
          propBindings: ['styleConfig.drawOne.image'],
          renderMode: 'generated-asset',
          confidence: 1,
        },
        {
          id: 'runtime-action',
          role: '去完成',
          content: '去完成',
          bounds: { x: 250, y: 44, width: 90, height: 40 },
          propBindings: [],
          renderMode: 'button',
          confidence: 1,
          style: { fill: '#ffbf1f', color: '#1f2937', radius: 8 },
        },
        {
          id: 'runtime-title',
          role: '任务标题',
          content: '每日观看直播',
          bounds: { x: 80, y: 44, width: 160, height: 30 },
          propBindings: [],
          renderMode: 'text',
          confidence: 1,
          style: { color: '#ffffff', fontSize: 16, fontWeight: 700 },
        },
      ],
    },
    assetTasks: [
      {
        id: 'component-backdrop',
        slotId: 'component-backdrop',
        label: '氛围底图',
        role: 'component-backdrop',
        targetSize: { width: 375, height: 300 },
        transparent: false,
        designOnly: true,
      },
      {
        id: 'component-slot-1',
        slotId: 'draw-one-slot',
        label: '抽一次',
        role: 'button',
        propPath: 'styleConfig.drawOne.image',
        targetSize: { width: 100, height: 48 },
        transparent: true,
        exactText: '抽一次',
      },
    ],
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
      scores: {
        structure: 1,
        theme: 0.8,
        readability: 1,
        completeness: 1,
        developmentReadiness: 0.8,
      },
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
