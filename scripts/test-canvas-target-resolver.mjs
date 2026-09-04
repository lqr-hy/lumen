import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'studio-target-resolver-'))
const workflowOutfile = join(directory, 'workflow-target.mjs')

try {
  await build({
    stdin: {
      contents: [
        "export { resolveWorkflowCanvasTarget } from './src/features/editor/utils/workflow-canvas-target.ts'",
        "export { useEditorStore } from './src/features/editor/store/editor-store.ts'",
        "export { createBlankDocument } from './src/features/editor/data/sample-document.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
    },
    outfile: workflowOutfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { createBlankDocument, resolveWorkflowCanvasTarget, useEditorStore } = await import(
    `${pathToFileURL(workflowOutfile).href}?t=${Date.now()}`
  )
  const blankDocument = createBlankDocument('自动目标测试')
  useEditorStore.getState().setDocument({ ...blankDocument, artboards: [], elements: [] })
  const workflowThread = {
    id: 'workflow-thread',
    title: '自动目标测试',
    prompt: '',
    referenceImages: [],
    textReferences: [],
    messages: [],
  }
  useEditorStore.getState().addChatThread(workflowThread)
  const request = {
    id: 'target-request-1',
    turnId: 'turn-1',
    sessionId: workflowThread.id,
    projectId: blankDocument.id,
    action: 'create-component',
    taskKind: 'component-design',
    operationId: 'operation-create-component',
    placement: {
      operation: 'create',
      scope: 'document',
      reason: 'new-component-design',
      confidence: 0.96,
    },
    baseDocumentRevision: useEditorStore.getState().document.version,
    logicalSize: { width: 375, initialHeight: 812, autoHeight: true },
  }
  const created = resolveWorkflowCanvasTarget(workflowThread.id, request)
  assert.equal(created.status, 'ready')
  assert.equal(created.target.createdForThread, true)
  assert.equal(created.target.width, 375)
  assert.equal(useEditorStore.getState().document.artboards.length, 1)

  const retried = resolveWorkflowCanvasTarget(workflowThread.id, {
    ...request,
    id: 'target-request-2',
    action: 'continue',
    operationId: 'operation-resume-component',
    placement: {
      operation: 'resume',
      scope: 'artboard',
      targetArtboardId: created.target.artboardId,
      reason: 'resume-task',
      confidence: 1,
    },
    preferredArtboardId: created.target.artboardId,
    baseDocumentRevision: useEditorStore.getState().document.version,
  })
  assert.equal(retried.target.artboardId, created.target.artboardId)
  assert.equal(retried.target.createdForThread, false)
  assert.equal(useEditorStore.getState().document.artboards.length, 1)

  const explicit = resolveWorkflowCanvasTarget(workflowThread.id, {
    ...request,
    id: 'target-request-3',
    action: 'create-artboard',
    operationId: 'operation-create-artboard',
    placement: {
      operation: 'create',
      scope: 'document',
      reason: 'new-artboard',
      confidence: 1,
    },
    preferredArtboardId: undefined,
    baseDocumentRevision: useEditorStore.getState().document.version,
  })
  assert.notEqual(explicit.target.artboardId, created.target.artboardId)
  assert.equal(useEditorStore.getState().document.artboards.length, 2)

  const desktopUi = resolveWorkflowCanvasTarget(workflowThread.id, {
    ...request,
    id: 'target-request-4',
    action: 'create-ui',
    taskKind: 'generic-ui',
    operationId: 'operation-create-admin',
    placement: {
      operation: 'create',
      scope: 'document',
      reason: 'new-admin-design',
      confidence: 0.98,
    },
    preferredArtboardId: undefined,
    baseDocumentRevision: useEditorStore.getState().document.version,
    logicalSize: { width: 1440, initialHeight: 900, autoHeight: false },
  })
  assert.notEqual(desktopUi.target.artboardId, created.target.artboardId)
  assert.equal(desktopUi.target.width, 1440)
  assert.equal(desktopUi.target.placementMode, 'new-artboard')
  assert.equal(useEditorStore.getState().document.artboards.length, 3)

  const missingInsertTarget = resolveWorkflowCanvasTarget(workflowThread.id, {
    ...request,
    id: 'target-request-5',
    operationId: 'operation-insert-without-target',
    placement: {
      operation: 'insert',
      scope: 'artboard',
      reason: 'insert-section',
      confidence: 0.8,
    },
    preferredArtboardId: undefined,
    baseDocumentRevision: useEditorStore.getState().document.version,
  })
  assert.equal(missingInsertTarget.status, 'failed')
  assert.equal(missingInsertTarget.errorCode, 'CANVAS_TARGET_REQUIRED')

  const explicitInsert = resolveWorkflowCanvasTarget(workflowThread.id, {
    ...request,
    id: 'target-request-6',
    operationId: 'operation-insert-explicit',
    placement: {
      operation: 'insert',
      scope: 'artboard',
      targetArtboardId: created.target.artboardId,
      reason: 'insert-into-selected-artboard',
      confidence: 0.99,
    },
    preferredArtboardId: created.target.artboardId,
    baseDocumentRevision: useEditorStore.getState().document.version,
  })
  assert.equal(explicitInsert.status, 'ready')
  assert.equal(explicitInsert.target.artboardId, created.target.artboardId)
  assert.equal(explicitInsert.target.placementMode, 'append-section')
  assert.equal(useEditorStore.getState().document.artboards.length, 3)

  const stale = resolveWorkflowCanvasTarget(workflowThread.id, {
    ...request,
    id: 'target-request-7',
    operationId: 'operation-stale',
    baseDocumentRevision: 0,
  })
  assert.equal(stale.status, 'failed')
  assert.equal(stale.errorCode, 'CANVAS_DOCUMENT_STALE')

  console.log(
    JSON.stringify(
      {
        piOwnsDesignDecision: true,
        workflowAutoCreatesTarget: true,
        retryReusesTarget: true,
        explicitArtboardCreatesOnce: true,
        desktopUiCreatesEditableArtboard: true,
        insertRequiresExplicitTarget: true,
        staleRevisionRejected: true,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
