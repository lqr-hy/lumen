import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { runDesignWorkflow } from '../agent.mjs'
import { loadAgentSession, saveAgentSession } from '../agent-session-store.mjs'
import { getProviderRuntime } from '../env.mjs'
import { createRuntimeError, resolveModel, resolveProvider } from '../providers.mjs'
import { activateSkill, buildSkillCatalogPrompt, readSkillResource } from '../skills.mjs'
import { registerPiAgent } from './cancellation.mjs'
import { assembleRuntimeContext } from './context-runtime.mjs'
import { createStudioContextTransformer } from './context-policy.mjs'
import { createStudioPiModels } from './model-runtime.mjs'
import { getPiSession } from './session-store.mjs'

const WORKFLOW_TOOL = 'studio_run_design_workflow'
const SKILL_ACTIVATE_TOOL = 'skill_activate'
const SKILL_READ_TOOL = 'skill_read_resource'
const WORKFLOW_ACTIONS = [
  'continue',
  'create-artboard',
  'create-ui',
  'create-page',
  'create-component',
  'create-assets',
  'create-image',
  'revise-page',
  'revise-page-shell',
  'revise-component',
  'revise-design',
  'revise-ui-structure',
  'regenerate-slot',
]
const WORKFLOW_TASK_KINDS = [
  'artboard',
  'generic-ui',
  'page-design',
  'component-design',
  'asset-set',
  'design-image',
  'page-shell-edit',
  'component-slot-edit',
  'design-patch',
  'design-spec-patch',
]
const STANDALONE_GREETING_PATTERN =
  /^(?:hello|hi|hey|你好|您好|嗨|哈喽|在吗|早上好|上午好|下午好|晚上好)$/iu

