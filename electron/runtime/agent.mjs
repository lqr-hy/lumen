import crypto from 'node:crypto'
import { planAgentTurn } from './agent-planner.mjs'
import {
  loadAgentSession,
  loadStepCheckpoint,
  saveAgentSession,
  saveStepCheckpoint,
} from './agent-session-store.mjs'
import { createAgentToolRegistry } from './agent-tools.mjs'
import { getReadyWorkflowSteps } from './workflow-graph.mjs'
import { createRuntimeError } from './providers.mjs'
import { readArtifact, writeArtifact } from '../artifacts/artifact-repository.mjs'
import { cancelPiAgent } from './pi/cancellation.mjs'
import { genericUiLogicalSize } from './generic-ui.mjs'
import {
  inferFallbackSurfaceKind,
  isFullUiRedesignRequest,
  routeAgentIntent,
} from './intent-router.mjs'
import { createDefaultRuntimePlugins } from './plugins/campaign-component-plugin.mjs'
import { assertTurnBudget, consumeTurnBudget, ensureTurnBudget } from './pi/turn-budget.mjs'

const activeSessions = new Map()
const MAX_ITERATIONS = 32
const DEFAULT_TOOL_TIMEOUT_MS = 5 * 60 * 1000
// 这些 Tool 内部串行生成多张图片，每张自带 per-request 超时；
// 外层必须覆盖累计耗时，不能复用单次请求的 5 分钟限制。
const BATCH_IMAGE_TOOL_TIMEOUT_MS = 20 * 60 * 1000
const BATCH_IMAGE_TOOLS = new Set([
  'component.generate-assets',
  'component.generate-image',
  'component.regenerate-slots',
  'page.generate-component',
  'page.generate-shell',
  'ui.transform',
  'design.patch.generate-images',
])
const MAX_TOOL_ATTEMPTS = 2

/**
 * 确定性设计工作流的总入口。
 * 负责恢复领域 Session、确认画布目标、生成计划，并在同一 Session 上执行到终态。
 */
export async function runDesignWorkflow(payload, callbacks = {}, dependencies) {
  validateAgentPayload(payload)
  ensureTurnBudget(payload)
  const session = await loadAgentSession(payload.sessionId)
  if (typeof payload.projectId === 'string' && payload.projectId.trim()) {
    session.projectId = payload.projectId
  }
  session.activeStylePack =
    payload.stylePack && typeof payload.stylePack === 'object' ? payload.stylePack : undefined
  const decision = resolveWorkflowDecision(payload, session)
  const resolvedTarget =
    decision?.action === 'chat'
      ? undefined
      : await resolveWorkflowCanvasTarget(session, payload, decision, callbacks)
  if (resolvedTarget) payload = { ...payload, canvasTarget: resolvedTarget }
  if (payload.canvasSnapshot && typeof payload.canvasSnapshot === 'object') {
    session.canvasSnapshot = sanitizeCanvasSnapshot(payload.canvasSnapshot)
  }
  if (isDesignEditScope(payload.editScope)) {
    session.editScope = { ...payload.editScope }
  } else if (session.taskKind === 'component-slot-edit' && session.editScope) {
    payload = { ...payload, editScope: session.editScope }
  }
  const selectedSkills =
    Array.isArray(payload.skillNames) && payload.skillNames.length
      ? payload.skillNames
      : (session.skills ?? [])
  payload = { ...payload, skillNames: selectedSkills }
  session.skills = selectedSkills
  session.lastWorkflowTrigger = decision
    ? {
        action: decision.action,
        taskKind: decision.taskKind,
        reason: decision.reason,
        source: decision.source,
      }
    : undefined
  if (
    !session.componentRequest &&
    typeof decision?.target?.componentName === 'string' &&
    decision.target.componentName.trim()
  ) {
    session.componentRequest = decision.target.componentName.trim()
  }
  const runtimePlugins =
    dependencies?.plugins === undefined ? createDefaultRuntimePlugins() : dependencies.plugins
  const turn = planAgentTurn(session, payload, decision, { plugins: runtimePlugins })
  await saveAndEmitSession(session, callbacks)

  if (turn.action === 'reply') return { text: turn.text, agent: publicSession(session) }

  if (turn.action === 'chat') {
    throw createRuntimeError('WORKFLOW_ACTION_REQUIRED', '设计工作流只接受明确的设计操作。')
  }

  if (activeSessions.has(session.id)) {
    throw createRuntimeError('AGENT_SESSION_BUSY', '当前任务仍在执行，请等待完成后再继续。')
  }

  const controller = new AbortController()
  // Renderer 只知道自己的 threadId，而领域 Session 用 projectId::threadId 隔离项目。
  // 两个 key 都注册，"停止"才能命中真正在执行的 Workflow。
  const cancelKeys = [
    session.id,
    ...(typeof payload.rendererSessionId === 'string' && payload.rendererSessionId.trim()
      ? [payload.rendererSessionId.trim()]
      : []),
  ].filter((key, index, list) => list.indexOf(key) === index)
  cancelKeys.forEach((key) => activeSessions.set(key, controller))
  // 上游 Pi Agent 的取消必须继续传导到本次 Workflow 和底层生图请求，
  // 否则中止 Agent Loop 之后图片仍会继续生成并写入画布。
  const parentSignal = payload.signal
  const abortFromParent = () =>
    controller.abort(
      parentSignal?.reason ?? createRuntimeError('AGENT_CANCELLED', '用户已取消当前任务。'),
    )
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  try {
    return await executePlan(
      session,
      { ...payload, signal: controller.signal },
      callbacks,
      dependencies,
      runtimePlugins,
    )
  } finally {
    parentSignal?.removeEventListener('abort', abortFromParent)
    cancelKeys.forEach((key) => {
      if (activeSessions.get(key) === controller) activeSessions.delete(key)
    })
  }
}

/**
 * 将 Pi 提供的 WorkflowDecision 规范化为领域决策。
 * Pi 不可用时才使用确定性 Intent Router，并始终补齐版本化 Placement。
 */
