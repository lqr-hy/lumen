import { routeAgentIntent, validateAgentIntent } from './intent-router.mjs'
import { createRuntimePluginRegistry, requirePluginPlan } from './plugins/plugin-registry.mjs'
import { createDefaultRuntimePlugins } from './plugins/campaign-component-plugin.mjs'

export function planAgentTurn(session, payload, providedIntent, options = {}) {
  const pluginRegistry = createRuntimePluginRegistry(
    options.plugins === undefined ? createDefaultRuntimePlugins() : options.plugins,
  )
  const prompt = String(payload.question || '').trim()
  rememberStructuredComponentReferences(session, payload.componentReferences, prompt)
  const intent =
    providedIntent ?? routeAgentIntent({ prompt, session, editScope: payload.editScope })
  if (!validateAgentIntent(intent)) throw new TypeError('Agent Intent 不符合版本 1 协议。')
  const referenceUpdate = mergeReferences(session, payload.uploads ?? [], prompt, {
    // Any explicit image in the current turn is a new reference set. Do not
    // merge it with a previous turn's KV/prototype/visual references.
    replace:
      Array.isArray(payload.uploads) &&
      payload.uploads.some(
        (upload) => typeof upload?.data === 'string' && upload.data.startsWith('data:image/'),
      ),
    referenceBindings: intent.referenceBindings,
  })
  session.lastIntent = intent
  if (
    payload.editScope?.type === 'component-instance' &&
    payload.editScope.locked === true &&
    ['revise-component', 'regenerate-slot'].includes(intent.action)
  ) {
    touch(session)
    return {
      action: 'reply',
      text: '当前页面模块已锁定。请先在画布右键菜单中解锁，再执行局部修订。',
    }
  }
  if (intent.action === 'create-artboard') {
    touch(session)
    session.taskKind = 'artboard'
    session.status = 'completed'
    return {
      action: 'reply',
      text: '已新增一个 375px H5 画板，当前画板已切换到新画板。',
    }
  }
  if (intent.action === 'regenerate-slot') {
    session.goal = prompt
    session.taskKind = 'component-slot-edit'
    session.editScope = { ...payload.editScope }
    session.status = 'ready'
    beginRun(session, requirePluginPlan(pluginRegistry, 'component-slot-edit'))
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'component-slot-edit' }
  }
  if (intent.action === 'regenerate-slots') {
    if (payload.editScope?.type !== 'component-region-batch') {
      throw new TypeError('regenerate-slots 缺少有效的批量组件素材范围。')
    }
    session.goal = prompt
    session.taskKind = 'component-slot-batch-edit'
    session.editScope = structuredClone(payload.editScope)
    session.status = 'ready'
    beginRun(session, requirePluginPlan(pluginRegistry, 'component-slot-batch-edit'))
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'component-slot-batch-edit' }
  }
  if (intent.action === 'revise-page-shell') {
    session.goal = prompt
    session.taskKind = 'page-shell-edit'
    session.editScope = { ...payload.editScope }
    session.status = 'ready'
    beginRun(session, requirePluginPlan(pluginRegistry, 'page-shell-edit'))
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'page-shell-edit' }
  }
  if (intent.action === 'revise-design') {
    if (
      !['generic-node', 'multi-node', 'text-range', 'image-region'].includes(
        payload.editScope?.type,
      )
    ) {
      throw new TypeError('revise-design 缺少有效的 SelectionScope。')
    }
    session.goal = prompt
    session.taskKind = 'design-patch'
    session.editScope = { ...payload.editScope }
    session.status = 'ready'
    beginRun(session, createDesignPatchPlan())
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'generic-design-patch' }
  }
  if (intent.action === 'revise-ui-structure') {
    session.goal = prompt
    session.taskKind = 'design-spec-patch'
    session.status = 'ready'
    beginRun(session, createDesignSpecPatchPlan())
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'design-spec-structure-patch' }
  }
  const designRevision = ['revise-page', 'revise-component'].includes(intent.action)
  const explicitGeneration = [
    'create-ui',
    'create-page',
    'create-component',
    'create-assets',
    'create-image',
    'revise-page',
    'revise-component',
  ].includes(intent.action)
  const continuation = intent.action === 'continue'

  if (explicitGeneration) {
    session.goal = prompt
    if (
      !['create-page', 'create-component', 'revise-page', 'revise-component'].includes(
        intent.action,
      )
    ) {
      clearComponentTaskContext(session)
    }
    const componentInstanceRevision =
      designRevision && payload.editScope?.type === 'component-instance'
    if (componentInstanceRevision) {
      session.componentRequest ||= payload.editScope.componentName
      session.editScope = { ...payload.editScope }
    } else {
      delete session.editScope
    }
    session.taskKind =
      intent.taskKind === 'chat' || intent.taskKind === 'unknown'
        ? componentInstanceRevision
          ? 'component-design'
          : 'design-image'
        : intent.taskKind
    session.outputKind = intent.outputKind
    session.designArchetype = intent.designArchetype
    session.surfaceKind = intent.surfaceKind
    if (session.taskKind === 'design-image') delete session.blueprint
    if (session.taskKind !== 'generic-ui') delete session.genericUiSchema
    session.status = 'ready'
    if (['component-design', 'page-design'].includes(session.taskKind)) {
      session.pendingTask = createPendingTask(session, session.taskKind, prompt, 'running')
    }
    beginRun(session, createTaskPlan(session.taskKind, pluginRegistry))
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'explicit-generation' }
  }

  if (continuation) {
    if (
      session.pendingTask &&
      ['component-design', 'page-design'].includes(session.pendingTask.kind)
    ) {
      const resumingBlueprintConfirmation =
        session.status === 'awaiting-confirmation' && session.pendingTask.kind === 'page-design'
      session.goal =
        session.pendingTask.goal ||
        `生成 ${session.pendingTask.componentReferences.map((item) => item.componentName).join('、')} 设计稿`
      session.taskKind = session.pendingTask.kind
      session.componentReferences = session.pendingTask.componentReferences.map((item) => ({
        ...item,
      }))
      session.componentRequest = session.componentReferences
        .map((item) => item.componentName)
        .join(' ')
      session.pendingTask = createPendingTask(session, session.taskKind, session.goal, 'running')
      session.status = 'ready'
      resumeRun(session, createTaskPlan(session.taskKind, pluginRegistry))
      if (resumingBlueprintConfirmation) resetPageConfirmationSteps(session)
      clearFailure(session)
      touch(session)
      return { action: 'run', reason: 'resume-pending-task' }
    }
    if (session.taskKind === 'component-design' && session.status === 'completed') {
      touch(session)
      return {
        action: 'reply',
        text: '当前没有等待执行的组件任务，请先通过 @ 选择组件并说明设计目标。',
      }
    }
    if (
      session.goal &&
      [
        'ready',
        'failed',
        'collecting',
        'completed',
        'cancelled',
        'awaiting-confirmation',
        'waiting-user',
      ].includes(session.status)
    ) {
      const resumingBlueprintConfirmation =
        session.status === 'awaiting-confirmation' && session.taskKind === 'page-design'
      session.status = 'ready'
      resumeRun(session, createTaskPlan(session.taskKind, pluginRegistry))
      if (resumingBlueprintConfirmation) resetPageConfirmationSteps(session)
      clearFailure(session)
      touch(session)
      return { action: 'run', reason: 'resume' }
    }
    touch(session)
    return {
      action: 'reply',
      text: '当前没有可以继续执行的任务。请先说明要生成或处理的目标。',
    }
  }

  touch(session)
  return { action: 'chat' }
}

