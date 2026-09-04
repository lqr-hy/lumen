import type {
  AgentEvent,
  CanvasWriteObservation,
  DesignPatch,
  IncrementalCanvasDeliverable,
} from './types'

export type ChatRunStatus =
  | 'understanding'
  | 'planning'
  | 'running'
  | 'waiting-confirmation'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface ChatRunStep {
  id: string
  title: string
  tool: string
  status: 'pending' | 'running' | 'completed' | 'retrying' | 'failed' | 'cancelled'
  attempt?: number
  error?: string
  errorCode?: string
  summary?: string
  startedAt?: string
  completedAt?: string
  partialFailure?: boolean
  partialSummary?: string
  traces?: ChatRunTrace[]
}

export interface ChatRunTrace {
  id: string
  tool: string
  label: string
  status: 'started' | 'retrying' | 'completed' | 'fallback' | 'failed'
  message: string
  attempt?: number
  maxAttempts?: number
  elapsedMs?: number
  targetSize?: { width: number; height: number }
  errorCode?: string
  timestamp: number
}

export interface ChatRunDeliverable {
  id: string
  kind: IncrementalCanvasDeliverable['kind']
  title: string
  status: 'success' | 'failed'
  summary: string
  artboardId?: string
  elementId?: string
  errorCode?: string
  conflictResolution?: NonNullable<CanvasWriteObservation['data']>['designSpecConflictResolution']
  patchOperations?: Array<{
    id: string
    kind: DesignPatch['operations'][number]['kind']
    elementId?: string
    summary: string
    before?: string
    after?: string
  }>
  affectedElementIds?: string[]
  documentRevision?: number
  createdAt: string
}

export interface ChatRun {
  id: string
  messageId: string
  status: ChatRunStatus
  phaseLabel: string
  currentStepId?: string
  steps: ChatRunStep[]
  deliverables: ChatRunDeliverable[]
  startedAt: string
  finishedAt?: string
  error?: string
  lastSequence: number
}

export function createChatRun(id: string, messageId: string): ChatRun {
  return {
    id,
    messageId,
    status: 'understanding',
    phaseLabel: '正在理解需求',
    steps: [],
    deliverables: [],
    startedAt: new Date().toISOString(),
    lastSequence: 0,
  }
}

export function reduceChatRunEvent(run: ChatRun, event: AgentEvent): ChatRun {
  if (event.sequence && event.sequence <= run.lastSequence) return run
  const next = {
    ...run,
    lastSequence: Math.max(run.lastSequence, event.sequence ?? run.lastSequence + 1),
  }

  if (event.type === 'pi.agent.started' || event.type === 'pi.turn.started') {
    return { ...next, status: 'understanding', phaseLabel: '正在理解需求' }
  }
  if (event.type === 'plan.updated' && event.steps) {
    const steps = event.steps.map((step) =>
      normalizeStep(
        step,
        run.steps.find((item) => item.id === step.id),
      ),
    )
    const activeStep = steps.find((step) => step.status === 'running' || step.status === 'retrying')
    return {
      ...next,
      status: activeStep ? 'running' : 'planning',
      phaseLabel: activeStep ? `正在${activeStep.title}` : '已生成执行计划',
      currentStepId: activeStep?.id,
      steps,
    }
  }
  if (event.type === 'step.started' && event.step) {
    const step = normalizeStep({ ...event.step, status: 'running' })
    return {
      ...next,
      status: 'running',
      phaseLabel: `正在${step.title}`,
      currentStepId: step.id,
      steps: upsertStep(closeStaleActiveSteps(run.steps, step), step),
    }
  }
  if (event.type === 'step.retrying' && event.step) {
    const step = normalizeStep({
      ...event.step,
      status: 'retrying',
      error: event.error,
      attempt: event.attempt,
    })
    return {
      ...next,
      status: 'running',
      phaseLabel: `${step.title}失败，正在重试`,
      currentStepId: step.id,
      steps: upsertStep(closeStaleActiveSteps(run.steps, step), step),
    }
  }
  if (event.type === 'step.completed' && event.step) {
    const step = normalizeStep({ ...event.step, status: 'completed' })
    return {
      ...next,
      status: 'running',
      phaseLabel: `${step.title}已完成`,
      currentStepId: undefined,
      steps: upsertStep(run.steps, step),
    }
  }
  if (event.type === 'step.failed' && event.step) {
    const step = normalizeStep({ ...event.step, status: 'failed', error: event.error })
    return {
      ...next,
      status: 'failed',
      phaseLabel: `${step.title}执行失败`,
      currentStepId: step.id,
      error: event.error,
      steps: upsertStep(run.steps, step),
    }
  }
  if (event.type === 'tool.trace' && event.trace) {
    const stepId = event.stepId || run.currentStepId
    if (!stepId) return next
    const trace: ChatRunTrace = {
      id: event.trace.id,
      tool: event.trace.tool,
      label: event.trace.label || event.trace.taskId || event.trace.tool,
      status: event.trace.status,
      message: event.trace.message,
      attempt: event.trace.attempt,
      maxAttempts: event.trace.maxAttempts,
      elapsedMs: event.trace.elapsedMs,
      targetSize: event.trace.targetSize,
      errorCode: event.trace.errorCode,
      timestamp: event.trace.timestamp,
    }
    return {
      ...next,
      steps: run.steps.map((step) =>
        step.id === stepId ? { ...step, traces: upsertTrace(step.traces ?? [], trace) } : step,
      ),
    }
  }
  if (event.type === 'observation.created' && event.observation) {
    const stepId = event.observation.stepId || run.currentStepId
    if (!stepId) return next
    return {
      ...next,
      steps: run.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              summary: event.observation?.summary,
              errorCode: event.observation?.errorCode ?? step.errorCode,
            }
          : step,
      ),
    }
  }
  if (event.type === 'task.awaiting-confirmation') {
    return { ...next, status: 'waiting-confirmation', phaseLabel: '等待确认页面结构' }
  }
  if (event.type === 'task.completed') {
    return { ...next, status: 'delivering', phaseLabel: '正在交付结果到画布' }
  }
  if (event.type === 'task.cancelled') {
    return finishRun(next, 'cancelled', '任务已停止', event.error)
  }
  if (event.type === 'task.failed') {
    return finishRun(next, 'failed', '任务执行失败', event.error)
  }
  return next
}