export function resolveWorkflowDecision(payload, session = {}) {
  // 视觉优化入口已经提供结构化 Brief；由显式 Context 区分新建设计与 Variant，
  // 优先级高于 Prompt 中的 H5/页面等关键词，避免自然语言覆盖用户选择。
  if (payload.visualBrief && typeof payload.visualBrief === 'object') {
    const visualContext = payload.visualOptimizationContext
    const createNewDesign = visualContext?.mode === 'new-design'
    const targetArtboardId = createNewDesign
      ? undefined
      : visualContext?.sourceArtboardId ||
        payload.canvasTarget?.artboardId ||
        payload.selectedArtboardId ||
        payload.activeArtboardId
    return {
      version: 2,
      action: 'create-ui',
      taskKind: 'generic-ui',
      confidence: 1,
      reason: 'visual-optimization-structured-context',
      source: 'visual-optimization',
      placement: targetArtboardId
        ? {
            operation: 'variant',
            scope: 'artboard',
            targetArtboardId,
            reason: '视觉优化创建独立 Variant，保留原画板。',
            confidence: 1,
          }
        : {
            operation: 'create',
            scope: 'document',
            reason: createNewDesign
              ? '视觉优化新建设计，创建独立画板。'
              : '视觉优化缺少目标画板，创建独立画板。',
            confidence: 1,
          },
      visualBrief: payload.visualBrief,
      visualAssetPlan: payload.visualAssetPlan,
    }
  }
  const supplied = payload.workflowDecision
  if (supplied) {
    if (!isPlacementDecision(supplied.placement)) {
      throw createRuntimeError('PLACEMENT_DECISION_MISSING', '设计工作流缺少有效的画布放置决策。')
    }
    const reconciled = reconcileComponentWorkflowDecision(
      reconcileSuppliedWorkflowDecision(supplied, payload),
      payload,
    )
    if (
      ['create-component', 'create-page'].includes(reconciled.action) &&
      (payload.selectedArtboardId || payload.activeArtboardId) &&
      (payload.componentReferences?.length ?? 0) > 0
    ) {
      reconciled.placement = {
        operation: 'insert',
        scope: 'artboard',
        targetArtboardId: payload.selectedArtboardId || payload.activeArtboardId,
        reason: '用户已选中画板并要求追加组件，写入当前画板底部。',
        confidence: 1,
      }
    }
    return reconciled
  }
  const deterministic = reconcileComponentWorkflowDecision(
    routeAgentIntent({
      prompt: payload.question,
      editScope: payload.editScope,
      componentReferences: payload.componentReferences,
      session: {
        taskKind: session.taskKind,
        canvasSnapshot: payload.canvasSnapshot || session.canvasSnapshot,
        componentDesign: session.componentDesign,
        visualBrief: payload.visualBrief,
      },
    }),
    payload,
  )
  // 只依据画布选择状态决定组件目标，不猜测自然语言。
  if (
    ['create-component', 'create-page'].includes(deterministic.action) &&
    (payload.selectedArtboardId || payload.activeArtboardId) &&
    (payload.componentReferences?.length ?? 0) > 0
  ) {
    deterministic.placement = {
      operation: 'insert',
      scope: 'artboard',
      targetArtboardId: payload.selectedArtboardId || payload.activeArtboardId,
      reason: '用户已选中画板并要求追加组件，写入当前画板底部。',
      confidence: 1,
    }
  }
  return {
    ...deterministic,
    version: 2,
    placement:
      deterministic.placement ?? fallbackPlacementForDecision(deterministic, payload, session),
    ...(deterministic.action === 'create-ui'
      ? { surfaceKind: inferFallbackSurfaceKind(payload.question) }
      : {}),
  }
}

/** 用结构化组件引用数量校正组件工作流，防止普通 H5 被“页面”字样误导。 */
function reconcileComponentWorkflowDecision(decision, payload) {
  if (!['create-page', 'create-component'].includes(decision.action)) return decision
  const references = Array.isArray(payload.componentReferences)
    ? payload.componentReferences.filter((item) => item?.packId && item?.componentName)
    : []
  if (references.length === 0) {
    return {
      ...decision,
      action: 'create-ui',
      taskKind: 'generic-ui',
      reason: 'runtime-unbound-page-routed-to-generic-ui',
      target: undefined,
      surfaceKind: decision.surfaceKind || inferFallbackSurfaceKind(payload.question),
      designArchetype: decision.designArchetype || '由用户目标推导',
    }
  }
  if (references.length === 1) {
    return {
      ...decision,
      action: 'create-component',
      taskKind: 'component-design',
      reason: 'runtime-single-component-routed-to-component-design',
      target: { componentName: references[0].componentName },
    }
  }
  return {
    ...decision,
    action: 'create-page',
    taskKind: 'page-design',
    reason:
      decision.action === 'create-page'
        ? decision.reason
        : 'runtime-multiple-components-routed-to-page-design',
    target: undefined,
  }
}

/** 将被误判为有限结构修改的“整页重设计”纠正为保留原稿的 Variant 流程。 */
function reconcileSuppliedWorkflowDecision(decision, payload) {
  if (decision.action !== 'revise-ui-structure' || !isFullUiRedesignRequest(payload.question)) {
    return decision
  }
  const targetArtboardId =
    decision.placement?.targetArtboardId || payload.canvasSnapshot?.artboardId
  return {
    ...decision,
    action: 'create-ui',
    taskKind: 'generic-ui',
    reason: 'runtime-full-ui-redesign-variant',
    placement: targetArtboardId
      ? {
          operation: 'variant',
          scope: 'artboard',
          targetArtboardId,
          reason: '整页重新设计生成独立 Variant，保留原画板。',
          confidence: 1,
        }
      : {
          operation: 'create',
          scope: 'document',
          reason: '整页重新设计缺少现有目标，创建新画板。',
          confidence: 1,
        },
  }
}

