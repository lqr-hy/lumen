import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'silent',
})

try {
  const {
    appendRunDeliverable,
    createChatRun,
    finishRun,
    isSelectionConflict,
    reduceChatRunEvent,
  } = await vite.ssrLoadModule('/src/features/ai/agent-run.ts')
  const { buildAgentUploads } = await vite.ssrLoadModule('/src/features/ai/api.ts')
  const { DEFAULT_VISUAL_REDESIGN_BRIEF, summarizeVisualRedesignBrief } =
    await vite.ssrLoadModule('/src/features/editor/utils/visual-brief.ts')
  const { compareArtboardVersions } = await vite.ssrLoadModule(
    '/src/features/editor/utils/variant-comparison.ts',
  )
  const {
    getMessageImageLabel,
    getPromptReferenceImages,
    getStandaloneMessageImages,
    isMessageImageMentioned,
  } = await vite.ssrLoadModule('/src/features/editor/utils/chat-references.ts')

  const currentImage = { id: 'current', name: '图1.png', src: 'data:image/png;base64,current' }
  const staleImage = { id: 'stale', name: '历史图.png', src: 'data:image/png;base64,stale' }
  assert.deepEqual(getPromptReferenceImages('以 @图1 为主题生成后台', [currentImage, staleImage]), [
    currentImage,
  ])
  assert.deepEqual(
    getPromptReferenceImages('以 @已失效图片 为主题生成后台', [currentImage, staleImage]),
    [],
  )
  assert.deepEqual(getPromptReferenceImages('生成后台', [currentImage, staleImage]), [
    currentImage,
    staleImage,
  ])
  const uploads = buildAgentUploads({
    prompt: '以 @图1 为主题生成后台',
    document: {},
    history: [{ role: 'user', text: '旧消息', referenceImages: [staleImage] }],
    referenceImages: [currentImage.src],
    referenceImageNames: [currentImage.name],
    referenceImageRoles: ['prototype'],
  })
  assert.deepEqual(
    uploads.map((upload) => upload.name),
    ['图1.png'],
  )
  assert.equal(uploads[0].role, 'prototype')
  const visualSummary = summarizeVisualRedesignBrief(DEFAULT_VISUAL_REDESIGN_BRIEF)
  assert(visualSummary.preserve.includes('主 CTA 与转化路径'))
  assert(visualSummary.change.includes('颜色角色与对比'))
  const sourceArtboard = {
    id: 'source-board',
    width: 375,
    height: 812,
    background: '#ffffff',
  }
  const variantArtboard = {
    id: 'variant-board',
    width: 375,
    height: 900,
    background: '#111111',
  }
  const comparison = compareArtboardVersions(
    {
      artboards: [sourceArtboard, variantArtboard],
      elements: [
        {
          id: 'source-title',
          artboardId: sourceArtboard.id,
          type: 'text',
          content: '准确标题',
          style: { color: '#111111' },
        },
        {
          id: 'source-cta',
          artboardId: sourceArtboard.id,
          type: 'button',
          content: '立即参与',
          style: { background: '#ff6699', color: '#ffffff' },
        },
        {
          id: 'variant-title',
          artboardId: variantArtboard.id,
          type: 'text',
          content: '准确标题',
          style: { color: '#ffffff' },
        },
      ],
    },
    sourceArtboard,
    variantArtboard,
  )
  assert.equal(comparison.text.retentionRate, 0.5)
  assert.deepEqual(comparison.text.missing, ['立即参与'])
  assert.equal(comparison.source.palette[0], '#ffffff')
  assert.equal(comparison.variant.height, 900)
  assert.equal(getMessageImageLabel(0), '图1')
  assert.equal(isMessageImageMentioned('以 @图1 为主题', currentImage, 0), true)
  assert.deepEqual(getStandaloneMessageImages('以 @图1 为主题', [currentImage, staleImage]), [
    staleImage,
  ])

  let run = createChatRun('run-1', 'message-1')
  run = reduceChatRunEvent(run, {
    type: 'plan.updated',
    sessionId: 'session-1',
    sequence: 1,
    steps: [
      { id: 'prepare', title: '准备参考图', tool: 'reference.prepare', status: 'pending' },
      {
        id: 'generate',
        title: '生成组件素材',
        tool: 'component.generate-assets',
        status: 'pending',
      },
    ],
  })
  assert.equal(run.status, 'planning')
  assert.equal(run.steps.length, 2)

  run = reduceChatRunEvent(run, {
    type: 'step.started',
    sessionId: 'session-1',
    sequence: 2,
    step: { id: 'prepare', title: '准备参考图', tool: 'reference.prepare', status: 'running' },
  })
  assert.equal(run.currentStepId, 'prepare')
  assert.equal(run.steps[0].status, 'running')

  run = reduceChatRunEvent(run, {
    type: 'step.started',
    sessionId: 'session-1',
    sequence: 3,
    step: {
      id: 'generate',
      title: '生成组件素材',
      tool: 'component.generate-assets',
      status: 'running',
    },
  })
  assert.equal(run.steps.filter((step) => step.status === 'running').length, 1)
  assert.equal(run.steps[0].status, 'completed')
  assert.equal(run.currentStepId, 'generate')

  run = reduceChatRunEvent(run, {
    type: 'tool.trace',
    sessionId: 'session-1',
    sequence: 4,
    stepId: 'generate',
    trace: {
      id: 'trace-1',
      stage: 'design.transform',
      tool: 'component.generate-assets',
      taskId: 'draw-one',
      label: '抽一次按钮',
      status: 'started',
      attempt: 1,
      maxAttempts: 2,
      targetSize: { width: 160, height: 48 },
      message: '开始生成抽一次按钮',
      timestamp: 100,
    },
  })
  run = reduceChatRunEvent(run, {
    type: 'tool.trace',
    sessionId: 'session-1',
    sequence: 5,
    stepId: 'generate',
    trace: {
      id: 'trace-2',
      stage: 'design.transform',
      tool: 'component.generate-assets',
      taskId: 'draw-one',
      label: '抽一次按钮',
      status: 'completed',
      attempt: 1,
      maxAttempts: 2,
      elapsedMs: 1200,
      targetSize: { width: 160, height: 48 },
      message: '素材生成完成',
      timestamp: 101,
    },
  })
  assert.equal(run.steps[1].traces.length, 1)
  assert.equal(run.steps[1].traces[0].status, 'completed')
  assert.equal(run.steps[1].traces[0].elapsedMs, 1200)

  const unchanged = reduceChatRunEvent(run, {
    type: 'step.completed',
    sessionId: 'session-1',
    sequence: 1,
    step: { id: 'prepare', title: '准备参考图', tool: 'reference.prepare', status: 'completed' },
  })
  assert.equal(unchanged, run)

  run = reduceChatRunEvent(run, {
    type: 'step.retrying',
    sessionId: 'session-1',
    sequence: 6,
    attempt: 2,
    error: '上游超时',
    step: { id: 'prepare', title: '准备参考图', tool: 'reference.prepare', status: 'running' },
  })
  assert.equal(run.steps[0].status, 'retrying')
  assert.equal(run.steps[0].attempt, 2)

  run = reduceChatRunEvent(run, {
    type: 'observation.created',
    sessionId: 'session-1',
    sequence: 7,
    observation: {
      stepId: 'prepare',
      tool: 'reference.prepare',
      status: 'failed',
      summary: '参考图解析失败',
      errorCode: 'REFERENCE_INVALID',
      retryable: false,
    },
  })
  assert.equal(run.steps[0].summary, '参考图解析失败')
  assert.equal(run.steps[0].errorCode, 'REFERENCE_INVALID')

  run = reduceChatRunEvent(run, {
    type: 'step.failed',
    sessionId: 'session-1',
    sequence: 8,
    error: '参考图失败',
    step: { id: 'prepare', title: '准备参考图', tool: 'reference.prepare', status: 'failed' },
  })
  assert(run.steps[0].completedAt)

  run = reduceChatRunEvent(run, {
    type: 'step.completed',
    sessionId: 'session-1',
    sequence: 9,
    step: {
      id: 'generate',
      title: '交付筛选区',
      tool: 'canvas.present-ui-section',
      status: 'completed',
      partialFailure: true,
      partialSummary: '筛选区写入失败，已继续后续 Section。',
    },
  })
  assert.equal(run.steps[1].partialFailure, true)
  assert.equal(run.steps[1].partialSummary, '筛选区写入失败，已继续后续 Section。')

  run = appendRunDeliverable(
    run,
    {
      id: 'delivery-1',
      kind: 'page-component',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'generate',
      target: { artboardId: 'artboard-1', createdForThread: false, width: 375, height: 812 },
      component: {
        componentDesign: { componentName: 'EraLottery' },
        images: [],
      },
    },
    {
      status: 'success',
      summary: '抽奖组件已写入画布',
      data: { artboardId: 'artboard-1', rootElementId: 'element-1' },
    },
  )
  assert.equal(run.deliverables[0].elementId, 'element-1')
  assert.equal(run.status, 'delivering')

  run = appendRunDeliverable(
    run,
    {
      id: 'delivery-patch',
      kind: 'design-patch',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'generate',
      target: { artboardId: 'artboard-1', createdForThread: false, width: 375, height: 812 },
      patch: {
        version: 1,
        baseRevision: 4,
        artboardId: 'artboard-1',
        summary: '替换标题局部文字',
        operations: [
          {
            id: 'replace-title-range',
            kind: 'replace-text-range',
            elementId: 'title',
            start: 0,
            end: 3,
            expectedText: '旧标题',
            replacement: '新标题',
          },
        ],
      },
      images: {},
    },
    {
      status: 'success',
      summary: '已原子应用 1 个局部修改。',
      data: {
        artboardId: 'artboard-1',
        rootElementId: 'title',
        documentRevision: 5,
        affectedElementIds: ['title'],
      },
    },
  )
  const patchDelivery = run.deliverables.find((item) => item.id === 'delivery-patch')
  assert.equal(patchDelivery.title, '局部设计修改')
  assert.equal(patchDelivery.documentRevision, 5)
  assert.deepEqual(patchDelivery.affectedElementIds, ['title'])
  assert.deepEqual(patchDelivery.patchOperations[0], {
    id: 'replace-title-range',
    kind: 'replace-text-range',
    elementId: 'title',
    summary: '替换字符 0-3',
    before: '旧标题',
    after: '新标题',
  })
  const conflictedRun = appendRunDeliverable(
    createChatRun('conflict-run', 'conflict-message'),
    {
      id: 'conflict-delivery',
      kind: 'design-patch',
      sessionId: 'session-1',
      runId: 'conflict-run',
      stepId: 'patch',
      patch: {
        version: 1,
        baseRevision: 4,
        artboardId: 'artboard-1',
        summary: '冲突 Patch',
        operations: [],
      },
      images: {},
    },
    {
      status: 'failed',
      summary: '文本选区已经变化，请重新选择后执行。',
      errorCode: 'DESIGN_PATCH_TEXT_RANGE_CONFLICT',
    },
  )
  assert.equal(isSelectionConflict(conflictedRun), true)

  run = reduceChatRunEvent(run, {
    type: 'step.started',
    sessionId: 'session-1',
    sequence: 10,
    step: { id: 'finalize', title: '校验最终交付', tool: 'canvas.present-ui', status: 'running' },
  })

  run = finishRun(run, 'completed', '任务已完成')
  assert.equal(run.status, 'completed')
  assert(run.finishedAt)
  assert.equal(
    run.steps.every((step) => !['running', 'retrying'].includes(step.status)),
    true,
  )
  assert.equal(run.steps[0].status, 'failed')
  assert.equal(run.steps[1].status, 'completed')
  assert.equal(run.steps.find((step) => step.id === 'finalize').status, 'completed')

  console.log(
    JSON.stringify(
      {
        versionedEventOrdering: true,
        planAndStepTimeline: true,
        retryState: true,
        internalToolTrace: true,
        stepDiagnostics: true,
        partialStepDiagnostics: true,
        canvasDeliverableTarget: true,
        designPatchDiagnostics: true,
        selectionConflictRecovery: true,
        completionState: true,
        currentTurnAttachmentIsolation: true,
        invalidMentionDoesNotSendAll: true,
        compactMessageImageLabels: true,
        mentionedImageDeduplication: true,
      },
      null,
      2,
    ),
  )
} finally {
  await vite.close()
}
