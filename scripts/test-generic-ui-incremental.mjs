import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { normalizeGenericUiSchema } from '../electron/runtime/generic-ui.mjs'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-ui-incremental-'))
const bundleFile = path.join(testRoot, 'generic-ui-renderer.mjs')
configureAgentSessionStore(testRoot)

try {
  const schema = createDesignSpec()
  const runtimeDeliveries = []
  const result = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `generic-ui-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: '生成订单管理后台 Dashboard',
      uploads: [],
      canvasTarget: {
        artboardId: 'runtime-board',
        createdForThread: true,
        width: 1440,
        height: 900,
        placementMode: 'new-artboard',
        placementSource: 'automatic',
      },
      workflowDecision: {
        version: 2,
        action: 'create-ui',
        taskKind: 'generic-ui',
        confidence: 1,
        reason: 'test',
        source: 'test',
        placement: {
          operation: 'create',
          scope: 'document',
          reason: 'test-create-admin',
          confidence: 1,
        },
      },
    },
    {
      onDeliverable: async (deliverable) => {
        runtimeDeliveries.push(deliverable)
        if (deliverable.kind === 'generic-ui-section' && deliverable.section.index === 1) {
          return {
            status: 'failed',
            summary: '模拟第二个 Section 写入失败。',
            errorCode: 'TEST_SECTION_FAILED',
          }
        }
        return {
          status: 'success',
          summary: '写入成功。',
          data: {
            artboardId: 'runtime-board',
            rootElementId: 'runtime-root',
            elementCount: 12,
            documentRevision: deliverable.section?.index ?? 4,
          },
        }
      },
    },
    {
      invokeProvider: async (payload) => {
        if (payload.type === 'generate_ui_schema') return { uiSchema: schema }
        throw new Error(`未预期的 Provider 请求：${payload.type}`)
      },
    },
  )

  const sectionDeliveries = runtimeDeliveries.filter((item) => item.kind === 'generic-ui-section')
  const finalDelivery = runtimeDeliveries.find((item) => item.kind === 'generic-ui-finalize')
  assert.equal(sectionDeliveries.length, schema.blocks.length)
  assert.equal(sectionDeliveries[0].uiSchema.blocks.length, schema.blocks.length)
  assert.deepEqual(sectionDeliveries[2].deliveredBlockIds, ['header', 'table'])
  assert.deepEqual(finalDelivery.expectedBlockIds, ['header', 'table'])
  assert.deepEqual(finalDelivery.failedSectionIndexes, [1])
  assert.equal(
    result.agent.plan.filter((step) => step.tool === 'canvas.present-ui-section').length,
    3,
  )
  assert.equal(
    result.agent.plan.find((step) => step.id === 'present-ui-section-2')?.partialFailure,
    true,
  )
  assert.deepEqual(
    result.genericUiSchema.blocks.map((block) => block.id),
    ['header', 'table'],
  )

  await build({
    stdin: {
      contents: [
        "export { useEditorStore } from './src/features/editor/store/editor-store.ts'",
        "export { applyIncrementalCanvasDeliverable } from './src/features/editor/utils/incremental-delivery.ts'",
        "export { compileDesignSpec, resolveDesignSpecBreakpoint } from './src/features/editor/utils/generic-ui-compiler.ts'",
        "export { compileResponsivePreviews } from './src/features/editor/utils/responsive-preview.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'generic-ui-incremental-entry.ts',
    },
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const {
    useEditorStore,
    applyIncrementalCanvasDeliverable,
    compileDesignSpec,
    resolveDesignSpecBreakpoint,
    compileResponsivePreviews,
  } = await import(`${pathToFileURL(bundleFile).href}?t=${Date.now()}`)
  const rawDuplicateHeaderSchema = {
    ...schema,
    blocks: [
      schema.blocks[0],
      { ...schema.blocks[0], id: 'content-header', title: '内容区标题' },
      schema.blocks[2],
    ],
  }
  const selectiveCompile = compileDesignSpec(rawDuplicateHeaderSchema, {
    artboard: createDocument('selective-board').artboards[0],
    includeBlockIds: new Set(['header']),
  })
  assert.ok(selectiveCompile.elements.some((element) => element.designBlockId === 'header'))
  assert.ok(
    selectiveCompile.elements.every((element) => element.designBlockId !== 'content-header'),
  )
  const repairedDuplicateHeaderSchema = normalizeGenericUiSchema(
    rawDuplicateHeaderSchema,
    '低代码平台后台',
  )
  const repairedCompile = compileDesignSpec(repairedDuplicateHeaderSchema, {
    artboard: createDocument('repaired-board').artboards[0],
  })
  assert.deepEqual(
    repairedDuplicateHeaderSchema.blocks.map((item) => item.kind),
    ['header', 'section-header', 'data-table'],
  )
  assert.ok(
    repairedCompile.elements.some(
      (element) =>
        element.designBlockId === 'content-header' && element.designRole === 'design-block',
    ),
  )
  const target = { artboardId: 'renderer-board', created: true, mode: 'new-artboard' }
  useEditorStore.getState().setDocument(createDocument(target.artboardId))

  const first = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-header', schema, 0, ['header']),
  )
  assert.equal(first.status, 'success')
  assert.ok(first.data.blockRootElementId)
  assert.deepEqual(currentBlockIds(useEditorStore), ['header'])
  const rootId = first.data.rootElementId
  const headerIds = elementIdsForBlock(useEditorStore, 'header')
  const revisionAfterFirst = useEditorStore.getState().document.version

  const rejected = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-filter-invalid', schema, 1, ['header']),
  )
  assert.equal(rejected.status, 'failed')
  assert.equal(useEditorStore.getState().document.version, revisionAfterFirst)
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'header'), headerIds)

  const third = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-table', schema, 2, ['header', 'table']),
  )
  assert.equal(third.status, 'success')
  assert.equal(third.data.rootElementId, rootId)
  assert.deepEqual(currentBlockIds(useEditorStore), ['header', 'table'])
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'header'), headerIds)
  const tableRootId = third.data.blockRootElementId
  const revisionBeforeRepatch = useEditorStore.getState().document.version
  const updatedSchema = {
    ...schema,
    blocks: schema.blocks.map((item) =>
      item.id === 'table'
        ? { ...item, rows: [...item.rows, ['#1002', '新增客户', '已完成', '查看']] }
        : item,
    ),
  }
  const repatched = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-table-repatch', updatedSchema, 2, ['header', 'table']),
  )
  assert.equal(repatched.status, 'success')
  assert.equal(repatched.data.blockRootElementId, tableRootId)
  assert.equal(repatched.data.documentRevision, revisionBeforeRepatch + 1)
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'header'), headerIds)
  assert.ok(
    useEditorStore.getState().document.elements.some((element) => element.name === '新增客户'),
  )

  const headerIdsBeforeStructurePatch = elementIdsForBlock(useEditorStore, 'header')
  const tableIdsBeforeInsert = elementIdsForBlock(useEditorStore, 'table')
  const tableYBeforeInsert = blockRoot(useEditorStore, 'table').y
  const statsBlock = block('stats', '关键指标', { items: ['订单总数 1284', '今日新增 36'] })
  const insertedSchema = {
    ...updatedSchema,
    blocks: [updatedSchema.blocks[0], updatedSchema.blocks[1], statsBlock, updatedSchema.blocks[2]],
  }
  const inserted = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-stats-insert', insertedSchema, 2, [
      'header',
      'stats',
      'table',
    ]),
  )
  assert.equal(inserted.status, 'success')
  assert.deepEqual(inserted.data.affectedBlockIds, ['stats', 'table'])
  assert.deepEqual(inserted.data.removedBlockIds, [])
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'header'), headerIdsBeforeStructurePatch)
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'table'), tableIdsBeforeInsert)
  assert.ok(blockRoot(useEditorStore, 'table').y > tableYBeforeInsert)
  assert.deepEqual(blockRoot(useEditorStore, 'stats').layoutConstraints, {
    horizontal: 'stretch',
    vertical: 'top',
  })

  const reorderedSchema = {
    ...insertedSchema,
    blocks: [
      insertedSchema.blocks[0],
      insertedSchema.blocks[1],
      insertedSchema.blocks[3],
      insertedSchema.blocks[2],
    ],
  }
  const reordered = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-table-reorder', reorderedSchema, 2, [
      'header',
      'table',
      'stats',
    ]),
  )
  assert.equal(reordered.status, 'success')
  assert.deepEqual(reordered.data.affectedBlockIds, ['table', 'stats'])
  assert.ok(blockRoot(useEditorStore, 'table').y < blockRoot(useEditorStore, 'stats').y)
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'header'), headerIdsBeforeStructurePatch)

  const deletedSchema = { ...updatedSchema }
  const deleted = applyIncrementalCanvasDeliverable(
    target,
    createSectionDeliverable('delivery-stats-delete', deletedSchema, 2, ['header', 'table']),
  )
  assert.equal(deleted.status, 'success')
  assert.deepEqual(deleted.data.removedBlockIds, ['stats'])
  assert.equal(elementIdsForBlock(useEditorStore, 'stats').length, 0)

  const finalized = applyIncrementalCanvasDeliverable(target, {
    id: 'delivery-finalize',
    kind: 'generic-ui-finalize',
    sessionId: 'renderer-session',
    runId: 'renderer-run',
    stepId: 'present-generic-ui',
    uiSchema: { ...updatedSchema, blocks: [updatedSchema.blocks[0], updatedSchema.blocks[2]] },
    expectedBlockIds: ['header', 'table'],
    failedSectionIndexes: [1],
  })
  assert.equal(finalized.status, 'success')
  assert.equal(finalized.data.failedSectionCount, 1)

  const idsBeforeResize = new Set(
    useEditorStore
      .getState()
      .document.elements.filter(
        (element) => element.designBlockId || element.designRole === 'container',
      )
      .map((element) => element.id),
  )
  const tableWidthBeforeResize = blockRoot(useEditorStore, 'table').width
  useEditorStore.getState().addElement({
    id: 'manual-note',
    artboardId: target.artboardId,
    type: 'text',
    name: '手工备注',
    content: '手工备注',
    x: 20,
    y: 20,
    width: 100,
    height: 24,
    zIndex: 20,
    style: { color: '#111111', fontSize: 14 },
  })
  useEditorStore.getState().updateArtboard(target.artboardId, { width: 1200 })
  assert.equal(useEditorStore.getState().document.artboards[0].width, 1200)
  assert.ok(blockRoot(useEditorStore, 'table').width < tableWidthBeforeResize)
  assert.deepEqual(
    new Set(
      useEditorStore
        .getState()
        .document.elements.filter(
          (element) => element.designBlockId || element.designRole === 'container',
        )
        .map((element) => element.id),
    ),
    idsBeforeResize,
  )
  assert.ok(
    useEditorStore.getState().document.elements.some((element) => element.id === 'manual-note'),
  )
  const idsBeforeBreakpoint = elementIdsForBlock(useEditorStore, 'table')
  useEditorStore.getState().setDesignBreakpoint(target.artboardId, 'mobile')
  assert.equal(useEditorStore.getState().document.artboards[0].width, 375)
  assert.equal(useEditorStore.getState().document.artboards[0].designBreakpointId, 'mobile')
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'table'), idsBeforeBreakpoint)
  useEditorStore.getState().setDesignBreakpoint(target.artboardId, 'tablet')
  assert.equal(useEditorStore.getState().document.artboards[0].width, 768)
  useEditorStore.getState().setDesignBreakpoint(target.artboardId, 'desktop')
  assert.equal(useEditorStore.getState().document.artboards[0].width, 1440)
  useEditorStore.getState().upsertDesignBreakpoint(target.artboardId, {
    id: 'compact-desktop',
    label: '紧凑桌面',
    viewport: { width: 1180, height: 820 },
    overrides: {
      theme: {
        colors: ['#ffffff', '#f5f7fa', '#182230', '#7c3aed', '#d9dee8'],
        radius: 14,
        density: 'comfortable',
      },
      layout: { contentPadding: 30, blockGap: 22, sidebarMode: 'collapsed' },
    },
  })
  useEditorStore.getState().setDesignBreakpoint(target.artboardId, 'compact-desktop')
  assert.equal(useEditorStore.getState().document.artboards[0].width, 1180)
  assert.equal(
    useEditorStore.getState().document.artboards[0].designBreakpointId,
    'compact-desktop',
  )
  assert.ok(
    useEditorStore
      .getState()
      .document.artboards[0].designSpec.responsive.breakpoints.some(
        (item) => item.id === 'compact-desktop',
      ),
  )
  assert.equal(
    useEditorStore.getState().document.artboards[0].designSpec.theme.radius,
    schema.theme.radius,
  )
  const responsivePreviews = compileResponsivePreviews(
    useEditorStore.getState().document.artboards[0].designSpec,
    useEditorStore.getState().document.artboards[0],
  )
  const compactPreview = responsivePreviews.find((item) => item.breakpoint.id === 'compact-desktop')
  assert.equal(compactPreview.schema.theme.radius, 14)
  assert.equal(compactPreview.schema.theme.colors[3], '#7c3aed')
  assert.equal(compactPreview.schema.layout.contentPadding, 30)
  assert.ok(compactPreview.hints.some((hint) => hint.label === '内容边距变化'))
  assert.ok(compactPreview.hints.some((hint) => hint.label === '主色覆盖'))
  assert.equal(
    compactPreview.fingerprint,
    compileResponsivePreviews(
      useEditorStore.getState().document.artboards[0].designSpec,
      useEditorStore.getState().document.artboards[0],
    ).find((item) => item.breakpoint.id === 'compact-desktop').fingerprint,
  )
  const idsBeforeTokenBatch = elementIdsForBlock(useEditorStore, 'table')
  const revisionBeforeTokenBatch = useEditorStore.getState().document.version
  useEditorStore
    .getState()
    .applyResponsiveTokenBatch(target.artboardId, ['compact-desktop', 'mobile'], {
      primaryColor: '#0f766e',
      radius: 18,
      contentPadding: 28,
      blockGap: 18,
    })
  assert.equal(useEditorStore.getState().document.version, revisionBeforeTokenBatch + 1)
  assert.deepEqual(elementIdsForBlock(useEditorStore, 'table'), idsBeforeTokenBatch)
  const batchBreakpoints =
    useEditorStore.getState().document.artboards[0].designSpec.responsive.breakpoints
  assert.equal(
    batchBreakpoints.find((item) => item.id === 'compact-desktop').overrides.theme.colors[3],
    '#0f766e',
  )
  assert.equal(batchBreakpoints.find((item) => item.id === 'mobile').overrides.theme.radius, 18)
  assert.equal(
    useEditorStore.getState().document.artboards[0].designSpec.theme.colors[3],
    schema.theme.colors[3],
  )
  const batchPreview = compileResponsivePreviews(
    useEditorStore.getState().document.artboards[0].designSpec,
    useEditorStore.getState().document.artboards[0],
  ).find((item) => item.breakpoint.id === 'compact-desktop')
  useEditorStore.getState().captureResponsiveBaseline(target.artboardId, 'compact-desktop')
  const baseline =
    useEditorStore.getState().document.artboards[0].responsiveBaselines['compact-desktop']
  assert.equal(baseline.fingerprint, batchPreview.fingerprint)
  useEditorStore.getState().upsertDesignBreakpoint(target.artboardId, {
    ...useEditorStore
      .getState()
      .document.artboards[0].designSpec.responsive.breakpoints.find(
        (item) => item.id === 'compact-desktop',
      ),
    overrides: {
      ...batchPreview.breakpoint.overrides,
      theme: { ...batchPreview.breakpoint.overrides.theme, radius: 20 },
    },
  })
  const changedFingerprint = compileResponsivePreviews(
    useEditorStore.getState().document.artboards[0].designSpec,
    useEditorStore.getState().document.artboards[0],
  ).find((item) => item.breakpoint.id === 'compact-desktop').fingerprint
  assert.notEqual(changedFingerprint, baseline.fingerprint)
  useEditorStore.getState().removeDesignBreakpoint(target.artboardId, 'compact-desktop')
  useEditorStore.getState().setDesignBreakpoint(target.artboardId, 'desktop')
  assert.equal(
    useEditorStore
      .getState()
      .document.artboards[0].designSpec.responsive.breakpoints.some(
        (item) => item.id === 'compact-desktop',
      ),
    false,
  )
  assert.equal(
    useEditorStore.getState().document.artboards[0].responsiveBaselines['compact-desktop'],
    undefined,
  )

  const compileArtboard = createDocument('stable-board').artboards[0]
  const withFooter = {
    ...schema,
    blocks: [...schema.blocks, block('footer', '页脚', { items: ['服务条款'] })],
  }
  const firstCompile = compileDesignSpec(withFooter, { artboard: compileArtboard })
  const secondCompile = compileDesignSpec(withFooter, { artboard: compileArtboard })
  assert.deepEqual(
    firstCompile.elements.map((element) => element.id),
    secondCompile.elements.map((element) => element.id),
  )
  assert.ok(firstCompile.elements.some((element) => element.designBlockId === 'footer'))
  const otherCompile = compileDesignSpec(withFooter, {
    artboard: { ...compileArtboard, id: 'other-board' },
  })
  assert.equal(
    firstCompile.elements.some((element) =>
      otherCompile.elements.some((other) => other.id === element.id),
    ),
    false,
  )
  const rowInsertedSchema = {
    ...schema,
    blocks: schema.blocks.map((item) =>
      item.id === 'table'
        ? { ...item, rows: [['#9999', '新客户', '待处理', '查看'], ...item.rows] }
        : item,
    ),
  }
  const beforeRowInsert = compileDesignSpec(schema, { artboard: compileArtboard })
  const afterRowInsert = compileDesignSpec(rowInsertedSchema, { artboard: compileArtboard })
  assert.equal(
    beforeRowInsert.elements.find(
      (element) => element.type === 'text' && element.content === '#1001',
    )?.id,
    afterRowInsert.elements.find(
      (element) => element.type === 'text' && element.content === '#1001',
    )?.id,
  )
  const responsiveSchema = {
    ...schema,
    blocks: [
      block('sidebar', '侧边导航', { items: ['概览', '订单'] }),
      block('stats', '指标', { items: ['总数 10', '新增 2', '完成 8', '失败 0'] }),
      ...schema.blocks,
    ],
  }
  const mobileSchema = resolveDesignSpecBreakpoint(responsiveSchema, 'mobile')
  const mobileCompile = compileDesignSpec(mobileSchema, {
    artboard: { ...compileArtboard, width: 375 },
  })
  const mobileSidebar = mobileCompile.elements.find(
    (element) => element.designBlockId === 'sidebar' && element.designRole === 'design-block',
  )
  const mobileStats = mobileCompile.elements.find(
    (element) => element.designBlockId === 'stats' && element.designRole === 'design-block',
  )
  assert.equal(mobileSidebar.visible, false)
  assert.equal(
    mobileCompile.elements.some((element) => element.parentId === mobileSidebar.id),
    false,
  )
  assert.ok(mobileStats.height > 400)
  const mobilePagination = mobileCompile.elements.filter(
    (element) => element.designBlockId === 'pagination',
  )
  const mobilePaginationRoot = mobilePagination.find(
    (element) => element.designRole === 'design-block',
  )
  assert.ok(
    mobilePagination
      .filter((element) => element.type === 'button')
      .every((element) => element.x >= mobilePaginationRoot.x),
  )
  const differencePreviews = compileResponsivePreviews(
    {
      ...responsiveSchema,
      responsive: {
        strategy: 'fluid',
        breakpoints: [
          { id: 'mobile', label: '移动端', viewport: { width: 375, height: 812 } },
          { id: 'desktop', label: '桌面端', viewport: { width: 1440, height: 900 } },
        ],
      },
    },
    compileArtboard,
  )
  const columnHint = differencePreviews
    .find((item) => item.breakpoint.id === 'mobile')
    .hints.find((hint) => hint.code === 'block-columns')
  assert.ok(columnHint.blockIds.includes('stats'))
  assert.ok(columnHint.elementIds.length > 0)

  const runtimeTarget = { artboardId: 'runtime-scene-board', created: true, mode: 'new-artboard' }
  const runtimeDocument = createDocument(runtimeTarget.artboardId)
  runtimeDocument.artboards[0] = {
    ...runtimeDocument.artboards[0],
    x: 80,
    y: 120,
    designSpec: schema,
    genericUiSchema: schema,
  }
  runtimeDocument.elements = [
    {
      id: 'obsolete-node',
      artboardId: runtimeTarget.artboardId,
      type: 'text',
      name: '旧节点',
      content: '旧节点',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      zIndex: 1,
      style: { color: '#111111', fontSize: 12 },
    },
  ]
  useEditorStore.getState().setDocument(runtimeDocument)
  const runtimeScene = createRuntimeScene()
  const invalidRuntime = applyIncrementalCanvasDeliverable(runtimeTarget, {
    id: 'runtime-count-invalid',
    kind: 'generic-ui-runtime',
    sessionId: 'runtime-session',
    runId: 'runtime-run',
    stepId: 'runtime-present',
    sceneGraph: runtimeScene,
    expectedNodeCount: runtimeScene.nodes.length + 1,
  })
  assert.equal(invalidRuntime.status, 'failed')
  assert.equal(useEditorStore.getState().document.version, 1)
  const runtimeObservation = applyIncrementalCanvasDeliverable(runtimeTarget, {
    id: 'runtime-valid',
    kind: 'generic-ui-runtime',
    sessionId: 'runtime-session',
    runId: 'runtime-run',
    stepId: 'runtime-present',
    sceneGraph: runtimeScene,
    expectedNodeCount: runtimeScene.nodes.length,
  })
  assert.equal(runtimeObservation.status, 'success')
  assert.equal(runtimeObservation.data.elementCount, runtimeScene.nodes.length)
  assert.equal(runtimeObservation.data.editableNodeCount, 4)
  assert.equal(runtimeObservation.data.replacedArtboard, true)
  assert.equal(runtimeObservation.data.elements.length, runtimeScene.nodes.length)
  const runtimeState = useEditorStore.getState()
  const runtimeArtboard = runtimeState.document.artboards[0]
  assert.equal(runtimeArtboard.designSpec, undefined)
  assert.equal(runtimeArtboard.genericUiSchema, undefined)
  assert.equal(runtimeArtboard.runtimeScene.nodeCount, runtimeScene.nodes.length)
  assert.equal(
    runtimeState.document.elements.some((element) => element.id === 'obsolete-node'),
    false,
  )
  assert.ok(
    runtimeState.document.elements.every((element) =>
      element.id.startsWith(`${runtimeTarget.artboardId}:runtime:`),
    ),
  )
  assert.equal(runtimeState.document.elements.find((element) => !element.parentId).x, 80)
  assert.equal(runtimeState.document.elements.find((element) => !element.parentId).y, 120)
  assert.equal(
    runtimeState.document.elements.find((element) => element.type === 'input').content,
    '搜索组件',
  )

  console.log(
    JSON.stringify(
      {
        dynamicSectionSteps: true,
        sectionFailureIsolation: true,
        cumulativeDesignSpec: true,
        stableCompilerIds: true,
        blockLevelPatch: true,
        blockInsertDeleteReorder: true,
        stableSemanticItemKeys: true,
        responsiveConstraintMetadata: true,
        responsiveArtboardReflow: true,
        multiBreakpointPreview: true,
        customBreakpointLifecycle: true,
        breakpointStyleOverrides: true,
        responsiveDifferenceHints: true,
        responsiveVisualBaseline: true,
        batchResponsiveTokens: true,
        locatableResponsiveDifferences: true,
        narrowLayoutAdaptation: true,
        footerCompilation: true,
        rendererMutationGuard: true,
        finalBlockVerification: true,
        runtimeSceneAtomicCommit: true,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

function createDesignSpec() {
  return {
    version: 1,
    surfaceKind: 'desktop-admin',
    title: '订单管理',
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: 'light',
      colors: ['#ffffff', '#f5f7fa', '#182230', '#2563eb', '#d9dee8'],
      radius: 6,
      density: 'compact',
    },
    blocks: [
      block('header', '顶部导航', { title: '订单管理', actions: ['新建订单'] }),
      block('filter-bar', '筛选条件', { fields: ['关键词', '状态'], actions: ['查询'] }),
      block('data-table', '订单列表', {
        columns: ['编号', '客户', '状态', '操作'],
        rows: [['#1001', '示例客户', '处理中', '查看']],
      }),
    ],
  }
}

function block(kind, label, values = {}) {
  return {
    id: kind === 'data-table' ? 'table' : kind === 'filter-bar' ? 'filter' : kind,
    kind,
    label,
    items: [],
    fields: [],
    actions: [],
    columns: [],
    rows: [],
    ...values,
  }
}

function createRuntimeScene() {
  const source = { adapterId: 'runtime-dom', confidence: 0.98 }
  const ownership = { regionId: 'workspace', role: 'structure' }
  return {
    version: 1,
    id: 'runtime-scene',
    rootNodeId: 'root',
    mode: 'editable-scene',
    surface: { kind: 'desktop-admin', width: 1440, height: 900, originX: 0, originY: 0 },
    nodes: [
      {
        id: 'root',
        type: 'frame',
        name: '工作台',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        zIndex: 1,
        source,
        ownership,
      },
      {
        id: 'panel',
        parentId: 'root',
        type: 'shape',
        name: '侧栏',
        bounds: { x: 0, y: 0, width: 240, height: 900 },
        zIndex: 2,
        style: { fill: '#111827' },
        source,
        ownership,
      },
      {
        id: 'title',
        parentId: 'root',
        type: 'text',
        name: '标题',
        content: '低代码工作台',
        bounds: { x: 264, y: 20, width: 180, height: 28 },
        zIndex: 3,
        style: { color: '#111827', fontSize: 20 },
        source,
        ownership,
      },
      {
        id: 'search',
        parentId: 'root',
        type: 'input',
        name: '搜索',
        content: '搜索组件',
        bounds: { x: 900, y: 14, width: 260, height: 36 },
        zIndex: 3,
        style: {
          background: '#ffffff',
          color: '#64748b',
          stroke: '#d1d5db',
          strokeWidth: 1,
          borderRadius: 6,
        },
        source,
        ownership,
      },
      {
        id: 'button',
        parentId: 'root',
        type: 'button',
        name: '发布',
        content: '发布',
        bounds: { x: 1180, y: 14, width: 96, height: 36 },
        zIndex: 3,
        style: { background: '#2563eb', color: '#ffffff', fontSize: 14 },
        source,
        ownership,
      },
      {
        id: 'logo',
        parentId: 'root',
        type: 'image',
        name: '品牌',
        bounds: { x: 24, y: 24, width: 32, height: 32 },
        zIndex: 3,
        asset: { source: 'data:image/png;base64,AA==' },
        source,
        ownership,
      },
    ],
  }
}

function createDocument(artboardId) {
  const now = new Date().toISOString()
  return {
    id: 'generic-ui-document',
    title: '通用 UI 增量交付',
    version: 1,
    artboards: [
      {
        id: artboardId,
        name: 'Dashboard',
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        background: '#ffffff',
      },
    ],
    elements: [],
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createSectionDeliverable(id, schema, index, deliveredBlockIds) {
  const section = schema.blocks[index]
  return {
    id,
    kind: 'generic-ui-section',
    sessionId: 'renderer-session',
    runId: 'renderer-run',
    stepId: `section-${index}`,
    uiSchema: schema,
    section: {
      index,
      id: section.id,
      kind: section.kind,
      label: section.label,
    },
    deliveredBlockIds,
  }
}

function currentBlockIds(useEditorStore) {
  return useEditorStore.getState().document.artboards[0].designSpec.blocks.map((block) => block.id)
}

function elementIdsForBlock(useEditorStore, blockId) {
  return useEditorStore
    .getState()
    .document.elements.filter((element) => element.designBlockId === blockId)
    .map((element) => element.id)
    .sort()
}

function blockRoot(useEditorStore, blockId) {
  return useEditorStore
    .getState()
    .document.elements.find(
      (element) => element.designBlockId === blockId && element.designRole === 'design-block',
    )
}