/**
 * 在工作流开始前向 Renderer 请求目标画板，并把返回的 Lease 记录到 Canvas Transaction。
 * 后续所有 Deliverable 都只能写入这个经过确认的目标。
 */
async function resolveWorkflowCanvasTarget(session, payload, decision, callbacks) {
  const incomingTarget = isCanvasTarget(payload.canvasTarget) ? payload.canvasTarget : undefined
  const previousTarget = isCanvasTarget(session.canvasTarget) ? session.canvasTarget : undefined
  if (decision && typeof callbacks.onCanvasTargetRequest === 'function') {
    const placement = decision.placement
    const operationId = `canvas-operation-${payload.streamId || payload.sessionId}`
    const preferredArtboardId =
      placement.operation === 'resume'
        ? previousTarget?.artboardId
        : placement.targetArtboardId ||
          (placement.scope === 'selection' ? payload.canvasSnapshot?.artboardId : undefined)
    const request = {
      id: `canvas-target-${operationId}`,
      turnId: payload.streamId || `turn-${Date.now()}`,
      sessionId: payload.sessionId,
      projectId: payload.projectId,
      action: decision.action,
      taskKind: decision.taskKind,
      operationId,
      placement,
      preferredArtboardId,
      editScope: payload.editScope,
      baseDocumentRevision:
        payload.canvasContext?.documentRevision ?? payload.canvasSnapshot?.documentRevision ?? 0,
      logicalSize:
        decision.taskKind === 'generic-ui'
          ? genericUiLogicalSize(decision.surfaceKind || 'desktop-admin')
          : { width: 375, initialHeight: 812, autoHeight: true },
    }
    const resolution = await callbacks.onCanvasTargetRequest(request)
    if (resolution?.status !== 'ready' || !isCanvasTarget(resolution.target)) {
      throw createRuntimeError(
        resolution?.errorCode || 'CANVAS_TARGET_MISSING',
        resolution?.reason || '设计任务无法创建或选择目标画板。',
      )
    }
    session.canvasTarget = { ...resolution.target }
    session.canvasTransaction = {
      operationId,
      leaseId: resolution.target.leaseId,
      turnId: request.turnId,
      placement,
      artboardId: resolution.target.artboardId,
      baseDocumentRevision: request.baseDocumentRevision,
      leasedDocumentRevision: resolution.target.documentRevision,
      status: 'reserved',
      updatedAt: new Date().toISOString(),
    }
    return session.canvasTarget
  }
  if (incomingTarget) {
    session.canvasTarget = { ...incomingTarget }
    return session.canvasTarget
  }
  if (decision?.placement?.operation === 'resume' && previousTarget) return previousTarget
  return undefined
}

/** 为离线 Intent Router 补充确定性的创建、修订、素材或恢复放置策略。 */
function fallbackPlacementForDecision(decision, payload, session) {
  const selectionTarget = payload.canvasSnapshot?.artboardId
  const sessionTarget = session.canvasTarget?.artboardId
  if (decision.action === 'continue') {
    return {
      operation: 'resume',
      scope: 'artboard',
      targetArtboardId: sessionTarget,
      reason: 'offline-resume',
      confidence: 1,
    }
  }
  if (decision.action === 'create-assets') {
    return { operation: 'assets', scope: 'asset-board', reason: 'offline-assets', confidence: 1 }
  }
  if (
    decision.action === 'create-artboard' ||
    ['create-page', 'create-ui', 'create-component', 'create-image'].includes(decision.action)
  ) {
    return {
      operation: 'create',
      scope: 'document',
      reason: 'offline-create',
      confidence: decision.confidence,
    }
  }
  return {
    operation: 'revise',
    scope: 'selection',
    targetArtboardId: selectionTarget,
    targetElementIds: decision.targetIds ?? [],
    reason: 'offline-selection-revision',
    confidence: decision.confidence,
  }
}

function isPlacementDecision(value) {
  return Boolean(
    value &&
    ['create', 'insert', 'revise', 'variant', 'assets', 'resume'].includes(value.operation) &&
    ['document', 'artboard', 'selection', 'asset-board'].includes(value.scope) &&
    typeof value.reason === 'string' &&
    Number.isFinite(value.confidence),
  )
}

/**
 * 取消当前领域 Workflow；若尚未进入领域执行器，则继续取消对应 Pi Agent。
 * sessionId 可以是 Renderer 的 threadId 或领域 projectId::threadId，两者都已注册。
 */
export function cancelDesignWorkflow(sessionId) {
  const controller = activeSessions.get(sessionId)
  if (controller) {
    controller.abort(createRuntimeError('AGENT_CANCELLED', '用户已取消当前任务。'))
    return true
  }
  return cancelPiAgent(sessionId)
}

/**
 * 执行 Workflow Graph 主循环：选择 Ready Step、执行 Tool、保存 Checkpoint、
 * 处理动态步骤与画布 ACK，最终提交或失败当前 Canvas Transaction。
 */