export async function runPiStudioAgent(payload, callbacks = {}, dependencies) {
  const provider = resolveProvider(payload.provider)
  const modelId = resolveModel(provider, payload.model)
  const runtime = getProviderRuntime(provider)
  const domainSessionId = createProjectSessionId(payload.projectId, payload.sessionId)
  const domainSession = await loadAgentSession(domainSessionId)
  const componentReferences = normalizeComponentReferences(payload.componentReferences)
  const explicitContinuation = isExplicitContinuation(payload.question)
  if (componentReferences.length && !explicitContinuation) {
    const now = new Date().toISOString()
    domainSession.componentReferences = componentReferences
    domainSession.componentRequest = componentReferences.map((item) => item.componentName).join(' ')
    domainSession.pendingTask = {
      id: domainSession.pendingTask?.id || `pending-${Date.now()}`,
      kind: componentReferences.length > 1 ? 'page-design' : 'component-design',
      status: 'prepared',
      componentReferences,
      goal: payload.question,
      createdAt: domainSession.pendingTask?.createdAt || now,
      updatedAt: now,
    }
    domainSession.updatedAt = now
    await saveAgentSession(domainSession)
  }
  if (isComponentRegionBatchAction(payload.componentRegionAction)) {
    const targets = payload.componentRegionAction.targets
    const result = await runDesignWorkflow(
      {
        ...payload,
        sessionId: domainSessionId,
        workflowDecision: {
          version: 2,
          mode: 'execute',
          action: 'regenerate-slots',
          taskKind: 'component-slot-batch-edit',
          confidence: 1,
          reason: 'structured-component-region-action',
          source: 'composer-action',
          placement: {
            operation: 'revise',
            scope: 'selection',
            targetArtboardId: payload.editScope?.artboardId,
            targetElementIds: targets.map((target) => target.elementId),
            reason: '批量重生成用户明确选择的组件素材',
            confidence: 1,
          },
        },
      },
      callbacks,
      dependencies,
    )
    return { ...result, runtimeEngine: 'pi-structured-action' }
  }
  if (explicitContinuation) {
    const result = await runDesignWorkflow(
      {
        ...payload,
        sessionId: domainSessionId,
        componentReferences: [],
        uploads: [],
        workflowDecision: {
          version: 2,
          mode: 'execute',
          action: 'continue',
          taskKind: domainSession.taskKind || 'unknown',
          confidence: 1,
          reason: 'deterministic-run-continuation',
          source: 'runtime-control',
          placement: {
            operation: 'resume',
            scope: 'document',
            targetArtboardId:
              payload.canvasTarget?.artboardId || payload.canvasContext?.activeArtboardId,
            reason: '恢复当前 Session 中已经建立的任务',
            confidence: 1,
          },
        },
      },
      callbacks,
      dependencies,
    )
    return { ...result, runtimeEngine: 'pi-deterministic-continuation' }
  }
  const selectedSkills = payload.skillNames ?? []
  const runtimeContext = assembleRuntimeContext(payload, domainSession, selectedSkills)
  const skillCatalog = await buildSkillCatalogPrompt()
  let workflowResult
  let workflowError
  let streamedText = ''

  const piRuntime =
    dependencies.piRuntime ?? createStudioPiModels({ provider, runtime, model: modelId })
  const streamFn = piRuntime.streamFn ?? piRuntime.models.streamSimple.bind(piRuntime.models)
  const workflowTool = createWorkflowTool({
    payload,
    domainSessionId,
    callbacks,
    dependencies,
    setResult: (value) => {
      workflowResult = value
    },
    setError: (error) => {
      workflowError = error
    },
  })
  const tools = isStandaloneGreeting(payload.question)
    ? []
    : [createActivateSkillTool(), createReadSkillResourceTool(), workflowTool]
  const systemPrompt = buildPiSystemPrompt(runtimeContext, skillCatalog)
  const agent = new Agent({
    sessionId: payload.sessionId,
    streamFn,
    getApiKey: () => runtime.apiKey || 'provider-key-optional',
    toolExecution: 'sequential',
    transformContext: createStudioContextTransformer({
      model: piRuntime.model,
      models: piRuntime.models,
      systemPrompt,
      tools,
    }),
    initialState: {
      systemPrompt,
      model: piRuntime.model,
      thinkingLevel: 'medium',
      tools,
      messages: buildPiHistory(payload.history),
    },
    beforeToolCall: async ({ toolCall }) => {
      if (![WORKFLOW_TOOL, SKILL_ACTIVATE_TOOL, SKILL_READ_TOOL].includes(toolCall.name)) {
        return { block: true, reason: `工具不在 Studio 白名单：${toolCall.name}` }
      }
      return undefined
    },
  })
  const unregister = registerPiAgent(payload.sessionId, agent)
  const piSession = await getPiSession(domainSessionId, payload.projectId).catch((error) => {
    console.warn('[pi-runtime] session persistence unavailable', {
      cause: error instanceof Error ? error.message : String(error),
    })
    return undefined
  })
  const unsubscribe = agent.subscribe(async (event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      const delta = event.assistantMessageEvent.delta
      streamedText += delta
      callbacks.onToken?.(delta)
    }
    if (event.type === 'message_end' && piSession) {
      await piSession.appendMessage(sanitizePiMessage(event.message)).catch((error) => {
        console.warn('[pi-runtime] message persistence failed', {
          cause: error instanceof Error ? error.message : String(error),
        })
      })
    }
    const mapped = mapPiEvent(event, payload.sessionId)
    if (mapped) callbacks.onAgentEvent?.(mapped)
  })

  try {
    await agent.prompt(buildAgentQuestion(payload), buildPiImages(payload.uploads))
    if (workflowError) throw workflowError
    if (workflowResult) return { ...workflowResult, runtimeEngine: 'pi' }
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage)
    return {
      text: streamedText || extractLastAssistantText(agent.state.messages),
      runtimeEngine: 'pi',
      agent: { id: payload.sessionId, status: 'completed', engine: 'pi-agent-core' },
    }
  } finally {
    unsubscribe()
    unregister()
  }
}

function buildAgentQuestion(payload) {
  const question = String(payload.question || '').trim()
  const brief = payload.visualBrief
  if (!brief || typeof brief !== 'object') return question
  // Brief 作为结构化约束附加到本轮上下文，避免 Runtime 只能依赖 UI 拼接的自然语言。
  return [
    question,
    '',
    '[VISUAL_BRIEF_JSON]',
    JSON.stringify(brief),
    '[/VISUAL_BRIEF_JSON]',
    '请严格遵守上述视觉 Brief；必须保留项不可丢失，重点重设计项仅在允许范围内调整。',
  ].join('\n')
}

