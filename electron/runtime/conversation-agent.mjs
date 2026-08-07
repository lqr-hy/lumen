import { routeAgentIntent, validateAgentIntent } from './intent-router.mjs'

const ACTION_TASK_KIND = {
  chat: 'chat',
  continue: 'unknown',
  'create-artboard': 'artboard',
  'create-page': 'page-design',
  'create-component': 'component-design',
  'create-assets': 'asset-set',
  'create-image': 'design-image',
  'revise-page': 'page-design',
  'revise-page-shell': 'page-shell-edit',
  'revise-component': 'component-design',
  'regenerate-slot': 'component-slot-edit',
}

export async function decideConversationTurn({ session, payload, invokeProvider }) {
  const context = buildConversationContext(session, payload)
  if (typeof invokeProvider === 'function') {
    try {
      const result = await invokeProvider({
        ...payload,
        type: 'decide_agent_action',
        uploads: [],
        question: buildDecisionQuestion(context),
      }, {})
      const decision = normalizeConversationDecision(
        result.conversationDecision ?? parseConversationDecisionText(result.text),
      )
      if (decision?.mode === 'execute' && decision.confidence < 0.55) {
        return {
          version: 1,
          mode: 'clarify',
          action: 'chat',
          taskKind: 'chat',
          confidence: decision.confidence,
          reason: 'model-confidence-below-execution-threshold',
          response: '我还不能确定要操作哪个页面或组件，请补充目标对象和期望结果。',
          source: 'model',
          context,
        }
      }
      if (decision) return { ...decision, source: 'model', context }
    } catch (error) {
      console.warn('[agent] conversation decision degraded to deterministic fallback', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const intent = routeAgentIntent({
    prompt: payload.question,
    session,
    editScope: payload.editScope,
  })
  return {
    version: 1,
    mode: intent.action === 'chat' ? 'reply' : 'execute',
    action: intent.action,
    taskKind: intent.taskKind,
    confidence: intent.confidence,
    reason: intent.reason,
    source: 'deterministic-fallback',
    context,
  }
}

export function buildConversationContext(session, payload) {
  const editScope = payload.editScope ?? session.editScope
  return {
    message: String(payload.question || '').trim(),
    recentHistory: (payload.history ?? []).slice(-10).map((message) => ({
      role: message.role === 'agent' ? 'agent' : 'user',
      text: String(message.text || '').slice(0, 800),
    })),
    session: {
      status: session.status,
      taskKind: session.taskKind,
      goal: session.goal,
      componentRequest: session.componentRequest,
      completedComponent: session.componentDesign?.componentName,
      failedStep: session.lastError?.stepId,
    },
    canvas: payload.canvasTarget ? {
      artboardId: payload.canvasTarget.artboardId,
      width: payload.canvasTarget.width,
      height: payload.canvasTarget.height,
      placementMode: payload.canvasTarget.placementMode,
    } : undefined,
    canvasSnapshot: session.canvasSnapshot,
    selection: editScope ? {
      type: editScope.type,
      componentName: editScope.componentName,
      instanceId: editScope.instanceId,
      slotId: editScope.slotId,
    } : undefined,
    references: (payload.uploads ?? []).map((reference) => ({
      name: String(reference.name || '未命名参考图'),
      role: String(reference.role || 'unknown'),
      mime: String(reference.mime || ''),
    })),
    capabilities: [
      'normal-chat',
      'create-artboard',
      'create-page',
      'create-component',
      'create-assets',
      'create-image',
      'revise-page-shell',
      'revise-component',
      'regenerate-component-slot',
      'continue-failed-run',
      'present-current-session-component',
    ],
  }
}

export function normalizeConversationDecision(value) {
  if (!value || value.version !== 1) return undefined
  if (!['reply', 'execute', 'clarify'].includes(value.mode)) return undefined
  if (!(value.action in ACTION_TASK_KIND)) return undefined
  const confidence = Number(value.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return undefined
  const taskKind = typeof value.taskKind === 'string' && value.taskKind.trim()
    ? value.taskKind.trim()
    : ACTION_TASK_KIND[value.action]
  const intent = {
    version: 1,
    prompt: '',
    action: value.action,
    taskKind,
    confidence,
    reason: typeof value.reason === 'string' ? value.reason : 'model-decision',
    source: 'conversation-agent',
    targetIds: typeof value.target?.id === 'string' ? [value.target.id] : [],
  }
  if (!validateAgentIntent(intent)) return undefined
  return {
    version: 1,
    mode: value.mode,
    action: value.action,
    taskKind,
    confidence,
    reason: intent.reason,
    intent,
    ...(typeof value.response === 'string' && value.response.trim()
      ? { response: value.response.trim() }
      : {}),
    ...(value.target && typeof value.target === 'object' ? { target: value.target } : {}),
  }
}

export function parseConversationDecisionText(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const source = value.trim()
  const candidates = [source]
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const firstBrace = source.indexOf('{')
  const lastBrace = source.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1))
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // Try the next supported JSON envelope.
    }
  }
  return undefined
}

function buildDecisionQuestion(context) {
  return [
    '你是 AI Campaign Page Studio 的 Conversation Agent。',
    '根据上下文判断用户真实目标，只做决策，不执行工具，不声明已经生成或已经写入画布。',
    '普通问答使用 mode=reply/action=chat 并给出 response；目标不清楚使用 mode=clarify/action=chat；需要执行时使用 mode=execute。',
    '只返回一个 JSON 对象，不要使用自然语言包裹。字段必须包含 version=1、mode、action、taskKind、confidence、reason，可选 target 和 response。',
    'action 只能是 chat、continue、create-artboard、create-page、create-component、create-assets、create-image、revise-page、revise-page-shell、revise-component、regenerate-slot。',
    'confidence 必须是 0 到 1 的数字；reply 或 clarify 必须给出直接面向用户的 response。',
    '用户明确指定 EraLottery、EraTasklist 或某个 JSON 时，即使省略“组件”二字，也应识别为组件目标。',
    '“添加到画布”只有当前会话存在同名 completedComponent 时才能 continue；否则指定了组件就 create-component，禁止恢复其他会话结果。',
    '只有明确要求新建/新增/创建画板时才能 create-artboard。',
    `上下文：${JSON.stringify(context, null, 2)}`,
  ].join('\n\n')
}