async function executePlan(session, payload, callbacks, dependencies, runtimePlugins) {
  const registry = createAgentToolRegistry({
    ...dependencies,
    plugins: runtimePlugins,
    invokeProvider: (providerPayload, providerCallbacks) =>
      dependencies.invokeProvider(
        {
          ...providerPayload,
          question: appendStylePackContract(providerPayload.question, session.activeStylePack),
        },
        providerCallbacks,
      ),
  })
  const memory = await restoreStepMemory(session, payload)
  session.workflowState = {
    iteration: 0,
    maxIterations: Math.min(MAX_ITERATIONS, payload.turnBudget.maxIterations),
  }
  session.status = 'running'
  emit(callbacks, { type: 'plan.updated', sessionId: session.id, steps: session.plan })
  await saveAndEmitSession(session, callbacks)

  let iterations = 0
  const iterationLimit = Math.min(MAX_ITERATIONS, payload.turnBudget.maxIterations)
  try {
    while (iterations < iterationLimit) {
      const readySteps = getReadyWorkflowSteps(session)
      const step = readySteps[0]
      if (!step) break
      assertTurnBudget(payload)
      consumeTurnBudget(payload, 'iteration')
      if (payload.provider === 'codex' && step.tool === 'page.generate-component') {
        step.title = `生成 ${step.input?.componentName ?? '页面'} 组件`
      }
      iterations += 1
      session.workflowState.iteration = iterations
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
          getToolAttempts(step.tool),
        )
        recordDesignEvaluation(session, step, result.data, callbacks)
        if (
          (step.tool === 'page.generate-shell' ||
            result.data?.deliveryKind === 'page-shell' ||
            step.tool === 'page.generate-component') &&
          !result.data?.failed
        ) {
          const canvasObservation =
            step.tool === 'page.generate-shell' || result.data?.deliveryKind === 'page-shell'
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
        if (step.tool.startsWith('canvas.present') || step.tool === 'canvas.commit') {
          const canvasObservation = await deliverPresentation(
            session,
            step,
            result.data,
            callbacks,
            iterations,
          )
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
              if (step.tool === 'canvas.present-ui-section') {
                const sectionIndex = Number(step.input?.blockIndex)
                if (Number.isInteger(sectionIndex)) {
                  session.genericUiFailedSectionIndexes = [
                    ...new Set([...(session.genericUiFailedSectionIndexes ?? []), sectionIndex]),
                  ]
                }
                result.data = {
                  ...result.data,
                  failed: true,
                  canvasFailure: {
                    errorCode: canvasObservation.errorCode,
                    summary: canvasObservation.summary,
                  },
                }
                step.partialSummary = canvasObservation.summary
              } else {
                throw createRuntimeError(
                  canvasObservation.errorCode || 'CANVAS_DELIVERY_FAILED',
                  canvasObservation.summary || '设计结果未写入目标画板。',
                )
              }
            }
          }
        }
        memory.set(step.tool, result)
        memory.set(step.id, result)
        if (result.data?.failed) {
          step.partialFailure = true
        } else {
          delete step.partialFailure
        }
        const planLengthBeforeDynamicChanges = session.plan.length
        const insertedStepCount = insertDynamicSteps(session, step.id, result.nextSteps)
        if (insertedStepCount > 0 || session.plan.length !== planLengthBeforeDynamicChanges) {
          emit(callbacks, { type: 'plan.updated', sessionId: session.id, steps: session.plan })
        }
        const externalizedResult = await externalizeArtifacts(result, session)
        step.outputHash = hashValue(externalizedResult)
        await saveStepCheckpoint(session.id, session.runId, step.id, {
          checkpointVersion: 2,
          inputHash: step.inputHash,
          outputHash: step.outputHash,
          result: externalizedResult,
        })
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
        step.completedAt = new Date().toISOString()
        const observation = {
          id: `observation-${Date.now()}-${iterations}-failed`,
          stepId: step.id,
          tool: step.tool,
          status: 'failed',
          summary: step.error,
          errorCode: typeof error?.code === 'string' ? error.code : 'AGENT_TOOL_FAILED',
          retryable: false,
          createdAt: new Date().toISOString(),
        }
        session.observations = [...session.observations.slice(-49), observation]
        session.status = 'failed'
        if (session.canvasTransaction) {
          session.canvasTransaction.status = 'failed'
          session.canvasTransaction.updatedAt = new Date().toISOString()
        }
        session.lastError = {
          code: typeof error?.code === 'string' ? error.code : 'AGENT_TOOL_FAILED',
          message: step.error,
          stepId: step.id,
        }
        touch(session)
        emit(callbacks, {
          type: 'step.failed',
          sessionId: session.id,
          step: publicStep(step),
          error: step.error,
        })
        emit(callbacks, { type: 'observation.created', sessionId: session.id, observation })
        await saveAgentSession(session)
        emit(callbacks, { type: 'task.failed', sessionId: session.id, error: step.error })
        throw error
      }
    }

    if (session.plan.some((step) => step.status !== 'completed')) {
      throw createRuntimeError('AGENT_LOOP_LIMIT', `Agent 超过 ${iterationLimit} 次循环限制。`)
    }

    const presentation = memory.get('canvas.present')?.data
    const pagePresentation =
      memory.get('canvas.present-page')?.data ??
      (memory.get('canvas.commit')?.data?.deliveryKind === 'page'
        ? memory.get('canvas.commit')?.data
        : undefined)
    const componentPresentation =
      memory.get('canvas.present-component')?.data ??
      (memory.get('canvas.commit')?.data?.deliveryKind === 'component'
        ? memory.get('canvas.commit')?.data
        : undefined)
    const slotPresentation = memory.get('canvas.present-slot')?.data
    const slotBatchPresentation = memory.get('canvas.present-slots')?.data
    const pageShellPresentation = memory.get('canvas.present-page-shell')?.data
    const patchPresentation = memory.get('canvas.present-patch')?.data
    const specPatchPresentation = memory.get('canvas.present-spec-patch')?.data
    const artifact =
      pagePresentation?.pageShellArtifact ??
      pageShellPresentation?.pageShellArtifact ??
      pageShellPresentation?.artifact ??
      slotPresentation?.artifact ??
      slotBatchPresentation?.items?.[0]?.artifact ??
      componentPresentation?.previewArtifact ??
      presentation?.artifact
    const assetArtifacts = componentPresentation
      ? (componentPresentation.artifacts ?? [])
      : memory.get('canvas.present-assets')?.data?.artifacts
    const artifacts = pagePresentation
      ? [
          pagePresentation.pageShellArtifact,
          ...pagePresentation.components.flatMap((component) => [
            component.previewArtifact,
            ...(component.artifacts ?? []),
          ]),
        ].filter(Boolean)
      : pageShellPresentation
        ? [pageShellPresentation.artifact]
        : slotBatchPresentation
          ? slotBatchPresentation.items.map((item) => item.artifact)
          : slotPresentation
            ? [slotPresentation.artifact]
            : componentPresentation
              ? [
                  componentPresentation.previewArtifact,
                  ...(componentPresentation.artifacts ?? []),
                ].filter(Boolean)
              : patchPresentation
                ? Object.values(patchPresentation.imageArtifacts ?? {})
                : (assetArtifacts ?? (artifact ? [artifact] : []))
    session.status = 'completed'
    if (session.canvasTransaction) {
      session.canvasTransaction.status = 'committed'
      session.canvasTransaction.updatedAt = new Date().toISOString()
    }
    if (pagePresentation?.failedComponents?.length && session.pendingTask) {
      session.pendingTask.status = 'failed'
      session.pendingTask.updatedAt = new Date().toISOString()
    } else if (componentPresentation || pagePresentation) {
      delete session.pendingTask
    }
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
    const canvasQualityReport = [...(session.canvasObservations ?? [])]
      .reverse()
      .find((observation) => observation.data?.qualityReport)?.data?.qualityReport
    return {
      text: pagePresentation
        ? pagePresentation.failedComponents?.length
          ? `页面已交付 ${pagePresentation.components.length}/${pagePresentation.components.length + pagePresentation.failedComponents.length} 个组件；生成失败：${pagePresentation.failedComponents.map((item) => item.componentName).join('、')}。点击“继续”只重试失败组件。`
          : `已完成包含 ${pagePresentation.components.length} 个组件实例的完整页面设计。`
        : pageShellPresentation
          ? '已重新生成并替换页面视觉外壳。'
          : slotBatchPresentation
            ? `已批量重新生成并替换 ${slotBatchPresentation.items.length} 个组件素材。`
            : slotPresentation
              ? `已重新生成并替换 ${slotPresentation.editScope.slotId} 素材。`
              : componentPresentation
                ? ['raster-component', 'hybrid-component'].includes(
                    componentPresentation.componentDesign.deliveryMode,
                  )
                  ? componentPresentation.componentDesign.deliveryMode === 'hybrid-component'
                    ? `已完成 ${componentPresentation.componentDesign.componentName} 视觉设计，并写入视觉外壳和可编辑文字、按钮、图片节点。`
                    : `已完成 ${componentPresentation.componentDesign.componentName} 整体组件设计，并作为单张图片写入画布；Runtime 结构已保留为元数据。`
                  : `已完成 ${componentPresentation.componentDesign.componentName} 可编辑组件设计，生成 ${componentPresentation.artifacts.length} 个必要的 Props 叶子素材和 Props Patch。`
                : specPatchPresentation
                  ? `已应用 ${specPatchPresentation.patch.operations.length} 个页面结构修改。`
                  : patchPresentation
                    ? `已应用 ${patchPresentation.patch.operations.length} 个局部修改。`
                    : session.genericUiSchema
                      ? `已生成包含 ${session.genericUiSchema.blocks.length} 个通用 UI 模块的可编辑设计稿。`
                      : artifacts.length > 1
                        ? `已完成计划并生成 ${artifacts.length} 个独立素材。`
                        : '已完成计划并生成设计图。',
      artifact,
      artifacts: assetArtifacts,
      componentDesign: componentPresentation?.componentDesign,
      pageDesign: pagePresentation?.pageDesign,
      pageComponents: pagePresentation?.components,
      pageShellArtifact: pagePresentation?.pageShellArtifact,
      genericUiSchema: session.genericUiSchema,
      visualAssetReport: session.visualAssetReport,
      designSpec: session.designSpec,
      editScope:
        pageShellPresentation?.editScope ??
        slotPresentation?.editScope ??
        (componentPresentation && session.editScope?.type === 'component-instance'
          ? session.editScope
          : undefined),
      blueprint: session.blueprint,
      generationBrief: session.generationBrief,
      designPatch: patchPresentation?.patch,
      designSpecPatch: specPatchPresentation?.patch,
      qualityReview: presentation?.review ?? canvasQualityReport,
      refined: presentation?.refined ?? false,
      canvasDelivered: typeof callbacks.onDeliverable === 'function',
      agent: publicSession(session),
    }
  } catch (error) {
    if (payload.signal?.aborted || error?.code === 'AGENT_CANCELLED') {
      const currentStep = session.plan.find((step) => step.status === 'running')
      if (currentStep) {
        currentStep.status = 'cancelled'
        currentStep.completedAt = new Date().toISOString()
      }
      session.status = 'cancelled'
      if (session.pendingTask) {
        session.pendingTask.status = 'failed'
        session.pendingTask.updatedAt = new Date().toISOString()
      }
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
    if (session.pendingTask) {
      session.pendingTask.status = 'failed'
      session.pendingTask.updatedAt = new Date().toISOString()
      await saveAgentSession(session)
    }
    throw error
  }
}

