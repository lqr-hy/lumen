import crypto from 'node:crypto'
import { planAgentTurn } from './agent-planner.mjs'
import {
  loadAgentSession,
  loadStepCheckpoint,
  saveAgentSession,
  saveStepCheckpoint,
} from './agent-session-store.mjs'
import { createAgentToolRegistry } from './agent-tools.mjs'
import { decideConversationTurn } from './conversation-agent.mjs'
import { decideAgentNextAction, getReadyAgentSteps } from './react-loop.mjs'
import { createRuntimeError } from './providers.mjs'
import { readArtifact, writeArtifact } from '../artifacts/artifact-repository.mjs'

const activeSessions = new Map()
const MAX_ITERATIONS = 32
const MAX_REACT_ITERATIONS = 20
const DEFAULT_TOOL_TIMEOUT_MS = 5 * 60 * 1000
// 页面组件工具内部包含多个组件流水线，不能复用单组件的 5 分钟限制。
const MAX_TOOL_ATTEMPTS = 2

export async function runAgent(payload, callbacks = {}, dependencies) {
  validateAgentPayload(payload)
  const session = await loadAgentSession(payload.sessionId)
  if (typeof payload.projectId === 'string' && payload.projectId.trim()) {
    session.projectId = payload.projectId
  }
  if (isCanvasTarget(payload.canvasTarget)) {
    session.canvasTarget = { ...payload.canvasTarget }
  } else if (session.canvasTarget) {
    payload = { ...payload, canvasTarget: session.canvasTarget }
  }
  if (payload.canvasSnapshot && typeof payload.canvasSnapshot === 'object') {
    session.canvasSnapshot = sanitizeCanvasSnapshot(payload.canvasSnapshot)
  }
  if (isDesignEditScope(payload.editScope)) {
    session.editScope = { ...payload.editScope }
  } else if (session.taskKind === 'component-slot-edit' && session.editScope) {
    payload = { ...payload, editScope: session.editScope }
  }
  const selectedSkills = Array.isArray(payload.skillNames) && payload.skillNames.length
    ? payload.skillNames
    : session.skills ?? []
  payload = { ...payload, skillNames: selectedSkills }
  session.skills = selectedSkills
  const decision = await decideConversationTurn({
    session,
    payload,
    invokeProvider: dependencies.decideIntent,
  })
  session.lastConversationDecision = {
    mode: decision.mode,
    action: decision.action,
    taskKind: decision.taskKind,
    confidence: decision.confidence,
    reason: decision.reason,
    source: decision.source,
  }
  if (typeof decision.target?.componentName === 'string' && decision.target.componentName.trim()) {
    session.componentRequest = decision.target.componentName.trim()
  }
  if (
    decision.source === 'model' &&
    (decision.mode === 'reply' || decision.mode === 'clarify') &&
    decision.response
  ) {
    touch(session)
    await saveAndEmitSession(session, callbacks)
    return { text: decision.response, agent: publicSession(session) }
  }
  const turn = planAgentTurn(session, payload, decision.intent)
  await saveAndEmitSession(session, callbacks)

  if (turn.action === 'reply') return { text: turn.text, agent: publicSession(session) }

  if (turn.action === 'chat') {
    const result = await dependencies.invokeProvider({
      ...payload,
      type: 'chat',
      question: buildChatQuestion(payload),
    }, callbacks)
    return { ...result, agent: publicSession(session) }
  }

  if (activeSessions.has(session.id)) {
    throw createRuntimeError('AGENT_SESSION_BUSY', '当前任务仍在执行，请等待完成后再继续。')
  }

  const controller = new AbortController()
  activeSessions.set(session.id, controller)
  try {
    return await executePlan(
      session,
      { ...payload, signal: controller.signal },
      callbacks,
      dependencies,
    )
  } finally {
    activeSessions.delete(session.id)
  }
}

export function cancelAgentRun(sessionId) {
  const controller = activeSessions.get(sessionId)
  if (!controller) return false
  controller.abort(createRuntimeError('AGENT_CANCELLED', '用户已取消当前任务。'))
  return true
}

