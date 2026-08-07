const REACT_MODES = new Set(['tool', 'clarify', 'finish'])
const INSPECT_TOOLS = new Map([
  ['agent.inspect-state', '检查当前任务、步骤和最近 Observation'],
  ['canvas.inspect', '检查目标画板和当前选择摘要'],
  ['artifact.inspect', '检查当前会话已生成的 Artifact 摘要'],
])

export async function decideAgentNextAction({ session, payload, readySteps, invokeProvider }) {
  const fallback = createFallbackAction(readySteps)
  if (typeof invokeProvider !== 'function') return fallback
  const context = buildReactContext(session, payload, readySteps)
  try {
    const result = await invokeProvider({
      ...payload,
      type: 'decide_agent_next_action',
      uploads: [],
      question: buildNextActionQuestion(context),
    }, {})
    const value = result.agentNextAction ?? parseAgentNextActionText(result.text)
    const action = normalizeAgentNextAction(value, readySteps)
    if (action?.mode === 'tool' && action.confidence < 0.55) {
      return {
        version: 1,
        mode: 'clarify',
        response: '下一步操作目标还不明确，请补充要继续处理的页面、组件或素材。',
        confidence: action.confidence,
        reason: 'model-confidence-below-tool-threshold',
        source: 'model',
        context,
      }
    }
    return action ? { ...action, source: 'model', context } : fallback
  } catch (error) {
    console.warn('[agent] ReAct decision degraded to ready-step fallback', {
      cause: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}

export function getReadyAgentSteps(session) {
  const plan = Array.isArray(session.plan) ? session.plan : []
  const ready = []
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index]
    if (step.status !== 'pending' && step.status !== 'failed') continue
    const blocked = plan.slice(0, index).some((candidate) => (
      candidate.status !== 'completed' && !canRunAlongside(candidate, step)
    ))
    if (!blocked) ready.push(step)
  }
  return ready
}

export function buildReactContext(session, payload, readySteps) {
  return {
    goal: session.goal,
    taskKind: session.taskKind,
    status: session.status,
    iteration: session.reactState?.iteration ?? 0,
    canvas: session.canvasTarget,
    canvasSnapshot: session.canvasSnapshot,
    selection: session.editScope ? {
      type: session.editScope.type,
      componentName: session.editScope.componentName,
      instanceId: session.editScope.instanceId,
      slotId: session.editScope.slotId,
    } : undefined,
    references: (session.references ?? []).map((reference) => ({
      name: reference.name,
      role: reference.role,
      mime: reference.mime,
    })),
    readySteps: readySteps.map((step) => ({
      stepId: step.id,
      toolName: step.tool,
      title: step.title,
      input: step.input,
      previousError: step.error,
    })),
    inspectTools: Array.from(INSPECT_TOOLS, ([toolName, description]) => ({ toolName, description })),
    recentObservations: (session.observations ?? []).slice(-8).map((observation) => ({
      tool: observation.tool,
      status: observation.status ?? 'success',
      summary: observation.summary,
      errorCode: observation.errorCode,
      data: observation.data,
    })),
    limits: session.reactState?.budget,
    userMessage: String(payload.question || ''),
  }
}

export function normalizeAgentNextAction(value, readySteps) {
  if (!value || value.version !== 1 || !REACT_MODES.has(value.mode)) return undefined
  const confidence = Number(value.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return undefined
  if (value.mode === 'clarify') {
    if (typeof value.response !== 'string' || !value.response.trim()) return undefined
    return {
      version: 1,
      mode: 'clarify',
      response: value.response.trim(),
      confidence,
      reason: normalizeReason(value.reason),
    }
  }
  if (value.mode === 'finish') {
    return {
      version: 1,
      mode: 'finish',
      confidence,
      reason: normalizeReason(value.reason),
    }
  }
  const stepId = typeof value.tool?.stepId === 'string' ? value.tool.stepId.trim() : ''
  const toolName = typeof value.tool?.name === 'string' ? value.tool.name.trim() : ''
  const plannedStep = readySteps.find((step) => step.id === stepId && step.tool === toolName)
  if (!plannedStep && !INSPECT_TOOLS.has(toolName)) return undefined
  return {
    version: 1,
    mode: 'tool',
    confidence,
    reason: normalizeReason(value.reason ?? value.tool?.reason),
    tool: plannedStep
      ? { stepId: plannedStep.id, name: plannedStep.tool, kind: 'planned' }
      : {
          stepId: `inspect-${toolName.replaceAll('.', '-')}`,
          name: toolName,
          kind: 'inspect',
          arguments: isPlainObject(value.tool?.arguments) ? value.tool.arguments : {},
        },
  }
}

export function parseAgentNextActionText(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const source = value.trim()
  const candidates = [source]
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const firstBrace = source.indexOf('{')
  const lastBrace = source.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(source.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      // Try the next supported JSON envelope.
    }
  }
  return undefined
}

function createFallbackAction(readySteps) {
  const step = readySteps[0]
  return step ? {
    version: 1,
    mode: 'tool',
    confidence: 1,
    reason: 'deterministic-ready-step-fallback',
    source: 'deterministic-fallback',
    tool: { stepId: step.id, name: step.tool, kind: 'planned' },
  } : {
    version: 1,
    mode: 'finish',
    confidence: 1,
    reason: 'all-required-steps-completed',
    source: 'deterministic-fallback',
  }
}

function buildNextActionQuestion(context) {
  return [
    '你是 AI Campaign Page Studio 的 ReAct 执行 Agent。每轮只能决定一个动作，不执行工具，也不能声明已经完成。',
    '只返回一个 JSON 对象。格式：{"version":1,"mode":"tool|clarify|finish","tool":{"stepId":"...","name":"...","arguments":{}},"response":"...","confidence":0.0,"reason":"..."}。',
    'mode=tool 时只能原样选择 readySteps 中 stepId 与 toolName 的组合，或选择 inspectTools 中的只读工具；禁止编造工具和参数。',
    'mode=clarify 仅用于缺少用户才能提供的信息，并必须给出 response。工具失败时应先根据 Observation 选择可恢复工具，不要立刻追问。',
    '只有 readySteps 为空且最终交付步骤已经完成时才能 mode=finish。',
    `执行上下文：${JSON.stringify(context, null, 2)}`,
  ].join('\n\n')
}

function canRunAlongside(previous, current) {
  return previous.tool === 'page.generate-component' && current.tool === 'page.generate-component'
}

function normalizeReason(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : 'model-decision'
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