/**
 * 从持久化 Checkpoint 恢复步骤内存。
 * 输入哈希或依赖输出变化时，从首个失效步骤开始重置所有下游步骤。
 */
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
      const envelope = checkpoint?.checkpointVersion === 2 ? checkpoint : { result: checkpoint }
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

/** 将页面组件中间结果转换为增量 Deliverable，并等待 Renderer 写入 ACK。 */
async function deliverPageComponent(session, step, data, callbacks, iteration) {
  if (typeof callbacks.onDeliverable !== 'function') return undefined
  const deliveryId = stableDeliveryId(session.runId, step.id)
  const pageSection = session.pageBlueprint?.sections?.find(
    (section) => section.id === step.input?.pageSectionId,
  )
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
    },
  })
  const status = ['success', 'failed'].includes(observation?.status) ? observation.status : 'failed'
  return {
    id: `observation-${Date.now()}-${iteration}-canvas`,
    deliveryId,
    stepId: step.id,
    tool: 'canvas.incremental-present-component',
    status,
    summary:
      typeof observation?.summary === 'string'
        ? observation.summary
        : status === 'success'
          ? `${data.componentName} 已增量写入画布。`
          : `${data.componentName} 增量写入画布失败。`,
    errorCode: status === 'failed' ? observation?.errorCode || 'CANVAS_DELIVERY_FAILED' : undefined,
    retryable: status === 'failed',
    data: observation?.data,
    createdAt: new Date().toISOString(),
  }
}

