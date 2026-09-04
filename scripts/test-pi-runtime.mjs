import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import {
  configureAgentSessionStore,
  loadAgentSession,
  saveAgentSession,
} from '../electron/runtime/agent-session-store.mjs'
import {
  createProjectSessionId,
  resolveWorkflowToolParams,
  runPiStudioAgent,
} from '../electron/runtime/pi/agent-runtime.mjs'
import {
  closePiSessionStore,
  configurePiSessionStore,
} from '../electron/runtime/pi/session-store.mjs'
import {
  activateSkill,
  buildSkillCatalogPrompt,
  configureSkillRuntime,
  readSkillResource,
} from '../electron/runtime/skills.mjs'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-pi-runtime-'))
configureAgentSessionStore(testRoot)
configurePiSessionStore(testRoot)
configureSkillRuntime({ appRoot: path.resolve(import.meta.dirname, '..'), isPackaged: false })

try {
  const chatTokens = []
  const chatEvents = []
  const chat = await runPiStudioAgent(
    createPayload('pi-chat-session', '分析一下当前设计能力'),
    {
      onToken: (token) => chatTokens.push(token),
      onAgentEvent: (event) => chatEvents.push(event.type),
    },
    createDependencies({ type: 'text', text: 'Pi Runtime 正常回复。' }),
  )
  assert.equal(chat.text, 'Pi Runtime 正常回复。')
  assert.equal(chat.runtimeEngine, 'pi')
  assert.equal(chatTokens.join(''), chat.text)
  assert(chatEvents.includes('pi.agent.started'))
  assert(chatEvents.includes('pi.agent.completed'))

  const guardedComponentPayload = createPayload(
    'pi-component-guard-session',
    '生成这个组件的设计稿',
  )
  guardedComponentPayload.componentReferences = [
    {
      packId: 'campaign-components',
      componentName: 'EraLottery',
      label: 'EraLottery',
    },
  ]
  const guardedComponentReply = await runPiStudioAgent(
    guardedComponentPayload,
    {},
    createDependencies({ type: 'text', text: '当前没有执行画布工具。' }),
  )
  assert.equal(guardedComponentReply.text, '当前没有执行画布工具。')

  const greetingContexts = []
  let greetingTargetRequests = 0
  const greetingPayload = createPayload('pi-greeting-session', 'hello')
  greetingPayload.history = [
    { role: 'user', text: '生成 EraLottery 抽奖组件' },
    { role: 'agent', text: '已完成 EraLottery 组件设计。' },
  ]
  const greeting = await runPiStudioAgent(
    greetingPayload,
    {
      onCanvasTargetRequest: async () => {
        greetingTargetRequests += 1
        throw new Error('独立寒暄不应请求目标画板')
      },
    },
    createDependencies(
      { type: 'text', text: '你好，有什么可以帮你？' },
      { onContext: (context) => greetingContexts.push(context) },
    ),
  )
  assert.equal(greeting.text, '你好，有什么可以帮你？')
  assert.equal(greetingTargetRequests, 0)
  assert.equal(greetingContexts.length, 1)
  assert.deepEqual(greetingContexts[0].tools, [])

  const continuationPayload = createPayload('pi-continuation-session', '确认执行')
  const continuationSessionId = createProjectSessionId(
    continuationPayload.projectId,
    continuationPayload.sessionId,
  )
  const continuationSession = await loadAgentSession(continuationSessionId)
  continuationSession.taskKind = 'component-design'
  continuationSession.status = 'completed'
  continuationSession.goal = '生成 EraLottery 组件'
  await saveAgentSession(continuationSession)
  let continuationPiCalled = false
  const continuation = await runPiStudioAgent(
    continuationPayload,
    {},
    createDependencies(
      { type: 'text', text: '不应调用 Pi 文本模型。' },
      {
        onContext: () => {
          continuationPiCalled = true
        },
      },
    ),
  )
  assert.equal(continuationPiCalled, false)
  assert.equal(continuation.runtimeEngine, 'pi-deterministic-continuation')
  assert.match(continuation.text, /当前没有等待执行的组件任务/)

  const workflowEvents = []
  const targetRequests = []
  const workflowPayload = createPayload('pi-workflow-session', '新增一个画板')
  delete workflowPayload.canvasTarget
  const workflow = await runPiStudioAgent(
    workflowPayload,
    {
      onAgentEvent: (event) => workflowEvents.push(event),
      onCanvasTargetRequest: async (request) => {
        targetRequests.push(request)
        return {
          status: 'ready',
          target: {
            artboardId: 'pi-auto-board',
            createdForThread: true,
            width: 375,
            height: 812,
            autoHeight: true,
            placementMode: 'new-artboard',
            placementSource: 'default',
          },
        }
      },
    },
    createDependencies({
      type: 'tool',
      action: 'create-artboard',
      taskKind: 'artboard',
    }),
  )
  assert.equal(workflow.runtimeEngine, 'pi')
  assert.match(workflow.text, /375px H5 画板/)
  assert.equal(targetRequests.length, 1)
  assert.equal(targetRequests[0].action, 'create-artboard')
  assert.equal(targetRequests[0].placement.operation, 'create')
  assert(
    workflowEvents.some(
      (event) => event.type === 'step.started' && event.step?.tool === 'studio_run_design_workflow',
    ),
  )

  const catalog = await buildSkillCatalogPrompt()
  assert.match(catalog, /component-design-assets/)
  const activated = await activateSkill('component-design-assets')
  assert.match(activated.content, /组件设计素材/)
  const resource = await readSkillResource(
    'component-design-assets',
    'references/design-contract.md',
  )
  assert(resource.content.length > 0)
  await assert.rejects(
    () => readSkillResource('component-design-assets', 'runtime/manifest.json'),
    /只能读取 references 或 assets/,
  )
  assert(
    workflowEvents.some(
      (event) =>
        event.type === 'step.completed' && event.step?.tool === 'studio_run_design_workflow',
    ),
  )

  const correctedTargetRequests = []
  const correctedEvents = []
  const correctedPayload = createPayload(
    'pi-corrected-route-session',
    '以 @图1 主题生成一个电商后台管理系统设计稿',
  )
  const correctedDomainSessionId = createProjectSessionId(
    correctedPayload.projectId,
    correctedPayload.sessionId,
  )
  const pollutedSession = await loadAgentSession(correctedDomainSessionId)
  pollutedSession.taskKind = 'component-design'
  pollutedSession.componentRequest = 'EraLottery'
  pollutedSession.componentReferences = [
    {
      packId: 'campaign-components',
      componentName: 'EraLottery',
      label: 'EraLottery',
    },
  ]
  pollutedSession.pendingTask = {
    id: 'pending-era-lottery',
    kind: 'component-design',
    status: 'prepared',
    goal: '生成 EraLottery',
    componentReferences: pollutedSession.componentReferences,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await saveAgentSession(pollutedSession)
  correctedPayload.uploads = [
    {
      name: '图1.png',
      mime: 'image/png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xw7JAAAAAElFTkSuQmCC',
    },
  ]
  const corrected = await runPiStudioAgent(
    correctedPayload,
    {
      onAgentEvent: (event) => correctedEvents.push(event),
      onCanvasTargetRequest: async (request) => {
        correctedTargetRequests.push(request)
        return {
          status: 'ready',
          target: {
            artboardId: 'admin-board',
            createdForThread: true,
            width: 1440,
            height: 900,
            autoHeight: false,
            placementMode: 'new-artboard',
            placementSource: 'default',
          },
        }
      },
      onDeliverable: async () => ({ status: 'success', summary: '后台 UI 已写入画布' }),
    },
    createDependencies(
      {
        type: 'tool',
        action: 'create-ui',
        taskKind: 'generic-ui',
      },
      {
        invokeProvider: async (payload) => {
          if (payload.type === 'extract_visual_theme') {
            assert.equal(payload.uploads.length, 1)
            return {
              visualTheme: {
                source: 'visual',
                colors: ['#ff9f1a', '#fff4cc', '#5b2600'],
                colorTokens: [
                  { role: 'primary', value: '#ff9f1a' },
                  { role: 'background', value: '#fff4cc' },
                  { role: 'text', value: '#5b2600' },
                ],
                visualStyle: 'warm campaign',
              },
            }
          }
          assert.equal(payload.type, 'generate_ui_schema')
          assert.equal(payload.uploads.length, 1)
          assert.match(payload.question, /参考图/)
          return {
            uiSchema: {
              version: 1,
              surfaceKind: 'desktop-admin',
              designArchetype: 'commerce-admin',
              title: '电商管理',
              viewport: { width: 1440, height: 900 },
              theme: {
                mode: 'light',
                colors: ['#fff4cc', '#fffdf5', '#5b2600', '#ff9f1a', '#f4c04d'],
                radius: 8,
                density: 'compact',
              },
              blocks: [
                { id: 'header', kind: 'header', label: '页头', title: '电商管理' },
                {
                  id: 'orders',
                  kind: 'data-table',
                  label: '订单',
                  columns: ['订单号', '状态'],
                  rows: [['1001', '待处理']],
                },
              ],
            },
          }
        },
      },
    ),
  )
  assert.equal(corrected.genericUiSchema.surfaceKind, 'desktop-admin')
  const cleanedSession = await loadAgentSession(correctedDomainSessionId)
  assert.equal(cleanedSession.taskKind, 'generic-ui')
  assert.equal(cleanedSession.componentRequest, undefined)
  assert.equal(cleanedSession.componentReferences, undefined)
  assert.equal(cleanedSession.pendingTask, undefined)
  assert.equal(corrected.genericUiSchema.theme.colors[3], '#ff9f1a')
  assert.equal(correctedTargetRequests[0].action, 'create-ui')
  assert.equal(correctedTargetRequests[0].taskKind, 'generic-ui')
  assert(
    correctedEvents.some(
      (event) =>
        event.type === 'plan.updated' &&
        event.steps?.some((step) => step.tool === 'source.to-scene'),
    ),
  )
  assert(
    correctedEvents.some(
      (event) =>
        event.type === 'plan.updated' &&
        event.steps?.some((step) => step.tool === 'reference.prepare'),
    ),
  )
  assert(
    correctedEvents.some(
      (event) =>
        event.type === 'plan.updated' &&
        event.steps?.some((step) => step.tool === 'source.inspect'),
    ),
  )

  const guardedSelectionPayload = createPayload('pi-selection-guard-session', '重新生成选中的标题')
  guardedSelectionPayload.editScope = {
    type: 'generic-node',
    scopeId: 'scope-selected-title',
    artboardId: 'pi-board',
    documentRevision: 2,
    targetHash: 'hash-selected-title',
    targetElementIds: ['selected-title'],
    elementId: 'selected-title',
    elementType: 'text',
    name: '标题',
    bounds: { x: 20, y: 20, width: 200, height: 40 },
  }
  assert.throws(
    () =>
      resolveWorkflowToolParams(guardedSelectionPayload, {
        action: 'create-image',
        taskKind: 'design-image',
        placement: {
          operation: 'create',
          scope: 'document',
          reason: 'invalid-selection-fallback',
          confidence: 1,
        },
      }),
    (error) => error?.code === 'SELECTION_WORKFLOW_REQUIRED',
  )

  const explicitReferencePayload = createPayload(
    'pi-explicit-reference-session',
    '参考图片生成新版',
  )
  explicitReferencePayload.uploads = [
    { name: '结构.png', role: 'prototype', data: 'data:image/png;base64,cHJvdG8=' },
    { name: '主题.png', role: 'kv', data: 'data:image/png;base64,a3Y=' },
  ]
  const explicitReferenceParams = resolveWorkflowToolParams(explicitReferencePayload, {
    action: 'create-ui',
    taskKind: 'generic-ui',
    referenceBindings: [
      { uploadIndex: 0, role: 'visual' },
      { uploadIndex: 1, role: 'visual' },
    ],
    placement: {
      operation: 'create',
      scope: 'document',
      reason: 'reference-redesign',
      confidence: 1,
    },
  })
  assert.deepEqual(explicitReferenceParams.referenceBindings, [
    { uploadIndex: 0, role: 'prototype' },
    { uploadIndex: 1, role: 'kv' },
  ])

  const batchTargets = ['draw-one', 'draw-ten'].map((regionId, index) => ({
    type: 'component-region',
    scopeId: `scope-${regionId}`,
    artboardId: 'pi-board',
    documentRevision: 4,
    targetHash: `hash-${regionId}`,
    targetElementIds: [`element-${regionId}`],
    elementId: `element-${regionId}`,
    instanceId: 'instance-lottery',
    componentName: 'EraLottery',
    profile: 'style-config',
    regionId,
    slotId: `${regionId}-slot`,
    propPath: `styleConfig.${regionId}.image`,
    targetSize: { width: 100 + index * 10, height: 48 },
    transparent: true,
    exactText: regionId === 'draw-one' ? '抽一次' : '抽十次',
    assetRole: 'action',
    currentImage: `data:image/png;base64,${regionId === 'draw-one' ? 'b25l' : 'dGVu'}`,
    visualTheme: {
      source: 'kv',
      colors: ['#f472b6', '#ec4899', '#fdf2f8'],
      visualStyle: '粉色活动按钮',
    },
  }))
  const batchPayload = createPayload('pi-component-batch-session', '重新生成选中的组件素材')
  batchPayload.canvasContext = {
    documentRevision: 4,
    activeArtboardId: 'pi-board',
    selectedElementIds: batchTargets.map((target) => target.elementId),
    artboards: [
      {
        id: 'pi-board',
        name: 'Board',
        width: 375,
        height: 812,
        empty: false,
        hasDesignSpec: false,
      },
    ],
  }
  batchPayload.editScope = {
    type: 'component-region-batch',
    scopeId: 'scope-component-batch',
    artboardId: 'pi-board',
    documentRevision: 4,
    targetHash: 'hash-component-batch',
    targetElementIds: batchTargets.map((target) => target.elementId),
    elementIds: batchTargets.map((target) => target.elementId),
    targets: batchTargets,
  }
  batchPayload.componentRegionAction = {
    kind: 'regenerate-component-regions',
    targets: batchTargets,
  }
  const batchDeliverables = []
  let batchProviderCalls = 0
  const batchResult = await runPiStudioAgent(
    batchPayload,
    {
      onCanvasTargetRequest: async () => ({
        status: 'ready',
        target: {
          artboardId: 'pi-board',
          createdForThread: false,
          width: 375,
          height: 812,
          autoHeight: true,
          placementMode: 'append-section',
          placementSource: 'selection',
          documentRevision: 4,
        },
      }),
      onDeliverable: async (deliverable) => {
        batchDeliverables.push(deliverable)
        return {
          status: 'success',
          summary: '批量素材已原子写入。',
          data: {
            artboardId: 'pi-board',
            documentRevision: 5,
            affectedElementIds: batchTargets.map((target) => target.elementId),
          },
        }
      },
    },
    createDependencies(
      { type: 'text', text: '不应调用 Pi 文本模型。' },
      {
        invokeProvider: async (payload) => {
          batchProviderCalls += 1
          const task = payload.imageTasks[0]
          const size = task.targetSize
          assert.equal(task.transparent, true)
          assert.equal(task.textPolicy, 'model-exact')
          assert.match(payload.question, /同批组件素材视觉一致性契约/)
          assert.match(payload.question, /粉色活动按钮/)
          assert.equal(
            payload.uploads.some((upload) => upload.role === 'prototype'),
            true,
          )
          if (batchProviderCalls === 2) {
            assert.match(payload.question, /视觉母版/)
            assert.equal(
              payload.uploads.some((upload) => upload.role === 'edit-base'),
              true,
            )
          }
          return {
            artifacts: [
              {
                kind: 'raster',
                content: 'AAAA',
                mime: 'image/png',
                width: size.width,
                height: size.height,
              },
            ],
          }
        },
      },
    ),
  )
  assert.equal(batchProviderCalls, 2)
  assert.equal(batchDeliverables.length, 1)
  assert.equal(batchDeliverables[0].kind, 'component-slot-batch')
  assert.equal(batchDeliverables[0].items.length, 2)
  assert.equal(batchResult.runtimeEngine, 'pi-structured-action')
  assert.match(batchResult.text, /2 个组件素材/)

  await closePiSessionStore()
  const database = await fs.stat(path.join(testRoot, 'pi-agent-sessions.sqlite'))
  assert(database.size > 0, 'Pi SQLite Session 数据库为空')
  console.log(
    JSON.stringify(
      {
        piChatStream: true,
        componentReferenceDoesNotForceExecution: true,
        greetingDoesNotRunDesign: true,
        continuationBypassesPiRouting: true,
        piWorkflowTool: true,
        piOwnsWorkflowRouting: true,
        piCanvasTargetHandshake: true,
        domainWorkflowBridge: true,
        piEventMapping: true,
        piSqliteSession: true,
        projectScopedSession: true,
        staleComponentContextCleared: true,
        piSkillCatalog: true,
        piSkillActivation: true,
        piSkillResourceBoundary: true,
        selectionCannotDowngradeToImage: true,
        structuredComponentBatchAction: true,
      },
      null,
      2,
    ),
  )
} finally {
  await closePiSessionStore().catch(() => {})
  await fs.rm(testRoot, { recursive: true, force: true })
}

function createPayload(sessionId, question) {
  return {
    type: 'agent_run',
    sessionId,
    projectId: 'pi-runtime-project',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    question,
    history: [],
    uploads: [],
    skillNames: [],
    canvasTarget: {
      artboardId: 'pi-board',
      createdForThread: true,
      width: 375,
      height: 812,
      placementMode: 'new-artboard',
      placementSource: 'prompt',
    },
  }
}

function createDependencies(script, options = {}) {
  const invokeProvider =
    options.invokeProvider ||
    (async (payload) => {
      if (payload.type === 'chat') return { text: 'Pi Provider Bridge 回复。' }
      throw new Error(`测试没有实现 Provider 任务：${payload.type}`)
    })
  return {
    piRuntime: createScriptedPiRuntime(script, options),
    invokeProvider,
    executeSkillTool: async () => ({}),
    loadComponentFromPrompt: async () => undefined,
    loadComponentsFromPrompt: async () => [],
  }
}

function createScriptedPiRuntime(script, options = {}) {
  const model = {
    id: 'test-model',
    name: 'test-model',
    api: 'studio-test',
    provider: 'codex',
    baseUrl: 'http://127.0.0.1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32768,
  }
  return {
    model,
    streamFn: (_model, context) => {
      options.onContext?.(context)
      return createScriptedStream(model, script)
    },
  }
}

function createScriptedStream(model, script) {
  const stream = createAssistantMessageEventStream()
  queueMicrotask(() => {
    const base = createAssistantMessage(model)
    stream.push({ type: 'start', partial: base })
    if (script.type === 'tool') {
      const toolCall = {
        type: 'toolCall',
        id: 'studio-test-tool',
        name: 'studio_run_design_workflow',
        arguments: {
          action: script.action,
          taskKind: script.taskKind,
          surfaceKind: script.action === 'create-ui' ? 'desktop-admin' : undefined,
          designArchetype: script.action === 'create-ui' ? 'commerce-admin' : undefined,
          placement: script.placement ?? {
            operation: script.action === 'continue' ? 'resume' : 'create',
            scope: script.action === 'continue' ? 'artboard' : 'document',
            reason: 'scripted-agent-decision',
            confidence: 1,
          },
        },
      }
      const message = { ...base, content: [toolCall], stopReason: 'toolUse' }
      stream.push({ type: 'toolcall_start', contentIndex: 0, partial: base })
      stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message })
      stream.push({ type: 'done', reason: 'toolUse', message })
      stream.end(message)
      return
    }
    const message = { ...base, content: [{ type: 'text', text: script.text }], stopReason: 'stop' }
    stream.push({ type: 'text_start', contentIndex: 0, partial: base })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: script.text, partial: message })
    stream.push({ type: 'text_end', contentIndex: 0, content: script.text, partial: message })
    stream.push({ type: 'done', reason: 'stop', message })
    stream.end(message)
  })
  return stream
}

function createAssistantMessage(model) {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: Date.now(),
  }
}