async function executePlan(session, payload, callbacks, dependencies) {
  const registry = createAgentToolRegistry(dependencies)
  const memory = await restoreStepMemory(session, payload)
  const reactEnabled = typeof dependencies.decideNextAction === 'function'
  session.reactState = {
    enabled: reactEnabled,
    iteration: 0,
    consecutiveFailures: {},
    budget: {
      maxIterations: reactEnabled ? MAX_REACT_ITERATIONS : MAX_ITERATIONS,
      maxSameFailure: 2,
    },
  }
  session.status = 'running'
  emit(callbacks, { type: 'plan.updated', sessionId: session.id, steps: session.plan })
  await saveAndEmitSession(session, callbacks)

  let iterations = 0
  const iterationLimit = reactEnabled ? MAX_REACT_ITERATIONS : MAX_ITERATIONS
  try {
    while (iterations < iterationLimit) {
      const readySteps = getReadyAgentSteps(session)
      const nextAction = await decideAgentNextAction({
        session,
        payload,
        readySteps,
        invokeProvider: dependencies.decideNextAction,
      })
      session.lastNextAction = {
        mode: nextAction.mode,
        tool: nextAction.tool?.name,
        stepId: nextAction.tool?.stepId,
        confidence: nextAction.confidence,
        reason: nextAction.reason,
        source: nextAction.source,
      }
      emit(callbacks, { type: 'agent.decision', sessionId: session.id, decision: session.lastNextAction })
      if (nextAction.mode === 'clarify') {
        session.status = 'waiting-user'
        delete session.currentStepId
        touch(session)
        await saveAndEmitSession(session, callbacks)
        return { text: nextAction.response, agent: publicSession(session) }
      }
      if (nextAction.mode === 'finish' && !readySteps.length) break
      const selectedAction = nextAction.mode === 'finish'
        ? {
            ...nextAction,
            mode: 'tool',
            tool: readySteps[0]
              ? { stepId: readySteps[0].id, name: readySteps[0].tool, kind: 'planned' }
              : undefined,
          }
        : nextAction
      const step = resolveReactStep(session, readySteps, selectedAction, iterations)
      if (!step) {
        if (!readySteps.length) break
        throw createRuntimeError('AGENT_NEXT_ACTION_INVALID', 'ReAct Agent 没有选择可执行工具。')
      }
      if (
        (payload.provider === 'codex' || payload.provider === 'codex_cli') &&
        step.tool === 'page.generate-component'
      ) {
        step.title = `生成 ${step.input?.componentName ?? '页面'} 组件`
      }
      iterations += 1
      session.reactState.iteration = iterations
      session.currentStepId = step.id
      step.inputHash = computeStepInputHash(session, payload, step)
      step.status = 'running'
      step.startedAt = new Date().toISOString()
      touch(session)
      emit(callbacks, { type: 'step.started', sessionId: session.id, step: publicStep(step) })
      await saveAgentSession(session)

      try {
        const toolContext = {
          session,
          payload,
          memory,
          input: step.input,
          providerCallbacks: callbacks,
        }
        const result = await executeToolWithRetry(
          registry,
          step,
          toolContext,
          callbacks,
          session.id,
          reactEnabled ? 1 : MAX_TOOL_ATTEMPTS,
        )
        if (
          (step.tool === 'page.generate-shell' || step.tool === 'page.generate-component') &&
          !result.data?.failed
        ) {
          const canvasObservation = step.tool === 'page.generate-shell'
            ? await deliverPageShell(session, step, result.data, callbacks, iterations)
            : await deliverPageComponent(session, step, result.data, callbacks, iterations)
          if (canvasObservation) {
            session.canvasObservations = [
              ...(session.canvasObservations ?? []).slice(-19),
              canvasObservation,
            ]
            session.observations = [...session.observations.slice(-49), canvasObservation]
            mergeCanvasSnapshot(session, canvasObservation)
            emit(callbacks, {
              type: 'observation.created',
              sessionId: session.id,
              observation: canvasObservation,
            })
            if (canvasObservation.status !== 'success') {
              throw createRuntimeError(
                canvasObservation.errorCode || 'CANVAS_DELIVERY_FAILED',
                canvasObservation.summary || '页面组件未写入目标画板。',
              )
            }
          }
        }
        memory.set(step.tool, result)
        memory.set(step.id, result)
        if (step.tool === 'page.generate-component' && result.data?.failed) {
          step.partialFailure = true
        } else {
          delete step.partialFailure
        }
        insertDynamicSteps(session, step.id, result.nextSteps)
        const externalizedResult = await externalizeArtifacts(result, session)
        step.outputHash = hashValue(externalizedResult)
        await saveStepCheckpoint(
          session.id,
          session.runId,
          step.id,
          {
            checkpointVersion: 2,
            inputHash: step.inputHash,
            outputHash: step.outputHash,
            result: externalizedResult,
          },
        )
        const observation = {
          id: `observation-${Date.now()}-${iterations}`,
          stepId: step.id,
          tool: step.tool,
          status: result.data?.failed ? 'partial' : 'success',
          summary: result.summary,
          data: summarizeObservationData(result.data),
          createdAt: new Date().toISOString(),
        }
        session.observations = [...session.observations.slice(-49), observation]
        emit(callbacks, { type: 'observation.created', sessionId: session.id, observation })
        step.status = 'completed'
        step.completedAt = observation.createdAt
        step.observationId = observation.id
        delete step.error
        applyToolDecision(session, step, result.decision)
        emit(callbacks, { type: 'step.completed', sessionId: session.id, step: publicStep(step) })
        await saveAgentSession(session)
        if (result.pause?.type === 'blueprint-confirmation') {
          session.status = 'awaiting-confirmation'
          delete session.currentStepId
          touch(session)
          emit(callbacks, {
            type: 'task.awaiting-confirmation',
            sessionId: session.id,
            confirmation: result.pause,
          })
          await saveAndEmitSession(session, callbacks)
          return {
            text: result.pause.message,
            awaitingConfirmation: result.pause,
            agent: publicSession(session),
          }
        }
      } catch (error) {
        if (payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') throw error
        step.status = 'failed'
        step.error = error instanceof Error ? error.message : String(error)
        const failureKey = hashValue({ tool: step.tool, input: step.input, error: error?.code ?? step.error })
        const failureCount = (session.reactState.consecutiveFailures[failureKey] ?? 0) + 1
        session.reactState.consecutiveFailures[failureKey] = failureCount
        const observation = {
          id: `observation-${Date.now()}-${iterations}-failed`,
          stepId: step.id,
          tool: step.tool,
          status: 'failed',
          summary: step.error,
          errorCode: typeof error?.code === 'string' ? error.code : 'AGENT_TOOL_FAILED',
          retryable: reactEnabled && failureCount < session.reactState.budget.maxSameFailure,
          createdAt: new Date().toISOString(),
        }
        session.observations = [...session.observations.slice(-49), observation]
        session.status = 'failed'
        session.lastError = {
          code: typeof error?.code === 'string' ? error.code : 'AGENT_TOOL_FAILED',
          message: step.error,
          stepId: step.id,
        }
        touch(session)
        emit(callbacks, { type: 'step.failed', sessionId: session.id, step: publicStep(step), error: step.error })
        emit(callbacks, { type: 'observation.created', sessionId: session.id, observation })
        await saveAgentSession(session)
        if (reactEnabled && failureCount < session.reactState.budget.maxSameFailure) {
          session.status = 'running'
          continue
        }
        emit(callbacks, { type: 'task.failed', sessionId: session.id, error: step.error })
        throw error
      }
    }

    if (session.plan.some((step) => step.status !== 'completed')) {
      throw createRuntimeError('AGENT_LOOP_LIMIT', `Agent 超过 ${iterationLimit} 次循环限制。`)
    }

    const presentation = memory.get('canvas.present')?.data
    const pagePresentation = memory.get('canvas.present-page')?.data
    const componentPresentation = memory.get('canvas.present-component')?.data
    const slotPresentation = memory.get('canvas.present-slot')?.data
    const pageShellPresentation = memory.get('canvas.present-page-shell')?.data
    const artifact = pagePresentation?.pageShellArtifact ?? pageShellPresentation?.pageShellArtifact ?? pageShellPresentation?.artifact ?? slotPresentation?.artifact ?? componentPresentation?.previewArtifact ?? presentation?.artifact
    const assetArtifacts = componentPresentation
      ? componentPresentation.artifacts ?? []
      : memory.get('canvas.present-assets')?.data?.artifacts
    const artifacts = pagePresentation
      ? [
          pagePresentation.pageShellArtifact,
          ...pagePresentation.components.flatMap((component) => [
            component.previewArtifact,
            component.visualShellArtifact,
            ...(component.artifacts ?? []),
          ]),
        ].filter(Boolean)
      : pageShellPresentation
      ? [pageShellPresentation.artifact]
      : slotPresentation
      ? [slotPresentation.artifact]
      : componentPresentation
      ? [
          componentPresentation.previewArtifact,
          componentPresentation.visualShellArtifact,
          ...(componentPresentation.artifacts ?? []),
        ].filter(Boolean)
      : assetArtifacts ?? (artifact ? [artifact] : [])
    session.status = 'completed'
    delete session.currentStepId
    delete session.lastError
    for (let index = 0; index < artifacts.length; index += 1) {
      const currentArtifact = artifacts[index]
      const artifactMeta = {
        id: `artifact-${Date.now()}-${index}`,
        kind: currentArtifact.kind,
        name: currentArtifact.name || `AI 生成素材 ${index + 1}.png`,
        createdAt: new Date().toISOString(),
      }
      session.artifacts.push(artifactMeta)
      emit(callbacks, {
        type: 'artifact.created',
        sessionId: session.id,
        artifact: artifactMeta,
      })
    }
    touch(session)
    emit(callbacks, { type: 'task.completed', sessionId: session.id })
    await saveAndEmitSession(session, callbacks)
    return {
      text: pagePresentation
        ? pagePresentation.failedComponents?.length
          ? `页面已交付 ${pagePresentation.components.length}/${pagePresentation.pageDesign.blueprint.sections.length} 个组件；生成失败：${pagePresentation.failedComponents.map((item) => item.componentName).join('、')}。点击“继续”只重试失败组件。`
          : `已完成包含 ${pagePresentation.components.length} 个组件实例的完整页面设计。`
        : pageShellPresentation
        ? '已重新生成并替换页面视觉外壳。'
        : slotPresentation
        ? `已重新生成并替换 ${slotPresentation.editScope.slotId} 素材。`
        : componentPresentation
        ? `已完成 ${componentPresentation.componentDesign.componentName} 组件设计，生成视觉外壳、${componentPresentation.artifacts.length} 个 Props 独立素材和 Props Patch。`
        : artifacts.length > 1
          ? `已完成计划并生成 ${artifacts.length} 个独立素材。`
        : '已完成计划并生成设计图。',
      artifact,
      artifacts: assetArtifacts,
      visualShellArtifact: componentPresentation?.visualShellArtifact,
      componentDesign: componentPresentation?.componentDesign,
      pageDesign: pagePresentation?.pageDesign,
      pageComponents: pagePresentation?.components,
      pageShellArtifact: pagePresentation?.pageShellArtifact,
      editScope: pageShellPresentation?.editScope ?? slotPresentation?.editScope ?? (
        componentPresentation && session.editScope?.type === 'component-instance'
          ? session.editScope
          : undefined
      ),
      blueprint: session.blueprint,
      qualityReview: presentation?.review,
      refined: presentation?.refined ?? false,
      agent: publicSession(session),
    }
  } catch (error) {
    if (payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') {
      const currentStep = session.plan.find((step) => step.status === 'running')
      if (currentStep) currentStep.status = 'cancelled'
      session.status = 'cancelled'
      session.lastError = {
        code: 'AGENT_CANCELLED',
        message: '用户已取消当前任务。',
        stepId: currentStep?.id,
      }
      touch(session)
      emit(callbacks, { type: 'task.cancelled', sessionId: session.id })
      await saveAgentSession(session)
      throw createRuntimeError('AGENT_CANCELLED', '用户已取消当前任务。')
    }
    if (session.status !== 'failed') {
      session.status = 'failed'
      session.lastError = {
        code: typeof error?.code === 'string' ? error.code : 'AGENT_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }
      touch(session)
      await saveAgentSession(session)
    }
    throw error
  }
}

async function restoreStepMemory(session, payload) {
  const memory = new Map()
  if (!session.runId) return memory
  let invalidateDownstream = false
  for (const step of session.plan) {
    if (invalidateDownstream || step.status !== 'completed') continue
    const checkpoint = await loadStepCheckpoint(session.id, session.runId, step.id)
    if (!checkpoint) {
      step.status = 'pending'
      invalidateDownstream = true
      continue
    }
    try {
      const expectedInputHash = computeStepInputHash(session, payload, step)
      const envelope = checkpoint?.checkpointVersion === 2
        ? checkpoint
        : { result: checkpoint }
      if (envelope.inputHash && envelope.inputHash !== expectedInputHash) {
        step.status = 'pending'
        invalidateDownstream = true
        continue
      }
      const hydrated = await hydrateArtifacts(envelope.result)
      step.inputHash = envelope.inputHash ?? expectedInputHash
      step.outputHash = envelope.outputHash ?? hashValue(envelope.result)
      memory.set(step.tool, hydrated)
      memory.set(step.id, hydrated)
    } catch {
      step.status = 'pending'
      invalidateDownstream = true
    }
  }
  if (invalidateDownstream) {
    let reset = false
    session.plan = session.plan.map((step) => {
      if (step.status === 'pending') reset = true
      return reset && step.status === 'completed'
        ? { ...step, status: 'pending', observationId: undefined }
        : step
    })
  }
  return memory
}

function resolveReactStep(session, readySteps, action, iteration) {
  if (action.tool?.kind === 'planned') {
    return readySteps.find((step) => (
      step.id === action.tool.stepId && step.tool === action.tool.name
    ))
  }
  if (action.tool?.kind !== 'inspect') return undefined
  const step = {
    id: `${action.tool.stepId}-${Date.now()}-${iteration + 1}`,
    title: inspectToolTitle(action.tool.name),
    tool: action.tool.name,
    status: 'pending',
    input: action.tool.arguments ?? {},
    transient: true,
  }
  const insertionIndex = session.plan.findIndex((candidate) => (
    candidate.status === 'pending' || candidate.status === 'failed'
  ))
  if (insertionIndex < 0) session.plan.push(step)
  else session.plan.splice(insertionIndex, 0, step)
  return step
}

async function deliverPageComponent(session, step, data, callbacks, iteration) {
  if (typeof callbacks.onDeliverable !== 'function') return undefined
  const deliveryId = `deliverable-${session.runId}-${step.id}-${Date.now()}`
  const pageSection = session.pageBlueprint?.sections?.find((section) => (
    section.id === step.input?.pageSectionId
  ))
  const observation = await callbacks.onDeliverable({
    id: deliveryId,
    kind: 'page-component',
    sessionId: session.id,
    runId: session.runId,
    stepId: step.id,
    target: session.canvasTarget,
    component: {
      index: data.index,
      pageSectionId: step.input?.pageSectionId,
      bounds: pageSection?.bounds,
      componentName: data.componentName,
      componentDesign: data.componentDesign,
      artifacts: data.artifacts ?? [],
      visualShellArtifact: data.visualShellArtifact,
    },
  })
  const status = ['success', 'failed'].includes(observation?.status)
    ? observation.status
    : 'failed'
  return {
    id: `observation-${Date.now()}-${iteration}-canvas`,
    deliveryId,
    stepId: step.id,
    tool: 'canvas.incremental-present-component',
    status,
    summary: typeof observation?.summary === 'string'
      ? observation.summary
      : status === 'success'
        ? `${data.componentName} 已增量写入画布。`
        : `${data.componentName} 增量写入画布失败。`,
    errorCode: status === 'failed'
      ? observation?.errorCode || 'CANVAS_DELIVERY_FAILED'
      : undefined,
    retryable: status === 'failed',
    data: observation?.data,
    createdAt: new Date().toISOString(),
  }
}

async function deliverPageShell(session, step, data, callbacks, iteration) {
  if (typeof callbacks.onDeliverable !== 'function') return undefined
  const deliveryId = `deliverable-${session.runId}-${step.id}-${Date.now()}`
  const observation = await callbacks.onDeliverable({
    id: deliveryId,
    kind: 'page-shell',
    sessionId: session.id,
    runId: session.runId,
    stepId: step.id,
    target: session.canvasTarget,
    blueprint: data.blueprint,
    pageShellArtifact: data.pageShellArtifact,
  })
  return normalizeCanvasObservation({
    observation,
    deliveryId,
    step,
    iteration,
    tool: 'canvas.incremental-present-page-shell',
    successSummary: '页面视觉外壳已增量写入画布。',
    failureSummary: '页面视觉外壳增量写入画布失败。',
  })
}

function mergeCanvasSnapshot(session, observation) {
  const data = observation.data ?? {}
  const previousElements = Array.isArray(session.canvasSnapshot?.elements)
    ? session.canvasSnapshot.elements
    : []
  const writtenElement = data.rootElementId
    ? {
        id: data.rootElementId,
        type: 'section',
        designRole: 'component-root',
        instanceId: data.instanceId,
        pageSectionId: data.pageSectionId,
      }
    : data.shellElementId
      ? {
          id: data.shellElementId,
          type: 'image',
          designRole: 'page-shell',
        }
      : undefined
  const incomingElements = Array.isArray(data.elements) && data.elements.length
    ? data.elements.slice(0, 80)
    : writtenElement ? [writtenElement] : []
  const incomingIds = new Set(incomingElements.map((element) => element.id))
  const elements = incomingElements.length
    ? [
        ...previousElements.filter((element) => (
          !incomingIds.has(element.id) &&
          !(data.pageSectionId && element.pageSectionId === data.pageSectionId) &&
          !(data.shellElementId && element.designRole === 'page-shell')
        )),
        ...incomingElements,
      ].slice(-80)
    : previousElements
  session.canvasSnapshot = {
    ...(session.canvasSnapshot ?? {}),
    artboardId: data.artboardId ?? session.canvasTarget?.artboardId,
    width: session.canvasTarget?.width,
    height: session.canvasTarget?.height,
    elementCount: data.elementCount ?? session.canvasSnapshot?.elementCount,
    componentCount: data.componentCount ?? (
      observation.tool === 'canvas.incremental-present-component'
        ? (session.canvasSnapshot?.componentCount ?? 0) + 1
        : session.canvasSnapshot?.componentCount
    ),
    hasPageShell: data.hasPageShell ?? session.canvasSnapshot?.hasPageShell ?? false,
    elements,
    truncated: session.canvasSnapshot?.truncated === true,
    lastWrite: {
      tool: observation.tool,
      status: observation.status,
      rootElementId: data.rootElementId,
      shellElementId: data.shellElementId,
      instanceId: data.instanceId,
      pageSectionId: data.pageSectionId,
    },
  }
}

function normalizeCanvasObservation({
  observation,
  deliveryId,
  step,
  iteration,
  tool,
  successSummary,
  failureSummary,
}) {
  const status = ['success', 'failed'].includes(observation?.status)
    ? observation.status
    : 'failed'
  return {
    id: `observation-${Date.now()}-${iteration}-canvas`,
    deliveryId,
    stepId: step.id,
    tool,
    status,
    summary: typeof observation?.summary === 'string'
      ? observation.summary
      : status === 'success'
        ? successSummary
        : failureSummary,
    errorCode: status === 'failed'
      ? observation?.errorCode || 'CANVAS_DELIVERY_FAILED'
      : undefined,
    retryable: status === 'failed',
    data: observation?.data,
    createdAt: new Date().toISOString(),
  }
}

function inspectToolTitle(toolName) {
  if (toolName === 'canvas.inspect') return '检查目标画板'
  if (toolName === 'artifact.inspect') return '检查任务制品'
  return '检查 Agent 状态'
}

function summarizeObservationData(data) {
  if (!data || typeof data !== 'object') return undefined
  return {
    keys: Object.keys(data).slice(0, 20),
    artifactCount: Array.isArray(data.artifacts) ? data.artifacts.length : undefined,
    componentName: data.componentName ?? data.componentDesign?.componentName,
    componentCount: Array.isArray(data.components) ? data.components.length : undefined,
    failed: data.failed === true,
    targetArtboardId: data.canvasTarget?.artboardId,
  }
}

function applyToolDecision(session, currentStep, decision) {
  if (!decision || decision.action !== 'repair') return
  const maxAttempts = Number.isFinite(decision.maxAttempts) ? decision.maxAttempts : 2
  const key = String(decision.key || currentStep.id)
  session.repairAttempts ||= {}
  const attempts = (session.repairAttempts[key] ?? 0) + 1
  session.repairAttempts[key] = attempts
  if (attempts > maxAttempts) {
    throw createRuntimeError(
      'AGENT_REPAIR_LIMIT',
      decision.limitMessage || `${currentStep.title} 已达到 ${maxAttempts} 次自动修订上限。`,
    )
  }
  session.repairContext = {
    key,
    targetId: decision.targetId,
    issues: decision.issues ?? [],
    attempt: attempts,
  }
  const invalidatedIds = new Set(decision.invalidateStepIds ?? [])
  for (const step of session.plan) {
    if (!invalidatedIds.has(step.id)) continue
    step.status = 'pending'
    delete step.error
    delete step.observationId
    delete step.inputHash
    delete step.outputHash
  }
}

function computeStepInputHash(session, payload, step) {
  const dependencyHashes = []
  for (const candidate of session.plan ?? []) {
    if (candidate.id === step.id) break
    if (candidate.outputHash) dependencyHashes.push([candidate.id, candidate.outputHash])
  }
  return hashValue({
    version: 1,
    tool: step.tool,
    input: step.input,
    goal: session.goal,
    taskKind: session.taskKind,
    canvasTarget: session.canvasTarget,
    editScope: session.editScope,
    references: (session.references ?? []).map((reference) => ({
      id: reference.id,
      role: reference.role,
      mime: reference.mime,
      contentHash: reference.contentHash ?? hashValue(reference.data ?? ''),
    })),
    provider: payload.provider,
    model: payload.model,
    dependencies: dependencyHashes,
  })
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}

function insertDynamicSteps(session, afterStepId, nextSteps) {
  if (!Array.isArray(nextSteps) || !nextSteps.length) return
  const existingIds = new Set(session.plan.map((step) => step.id))
  const additions = nextSteps.filter((step) => (
    step &&
    typeof step.id === 'string' &&
    typeof step.title === 'string' &&
    typeof step.tool === 'string' &&
    !existingIds.has(step.id)
  )).map((step) => ({
    id: step.id,
    title: step.title,
    tool: step.tool,
    status: 'pending',
    input: step.input,
  }))
  if (!additions.length) return
  const index = session.plan.findIndex((step) => step.id === afterStepId)
  session.plan.splice(index + 1, 0, ...additions)
}

async function externalizeArtifacts(value, session) {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => externalizeArtifacts(item, session)))
  }
  if (!value || typeof value !== 'object') return value
  if ((value.kind === 'svg' || value.kind === 'raster') && typeof value.content === 'string') {
    const metadata = await writeArtifact({
      projectId: session.projectId,
      runId: session.runId,
      kind: value.kind,
      name: value.name,
      content: value.content,
      mime: value.mime,
      width: value.width,
      height: value.height,
    })
    return { __artifactRef: metadata.id }
  }
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [
    key,
    await externalizeArtifacts(item, session),
  ]))
  return Object.fromEntries(entries)
}

