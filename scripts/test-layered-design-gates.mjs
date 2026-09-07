import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import {
  routeAgentIntent,
  validateSelectionScopeForIntent,
} from '../electron/runtime/intent-router.mjs'
import { createDesignEvalReport } from '../electron/runtime/design-eval.mjs'

const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'layered-design-gates-'))
try {
  const outputFile = path.join(outputDirectory, 'renderer-gates.mjs')
  await build({
    stdin: {
      contents:
        "export * from './src/features/editor/utils/selection-scope.ts'; export * from './src/features/editor/utils/design-patch.ts'; export * from './src/features/editor/utils/visual-quality-gate.ts'",
      resolveDir: process.cwd(),
      sourcefile: 'renderer-gates.ts',
    },
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const gates = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)
  const document = createDocument()
  const batch = gates.createComponentRegionBatchScope(document, ['slot-one', 'slot-ten'])
  assert.equal(batch?.type, 'component-region-batch')
  assert.ok(gates.createComponentRegionBatchScope(document, ['slot-one', 'foreign-slot']))

  const snapshot = createSnapshot(document)
  assert.equal(
    validateSelectionScopeForIntent({
      prompt: '统一按钮颜色',
      editScope: { ...batch, documentRevision: 2 },
      canvasSnapshot: snapshot,
    })?.code,
    'SELECTION_SCOPE_STALE',
  )
  assert.equal(
    validateSelectionScopeForIntent({
      prompt: '统一按钮颜色',
      editScope: {
        ...batch,
        targets: [batch.targets[0], { ...batch.targets[1], instanceId: 'instance-2' }],
      },
      canvasSnapshot: snapshot,
    })?.code,
    'MIXED_COMPONENT_SELECTION',
  )
  const forged = {
    ...batch.targets[0],
    type: 'generic-node',
    elementType: 'image',
    name: '按钮',
  }
  assert.equal(
    validateSelectionScopeForIntent({
      prompt: '把按钮放大',
      editScope: forged,
      canvasSnapshot: snapshot,
    })?.code,
    'SELECTION_SCOPE_TYPE_MISMATCH',
  )
  assert.equal(
    routeAgentIntent({ prompt: '统一按钮颜色', editScope: batch.targets[0] }).errorCode,
    'ASSET_SLOT_NOT_STYLE_EDITABLE',
  )
  assert.equal(
    validateSelectionScopeForIntent({
      prompt: '统一按钮颜色',
      editScope: batch.targets[0],
      canvasSnapshot: snapshot,
    })?.code,
    'ASSET_SLOT_NOT_STYLE_EDITABLE',
  )
  assert.equal(
    routeAgentIntent({ prompt: '重新生成按钮图', editScope: batch.targets[0] }).action,
    'regenerate-slot',
  )

  const patchDocument = createPlainDocument()
  const targetHash = gates.computeSelectionTargetHash(patchDocument, ['button'])
  const applied = gates.applyDesignPatchToDocument(
    patchDocument,
    {
      version: 1,
      baseRevision: 3,
      artboardId: 'board',
      targetHash,
      targetElementIds: ['button'],
      summary: '放大按钮',
      operations: [
        {
          id: 'resize-button',
          kind: 'update',
          elementId: 'button',
          elementType: 'button',
          changes: { width: 500, height: 100 },
        },
      ],
    },
    {},
  )
  assert.equal(applied.ok, true)
  assert.equal(applied.qualityReport.version, 1)
  assert.equal(applied.qualityReport.scope, 'operation')
  assert.equal(applied.qualityReport.repairCount, 1)
  assert.equal(applied.document.elements.find((item) => item.id === 'button').width, 375)
  assert.equal(applied.beforeSnapshot.elements.find((item) => item.id === 'button').width, 120)

  const tampered = structuredClone(patchDocument)
  tampered.elements.find((item) => item.id === 'label').content = '被越界修改'
  const nonTargetReport = gates.reviewScopedVisualQuality(
    tampered,
    tampered.artboards[0],
    ['button'],
    'operation',
    { beforeDocument: patchDocument },
  )
  assert.equal(
    nonTargetReport.issues.some((issue) => issue.code === 'non-target-modified'),
    true,
  )

  const evalReport = createDesignEvalReport({
    scope: 'component',
    scores: {
      theme: 1,
      structure: 1,
      completeness: 1,
      developmentReadiness: 1,
      readability: 1,
    },
    targetIds: ['instance-1'],
  })
  assert.equal(evalReport.version, 1)
  assert.equal(evalReport.scope, 'module')
  assert.equal(evalReport.score, 1)
  assert.deepEqual(evalReport.targetIds, ['instance-1'])

  console.log(
    JSON.stringify(
      {
        mixedComponentBlocked: true,
        staleAndForgedScopeBlocked: true,
        styleAndAssetIntentSeparated: true,
        operationGateAndRepair: true,
        beforeSnapshotPreserved: true,
        nonTargetMutationDetected: true,
        unifiedGateReport: true,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(outputDirectory, { recursive: true, force: true })
}

function createDocument() {
  const rootBinding = {
    instanceId: 'instance-1',
    componentName: 'EraLottery',
    profile: 'default',
    regionId: 'root',
    renderMode: 'root',
    rootElementId: 'root',
    propPaths: [],
    bindings: {},
  }
  const slot = (id, regionId, slotId, instanceId = 'instance-1', rootElementId = 'root') => ({
    id,
    artboardId: 'board',
    type: 'image',
    name: regionId,
    src: 'data:image/png;base64,AA==',
    x: 20,
    y: 20,
    width: 100,
    height: 50,
    zIndex: 2,
    componentBinding: {
      ...rootBinding,
      instanceId,
      rootElementId,
      regionId,
      slotId,
      renderMode: 'generated-asset',
      bindings: { image: `freeStyleConfig.${regionId}.image` },
    },
  })
  return {
    id: 'document',
    title: 'test',
    version: 3,
    createdAt: '',
    updatedAt: '',
    artboards: [
      { id: 'board', name: 'Board', x: 0, y: 0, width: 375, height: 812, background: '#fff' },
    ],
    elements: [
      {
        id: 'root',
        artboardId: 'board',
        type: 'section',
        name: 'EraLottery',
        x: 0,
        y: 0,
        width: 375,
        height: 300,
        zIndex: 1,
        componentBinding: rootBinding,
      },
      slot('slot-one', 'asset-a', 'asset-a-slot'),
      slot('slot-ten', 'asset-b', 'asset-b-slot'),
      slot('foreign-slot', 'asset-a', 'asset-a-slot', 'instance-2', 'root-2'),
    ],
    assets: [],
  }
}

function createSnapshot(document) {
  return {
    artboardId: 'board',
    documentRevision: 3,
    elements: document.elements.map((element) => ({
      id: element.id,
      type: element.type,
      name: element.name,
      instanceId: element.componentBinding?.instanceId,
      componentImageBinding: Boolean(element.componentBinding?.bindings.image),
    })),
  }
}

function createPlainDocument() {
  return {
    id: 'plain',
    title: 'plain',
    version: 3,
    createdAt: '',
    updatedAt: '',
    artboards: [
      { id: 'board', name: 'Board', x: 0, y: 0, width: 375, height: 300, background: '#fff' },
    ],
    elements: [
      {
        id: 'button',
        artboardId: 'board',
        type: 'button',
        name: 'CTA 按钮',
        content: '立即参与',
        style: { fontSize: 16, color: '#fff', background: '#f00' },
        x: 20,
        y: 20,
        width: 120,
        height: 44,
        zIndex: 1,
      },
      {
        id: 'label',
        artboardId: 'board',
        type: 'text',
        name: '说明',
        content: '说明',
        style: { fontSize: 14, color: '#111' },
        x: 20,
        y: 80,
        width: 100,
        height: 24,
        zIndex: 1,
      },
    ],
    assets: [],
  }
}
