import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import {
  applyDesignSpecPatch,
  normalizeDesignSpecPatch,
  validateDesignSpecPatch,
} from '../electron/runtime/design-spec-patch.mjs'
import { routeAgentIntent } from '../electron/runtime/intent-router.mjs'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-spec-patch-'))
const bundleFile = path.join(testRoot, 'design-spec-patch-renderer.mjs')
configureAgentSessionStore(testRoot)

try {
  const schema = createDesignSpec()
  const snapshot = {
    artboardId: 'spec-board',
    documentRevision: 7,
    width: 1440,
    height: 900,
    elementCount: 20,
    selectedElementIds: [],
    elements: [],
    designSpec: schema,
  }
  const intent = routeAgentIntent({
    prompt: '在表格前新增关键指标模块，并把筛选区移动到表格后面',
    session: { canvasSnapshot: snapshot },
  })
  assert.equal(intent.action, 'revise-ui-structure')
  assert.equal(intent.taskKind, 'design-spec-patch')

  const providerPatch = {
    version: 1,
    baseRevision: 7,
    artboardId: 'spec-board',
    summary: '增加指标并调整筛选顺序',
    operations: [
      {
        id: 'insert-stats',
        kind: 'insert-block',
        beforeBlockId: 'table',
        block: {
          id: 'stats',
          kind: 'stats',
          label: '关键指标',
          items: ['订单总数 1284', '今日新增 36'],
        },
      },
      { id: 'move-filter', kind: 'move-block', blockId: 'filter', afterBlockId: 'table' },
    ],
  }
  const normalized = normalizeDesignSpecPatch(providerPatch, snapshot)
  assert.deepEqual(validateDesignSpecPatch(normalized, snapshot), [])
  const expectedSpec = applyDesignSpecPatch(schema, normalized)
  assert.deepEqual(
    expectedSpec.blocks.map((block) => block.id),
    ['header', 'stats', 'table', 'filter'],
  )

  let delivered
  const runtimeResult = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `design-spec-patch-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: '在表格前新增关键指标模块，并把筛选区移动到表格后面',
      uploads: [],
      canvasSnapshot: snapshot,
      canvasTarget: {
        artboardId: 'spec-board',
        createdForThread: false,
        width: 1440,
        height: 900,
        placementMode: 'append-section',
        placementSource: 'selection',
      },
    },
    {
      onDeliverable: async (value) => {
        delivered = value
        return {
          status: 'success',
          summary: 'DesignSpec Patch 已应用。',
          data: {
            artboardId: 'spec-board',
            rootElementId: 'root',
            elementCount: 30,
            documentRevision: 8,
            designSpec: value.nextDesignSpec,
          },
        }
      },
    },
    {
      invokeProvider: async (payload) => {
        assert.equal(payload.type, 'generate_design_spec_patch')
        assert.equal(payload.canvasSnapshot.designSpec.blocks.length, 3)
        return { data: providerPatch }
      },
    },
  )
  assert.equal(delivered.kind, 'design-spec-patch')
  assert.deepEqual(
    delivered.nextDesignSpec.blocks.map((block) => block.id),
    ['header', 'stats', 'table', 'filter'],
  )
  assert.equal(runtimeResult.designSpecPatch.operations.length, 2)
  assert.equal(
    runtimeResult.agent.plan.every((step) => step.status === 'completed'),
    true,
  )

  await build({
    stdin: {
      contents: [
        "export { useEditorStore } from './src/features/editor/store/editor-store.ts'",
        "export { applyIncrementalCanvasDeliverable } from './src/features/editor/utils/incremental-delivery.ts'",
        "export { compileDesignSpec } from './src/features/editor/utils/generic-ui-compiler.ts'",
        "export { resolveDesignSpecPatchConflicts } from './src/features/editor/utils/design-spec-patch.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'design-spec-patch-entry.ts',
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
    resolveDesignSpecPatchConflicts,
  } = await import(`${pathToFileURL(bundleFile).href}?t=${Date.now()}`)
  const document = createDocument(schema, compileDesignSpec)
  useEditorStore.getState().setDocument({ ...document, version: 8 })
  const target = { artboardId: 'spec-board', created: false, mode: 'append-section' }
  const rebasedObservation = applyIncrementalCanvasDeliverable(target, {
    ...delivered,
    id: 'safe-rebase-spec-patch',
  })
  assert.equal(rebasedObservation.status, 'success')
  assert.equal(rebasedObservation.data.rebasedFromRevision, 7)
  assert.equal(rebasedObservation.data.rebasedToRevision, 8)
  assert.equal(useEditorStore.getState().document.version, 9)

  useEditorStore.getState().setDocument(document)
  const headerIds = idsForBlock(useEditorStore, 'header')
  const tableY = blockRoot(useEditorStore, 'table').y
  const observation = applyIncrementalCanvasDeliverable(target, delivered)
  assert.equal(observation.status, 'success')
  assert.deepEqual(
    useEditorStore.getState().document.artboards[0].designSpec.blocks.map((block) => block.id),
    ['header', 'stats', 'table', 'filter'],
  )
  assert.deepEqual(idsForBlock(useEditorStore, 'header'), headerIds)
  assert.ok(blockRoot(useEditorStore, 'table').y > tableY)
  assert.ok(blockRoot(useEditorStore, 'filter').y > blockRoot(useEditorStore, 'table').y)
  assert.equal(useEditorStore.getState().document.version, 8)

  const conflict = applyIncrementalCanvasDeliverable(target, {
    ...delivered,
    id: 'stale-spec-patch',
  })
  assert.equal(conflict.status, 'failed')
  assert.equal(conflict.errorCode, 'CANVAS_DESIGN_SPEC_REVISION_CONFLICT')
  assert.ok(conflict.data.designSpecConflicts.length >= 1)
  assert.ok(
    conflict.data.designSpecConflicts.every(
      (item) => item.blockId && item.operationId && item.reason,
    ),
  )
  const choices = Object.fromEntries(
    conflict.data.designSpecConflicts.map((item) => [item.blockId, 'incoming']),
  )
  const resolvedSpec = resolveDesignSpecPatchConflicts(
    useEditorStore.getState().document.artboards[0].designSpec,
    conflict.data.designSpecConflictResolution.patch,
    conflict.data.designSpecConflicts,
    choices,
  )
  assert.deepEqual(
    resolvedSpec.blocks.map((item) => item.id),
    ['header', 'stats', 'table', 'filter'],
  )
  assert.equal(useEditorStore.getState().document.version, 8)

  const removePatch = normalizeDesignSpecPatch(
    {
      baseRevision: 8,
      artboardId: 'spec-board',
      operations: [{ id: 'remove-filter', kind: 'remove-block', blockId: 'filter' }],
    },
    { ...snapshot, documentRevision: 8, designSpec: expectedSpec },
  )
  assert.deepEqual(
    applyDesignSpecPatch(expectedSpec, removePatch).blocks.map((block) => block.id),
    ['header', 'stats', 'table'],
  )

  console.log(
    JSON.stringify(
      {
        structureIntentRouting: true,
        constrainedSpecPatch: true,
        runtimeSpecPatchPlan: true,
        rendererAtomicStructureCommit: true,
        unaffectedBlockIdsStable: true,
        revisionConflictGuard: true,
        safeRevisionAutoRebase: true,
        structuredBlockConflicts: true,
        nodeLevelConflictResolution: true,
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
      block('filter-bar', '筛选条件', {
        id: 'filter',
        fields: ['关键词', '状态'],
        actions: ['查询'],
      }),
      block('data-table', '订单列表', {
        id: 'table',
        columns: ['编号', '客户', '状态', '操作'],
        rows: [['#1001', '示例客户', '处理中', '查看']],
      }),
    ],
  }
}

function block(kind, label, values = {}) {
  return {
    id: kind,
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

function createDocument(schema, compileDesignSpec) {
  const now = new Date().toISOString()
  const artboard = {
    id: 'spec-board',
    name: '订单管理',
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    background: '#f5f7fa',
    designSpec: schema,
    genericUiSchema: schema,
  }
  const compiled = compileDesignSpec(schema, { artboard })
  return {
    id: 'spec-document',
    title: 'DesignSpec Patch',
    version: 7,
    artboards: [{ ...artboard, height: compiled.contentHeight }],
    elements: compiled.elements,
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

function idsForBlock(useEditorStore, blockId) {
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
