import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-graph-'))
const bundleFile = path.join(testRoot, 'scene-graph-test.mjs')

try {
  await build({
    stdin: {
      contents: [
        "export { compileDesignSpec } from './src/features/editor/utils/generic-ui-compiler.ts'",
        "export { compileDesignSpecToSceneCommit } from './src/features/editor/scene/design-spec-adapter.ts'",
        "export { compileDesignSpecSceneTransaction } from './src/features/editor/scene/design-spec-transaction.ts'",
        "export { compileComponentDesignToSceneCommit } from './src/features/editor/scene/component-design-adapter.ts'",
        "export { designElementToSceneNode, sceneNodeToDesignElement } from './src/features/editor/scene/design-element-adapter.ts'",
        "export { compileSceneCommit } from './src/features/editor/scene/scene-commit.ts'",
        "export { validateSceneGraph, SceneGraphValidationError } from './src/features/editor/scene/scene-validator.ts'",
        "export { useEditorStore } from './src/features/editor/store/editor-store.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'scene-graph-test-entry.ts',
    },
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const runtime = await import(`${pathToFileURL(bundleFile).href}?t=${Date.now()}`)
  const artboard = {
    id: 'scene-board',
    name: '订单后台',
    x: 120,
    y: 80,
    width: 1440,
    height: 900,
    background: '#ffffff',
  }
  const schema = createDesignSpec()
  const legacy = runtime.compileDesignSpec(schema, { artboard })
  const first = runtime.compileDesignSpecToSceneCommit(schema, artboard)
  const second = runtime.compileDesignSpecToSceneCommit(schema, artboard)

  assert.equal(first.graph.mode, 'editable-scene')
  assert.equal(first.graph.nodes.length, legacy.elements.length)
  assert.equal(first.commit.elements.length, legacy.elements.length)
  assert.equal(first.commit.rootNodeId, legacy.rootId)
  assert.equal(first.commit.contentHeight, legacy.contentHeight)
  assert.equal(first.commit.sourceAdapterId, 'design-spec')
  assert.deepEqual(first.commit.elements.map(projectElement), legacy.elements.map(projectElement))
  assert.deepEqual(
    first.commit.elements.map((element) => element.id),
    second.commit.elements.map((element) => element.id),
  )
  assert.ok(first.graph.nodes.every((node) => node.source.adapterId === 'design-spec'))
  assert.ok(first.graph.nodes.every((node) => node.ownership.regionId))

  runtime.useEditorStore.getState().setDocument(createDocument(artboard))
  const storeRootId = runtime.useEditorStore.getState().applyGenericUiDesign(
    {
      artboardId: artboard.id,
      created: true,
      mode: 'new-artboard',
    },
    schema,
  )
  const committedDocument = runtime.useEditorStore.getState().document
  assert.equal(storeRootId, first.commit.rootNodeId)
  assert.equal(committedDocument.elements.length, first.commit.elements.length)
  assert.deepEqual(
    committedDocument.elements.map((element) => element.id),
    first.commit.elements.map((element) => element.id),
  )
  assert.equal(committedDocument.artboards[0].height, first.commit.contentHeight)
  const manualElement = {
    id: 'manual-note',
    artboardId: artboard.id,
    type: 'text',
    name: '手工备注',
    content: '手工备注',
    x: 20,
    y: 20,
    width: 120,
    height: 24,
    zIndex: 30,
    style: { color: '#111111', fontSize: 14 },
  }
  const transaction = runtime.compileDesignSpecSceneTransaction({
    artboard,
    renderSchema: schema,
    comparisonSchema: schema,
    previousSchema: schema,
    currentElements: [...committedDocument.elements, manualElement],
    desiredBlockIds: ['header', 'table'],
    forceBlockIds: ['table'],
  })
  assert.equal(transaction.kind, 'merge-regions')
  assert.deepEqual(transaction.affectedRegionIds, ['table'])
  assert.deepEqual(transaction.removedRegionIds, ['sidebar'])
  assert.ok(transaction.nextElements.some((element) => element.id === manualElement.id))
  assert.ok(transaction.nextElements.every((element) => element.designBlockId !== 'sidebar'))
  assert.equal(
    transaction.blockRootIds.table,
    first.commit.elements.find(
      (element) => element.designBlockId === 'table' && element.designRole === 'design-block',
    ).id,
  )

  const boundElement = {
    id: 'bound-shape',
    artboardId: artboard.id,
    type: 'shape',
    name: '绑定背景',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    zIndex: 2,
    shape: 'rect',
    fill: '#ffcc00',
    componentBinding: {
      instanceId: 'instance-1',
      componentName: 'Example',
      profile: 'default',
      regionId: 'background',
      renderMode: 'color',
      rootElementId: 'root-1',
      propPaths: ['style.backgroundColor'],
      bindings: { color: 'style.backgroundColor' },
    },
  }
  const boundNode = runtime.designElementToSceneNode(boundElement, 'test-adapter')
  assert.deepEqual(boundNode.bindings['canvas.componentBinding'], boundElement.componentBinding)
  assert.deepEqual(
    runtime.sceneNodeToDesignElement(boundNode).componentBinding,
    boundElement.componentBinding,
  )
  const componentOptions = {
    componentDesign: createComponentDesign(),
    assets: [{ src: 'data:image/png;base64,AA==', width: 100, height: 48, name: 'button.png' }],
    artboard: { ...artboard, width: 375, height: 812 },
    instanceId: 'component-instance-1',
    rootElementId: 'component-root-1',
    originX: 0,
    originY: 0,
    width: 375,
    height: 300,
    scale: 1,
    baseZIndex: 1,
    locked: false,
  }
  const componentScene = runtime.compileComponentDesignToSceneCommit(componentOptions)
  const repeatedComponentScene = runtime.compileComponentDesignToSceneCommit(componentOptions)
  assert.equal(componentScene.commit.sourceAdapterId, 'campaign-component-design')
  assert.equal(componentScene.graph.mode, 'editable-scene')
  assert.equal(
    componentScene.commit.elements.some(
      (element) => element.componentBinding?.renderMode === 'shell',
    ),
    false,
  )
  assert.equal(
    componentScene.commit.elements.length,
    componentOptions.componentDesign.blueprint.regions.length + 1,
    '组件 Scene 只能包含 Root 与 Blueprint Region，不得附加全尺寸覆盖层',
  )
  assert.deepEqual(
    componentScene.commit.elements.map((element) => element.id),
    repeatedComponentScene.commit.elements.map((element) => element.id),
  )
  const hiddenZeroNodeGraph = graphWith([
    rootNode(),
    {
      ...textNode('hidden-label', '隐藏标签'),
      parentId: 'root',
      visible: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
  ])
  assert.equal(runtime.validateSceneGraph(hiddenZeroNodeGraph).valid, true)

  const invalidCases = [
    {
      code: 'SCENE_NODE_ID_DUPLICATE',
      graph: graphWith([
        rootNode(),
        { ...textNode('same', '文本一'), parentId: 'root' },
        { ...textNode('same', '文本二'), parentId: 'root' },
      ]),
    },
    {
      code: 'SCENE_PARENT_MISSING',
      graph: graphWith([rootNode(), { ...textNode('orphan', '孤立文本'), parentId: 'missing' }]),
    },
    {
      code: 'SCENE_MULTIPLE_ROOTS',
      graph: graphWith([rootNode(), textNode('second-root', '第二根节点')]),
    },
    {
      code: 'SCENE_PARENT_CYCLE',
      graph: graphWith([
        rootNode(),
        { ...frameNode('cycle-a'), parentId: 'cycle-b' },
        { ...frameNode('cycle-b'), parentId: 'cycle-a' },
      ]),
    },
    {
      code: 'SCENE_CONTENT_INVALID',
      graph: graphWith([rootNode(), { ...textNode('placeholder', 'text-1'), parentId: 'root' }]),
    },
    {
      code: 'SCENE_FULL_FRAME_RASTER_CONFLICT',
      graph: graphWith([
        rootNode(),
        {
          ...frameNode('visual-shell'),
          type: 'image',
          parentId: 'root',
          bounds: { x: 0, y: 0, width: 375, height: 812 },
          asset: { source: 'data:image/png;base64,AA==' },
          ownership: { regionId: 'page', role: 'raster' },
        },
        { ...textNode('title', '活动标题'), parentId: 'root' },
      ]),
    },
  ]

  for (const testCase of invalidCases) {
    const validation = runtime.validateSceneGraph(testCase.graph)
    assert.equal(validation.valid, false)
    assert.ok(
      validation.diagnostics.some((item) => item.code === testCase.code),
      testCase.code,
    )
    assert.throws(
      () => runtime.compileSceneCommit(testCase.graph),
      (error) =>
        error instanceof runtime.SceneGraphValidationError &&
        error.diagnostics.some((item) => item.code === testCase.code),
    )
  }

  console.log(
    JSON.stringify(
      {
        canonicalSceneGraph: true,
        deterministicSceneCommit: true,
        designSpecAdapter: true,
        componentDesignAdapter: true,
        componentVisualShellRemoved: true,
        opaqueBindings: true,
        strictParentValidation: true,
        hiddenZeroBounds: true,
        atomicStoreCommit: true,
        regionSceneTransaction: true,
        cycleValidation: true,
        contentGuard: true,
        visualOwnershipGuard: true,
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
      block('sidebar', '侧边导航', { items: ['概览', '订单管理'] }),
      block('header', '顶部导航', { title: '订单管理', actions: ['新建订单'] }),
      block('data-table', '订单列表', {
        columns: ['编号', '客户', '状态', '操作'],
        rows: [['#1001', '示例客户', '处理中', '查看']],
      }),
    ],
  }
}

function createComponentDesign() {
  return {
    componentName: 'ExampleComponent',
    profile: 'default',
    sourceHash: 'scene-test',
    blueprint: {
      version: 1,
      componentName: 'ExampleComponent',
      profile: 'default',
      width: 375,
      height: 300,
      regions: [
        {
          id: 'background',
          role: '组件背景',
          bounds: { x: 0, y: 0, width: 375, height: 300 },
          propBindings: ['style.background'],
          renderMode: 'color',
          confidence: 1,
        },
        {
          id: 'action',
          role: '操作按钮',
          bounds: { x: 24, y: 220, width: 100, height: 48 },
          slotId: 'action-slot',
          propBindings: [],
          renderMode: 'generated-asset',
          confidence: 1,
        },
      ],
      propertyValues: { 'style.background': '#f5f5f5' },
      diagnostics: [],
    },
    assetTasks: [
      {
        id: 'action-asset',
        slotId: 'action-slot',
        label: '操作按钮',
        propPath: 'style.action.image',
        role: 'button',
        targetSize: { width: 100, height: 48 },
        transparent: true,
      },
    ],
    propsPatch: {},
    properties: [{ path: 'style.background', kind: 'color' }],
    unresolved: [],
    diagnostics: [],
  }
}

function createDocument(artboard) {
  const now = new Date().toISOString()
  return {
    id: 'scene-document',
    title: 'Scene Graph 测试',
    version: 1,
    artboards: [artboard],
    elements: [],
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

function block(kind, label, values = {}) {
  return {
    id: kind === 'data-table' ? 'table' : kind,
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

function projectElement(element) {
  return {
    id: element.id,
    artboardId: element.artboardId,
    parentId: element.parentId,
    type: element.type,
    name: element.name,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex,
    content: element.content,
    fill: element.fill,
    src: element.src,
    designRole: element.designRole,
    designBlockId: element.designBlockId,
  }
}

function graphWith(nodes) {
  return {
    version: 1,
    id: 'test-scene',
    rootNodeId: 'root',
    mode: 'editable-scene',
    surface: { kind: 'mobile', width: 375, height: 812 },
    nodes,
  }
}

function rootNode() {
  return frameNode('root')
}

function frameNode(id) {
  return {
    id,
    type: 'frame',
    name: id,
    bounds: { x: 0, y: 0, width: 375, height: 812 },
    zIndex: 1,
    source: { adapterId: 'test', sourceNodeId: id, confidence: 1 },
    ownership: { regionId: 'page', role: 'structure' },
  }
}

function textNode(id, content) {
  return {
    id,
    type: 'text',
    name: content,
    content,
    bounds: { x: 16, y: 16, width: 120, height: 24 },
    zIndex: 2,
    source: { adapterId: 'test', sourceNodeId: id, confidence: 1 },
    ownership: { regionId: 'page', role: 'structure' },
  }
}