function createWorkflowTool({
  payload,
  domainSessionId,
  callbacks,
  dependencies,
  setResult,
  setError,
}) {
  return {
    name: WORKFLOW_TOOL,
    label: '执行设计工作流',
    description: '执行页面、组件、素材、画板或局部修订工作流。用户要求实际生成或修改时必须调用。',
    parameters: Type.Object(
      {
        action: Type.Union(WORKFLOW_ACTIONS.map((action) => Type.Literal(action))),
        taskKind: Type.Optional(Type.Union(WORKFLOW_TASK_KINDS.map((kind) => Type.Literal(kind)))),
        componentName: Type.Optional(Type.String()),
        surfaceKind: Type.Optional(
          Type.Union([
            Type.Literal('desktop-admin'),
            Type.Literal('desktop-web'),
            Type.Literal('mobile'),
          ]),
        ),
        designArchetype: Type.Optional(Type.String()),
        outputKind: Type.Optional(
          Type.Union([Type.Literal('full-image'), Type.Literal('section'), Type.Literal('asset')]),
        ),
        referenceBindings: Type.Optional(
          Type.Array(
            Type.Object(
              {
                uploadIndex: Type.Number({ minimum: 0 }),
                role: Type.Union([
                  Type.Literal('kv'),
                  Type.Literal('prototype'),
                  Type.Literal('visual'),
                  Type.Literal('edit-base'),
                ]),
              },
              { additionalProperties: false },
            ),
          ),
        ),
        placement: Type.Object(
          {
            operation: Type.Union([
              Type.Literal('create'),
              Type.Literal('insert'),
              Type.Literal('revise'),
              Type.Literal('variant'),
              Type.Literal('assets'),
              Type.Literal('resume'),
            ]),
            scope: Type.Union([
              Type.Literal('document'),
              Type.Literal('artboard'),
              Type.Literal('selection'),
              Type.Literal('asset-board'),
            ]),
            targetArtboardId: Type.Optional(Type.String()),
            targetElementIds: Type.Optional(Type.Array(Type.String())),
            reason: Type.String(),
            confidence: Type.Number({ minimum: 0, maximum: 1 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, onUpdate) {
      const resolvedParams = resolveWorkflowToolParams(payload, params)
      const decision = createWorkflowDecision(resolvedParams)
      onUpdate?.({
        content: [{ type: 'text', text: '正在执行确定性设计工作流。' }],
        details: {
          action: decision.action,
          taskKind: decision.taskKind,
          requestedAction: params.action,
          placement: decision.placement,
        },
      })
      let result
      try {
        result = await runDesignWorkflow(
          { ...payload, sessionId: domainSessionId, signal, workflowDecision: decision },
          callbacks,
          dependencies,
        )
      } catch (error) {
        setError(error)
        return {
          content: [
            { type: 'text', text: `设计工作流执行失败：${error?.message || String(error)}` },
          ],
          details: {
            action: decision.action,
            taskKind: decision.taskKind,
            errorCode: error?.code || 'AGENT_WORKFLOW_FAILED',
          },
          terminate: true,
        }
      }
      setResult(result)
      return {
        content: [{ type: 'text', text: result.text || '设计工作流执行完成。' }],
        details: {
          action: decision.action,
          taskKind: decision.taskKind,
          resultKind: inferResultKind(result),
        },
        terminate: true,
      }
    },
  }
}

export function createProjectSessionId(projectId, sessionId) {
  const project =
    typeof projectId === 'string' && projectId.trim() ? projectId.trim() : 'unscoped-project'
  const session =
    typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'runtime-session'
  return `${project}::${session}`
}

function createActivateSkillTool() {
  return {
    name: SKILL_ACTIVATE_TOOL,
    label: '激活 Skill',
    description: '加载一个与当前任务相关的 Skill 完整执行规范。',
    parameters: Type.Object(
      {
        name: Type.String(),
        instructions: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const skill = await activateSkill(params.name, params.instructions)
      return {
        content: [{ type: 'text', text: skill.content }],
        details: { name: skill.name, tools: skill.tools },
      }
    },
  }
}

function createReadSkillResourceTool() {
  return {
    name: SKILL_READ_TOOL,
    label: '读取 Skill 资源',
    description: '读取 Skill 的 references 或 assets 目录中的文本资源。',
    parameters: Type.Object(
      { name: Type.String(), path: Type.String() },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const resource = await readSkillResource(params.name, params.path)
      return {
        content: [{ type: 'text', text: resource.content }],
        details: { name: resource.name, path: resource.path },
      }
    },
  }
}

function buildPiSystemPrompt(runtimeContext, skillCatalog) {
  return [
    '你是 AI Campaign Page Studio 的会话与设计 Agent。',
    '当前轮用户消息是是否执行工具的唯一授权来源。历史消息、历史设计 Session、当前画布和已选组件只提供上下文，不能单独触发或续跑设计。',
    '只有当前消息明确要求生成、修改、继续、重试或新增设计内容时才调用设计工作流。hello、你好、寒暄、普通问答和仅讨论方案时必须直接回复，禁止调用任何工具。',
    '普通问答直接回复。用户要求生成或修改设计时，必须调用 studio_run_design_workflow，禁止只给建议。后台、Dashboard、管理系统、工作台、普通 Web/H5/App 和未绑定业务组件的页面统一使用 create-ui；明确指定 Component Pack 组件或组件 JSON 时使用 create-component；只有明确指定多个业务组件并要求组合页面时才使用 create-page。',
    '调用设计工作流时必须同时给出 placement。先读取 RuntimeContext.canvasContext：创建独立设计成果使用 create；向明确画板插入内容使用 insert；修改选区使用 revise；新版本使用 variant；独立素材使用 assets；恢复已有任务使用 resume。insert、revise、variant 必须引用 canvasContext 中存在的画板或当前 selection，不能静默使用历史画板。',
    'create-ui 必须给出 surfaceKind 和 designArchetype；create-image/create-assets 必须给出 outputKind；当前轮存在图片时必须用 referenceBindings 明确每张被使用图片的 kv/prototype/visual/edit-base 职责。领域 Runtime 不会根据自然语言二次修改这些字段。',
    '不要依赖固定关键词判断 placement，应结合当前轮完整语义、选区、画板结构和任务状态动态选择。没有选中画板也不要求用户手动选择；独立的新设计可直接创建画板。',
    'RuntimeContext.componentReferences 是组件身份的唯一可信来源。组件引用存在时不得改用 create-image 或 create-ui。聊天中粘贴的 JSON 代码块没有经过导入，不得声称已经保存、注册或替换组件配置；应提示用户使用“导入组件 JSON”。',
    '用户说“开始生成、继续、重试”时只能调用 continue，由领域 Runtime 恢复 Pending Task，不得自行推断为 create-image。',
    '已有 DesignSpec 页面中，用户明确要求插入、删除、移动或更新某个 Sidebar、Header、筛选、指标、表格、表单、卡片、分页或 Footer Block 时使用 revise-ui-structure；普通节点局部修改使用 revise-design。用户要求参考图片重新设计、整体重做、整页改版或重新生成整个页面时必须使用 create-ui，并用 variant 保留旧画板，禁止把整页重设计压缩成有限 Block Patch。',
    '任务匹配 Skill 时先调用 skill_activate；需要参考资料时调用 skill_read_resource。',
    '只有 studio_run_design_workflow 可以修改画布；不得调用 Bash、任意文件系统或任意网络工具。',
    'DesignDocument、Props Patch、Canvas ACK 和 Artifact 由应用领域工作流负责。',
    '不要向用户输出 operations，也不要伪造 DesignDocument 或画布写入结果。',
    skillCatalog,
    `当前 RuntimeContext：\n${JSON.stringify(runtimeContext, null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function isStandaloneGreeting(question) {
  const normalized = String(question || '')
    .trim()
    .replace(/[\s,.!?，。！？、~～]+/gu, '')
  return STANDALONE_GREETING_PATTERN.test(normalized)
}

function isExplicitContinuation(question) {
  return /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/iu.test(
    String(question || '').trim(),
  )
}

function isComponentRegionBatchAction(action) {
  return (
    action?.kind === 'regenerate-component-regions' &&
    Array.isArray(action.targets) &&
    action.targets.length > 0 &&
    action.targets.every(
      (target) =>
        target?.type === 'component-region' &&
        target.elementId &&
        target.instanceId &&
        target.slotId &&
        target.propPath &&
        target.targetSize?.width > 0 &&
        target.targetSize?.height > 0,
    )
  )
}

function createWorkflowDecision(params) {
  return {
    version: 2,
    mode: 'execute',
    action: params.action,
    taskKind: params.taskKind || taskKindForAction(params.action),
    confidence: 1,
    reason: 'pi-native-tool-call',
    source: 'pi-agent-core',
    placement: params.placement,
    ...(params.componentName ? { target: { componentName: params.componentName } } : {}),
    ...(params.surfaceKind ? { surfaceKind: params.surfaceKind } : {}),
    ...(params.designArchetype ? { designArchetype: params.designArchetype } : {}),
    ...(params.outputKind ? { outputKind: params.outputKind } : {}),
    ...(params.referenceBindings?.length ? { referenceBindings: params.referenceBindings } : {}),
  }
}

export function resolveWorkflowToolParams(payload, params) {
  const componentReferences = normalizeComponentReferences(payload.componentReferences)
  const explicitReferenceBindings = (payload.uploads ?? [])
    .map((upload, uploadIndex) => ({ uploadIndex, role: upload?.role }))
    .filter((binding) => ['kv', 'prototype', 'visual', 'edit-base'].includes(binding.role))
  const expectedTaskKind = taskKindForAction(params.action)
  if (params.action !== 'continue' && params.taskKind && params.taskKind !== expectedTaskKind) {
    throw createRuntimeError(
      'WORKFLOW_TASK_KIND_MISMATCH',
      `${params.action} 必须使用 ${expectedTaskKind}，不能使用 ${params.taskKind}。`,
    )
  }
  const componentActions = new Set([
    'create-page',
    'create-component',
    'revise-page',
    'revise-component',
    'regenerate-slot',
  ])
  if (componentReferences.length && !componentActions.has(params.action)) {
    throw createRuntimeError(
      'COMPONENT_WORKFLOW_REQUIRED',
      '当前轮包含已注册组件引用，必须使用组件或组件页面工作流，不能降级为普通图片或通用 UI。',
    )
  }
  const requiredSelectionAction = selectionAction(payload.editScope)
  if (
    requiredSelectionAction &&
    params.action !== 'continue' &&
    params.action !== requiredSelectionAction
  ) {
    throw createRuntimeError(
      'SELECTION_WORKFLOW_REQUIRED',
      `当前轮已锁定局部修改范围，必须使用 ${requiredSelectionAction}，不能使用 ${params.action}。`,
    )
  }
  const operation = params.placement?.operation
  if (params.action === 'continue' && operation !== 'resume') {
    throw createRuntimeError('PLACEMENT_OPERATION_INVALID', '继续任务必须使用 resume 放置操作。')
  }
  if (params.action === 'create-artboard' && operation !== 'create') {
    throw createRuntimeError('PLACEMENT_OPERATION_INVALID', '新增画板必须使用 create 放置操作。')
  }
  if (params.action === 'create-assets' && operation !== 'assets') {
    throw createRuntimeError(
      'PLACEMENT_OPERATION_INVALID',
      '独立素材任务必须使用 assets 放置操作。',
    )
  }
  if (
    [
      'revise-page',
      'revise-page-shell',
      'revise-component',
      'revise-design',
      'revise-ui-structure',
      'regenerate-slot',
    ].includes(params.action) &&
    operation !== 'revise'
  ) {
    throw createRuntimeError('PLACEMENT_OPERATION_INVALID', '修订工作流必须使用 revise 放置操作。')
  }
  if (
    ['insert', 'revise', 'variant'].includes(operation) &&
    params.placement.scope !== 'selection' &&
    !params.placement.targetArtboardId
  ) {
    throw createRuntimeError(
      'CANVAS_TARGET_REQUIRED',
      '该放置操作必须指定 RuntimeContext 中存在的目标画板。',
    )
  }
  return {
    ...params,
    referenceBindings: explicitReferenceBindings.length
      ? explicitReferenceBindings
      : params.referenceBindings,
    componentName:
      params.componentName ||
      (componentReferences.length === 1 ? componentReferences[0].componentName : undefined),
  }
}

function selectionAction(scope) {
  if (!scope) return undefined
  if (scope.type === 'component-region') return 'regenerate-slot'
  if (scope.type === 'component-instance') return 'revise-component'
  if (scope.type === 'page-shell') return 'revise-page-shell'
  if (['generic-node', 'multi-node', 'text-range', 'image-region'].includes(scope.type))
    return 'revise-design'
  return undefined
}

function normalizeComponentReferences(value) {
  if (!Array.isArray(value)) return []
  const references = value
    .filter(
      (item) =>
        item &&
        typeof item.packId === 'string' &&
        /^[A-Za-z0-9_.-]+$/.test(item.packId) &&
        typeof item.componentName === 'string' &&
        /^[A-Za-z][A-Za-z0-9_-]*$/.test(item.componentName),
    )
    .map((item) => ({
      packId: item.packId,
      componentName: item.componentName,
      label: typeof item.label === 'string' ? item.label.slice(0, 128) : item.componentName,
    }))
  return Array.from(
    new Map(references.map((item) => [`${item.packId}:${item.componentName}`, item])).values(),
  )
}

function taskKindForAction(action) {
  if (action === 'create-ui') return 'generic-ui'
  if (action === 'revise-design') return 'design-patch'
  if (action === 'revise-ui-structure') return 'design-spec-patch'
  if (action === 'create-artboard') return 'artboard'
  if (['create-page', 'revise-page'].includes(action)) return 'page-design'
  if (action === 'revise-page-shell') return 'page-shell-edit'
  if (['create-component', 'revise-component'].includes(action)) return 'component-design'
  if (action === 'regenerate-slot') return 'component-slot-edit'
  if (action === 'create-assets') return 'asset-set'
  if (action === 'create-image') return 'design-image'
  return 'unknown'
}

function buildPiHistory(history = []) {
  return history.slice(-12).map((message) =>
    message.role === 'user'
      ? { role: 'user', content: message.text, timestamp: Date.now() }
      : {
          role: 'assistant',
          content: [{ type: 'text', text: message.text }],
          api: 'studio-history',
          provider: 'studio',
          model: 'history',
          usage: emptyUsage(),
          stopReason: 'stop',
          timestamp: Date.now(),
        },
  )
}

function buildPiImages(uploads = []) {
  return uploads
    .filter((upload) => typeof upload?.data === 'string' && upload.data.startsWith('data:image/'))
    .map((upload) => ({
      type: 'image',
      data: upload.data.slice(upload.data.indexOf(',') + 1),
      mimeType: upload.mime || upload.data.match(/^data:([^;]+);/)?.[1] || 'image/png',
    }))
}

function sanitizePiMessage(message) {
  const sanitized =
    message.role === 'toolResult'
      ? {
          ...message,
          details:
            message.details && typeof message.details === 'object'
              ? {
                  action: message.details.action,
                  taskKind: message.details.taskKind,
                  resultKind: message.details.resultKind,
                  name: message.details.name,
                  path: message.details.path,
                }
              : undefined,
        }
      : message
  return stripNonDurableValues(sanitized)
}

function stripNonDurableValues(value) {
  if (Array.isArray(value)) return value.map(stripNonDurableValues)
  if (!value || typeof value !== 'object') return value
  if (value.type === 'image' && typeof value.data === 'string') {
    return { type: 'text', text: `[图片附件：${value.mimeType || 'image'}]` }
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripNonDurableValues(entry)]),
  )
}

function mapPiEvent(event, sessionId) {
  if (event.type === 'agent_start')
    return { type: 'pi.agent.started', sessionId, status: 'running' }
  if (event.type === 'turn_start') return { type: 'pi.turn.started', sessionId, status: 'running' }
  if (event.type === 'tool_execution_start') {
    return {
      type: 'step.started',
      sessionId,
      step: {
        id: event.toolCallId,
        title: event.toolName,
        tool: event.toolName,
        status: 'running',
      },
    }
  }
  if (event.type === 'tool_execution_end') {
    return {
      type: event.isError ? 'step.failed' : 'step.completed',
      sessionId,
      step: {
        id: event.toolCallId,
        title: event.toolName,
        tool: event.toolName,
        status: event.isError ? 'failed' : 'completed',
      },
    }
  }
  if (event.type === 'agent_end')
    return { type: 'pi.agent.completed', sessionId, status: 'completed' }
  return undefined
}

function extractLastAssistantText(messages) {
  const message = [...messages].reverse().find((item) => item.role === 'assistant')
  return (
    message?.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('') || ''
  )
}

function inferResultKind(result) {
  if (result.pageDesign) return 'page'
  if (result.componentDesign) return 'component'
  if (result.artifacts?.length) return 'assets'
  if (result.artifact) return 'image'
  return 'text'
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}