function clearComponentTaskContext(session) {
  delete session.componentReferences
  delete session.componentRequest
  delete session.pendingTask
  delete session.componentDesign
  delete session.pageDesign
  delete session.blueprint
  delete session.confirmedPageRunId
}

function rememberStructuredComponentReferences(session, references, prompt) {
  if (!Array.isArray(references) || !references.length) return
  const normalized = references
    .filter((item) => item?.packId && item?.componentName)
    .map((item) => ({
      packId: String(item.packId),
      componentName: String(item.componentName),
      label: String(item.label || item.componentName),
    }))
  if (!normalized.length) return
  session.componentReferences = normalized
  session.componentRequest = normalized.map((item) => item.componentName).join(' ')
  session.pendingTask = createPendingTask(
    session,
    normalized.length > 1 ? 'page-design' : 'component-design',
    prompt,
    'prepared',
  )
}

function createPendingTask(session, kind, goal, status) {
  const now = new Date().toISOString()
  return {
    id: session.pendingTask?.id || `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    status,
    componentReferences: (session.componentReferences ?? []).map((item) => ({ ...item })),
    goal,
    createdAt: session.pendingTask?.createdAt || now,
    updatedAt: now,
  }
}

function resetPageConfirmationSteps(session) {
  const withoutGeneratedComponents = session.plan.filter(
    (step) => !['page.generate-component'].includes(step.tool),
  )
  const confirmationIndex = withoutGeneratedComponents.findIndex(
    (step) => step.tool === 'source.confirm' || step.tool === 'page.confirm-blueprint',
  )
  if (confirmationIndex < 0) return
  session.plan = withoutGeneratedComponents.map((step, index) =>
    index >= confirmationIndex
      ? {
          id: step.id,
          title: step.title,
          tool: step.tool,
          status: 'pending',
          input: step.input,
        }
      : step,
  )
}

export function createImagePlan() {
  return [
    createStep('prepare-references', '准备参考图', 'reference.prepare'),
    createStep('create-generation-brief', '建立图片生成契约', 'design.brief'),
    createStep('generate-design', '生成设计图', 'design.generate'),
    createStep('review-artifact', '审查设计制品', 'artifact.review'),
    createStep('refine-design', '修正设计制品', 'design.refine'),
    createStep('validate-artifact', '验证最终制品', 'artifact.validate'),
    createStep('present-artifact', '交付图片到画布', 'canvas.present'),
  ]
}

export function createAssetSetPlan() {
  return [
    createStep('prepare-references', '准备参考图', 'reference.prepare'),
    createStep('generate-assets', '分别生成独立素材', 'design.generate-assets'),
    createStep('validate-assets', '逐项验证素材', 'artifact.validate-assets'),
    createStep('present-assets', '交付独立素材到画布', 'canvas.present-assets'),
  ]
}

function createTaskPlan(taskKind, pluginRegistry) {
  if (taskKind === 'design-spec-patch') return createDesignSpecPatchPlan()
  if (taskKind === 'design-patch') return createDesignPatchPlan()
  const pluginPlan = pluginRegistry.resolvePlan(taskKind)
  if (pluginPlan) return pluginPlan
  if (
    [
      'page-shell-edit',
      'component-slot-edit',
      'component-slot-batch-edit',
      'page-design',
      'component-design',
    ].includes(taskKind)
  ) {
    return requirePluginPlan(pluginRegistry, taskKind)
  }
  return taskKind === 'asset-set' ? createAssetSetPlan() : createImagePlan()
}

export function createDesignSpecPatchPlan() {
  return [
    createStep('plan-design-spec-patch', '规划页面结构修改', 'design.spec-patch.plan'),
    createStep('validate-design-spec-patch', '校验页面结构修改', 'design.spec-patch.validate'),
    createStep('present-design-spec-patch', '应用页面结构修改', 'canvas.present-spec-patch'),
  ]
}

export function createDesignPatchPlan() {
  return [
    createStep('plan-design-patch', '规划局部修改', 'design.patch.plan'),
    createStep('validate-design-patch', '校验局部修改', 'design.patch.validate'),
    createStep('present-design-patch', '应用局部修改', 'canvas.present-patch'),
  ]
}

function createStep(id, title, tool) {
  return { id, title, tool, status: 'pending' }
}

function beginRun(session, plan) {
  session.runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`
  session.plan = plan
}

function resumeRun(session, expectedPlan) {
  const currentTools = session.plan
    ?.filter((step) => step.tool !== 'page.generate-component' && step.transient !== true)
    .map((step) => step.tool)
    .join('|')
  const expectedTools = expectedPlan.map((step) => step.tool).join('|')
  if (!session.runId || currentTools !== expectedTools) {
    beginRun(session, expectedPlan)
    return
  }
  session.plan = session.plan.map((step) =>
    step.status === 'failed' ||
    step.status === 'running' ||
    step.status === 'cancelled' ||
    step.partialFailure
      ? {
          ...step,
          status: 'pending',
          error: undefined,
          partialFailure: undefined,
          outputHash: undefined,
        }
      : step,
  )
  if (session.taskKind === 'page-design') session.confirmedPageRunId = session.runId
}

function mergeReferences(session, uploads, prompt, options = {}) {
  let changed = false
  const updatedRoles = []
  const candidates = []
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index]
    if (typeof upload?.data !== 'string' || !upload.data.startsWith('data:image/')) continue
    const name = String(upload.name || `参考图 ${index + 1}`)
    const structuredRole = options.referenceBindings?.find(
      (item) => item?.uploadIndex === index,
    )?.role
    // UI 已明确选择的图片角色随 upload 一起传入；优先级高于根据文件名/提示词推断，
    // 否则用户选了 KV/原型后，进入会话合并时会被丢失。
    const explicitRole = structuredRole || upload.role
    const role = ['kv', 'prototype', 'visual', 'edit-base'].includes(explicitRole)
      ? explicitRole
      : inferUploadRole(name, String(upload.context || ''), prompt)
    const candidate = {
      id: `reference-${Date.now()}-${index}`,
      name,
      role,
      data: upload.data,
      mime: upload.mime || getImageMime(upload.data),
      updatedAt: new Date().toISOString(),
    }
    if (role === 'kv' || role === 'prototype') {
      const previousIndex = candidates.findIndex((item) => item.role === role)
      if (previousIndex >= 0) candidates.splice(previousIndex, 1)
    }
    if (!candidates.some((item) => item.data === candidate.data)) candidates.push(candidate)
  }

  if (options.replace) {
    const nextData = new Set(candidates.map((candidate) => candidate.data))
    if (
      session.references.length !== candidates.length ||
      session.references.some((reference) => !nextData.has(reference.data))
    ) {
      session.references = []
      changed = true
    }
  }

  for (const candidate of candidates) {
    const existing = session.references.find((reference) => reference.data === candidate.data)
    if (existing) {
      if (candidate.role !== 'unknown' && existing.role !== candidate.role) {
        existing.role = candidate.role
        existing.updatedAt = new Date().toISOString()
        changed = true
      }
      continue
    }
    if (candidate.role === 'kv' || candidate.role === 'prototype') {
      session.references = session.references.filter(
        (reference) => reference.role !== candidate.role,
      )
    }
    session.references.push(candidate)
    changed = true
    if (candidate.role !== 'unknown') updatedRoles.push(referenceRoleLabel(candidate.role))
  }
  return {
    changed,
    summary: updatedRoles.length
      ? `已更新${Array.from(new Set(updatedRoles)).join('和')}`
      : '已保存新的参考图',
  }
}