/** 在组件生成前增量交付 Page Shell，并把 Renderer 结果规范化为 Observation。 */
async function deliverPageShell(session, step, data, callbacks, iteration) {
  if (typeof callbacks.onDeliverable !== 'function') return undefined
  const deliveryId = stableDeliveryId(session.runId, step.id)
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

/** 将各类最终展示步骤统一转换为 Canvas Deliverable，并等待 Renderer ACK。 */
async function deliverPresentation(session, step, data, callbacks, iteration) {
  if (typeof callbacks.onDeliverable !== 'function') return undefined
  const id = stableDeliveryId(session.runId, step.id)
  const base = {
    id,
    sessionId: session.id,
    runId: session.runId,
    stepId: step.id,
    target: session.canvasTarget,
  }
  let deliverable
  if (step.tool === 'canvas.present') {
    deliverable = { ...base, kind: 'image', artifacts: data?.artifact ? [data.artifact] : [] }
  } else if (step.tool === 'canvas.present-assets') {
    deliverable = { ...base, kind: 'asset-set', artifacts: data?.artifacts ?? [] }
  } else if (
    step.tool === 'canvas.present-component' ||
    (step.tool === 'canvas.commit' && data?.deliveryKind === 'component')
  ) {
    deliverable = {
      ...base,
      kind: 'component',
      componentDesign: data?.componentDesign,
      artifacts: data?.artifacts ?? [],
      editScope: session.editScope,
    }
  } else if (step.tool === 'canvas.present-slot') {
    deliverable = {
      ...base,
      kind: 'component-slot',
      artifact: data?.artifact,
      editScope: data?.editScope,
    }
  } else if (step.tool === 'canvas.present-slots') {
    deliverable = {
      ...base,
      kind: 'component-slot-batch',
      items: data?.items ?? [],
      editScope: data?.editScope,
    }
  } else if (step.tool === 'canvas.present-page-shell') {
    deliverable = {
      ...base,
      kind: 'page-shell-edit',
      artifact: data?.artifact,
      editScope: data?.editScope,
    }
  } else if (
    step.tool === 'canvas.present-page' ||
    (step.tool === 'canvas.commit' && data?.deliveryKind === 'page')
  ) {
    deliverable = {
      ...base,
      kind: 'page-finalize',
      blueprint: data?.pageDesign?.blueprint,
      expectedComponentCount: data?.components?.length ?? 0,
      expectedPageSectionIds:
        data?.successfulPageSectionIds ??
        data?.components?.map((component) => component.pageSectionId).filter(Boolean) ??
        [],
    }
  } else if (step.tool === 'canvas.present-ui-section') {
    deliverable = {
      ...base,
      kind: 'generic-ui-section',
      uiSchema: data?.uiSchema,
      section: data?.section,
      deliveredBlockIds: data?.deliveredBlockIds ?? [],
    }
  } else if (step.tool === 'canvas.present-ui') {
    deliverable = data?.sceneGraph
      ? {
          ...base,
          kind: 'generic-ui-runtime',
          sceneGraph: data.sceneGraph,
          runtimeDraft: summarizeRuntimeDraft(data.runtimeDraft),
          expectedNodeCount: data.expectedNodeCount ?? data.sceneGraph.nodes?.length ?? 0,
          visualAssetReport: data.visualAssetReport,
        }
      : {
          ...base,
          kind: 'generic-ui-finalize',
          uiSchema: data?.uiSchema,
          expectedBlockIds: data?.expectedBlockIds ?? [],
          failedSectionIndexes: data?.failedSectionIndexes ?? [],
        }
  } else if (step.tool === 'canvas.commit' && data?.deliveryKind === 'generic-ui') {
    deliverable = data?.sceneGraph
      ? {
          ...base,
          kind: 'generic-ui-runtime',
          sceneGraph: data.sceneGraph,
          runtimeDraft: summarizeRuntimeDraft(data.runtimeDraft),
          expectedNodeCount: data.expectedNodeCount ?? data.sceneGraph.nodes?.length ?? 0,
          visualAssetReport: data.visualAssetReport,
        }
      : {
          ...base,
          kind: 'generic-ui-finalize',
          uiSchema: data?.uiSchema,
          expectedBlockIds: data?.expectedBlockIds ?? [],
          failedSectionIndexes: data?.failedSectionIndexes ?? [],
        }
  } else if (step.tool === 'canvas.present-patch') {
    deliverable = {
      ...base,
      kind: 'design-patch',
      patch: data?.patch,
      imageArtifacts: data?.imageArtifacts ?? {},
    }
  } else if (step.tool === 'canvas.present-spec-patch') {
    deliverable = {
      ...base,
      kind: 'design-spec-patch',
      patch: data?.patch,
      baseDesignSpec: data?.baseDesignSpec,
      nextDesignSpec: data?.nextDesignSpec,
    }
  } else {
    return undefined
  }
  const observation = await callbacks.onDeliverable(deliverable)
  return normalizeCanvasObservation({
    observation,
    deliveryId: id,
    step,
    iteration,
    tool: step.tool,
    successSummary: '设计结果已写入目标画板。',
    failureSummary: '设计结果写入目标画板失败。',
  })
}

function summarizeRuntimeDraft(draft) {
  if (!draft || typeof draft !== 'object') return undefined
  return {
    version: 1,
    title: String(draft.title || 'Runtime UI'),
    viewport: {
      width: Number(draft.viewport?.width) || 1440,
      height: Number(draft.viewport?.height) || 960,
    },
  }
}

function stableDeliveryId(runId, stepId) {
  return `deliverable-${hashValue({ runId, stepId }).slice(0, 24)}`
}

/**
 * 将成功写入画布的 ACK 合并回轻量 CanvasSnapshot，
 * 让后续步骤看到最新 Revision 和节点摘要，而不传递完整 DesignDocument。
 */
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
  const incomingElements =
    Array.isArray(data.elements) && data.elements.length
      ? data.elements.slice(0, 80)
      : writtenElement
        ? [writtenElement]
        : []
  const incomingIds = new Set(incomingElements.map((element) => element.id))
  const retainedElements = data.replacedArtboard ? [] : previousElements
  const elements = incomingElements.length
    ? [
        ...retainedElements.filter(
          (element) =>
            !incomingIds.has(element.id) &&
            !(data.pageSectionId && element.pageSectionId === data.pageSectionId) &&
            !(data.shellElementId && element.designRole === 'page-shell'),
        ),
        ...incomingElements,
      ].slice(-80)
    : previousElements
  session.canvasSnapshot = {
    ...(session.canvasSnapshot ?? {}),
    artboardId: data.artboardId ?? session.canvasTarget?.artboardId,
    width: data.artboardWidth ?? session.canvasTarget?.width,
    height: data.artboardHeight ?? session.canvasTarget?.height,
    elementCount: data.elementCount ?? session.canvasSnapshot?.elementCount,
    documentRevision: Number.isInteger(data.documentRevision)
      ? data.documentRevision
      : session.canvasSnapshot?.documentRevision,
    componentCount:
      data.componentCount ??
      (observation.tool === 'canvas.incremental-present-component'
        ? (session.canvasSnapshot?.componentCount ?? 0) + 1
        : session.canvasSnapshot?.componentCount),
    hasPageShell: data.hasPageShell ?? session.canvasSnapshot?.hasPageShell ?? false,
    designSpec: data.replacedArtboard
      ? undefined
      : (data.designSpec ?? session.canvasSnapshot?.designSpec),
    elements,
    truncated: session.canvasSnapshot?.truncated === true,
    lastWrite: {
      tool: observation.tool,
      status: observation.status,
      rootElementId: data.rootElementId,
      shellElementId: data.shellElementId,
      instanceId: data.instanceId,
      pageSectionId: data.pageSectionId,
      affectedBlockIds: data.affectedBlockIds,
    },
  }
}