function upsertTrace(traces: ChatRunTrace[], trace: ChatRunTrace) {
  const taskKey = `${trace.tool}:${trace.label}`
  const next = traces.filter((item) => `${item.tool}:${item.label}` !== taskKey)
  return [...next, trace].sort((left, right) => left.timestamp - right.timestamp).slice(-30)
}

function closeStaleActiveSteps(steps: ChatRunStep[], activeStep: ChatRunStep) {
  const boundary = activeStep.startedAt ?? new Date().toISOString()
  return steps.map((step) =>
    step.id !== activeStep.id && ['running', 'retrying'].includes(step.status)
      ? { ...step, status: 'completed' as const, completedAt: step.completedAt ?? boundary }
      : step,
  )
}

export function appendRunDeliverable(
  run: ChatRun,
  deliverable: IncrementalCanvasDeliverable,
  observation: CanvasWriteObservation,
): ChatRun {
  const item: ChatRunDeliverable = {
    id: deliverable.id,
    kind: deliverable.kind,
    title: getDeliverableTitle(deliverable),
    status: observation.status,
    summary: observation.summary,
    artboardId: observation.data?.artboardId ?? deliverable.target?.artboardId,
    elementId: observation.data?.rootElementId ?? observation.data?.shellElementId,
    errorCode: observation.errorCode,
    conflictResolution: observation.data?.designSpecConflictResolution,
    patchOperations:
      deliverable.kind === 'design-patch'
        ? deliverable.patch.operations.map(summarizePatchOperation)
        : undefined,
    affectedElementIds: observation.data?.affectedElementIds,
    documentRevision: observation.data?.documentRevision,
    createdAt: new Date().toISOString(),
  }
  return {
    ...run,
    status: observation.status === 'success' ? 'delivering' : 'failed',
    phaseLabel: observation.status === 'success' ? observation.summary : '画布交付失败',
    error: observation.status === 'failed' ? observation.summary : run.error,
    deliverables: [...run.deliverables.filter((current) => current.id !== item.id), item],
  }
}

function getDeliverableTitle(deliverable: IncrementalCanvasDeliverable) {
  if (deliverable.kind === 'page-shell' || deliverable.kind === 'page-shell-edit') {
    return '页面视觉外壳'
  }
  if (deliverable.kind === 'page-component') {
    return deliverable.component.componentDesign.componentName || '页面组件'
  }
  if (deliverable.kind === 'component') return deliverable.componentDesign.componentName
  if (deliverable.kind === 'component-slot') return '组件局部素材'
  if (deliverable.kind === 'component-slot-batch')
    return `${deliverable.items.length} 个组件局部素材`
  if (deliverable.kind === 'asset-set') return '独立素材'
  if (deliverable.kind === 'image') return '设计图片'
  if (deliverable.kind === 'design-patch') return '局部设计修改'
  if (deliverable.kind === 'design-spec-patch') return '页面结构修改'
  if (deliverable.kind === 'generic-ui-runtime') return '可编辑 Runtime UI'
  return '完整页面'
}

