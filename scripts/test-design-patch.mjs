import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { normalizeDesignPatch, validateDesignPatch } from '../electron/runtime/design-patch.mjs'
import {
  compileDesignAction,
  extractDesignPatch,
} from '../electron/runtime/design-action-compiler.mjs'
import { routeAgentIntent } from '../electron/runtime/intent-router.mjs'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-design-patch-'))
const bundleFile = path.join(testRoot, 'design-patch.mjs')
configureAgentSessionStore(testRoot)

const snapshot = {
  artboardId: 'board-patch',
  documentRevision: 7,
  width: 1440,
  height: 900,
  elementCount: 2,
  selectedElementIds: ['title'],
  elements: [
    { id: 'root', type: 'section', name: '页面', bounds: { x: 0, y: 0, width: 1440, height: 900 } },
    {
      id: 'title',
      type: 'text',
      name: '页面标题',
      parentId: 'root',
      bounds: { x: 24, y: 24, width: 300, height: 40 },
      properties: { content: '旧标题' },
    },
  ],
}
const scope = {
  type: 'generic-node',
  elementId: 'title',
  artboardId: 'board-patch',
  documentRevision: 7,
  scopeId: 'scope-title',
  targetHash: 'hash-title',
  targetElementIds: ['title'],
  elementType: 'text',
  name: '页面标题',
  bounds: snapshot.elements[1].bounds,
}