function inferReferenceRole(value) {
  if (/原型图|原型|线框|wireframe|prototype|结构图|灰模/i.test(value)) return 'prototype'
  if (/\bkv\b|主视觉|视觉主图|banner|海报|头图/i.test(value)) return 'kv'
  if (/视觉|风格|素材|参考图/i.test(value)) return 'visual'
  return 'unknown'
}

function inferUploadRole(name, context, prompt) {
  const nameRole = inferReferenceRole(name)
  if (nameRole !== 'unknown') return nameRole

  const localContext = `${getMentionContext(context, name)} ${getMentionContext(prompt, name)}`
  const localRole = inferReferenceRole(localContext)
  if (localRole !== 'unknown') return localRole

  // @ 引用可能使用截断后的显示名，无法只依赖完整文件名定位上下文。
  // 用户明确说“KV/主视觉”时，优先把本次被 @ 的图片标记为 KV。
  if (/(?:\bkv\b|主视觉|视觉主图|视觉参考)/i.test(prompt)) return 'kv'

  const hasPrototype = /原型图|原型|线框|wireframe|prototype|结构图|灰模/i.test(context)
  const hasKv = /\bkv\b|主视觉|视觉主图|banner|海报|头图/i.test(context)
  if (hasPrototype !== hasKv) return hasPrototype ? 'prototype' : 'kv'
  return inferReferenceRole(prompt)
}

function referenceRoleLabel(role) {
  if (role === 'prototype') return '原型图'
  if (role === 'kv') return 'KV'
  return '参考图'
}

function getMentionContext(prompt, name) {
  const baseName = name.replace(/\.[a-z0-9]{1,8}$/i, '')
  const labels = [name, baseName, baseName.slice(0, 18)]
  for (const label of labels) {
    if (!label) continue
    const index = prompt.toLowerCase().indexOf(`@${label.toLowerCase()}`)
    if (index >= 0) return prompt.slice(Math.max(0, index - 80), index + label.length + 80)
  }
  return ''
}

function clearFailure(session) {
  delete session.lastError
  delete session.currentStepId
}

function touch(session) {
  session.updatedAt = new Date().toISOString()
}

function getImageMime(data) {
  return data.match(/^data:([^;]+);/)?.[1] || 'image/png'
}