function summarizePatchOperation(operation: DesignPatch['operations'][number]) {
  const elementId = 'elementId' in operation ? operation.elementId : operation.element.parentId
  if (operation.kind === 'replace-text-range') {
    return {
      id: operation.id,
      kind: operation.kind,
      elementId: operation.elementId,
      summary: `替换字符 ${operation.start}-${operation.end}`,
      before: operation.expectedText,
      after: operation.replacement,
    }
  }
  if (operation.kind === 'replace-image-region') {
    const rect = operation.normalizedRect
    return {
      id: operation.id,
      kind: operation.kind,
      elementId: operation.elementId,
      summary: `重绘区域 ${formatPercent(rect.x)}, ${formatPercent(rect.y)}, ${formatPercent(rect.width)} × ${formatPercent(rect.height)}`,
    }
  }
  if (operation.kind === 'update') {
    return {
      id: operation.id,
      kind: operation.kind,
      elementId,
      summary: `更新 ${Object.keys(operation.changes).join('、') || '节点属性'}`,
    }
  }
  if (operation.kind === 'semantic-update') {
    return {
      id: operation.id,
      kind: operation.kind,
      elementId,
      summary: `更新 ${Object.keys(operation.semantic).join('、') || '设计属性'}`,
    }
  }
  if (operation.kind === 'move')
    return { id: operation.id, kind: operation.kind, elementId, summary: '移动或调整父级' }
  if (operation.kind === 'delete')
    return { id: operation.id, kind: operation.kind, elementId, summary: '删除节点' }
  if (operation.kind === 'replace-image')
    return { id: operation.id, kind: operation.kind, elementId, summary: '替换整张图片' }
  return {
    id: operation.id,
    kind: operation.kind,
    elementId,
    summary: `新增 ${operation.element.type} 节点`,
  }
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export function finishRun(
  run: ChatRun,
  status: Extract<ChatRunStatus, 'completed' | 'failed' | 'cancelled' | 'waiting-confirmation'>,
  phaseLabel: string,
  error?: string,
): ChatRun {
  const finishedAt = status === 'waiting-confirmation' ? undefined : new Date().toISOString()
  return {
    ...run,
    status,
    phaseLabel,
    currentStepId: undefined,
    steps: finishedAt ? finalizeActiveSteps(run.steps, status, finishedAt, error) : run.steps,
    finishedAt,
    error,
  }
}

function finalizeActiveSteps(
  steps: ChatRunStep[],
  runStatus: Extract<ChatRunStatus, 'completed' | 'failed' | 'cancelled' | 'waiting-confirmation'>,
  finishedAt: string,
  error?: string,
) {
  return steps.map((step) => {
    if (!['running', 'retrying'].includes(step.status)) return step
    const status: ChatRunStep['status'] =
      runStatus === 'completed' ? 'completed' : runStatus === 'cancelled' ? 'cancelled' : 'failed'
    return {
      ...step,
      status,
      completedAt: step.completedAt ?? finishedAt,
      ...(status === 'failed' && error && !step.error ? { error } : {}),
    }
  })
}

export function getRunStatusLabel(run: ChatRun) {
  if (run.status === 'completed') return '已完成'
  if (run.status === 'failed') return '执行失败'
  if (run.status === 'cancelled') return '已停止'
  if (run.status === 'interrupted') return '已中断'
  if (run.status === 'waiting-confirmation') return '等待确认'
  return '进行中'
}

export function isRunActive(run: ChatRun) {
  return !['completed', 'failed', 'cancelled', 'interrupted', 'waiting-confirmation'].includes(
    run.status,
  )
}

export function isSelectionConflict(run: ChatRun) {
  const codes = [
    ...run.steps.map((step) => step.errorCode),
    ...run.deliverables.map((deliverable) => deliverable.errorCode),
  ].filter(Boolean)
  return (
    codes.some((code) =>
      /REVISION_CONFLICT|TARGET_CONFLICT|TEXT_RANGE_CONFLICT|SCOPE_VIOLATION/.test(code!),
    ) || /revision|选区已经变化|目标已经变化|重新选择/i.test(run.error || '')
  )
}

function upsertStep(steps: ChatRunStep[], next: ChatRunStep) {
  const exists = steps.some((step) => step.id === next.id)
  return exists
    ? steps.map((step) => (step.id === next.id ? { ...step, ...next } : step))
    : [...steps, next]
}

function normalizeStep(step: NonNullable<AgentEvent['step']>, previous?: ChatRunStep): ChatRunStep {
  const tool = step.tool || previous?.tool || 'agent-step'
  const rawTitle = step.title || previous?.title || tool
  const status = normalizeStepStatus(step.status)
  return {
    ...previous,
    id: step.id,
    tool,
    title: rawTitle === tool ? getToolLabel(tool) : rawTitle,
    status,
    attempt: step.attempt ?? previous?.attempt,
    error: step.error ?? previous?.error,
    startedAt: step.startedAt ?? previous?.startedAt,
    completedAt:
      step.completedAt ??
      previous?.completedAt ??
      (['completed', 'failed', 'cancelled'].includes(status)
        ? new Date().toISOString()
        : undefined),
    partialFailure: step.partialFailure ?? previous?.partialFailure,
    partialSummary: step.partialSummary ?? previous?.partialSummary,
  }
}

function normalizeStepStatus(status: string): ChatRunStep['status'] {
  if (['running', 'completed', 'retrying', 'failed', 'cancelled'].includes(status)) {
    return status as ChatRunStep['status']
  }
  return 'pending'
}

function getToolLabel(tool: string) {
  const labels: Record<string, string> = {
    studio_run_design_workflow: '准备设计工作流',
    skill_activate: '加载设计 Skill',
    skill_read_resource: '读取 Skill 资料',
  }
  return labels[tool] || tool
}