try {
  const intent = routeAgentIntent({ prompt: '把标题改成订单中心并向下移动', editScope: scope })
  assert.equal(intent.action, 'revise-design')
  assert.equal(intent.taskKind, 'design-patch')
  const autonomousDecisionIntent = routeAgentIntent({
    prompt: '当前模块是否设计一个主题背景',
    editScope: scope,
  })
  assert.equal(autonomousDecisionIntent.action, 'revise-design')
  assert.equal(autonomousDecisionIntent.reason, 'selection-generic-node')
  const deterministicTextAction = compileDesignAction({
    goal: '改成订单中心',
    scope,
    snapshot,
  })
  assert.equal(deterministicTextAction?.kind, 'text-content')
  assert.equal(deterministicTextAction?.patch.operations[0].changes.content, '订单中心')
  const shortTextAction = compileDesignAction({
    goal: '改成10%',
    scope: { ...scope, name: '支付转化率' },
    snapshot: {
      ...snapshot,
      elements: snapshot.elements.map((element) =>
        element.id === 'title'
          ? { ...element, properties: { content: '支付转化率 6.83% | 较上期' } }
          : element,
      ),
    },
  })
  assert.equal(shortTextAction?.patch.operations[0].changes.content, '10%')
  const containerHitScope = {
    ...scope,
    elementId: 'card',
    elementType: 'shape',
    targetElementIds: ['card', 'title'],
  }
  const containerHitAction = compileDesignAction({
    goal: '改成10%',
    scope: containerHitScope,
    snapshot: {
      ...snapshot,
      elements: [
        {
          id: 'card',
          type: 'shape',
          name: '指标卡片',
          bounds: { x: 0, y: 0, width: 400, height: 120 },
        },
        {
          ...snapshot.elements[1],
          parentId: 'card',
          properties: { content: '支付转化率 6.83% | 较上期' },
        },
      ],
    },
  })
  assert.equal(containerHitAction?.patch.operations[0].elementId, 'title')
  const shapeColorAction = compileDesignAction({
    goal: '改成红色背景',
    scope: {
      ...scope,
      elementId: 'card',
      elementType: 'shape',
      targetElementIds: ['card', 'title'],
    },
    snapshot: {
      ...snapshot,
      elements: [
        {
          id: 'card',
          type: 'shape',
          name: '指标卡片',
          bounds: { x: 0, y: 0, width: 400, height: 120 },
          properties: { fill: '#ffffff' },
        },
      ],
    },
  })
  assert.equal(shapeColorAction?.patch.operations[0].changes.fill, '#ef4444')
  assert.equal(compileDesignAction({ goal: '背景改成红色', scope, snapshot }), undefined)
  const multiIntent = routeAgentIntent({
    prompt: '统一调整选中模块的颜色',
    editScope: {
      type: 'multi-node',
      scopeId: 'scope-multi',
      artboardId: 'board-patch',
      documentRevision: 7,
      targetHash: 'hash-multi',
      targetElementIds: ['root', 'title'],
      elementIds: ['root', 'title'],
      names: ['页面', '页面标题'],
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
    },
  })
  assert.equal(multiIntent.action, 'revise-design')
  const textRangeScope = {
    type: 'text-range',
    elementId: 'title',
    elementType: 'text',
    name: '页面标题',
    artboardId: 'board-patch',
    documentRevision: 7,
    scopeId: 'scope-title-range',
    targetHash: 'hash-title-range',
    targetElementIds: ['title'],
    start: 1,
    end: 3,
    selectedText: '标题',
    prefix: '旧',
    suffix: '',
    bounds: snapshot.elements[1].bounds,
  }
  const textRangeIntent = routeAgentIntent({ prompt: '改成名称', editScope: textRangeScope })
  assert.equal(textRangeIntent.action, 'revise-design')

  const providerPatch = {
    version: 1,
    baseRevision: 7,
    artboardId: 'board-patch',
    summary: '修改标题',
    operations: [
      {
        id: 'update-title',
        kind: 'update',
        elementId: 'title',
        elementType: 'text',
        changes: { content: '订单中心', src: 'forbidden' },
      },
      { id: 'move-title', kind: 'move', elementId: 'title', x: 24, y: 48 },
      {
        id: 'style-title',
        kind: 'semantic-update',
        elementId: 'title',
        semantic: {
          layout: {
            widthMode: 'fill',
            minWidth: 100,
            maxWidth: 500,
            horizontalConstraint: 'stretch',
          },
          appearance: {
            opacity: 0.9,
            cornerRadii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
          },
        },
      },
    ],
  }
  assert.equal(extractDesignPatch({ data: { designPatch: providerPatch } }), providerPatch)
  const normalized = normalizeDesignPatch(providerPatch, snapshot)
  assert.equal(normalized.operations[0].changes.content, '订单中心')
  assert.equal(Object.hasOwn(normalized.operations[0].changes, 'src'), false)
  assert.deepEqual(validateDesignPatch(normalized, snapshot), [])
  const scopedPatch = normalizeDesignPatch(providerPatch, {
    ...snapshot,
    scopeId: 'scope-title',
    targetHash: 'hash-title',
    targetElementIds: ['title'],
  })
  assert.equal(scopedPatch.scopeId, 'scope-title')
  assert.deepEqual(scopedPatch.targetElementIds, ['title'])
  const escapedPatch = normalizeDesignPatch(
    {
      ...providerPatch,
      operations: [
        {
          id: 'escape-selection',
          kind: 'update',
          elementId: 'root',
          elementType: 'section',
          changes: { name: '越界' },
        },
      ],
    },
    {
      ...snapshot,
      scopeId: 'scope-title',
      targetHash: 'hash-title',
      targetElementIds: ['title'],
    },
  )
  assert.equal(
    validateDesignPatch(escapedPatch, snapshot).some((issue) => issue.includes('超出当前选区')),
    true,
  )

  let delivered
  const result = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `design-patch-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: '把标题改成订单中心并向下移动',
      uploads: [],
      editScope: scope,
      canvasSnapshot: snapshot,
      canvasTarget: {
        artboardId: 'board-patch',
        createdForThread: false,
        width: 1440,
        height: 900,
        placementMode: 'append-section',
        placementSource: 'selection',
      },
    },
    {
      onDeliverable: async (deliverable) => {
        delivered = deliverable
        return {
          status: 'success',
          summary: '测试 Patch 已应用。',
          data: {
            artboardId: 'board-patch',
            rootElementId: 'title',
            elementCount: 2,
            documentRevision: 8,
          },
        }
      },
    },
    {
      invokeProvider: async (payload) => {
        if (payload.type === 'generate_design_action') return { data: {} }
        assert.equal(payload.type, 'generate_design_patch')
        return { data: providerPatch }
      },
    },
  )
  assert.equal(delivered.kind, 'design-patch')
  assert.equal(result.designPatch.operations.length, 3)
  assert.equal(
    result.agent.plan.every((step) => step.status === 'completed'),
    true,
  )

  let fallbackPatchRequested = false
  const noConfirmationResult = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `design-patch-no-confirmation-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: '当前模块是否设计一个主题背景',
      uploads: [],
      editScope: scope,
      canvasSnapshot: snapshot,
      canvasTarget: {
        artboardId: 'board-patch',
        createdForThread: false,
        width: 1440,
        height: 900,
        placementMode: 'append-section',
        placementSource: 'selection',
      },
    },
    {
      onDeliverable: async () => ({
        status: 'success',
        summary: '测试 Patch 已应用。',
        data: {
          artboardId: 'board-patch',
          rootElementId: 'title',
          elementCount: 2,
          documentRevision: 8,
        },
      }),
    },
    {
      invokeProvider: async (payload) => {
        if (payload.type === 'generate_design_action') {
          return {
            data: {
              action: {
                action: 'set-style',
                target: { nodeId: 'title' },
                needsClarification: true,
                question: '请确认是否应用主题背景。',
              },
            },
          }
        }
        assert.equal(payload.type, 'generate_design_patch')
        fallbackPatchRequested = true
        return { data: providerPatch }
      },
    },
  )
  assert.equal(fallbackPatchRequested, true)
  assert.equal(noConfirmationResult.agent.status, 'completed')
  assert.equal(noConfirmationResult.agent.lastError, undefined)
  assert.equal(noConfirmationResult.designPatch.operations.length, 3)

  const blockSnapshot = {
    artboardId: 'board-patch',
    documentRevision: 7,
    width: 390,
    height: 844,
    elementCount: 3,
    selectedElementIds: ['hero-background'],
    elements: [
      {
        id: 'hero-block',
        type: 'section',
        name: '全幅沉浸首屏',
        designRole: 'design-block',
        designBlockId: 'hero',
        zIndex: 3,
        bounds: { x: 16, y: 16, width: 358, height: 300 },
      },
      {
        id: 'hero-background',
        parentId: 'hero-block',
        type: 'shape',
        name: '全幅沉浸首屏',
        designBlockId: 'hero',
        zIndex: 4,
        borderRadius: 8,
        bounds: { x: 16, y: 16, width: 358, height: 300 },
      },
      {
        id: 'hero-title',
        parentId: 'hero-block',
        type: 'text',
        name: '道友，别来无恙',
        designBlockId: 'hero',
        zIndex: 5,
        properties: { content: '道友，别来无恙' },
        bounds: { x: 44, y: 52, width: 302, height: 56 },
      },
    ],
  }
  const blockScope = {
    type: 'design-block',
    scopeId: 'scope-hero-block',
    artboardId: 'board-patch',
    documentRevision: 7,
    targetHash: 'hash-hero-block',
    targetElementIds: ['hero-block', 'hero-background', 'hero-title'],
    elementId: 'hero-block',
    blockId: 'hero',
    name: '全幅沉浸首屏',
    bounds: { x: 16, y: 16, width: 358, height: 300 },
    imageElementIds: [],
  }
  let imageGenerationPayload
  let imageInsertDeliverable
  const imageInsertResult = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `design-block-image-insert-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: '给当前模块添加一个图片资源，图片就是我发送的图片，图片需要优化一下',
      uploads: [
        {
          name: 'hero-reference.png',
          mime: 'image/png',
          role: 'kv',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw7JAAAAAElFTkSuQmCC',
        },
      ],
      editScope: blockScope,
      canvasSnapshot: blockSnapshot,
      canvasTarget: {
        artboardId: 'board-patch',
        createdForThread: false,
        width: 390,
        height: 844,
        placementMode: 'append-section',
        placementSource: 'selection',
      },
    },
    {
      onDeliverable: async (deliverable) => {
        imageInsertDeliverable = deliverable
        return {
          status: 'success',
          summary: '测试图片已添加。',
          data: {
            artboardId: 'board-patch',
            rootElementId: 'hero-block-image',
            elementCount: 4,
            documentRevision: 8,
          },
        }
      },
    },
    {
      invokeProvider: async (payload) => {
        assert.equal(payload.type, 'generate_image')
        imageGenerationPayload = payload
        return {
          artifact: {
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw7JAAAAAElFTkSuQmCC',
            width: 358,
            height: 300,
            mime: 'image/png',
            name: 'optimized-hero.png',
          },
        }
      },
    },
  )
  assert.equal(imageInsertResult.agent.status, 'completed')
  assert.equal(imageInsertResult.designPatch.operations[0].kind, 'add-image')
  assert.equal(imageInsertResult.designPatch.operations[0].element.parentId, 'hero-block')
  assert.equal(imageInsertResult.designPatch.operations[0].element.zIndex, 4.5)
  assert.equal(imageGenerationPayload.uploads[0].role, 'edit-base')
  assert.match(imageGenerationPayload.question, /禁止重复绘制这些 UI/)
  assert.equal(imageInsertDeliverable.kind, 'design-patch')
  assert.equal(Boolean(imageInsertDeliverable.imageArtifacts['add-design-block-image']), true)

  await build({
    stdin: {
      contents:
        "export { applyDesignPatchToDocument } from './src/features/editor/utils/design-patch.ts'; export { computeSelectionTargetHash } from './src/features/editor/utils/selection-scope.ts'",
      resolveDir: process.cwd(),
      sourcefile: 'design-patch-test-entry.ts',
    },
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { applyDesignPatchToDocument, computeSelectionTargetHash } = await import(
    `${pathToFileURL(bundleFile).href}?t=${Date.now()}`
  )
  const document = createDocument(7)
  const applied = applyDesignPatchToDocument(document, normalized, {})
  assert.equal(applied.ok, true)
  assert.equal(applied.document.version, 8)
  assert.equal(
    applied.document.elements.find((element) => element.id === 'title').content,
    '订单中心',
  )
  assert.equal(applied.document.elements.find((element) => element.id === 'title').y, 48)
  assert.equal(
    applied.document.elements.find((element) => element.id === 'title').layoutSizing.widthMode,
    'fill',
  )
  assert.equal(
    applied.document.elements.find((element) => element.id === 'title').layoutSizing.minWidth,
    100,
  )
  assert.equal(
    applied.document.elements.find((element) => element.id === 'title').layoutConstraints
      .horizontal,
    'stretch',
  )
  assert.equal(
    applied.document.elements.find((element) => element.id === 'title').cornerRadii.topLeft,
    4,
  )
  const conflict = applyDesignPatchToDocument(createDocument(8), normalized, {})
  assert.equal(conflict.ok, false)
  assert.equal(conflict.errorCode, 'DOCUMENT_REVISION_CONFLICT')

  const selectionDocument = createDocument(7)
  const selectionHash = computeSelectionTargetHash(selectionDocument, ['title'])
  const rendererScopedPatch = normalizeDesignPatch(providerPatch, {
    ...snapshot,
    scopeId: 'scope-renderer',
    targetHash: selectionHash,
    targetElementIds: ['title'],
  })
  assert.equal(applyDesignPatchToDocument(selectionDocument, rendererScopedPatch, {}).ok, true)
  const changedSelectionDocument = createDocument(7)
  changedSelectionDocument.elements.find((element) => element.id === 'title').content = '画布已变化'
  const targetConflict = applyDesignPatchToDocument(
    changedSelectionDocument,
    rendererScopedPatch,
    {},
  )
  assert.equal(targetConflict.ok, false)
  assert.equal(targetConflict.errorCode, 'SELECTION_TARGET_CONFLICT')
  const rendererEscapedPatch = normalizeDesignPatch(
    {
      baseRevision: 7,
      artboardId: 'board-patch',
      operations: [
        {
          id: 'escape-renderer',
          kind: 'update',
          elementId: 'root',
          elementType: 'section',
          changes: { name: '越界' },
        },
      ],
    },
    {
      ...snapshot,
      scopeId: 'scope-renderer',
      targetHash: selectionHash,
      targetElementIds: ['title'],
    },
  )
  const rendererScopeViolation = applyDesignPatchToDocument(
    selectionDocument,
    rendererEscapedPatch,
    {},
  )
  assert.equal(rendererScopeViolation.ok, false)
  assert.equal(rendererScopeViolation.errorCode, 'DESIGN_PATCH_SCOPE_VIOLATION')

  const rangeDocument = createDocument(7)
  const rangeHash = computeSelectionTargetHash(rangeDocument, ['title'])
  const rangePatch = normalizeDesignPatch(
    {
      baseRevision: 7,
      artboardId: 'board-patch',
      operations: [
        {
          id: 'replace-range',
          kind: 'replace-text-range',
          elementId: 'wrong-target',
          start: 0,
          end: 1,
          expectedText: '错',
          replacement: '名称',
        },
        { id: 'escape-range', kind: 'delete', elementId: 'root' },
      ],
    },
    {
      ...snapshot,
      scopeId: 'scope-title-range',
      targetHash: rangeHash,
      targetElementIds: ['title'],
      textRange: textRangeScope,
    },
  )
  assert.equal(rangePatch.operations.length, 1)
  assert.deepEqual(rangePatch.operations[0], {
    id: 'replace-range',
    kind: 'replace-text-range',
    elementId: 'title',
    start: 1,
    end: 3,
    expectedText: '标题',
    replacement: '名称',
  })
  assert.deepEqual(validateDesignPatch(rangePatch, snapshot), [])
  const rangeApplied = applyDesignPatchToDocument(rangeDocument, rangePatch, {})
  assert.equal(rangeApplied.ok, true)
  assert.equal(
    rangeApplied.document.elements.find((element) => element.id === 'title').content,
    '旧名称',
  )
  const shiftedRangeDocument = createDocument(7)
  shiftedRangeDocument.elements.find((element) => element.id === 'title').content = '新旧标题'
  const staleRangePatch = {
    ...rangePatch,
    targetHash: computeSelectionTargetHash(shiftedRangeDocument, ['title']),
  }
  const rangeConflict = applyDesignPatchToDocument(shiftedRangeDocument, staleRangePatch, {})
  assert.equal(rangeConflict.ok, false)
  assert.equal(rangeConflict.errorCode, 'DESIGN_PATCH_TEXT_RANGE_CONFLICT')

  const imageRegionScope = {
    type: 'image-region',
    elementId: 'hero',
    elementType: 'image',
    name: '主图',
    artboardId: 'board-patch',
    documentRevision: 7,
    scopeId: 'scope-hero-region',
    targetHash: 'hash-hero',
    targetElementIds: ['hero'],
    normalizedRect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    pixelRect: { x: 80, y: 45, width: 160, height: 90 },
    targetSize: { width: 320, height: 180 },
    currentImage: 'data:image/png;base64,base',
    maskImage: 'data:image/png;base64,mask',
  }
  assert.equal(
    routeAgentIntent({ prompt: '把区域里的花改成礼盒', editScope: imageRegionScope }).action,
    'revise-design',
  )
  const imageRegionPatch = normalizeDesignPatch(
    {
      baseRevision: 7,
      artboardId: 'board-patch',
      operations: [
        {
          id: 'replace-hero-region',
          kind: 'replace-image-region',
          elementId: 'wrong',
          prompt: '把花改成礼盒',
          normalizedRect: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    },
    {
      ...snapshot,
      scopeId: imageRegionScope.scopeId,
      targetHash: imageRegionScope.targetHash,
      targetElementIds: ['hero'],
      imageRegion: imageRegionScope,
    },
  )
  assert.equal(imageRegionPatch.operations[0].elementId, 'hero')
  assert.deepEqual(imageRegionPatch.operations[0].normalizedRect, imageRegionScope.normalizedRect)

  const added = applyDesignPatchToDocument(
    createDocument(7),
    normalizeDesignPatch(
      {
        baseRevision: 7,
        artboardId: 'board-patch',
        operations: [
          {
            id: 'add-badge',
            kind: 'add',
            element: {
              id: 'badge',
              type: 'shape',
              name: '状态标记',
              parentId: 'root',
              x: 360,
              y: 24,
              width: 80,
              height: 28,
              fill: '#22c55e',
            },
          },
        ],
      },
      snapshot,
    ),
    {},
  )
  assert.equal(added.ok, true)
  assert.equal(
    added.document.elements.some((element) => element.id === 'badge'),
    true,
  )

  const imageAddSnapshot = {
    ...snapshot,
    elements: snapshot.elements.map((element) =>
      element.id === 'root' ? { ...element, designRole: 'design-block' } : element,
    ),
  }
  const addedImagePatch = normalizeDesignPatch(
    {
      baseRevision: 7,
      artboardId: 'board-patch',
      operations: [
        {
          id: 'add-hero-image',
          kind: 'add-image',
          prompt: '生成 Hero 图片',
          element: {
            id: 'hero-image',
            type: 'image',
            name: 'Hero 主视觉',
            parentId: 'root',
            x: 24,
            y: 100,
            width: 320,
            height: 180,
            zIndex: 2,
            objectFit: 'cover',
          },
        },
      ],
    },
    {
      ...imageAddSnapshot,
      scopeId: 'scope-add-image',
      targetElementIds: ['root'],
    },
  )
  assert.deepEqual(validateDesignPatch(addedImagePatch, imageAddSnapshot), [])
  const imageAddDocument = createDocument(7)
  imageAddDocument.elements.find((element) => element.id === 'root').designRole = 'design-block'
  const addedImage = applyDesignPatchToDocument(imageAddDocument, addedImagePatch, {
    'add-hero-image': {
      src: 'data:image/png;base64,new-hero',
      width: 320,
      height: 180,
      mime: 'image/png',
      name: 'hero.png',
    },
  })
  assert.equal(addedImage.ok, true)
  assert.equal(
    addedImage.document.elements.find((element) => element.id === 'hero-image').src,
    'data:image/png;base64,new-hero',
  )

  const deleted = applyDesignPatchToDocument(
    createDocument(7),
    normalizeDesignPatch(
      {
        baseRevision: 7,
        artboardId: 'board-patch',
        operations: [{ id: 'delete-title', kind: 'delete', elementId: 'title' }],
      },
      snapshot,
    ),
    {},
  )
  assert.equal(deleted.ok, true)
  assert.equal(
    deleted.document.elements.some((element) => element.id === 'title'),
    false,
  )

  const imageDocument = createDocument(7)
  imageDocument.elements.push({
    id: 'hero',
    artboardId: 'board-patch',
    parentId: 'root',
    type: 'image',
    name: '主图',
    src: 'data:image/png;base64,old',
    x: 24,
    y: 100,
    width: 320,
    height: 180,
    zIndex: 2,
  })
  const replaced = applyDesignPatchToDocument(
    imageDocument,
    normalizeDesignPatch(
      {
        baseRevision: 7,
        artboardId: 'board-patch',
        operations: [
          { id: 'replace-hero', kind: 'replace-image', elementId: 'hero', prompt: '替换主图' },
        ],
      },
      snapshot,
    ),
    {
      'replace-hero': {
        src: 'data:image/png;base64,new',
        width: 320,
        height: 180,
        mime: 'image/png',
        name: 'new.png',
      },
    },
  )
  assert.equal(replaced.ok, true)
  assert.equal(
    replaced.document.elements.find((element) => element.id === 'hero').src,
    'data:image/png;base64,new',
  )

  const boundImageSnapshot = {
    ...snapshot,
    elementCount: 3,
    selectedElementIds: ['component-image'],
    elements: [
      ...snapshot.elements,
      {
        id: 'component-image',
        type: 'image',
        name: '组件按钮图',
        parentId: 'root',
        componentName: 'EraLottery',
        instanceId: 'instance-lottery',
        renderMode: 'generated-asset',
        componentImageBinding: true,
        bounds: { x: 24, y: 300, width: 100, height: 48 },
      },
    ],
  }
  const boundRegionPatch = normalizeDesignPatch(
    {
      baseRevision: 7,
      artboardId: 'board-patch',
      operations: [
        {
          id: 'edit-component-image',
          kind: 'replace-image-region',
          elementId: 'component-image',
          prompt: '修改按钮高光',
          normalizedRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        },
      ],
    },
    boundImageSnapshot,
  )
  assert.deepEqual(validateDesignPatch(boundRegionPatch, boundImageSnapshot), [])
  const forbiddenBoundReplace = normalizeDesignPatch(
    {
      baseRevision: 7,
      artboardId: 'board-patch',
      operations: [
        {
          id: 'replace-component-image',
          kind: 'replace-image',
          elementId: 'component-image',
          prompt: '整图替换',
        },
      ],
    },
    boundImageSnapshot,
  )
  assert.equal(
    validateDesignPatch(forbiddenBoundReplace, boundImageSnapshot).some((issue) =>
      issue.includes('不能修改业务组件'),
    ),
    true,
  )

  const boundImageDocument = createDocument(7)
  boundImageDocument.elements.push({
    id: 'component-image',
    artboardId: 'board-patch',
    parentId: 'root',
    type: 'image',
    name: '组件按钮图',
    src: 'data:image/png;base64,component-old',
    x: 24,
    y: 300,
    width: 100,
    height: 48,
    zIndex: 2,
    componentBinding: {
      instanceId: 'instance-lottery',
      componentName: 'EraLottery',
      profile: 'style-config',
      regionId: 'draw-one',
      slotId: 'draw-one-slot',
      renderMode: 'generated-asset',
      rootElementId: 'root',
      propPaths: ['styleConfig.drawOne.image'],
      bindings: { image: 'styleConfig.drawOne.image' },
    },
  })
  const boundRegionApplied = applyDesignPatchToDocument(boundImageDocument, boundRegionPatch, {
    'edit-component-image': {
      src: 'data:image/png;base64,component-new',
      width: 100,
      height: 48,
      mime: 'image/png',
      name: 'component-new.png',
    },
  })
  assert.equal(boundRegionApplied.ok, true)
  assert.equal(
    boundRegionApplied.document.elements.find((element) => element.id === 'component-image').src,
    'data:image/png;base64,component-new',
  )
  const rendererForbiddenBoundReplace = applyDesignPatchToDocument(
    boundImageDocument,
    forbiddenBoundReplace,
    {
      'replace-component-image': {
        src: 'data:image/png;base64,forbidden',
        width: 100,
        height: 48,
        mime: 'image/png',
        name: 'forbidden.png',
      },
    },
  )
  assert.equal(rendererForbiddenBoundReplace.ok, false)
  assert.equal(rendererForbiddenBoundReplace.errorCode, 'DESIGN_PATCH_TARGET_FORBIDDEN')

  console.log(
    JSON.stringify(
      {
        naturalLanguageRoute: true,
        providerPatchSanitized: true,
        workflowDelivery: true,
        atomicRevisionCommit: true,
        revisionConflictRejected: true,
        addDeleteAndImageReplace: true,
        semanticLayoutAndAppearancePatch: true,
        multiNodeSelectionRoute: true,
        selectionTargetWhitelist: true,
        rendererTargetHashGuard: true,
        rendererScopeGuard: true,
        textRangeRouteAndReplacement: true,
        textRangeFrozenAndConflictGuarded: true,
        imageRegionRouteAndFrozenMask: true,
        componentImageRegionAllowedAndGuarded: true,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

function createDocument(version) {
  const now = new Date().toISOString()
  return {
    id: 'project-patch',
    title: 'Patch Test',
    version,
    artboards: [
      {
        id: 'board-patch',
        name: 'Board',
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        background: '#fff',
      },
    ],
    elements: [
      {
        id: 'root',
        artboardId: 'board-patch',
        type: 'section',
        name: '页面',
        label: '页面',
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        zIndex: 1,
      },
      {
        id: 'title',
        artboardId: 'board-patch',
        parentId: 'root',
        type: 'text',
        name: '页面标题',
        content: '旧标题',
        x: 24,
        y: 24,
        width: 300,
        height: 40,
        zIndex: 2,
        style: { fontSize: 24, color: '#111' },
      },
    ],
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}