async function hydrateArtifacts(value) {
  if (Array.isArray(value)) return Promise.all(value.map(hydrateArtifacts))
  if (!value || typeof value !== 'object') return value
  if (typeof value.__artifactRef === 'string') {
    const artifact = await readArtifact(value.__artifactRef)
    if (!artifact) throw new Error(`Artifact 检查点缺失：${value.__artifactRef}`)
    return {
      kind: artifact.kind,
      name: artifact.name,
      content: artifact.content,
      ...(artifact.mime ? { mime: artifact.mime } : {}),
      ...(Number.isFinite(artifact.width) ? { width: artifact.width } : {}),
      ...(Number.isFinite(artifact.height) ? { height: artifact.height } : {}),
    }
  }
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [
    key,
    await hydrateArtifacts(item),
  ]))
  return Object.fromEntries(entries)
}

async function executeToolWithRetry(registry, step, context, callbacks, sessionId, maxAttempts = MAX_TOOL_ATTEMPTS) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let cancelAttempt
    try {
      if (context.payload.signal?.aborted) {
        throw createRuntimeError('AGENT_CANCELLED', '用户已取消当前任务。')
      }
      const attemptController = new AbortController()
      cancelAttempt = () => attemptController.abort(context.payload.signal?.reason)
      context.payload.signal?.addEventListener('abort', cancelAttempt, { once: true })
      return await withTimeout(
        registry.execute(step.tool, {
          ...context,
          signal: attemptController.signal,
          payload: { ...context.payload, signal: attemptController.signal },
        }),
        getToolTimeout(step.tool),
        `${step.title}执行超时。`,
        attemptController,
      )
    } catch (error) {
      lastError = error
      if (context.payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') break
      if (attempt >= maxAttempts) break
      emit(callbacks, {
        type: 'step.retrying',
        sessionId,
        step: publicStep(step),
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (cancelAttempt) context.payload.signal?.removeEventListener('abort', cancelAttempt)
    }
  }
  throw lastError
}

function getToolTimeout(toolName) {
  const defaultTimeout = DEFAULT_TOOL_TIMEOUT_MS
  const envName = 'AGENT_TOOL_TIMEOUT_MS'
  const configured = Number(process.env[envName])
  return Number.isFinite(configured) && configured > 0 ? configured : defaultTimeout
}

function withTimeout(promise, timeoutMs, message, controller) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = createRuntimeError('AGENT_TOOL_TIMEOUT', message)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function buildChatQuestion(payload) {
  const history = (payload.history ?? [])
    .slice(-12)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`)
    .join('\n')
  return [
    '你是 AI Campaign Page Studio 的助手。请直接进行正常对话，不要返回 JSON 或虚构已经执行了工具。',
    history ? `最近对话：\n${history}` : '',
    `用户：${payload.question}`,
  ].filter(Boolean).join('\n\n')
}

async function saveAndEmitSession(session, callbacks) {
  touch(session)
  await saveAgentSession(session)
  emit(callbacks, {
    type: 'session.updated',
    sessionId: session.id,
    status: session.status,
    session: publicSession(session),
  })
}

function emit(callbacks, event) {
  callbacks.onAgentEvent?.(event)
}

function publicSession(session) {
  return {
    id: session.id,
    runId: session.runId,
    projectId: session.projectId,
    goal: session.goal,
    status: session.status,
    plan: session.plan.map(publicStep),
    references: session.references.map((reference) => ({
      id: reference.id,
      name: reference.name,
      role: reference.role,
      mime: reference.mime,
      updatedAt: reference.updatedAt,
    })),
    artifacts: session.artifacts,
    skills: session.skills ?? [],
    canvasTarget: session.canvasTarget,
    editScope: session.editScope,
    componentContext: session.componentContext,
    blueprint: session.blueprint,
    lastConversationDecision: session.lastConversationDecision,
    lastNextAction: session.lastNextAction,
    reactState: session.reactState,
    observations: session.observations.slice(-20).map((observation) => ({
      id: observation.id,
      stepId: observation.stepId,
      tool: observation.tool,
      status: observation.status,
      summary: observation.summary,
      errorCode: observation.errorCode,
      retryable: observation.retryable,
      createdAt: observation.createdAt,
    })),
    canvasObservations: (session.canvasObservations ?? []).slice(-20),
    canvasSnapshot: session.canvasSnapshot,
    lastError: session.lastError,
    updatedAt: session.updatedAt,
  }
}

function isCanvasTarget(value) {
  return Boolean(
    value &&
    typeof value.artboardId === 'string' &&
    value.artboardId.trim() &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height),
  )
}

function sanitizeCanvasSnapshot(value) {
  return {
    artboardId: typeof value.artboardId === 'string' ? value.artboardId : undefined,
    width: Number.isFinite(value.width) ? value.width : undefined,
    height: Number.isFinite(value.height) ? value.height : undefined,
    elementCount: Number.isFinite(value.elementCount) ? value.elementCount : 0,
    componentCount: Number.isFinite(value.componentCount) ? value.componentCount : 0,
    hasPageShell: value.hasPageShell === true,
    selectedElementIds: Array.isArray(value.selectedElementIds)
      ? value.selectedElementIds.filter((id) => typeof id === 'string').slice(0, 50)
      : [],
    elements: Array.isArray(value.elements)
      ? value.elements.filter((element) => element && typeof element.id === 'string').slice(0, 80)
      : [],
    truncated: value.truncated === true,
  }
}

function isDesignEditScope(value) {
  if (!value || typeof value.elementId !== 'string' || !value.elementId.trim()) return false
  if (value.type === 'page-shell') {
    return Boolean(typeof value.artboardId === 'string' && value.artboardId.trim())
  }
  if (value.type === 'component-instance') {
    return Boolean(
      typeof value.instanceId === 'string' && value.instanceId.trim() &&
      typeof value.componentName === 'string' && value.componentName.trim(),
    )
  }
  return Boolean(
    value.type === 'component-region' &&
    typeof value.slotId === 'string' && value.slotId.trim() &&
    typeof value.propPath === 'string' && value.propPath.trim(),
  )
}

function publicStep(step) {
  return {
    id: step.id,
    title: step.title,
    tool: step.tool,
    status: step.status,
    error: step.error,
    inputHash: step.inputHash,
    outputHash: step.outputHash,
  }
}

function validateAgentPayload(payload) {
  if (!payload || payload.type !== 'agent_run') {
    throw createRuntimeError('INVALID_AGENT_REQUEST', 'Agent 请求格式错误。')
  }
  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    throw createRuntimeError('INVALID_AGENT_REQUEST', 'Agent 请求缺少 sessionId。')
  }
  if (typeof payload.question !== 'string' || !payload.question.trim()) {
    throw createRuntimeError('INVALID_AGENT_REQUEST', 'Agent 请求缺少问题。')
  }
}

function touch(session) {
  session.updatedAt = new Date().toISOString()
}