/** 把 Renderer 的写入结果转换为可持久化、可展示的统一 Canvas Observation。 */
function normalizeCanvasObservation({
  observation,
  deliveryId,
  step,
  iteration,
  tool,
  successSummary,
  failureSummary,
}) {
  const status = ['success', 'failed'].includes(observation?.status) ? observation.status : 'failed'
  return {
    id: `observation-${Date.now()}-${iteration}-canvas`,
    deliveryId,
    stepId: step.id,
    tool,
    status,
    summary:
      typeof observation?.summary === 'string'
        ? observation.summary
        : status === 'success'
          ? successSummary
          : failureSummary,
    errorCode: status === 'failed' ? observation?.errorCode || 'CANVAS_DELIVERY_FAILED' : undefined,
    retryable: status === 'failed',
    data: observation?.data,
    createdAt: new Date().toISOString(),
  }
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

/** 记录质量评估摘要，并发出独立事件供执行时间线展示。 */
function recordDesignEvaluation(session, step, data, callbacks) {
  const report = data?.qualityReview ?? data?.componentDesign?.qualityReview
  if (report?.evalVersion !== 1 || !report.dimensions) return
  const evaluation = {
    id: `design-eval-${Date.now()}-${step.id}`,
    stepId: step.id,
    scope:
      session.taskKind === 'page-design' || step.tool.startsWith('page.') ? 'page' : 'component',
    passed: report.passed,
    overall: report.overall,
    dimensions: report.dimensions,
    issueCodes: (report.issues ?? []).map((issue) => issue.code).slice(0, 20),
    repairTargets: (report.repairPlan ?? [])
      .map((item) => ({
        kind: item.kind,
        targetId: item.targetId,
        automatic: item.automatic,
      }))
      .slice(0, 10),
    createdAt: new Date().toISOString(),
  }
  session.designEvaluations = [...(session.designEvaluations ?? []).slice(-19), evaluation]
  emit(callbacks, { type: 'design.eval.completed', sessionId: session.id, evaluation })
}

/** 应用 Tool 返回的局部 Repair 决策，并精确失效需要重跑的步骤。 */
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

/**
 * 计算步骤缓存键。目标、选区、风格、参考图、模型和上游输出任一变化都会使缓存失效。
 */
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
    stylePack: session.activeStylePack,
    visualBrief: session.visualBrief,
    visualAssetPlan: session.visualAssetPlan,
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

function appendStylePackContract(question, stylePack) {
  if (!stylePack) return question
  return [
    question,
    '当前任务选择了以下 Style Pack。没有 KV/视觉参考时必须执行；存在本轮 KV/视觉参考时，KV 的品牌、主色和图形语言优先，Style Pack 只补充未指定的排版、间距和表面规则。',
    JSON.stringify(stylePack),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

/** 把 Tool 动态生成的页面组件或 Repair 步骤插入当前计划，并保证步骤 ID 幂等。 */
function insertDynamicSteps(session, afterStepId, nextSteps) {
  if (!Array.isArray(nextSteps) || !nextSteps.length) return 0
  const existingIds = new Set(session.plan.map((step) => step.id))
  const additions = nextSteps
    .filter(
      (step) =>
        step &&
        typeof step.id === 'string' &&
        typeof step.title === 'string' &&
        typeof step.tool === 'string' &&
        !existingIds.has(step.id),
    )
    .map((step) => ({
      id: step.id,
      title: step.title,
      tool: step.tool,
      status: 'pending',
      input: step.input,
    }))
  if (!additions.length) return 0
  const index = session.plan.findIndex((step) => step.id === afterStepId)
  session.plan.splice(index + 1, 0, ...additions)
  return additions.length
}

/** 将大体积 Raster/SVG 从 Checkpoint 外置到 Artifact Repository，只保留引用。 */
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
      analysis: value.analysis,
    })
    return { __artifactRef: metadata.id }
  }
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [
      key,
      await externalizeArtifacts(item, session),
    ]),
  )
  return Object.fromEntries(entries)
}

/** 读取 Artifact 引用并还原为 Tool 可继续消费的完整结果。 */
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
      ...(artifact.analysis ? { analysis: artifact.analysis } : {}),
    }
  }
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await hydrateArtifacts(item)]),
  )
  return Object.fromEntries(entries)
}

/**
 * 在预算、取消和超时约束下执行领域 Tool；仅对可重试错误执行有限次数重试。
 */
async function executeToolWithRetry(
  registry,
  step,
  context,
  callbacks,
  sessionId,
  maxAttempts = MAX_TOOL_ATTEMPTS,
) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let cancelAttempt
    try {
      consumeTurnBudget(context.payload, 'tool')
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
      if (error?.details?.retryable === false) break
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

/**
 * 按 Tool 实际工作量分配超时。批量生图 Tool 内部已有 per-request 超时和重试，
 * 外层预算必须覆盖串行累计耗时，否则整个 Tool 会被重试、已生成的图片重复付费。
 */
function getToolTimeout(toolName) {
  const configured = Number(process.env.AGENT_TOOL_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured > 0) return configured
  return BATCH_IMAGE_TOOLS.has(toolName) ? BATCH_IMAGE_TOOL_TIMEOUT_MS : DEFAULT_TOOL_TIMEOUT_MS
}

function getToolAttempts(toolName) {
  // Source Adapter stages are composite transactions. Retrying the whole stage
  // repeats internal tools and already completed provider requests.
  return [
    'source.inspect',
    'source.to-scene',
    'source.confirm',
    'design.transform',
    'canvas.commit',
  ].includes(toolName)
    ? 1
    : MAX_TOOL_ATTEMPTS
}

/** 为一次 Tool 调用建立超时边界，并通过 AbortController 终止底层任务。 */
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

/** 原子保存领域 Session，并向 Renderer 投影公开状态。 */
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
    activeStylePack: session.activeStylePack,
    canvasTarget: session.canvasTarget,
    canvasTransaction: session.canvasTransaction,
    editScope: session.editScope,
    componentContext: session.componentContext,
    blueprint: session.blueprint,
    generationBrief: session.generationBrief,
    designSpec: session.designSpec,
    lastWorkflowTrigger: session.lastWorkflowTrigger,
    workflowState: session.workflowState,
    designEvaluations: (session.designEvaluations ?? []).slice(-20),
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
    documentRevision: Number.isInteger(value.documentRevision) ? value.documentRevision : 0,
    selectedElementIds: Array.isArray(value.selectedElementIds)
      ? value.selectedElementIds.filter((id) => typeof id === 'string').slice(0, 50)
      : [],
    elements: Array.isArray(value.elements)
      ? value.elements.filter((element) => element && typeof element.id === 'string').slice(0, 80)
      : [],
    designSpec:
      value.designSpec && typeof value.designSpec === 'object' ? value.designSpec : undefined,
    truncated: value.truncated === true,
  }
}

function isDesignEditScope(value) {
  if (
    !value ||
    typeof value.scopeId !== 'string' ||
    !value.scopeId.trim() ||
    typeof value.artboardId !== 'string' ||
    !value.artboardId.trim() ||
    !Number.isInteger(value.documentRevision) ||
    typeof value.targetHash !== 'string' ||
    !value.targetHash.trim() ||
    !Array.isArray(value.targetElementIds) ||
    !value.targetElementIds.length
  )
    return false
  if (value.type === 'multi-node') {
    return Boolean(
      Array.isArray(value.elementIds) &&
      value.elementIds.length > 1 &&
      value.elementIds.every((id) => typeof id === 'string' && id.trim()),
    )
  }
  if (value.type === 'component-region-batch') {
    return Boolean(
      Array.isArray(value.elementIds) &&
      value.elementIds.length > 0 &&
      Array.isArray(value.targets) &&
      value.targets.length === value.elementIds.length &&
      value.targets.every(
        (target) =>
          target?.type === 'component-region' &&
          typeof target.elementId === 'string' &&
          typeof target.slotId === 'string' &&
          target.slotId.trim() &&
          typeof target.propPath === 'string' &&
          target.propPath.trim(),
      ),
    )
  }
  if (typeof value.elementId !== 'string' || !value.elementId.trim()) return false
  if (value.type === 'page-shell') {
    return true
  }
  if (value.type === 'generic-node') {
    return true
  }
  if (value.type === 'design-block') {
    return Boolean(
      typeof value.blockId === 'string' &&
      value.blockId.trim() &&
      Array.isArray(value.imageElementIds),
    )
  }
  if (value.type === 'text-range') {
    return Boolean(
      value.elementType === 'text' &&
      Number.isInteger(value.start) &&
      Number.isInteger(value.end) &&
      value.start >= 0 &&
      value.end > value.start &&
      typeof value.selectedText === 'string' &&
      value.selectedText.length === value.end - value.start,
    )
  }
  if (value.type === 'image-region') {
    return Boolean(
      value.elementType === 'image' &&
      value.normalizedRect &&
      [
        value.normalizedRect.x,
        value.normalizedRect.y,
        value.normalizedRect.width,
        value.normalizedRect.height,
      ].every(Number.isFinite) &&
      typeof value.currentImage === 'string' &&
      value.currentImage.startsWith('data:image/') &&
      typeof value.maskImage === 'string' &&
      value.maskImage.startsWith('data:image/png'),
    )
  }
  if (value.type === 'component-instance') {
    return Boolean(
      typeof value.instanceId === 'string' &&
      value.instanceId.trim() &&
      typeof value.componentName === 'string' &&
      value.componentName.trim(),
    )
  }
  return Boolean(
    value.type === 'component-region' &&
    typeof value.slotId === 'string' &&
    value.slotId.trim() &&
    typeof value.propPath === 'string' &&
    value.propPath.trim(),
  )
}

function publicStep(step) {
  return {
    id: step.id,
    title: step.title,
    tool: step.tool,
    status: step.status,
    error: step.error,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    inputHash: step.inputHash,
    outputHash: step.outputHash,
    partialFailure: step.partialFailure === true,
    partialSummary: step.partialSummary,
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
