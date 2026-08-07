import { routeAgentIntent, validateAgentIntent } from './intent-router.mjs'

const IMAGE_OUTPUT_PATTERN =
  /(?:生成|制作|输出|绘制|渲染|产出).{0,20}(?:完整|整张|一张)?(?:图片|设计图|设计稿|视觉稿|效果图|海报|页面|界面|ui|模块|区块)|(?:图片|设计图|设计稿|视觉稿|效果图|海报|页面|界面|ui|模块|区块).{0,20}(?:生成|制作|输出|放到|放入|添加到)(?:画布)?|(?:生成|制作|输出|放到|放入|添加).{0,24}(?:到|入)?画布|(?:生成|制作|输出|绘制|渲染|产出|新增|添加).{0,28}(?:素材|按钮|背景图|画板|面板|页面|界面|ui|模块|区块)|(?:素材|按钮|背景图|页面|界面|ui|模块|区块).{0,20}(?:生成|制作|输出|新增|添加|放到|放入)/i
const ASSET_SET_PATTERN =
  /(?:独立|单独|分别|逐个|每个).{0,24}(?:图片|素材|按钮|背景|装饰|元素)|(?:图片|素材|按钮|背景|装饰|元素).{0,24}(?:独立|单独|分别|逐个|拆分|切出|分开)|按钮素材|素材槽位|多素材/i
const COMPONENT_DESIGN_PATTERN =
  /(?:组件|component).{0,20}(?:json|设计|素材|props|配置|原型)|(?:componentsjson|component json|valuetypemap|素材槽位)|\bEra[A-Z][A-Za-z0-9_-]*\b/i
const COMPONENT_SELECTOR_PATTERN =
  /(?:[A-Za-z][A-Za-z0-9_-]*\.json\b|\bEra[A-Z][A-Za-z0-9_-]*\b|componentsJson\/[A-Za-z0-9_.-]+\.json\b)/i
const COMPONENT_ACTION_PATTERN =
  /(?:生成|设计|制作|输出|创建|规划|解析).{0,32}(?:组件|component|\bEra[A-Z][A-Za-z0-9_-]*\b)|(?:组件|component|\bEra[A-Z][A-Za-z0-9_-]*\b).{0,32}(?:生成|设计|制作|输出|创建|配置|预览|素材|props)/i
const DESIGN_REVISION_PATTERN =
  /(?:完善|优化|美化|丰富|改进|修改|调整|重做|重构|重新实现|重新设计|补齐|补全|按.{0,12}(?:建议|方案).{0,8}(?:修改|执行|实现)).{0,36}(?:设计稿|视觉稿|效果图|页面|界面|ui|组件|背景|外壳|整体|当前|这个)|(?:设计稿|视觉稿|效果图|页面|界面|ui|组件|背景|外壳|整体|当前|这个).{0,36}(?:完善|优化|美化|丰富|改进|修改|调整|重做|重构|重新实现|重新设计|补齐|补全)/i
const SHORT_REVISION_PATTERN = /^(?:请)?(?:完善|优化|美化|改进|修改|调整|重做|重构|重新实现|重新设计|补齐|补全|按(?:这个|上述|上面|建议|方案)(?:修改|执行|实现)?)(?:一下)?[吧。！!\s]*$/i
const ADVICE_REQUEST_PATTERN = /(?:怎么|如何|怎样|为什么|分析一下|是否|能否|可以吗|怎么办|缺少什么|还缺什么|(?:给|提供|说说|先).{0,8}(?:建议|方案|思路)|(?:建议|方案|思路).{0,8}(?:是什么|有哪些|怎么))/i
const PAGE_DESIGN_PATTERN = /(?:完整|整张|整个|活动|落地|长图|多组件|组合).{0,12}(?:页面|界面|ui|设计稿|视觉稿)|(?:页面|界面|ui|设计稿|视觉稿).{0,20}(?:完整|整张|整个|活动|落地|长图|多组件|组合|组件)/i

const CONTINUE_PATTERN = /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/i
const REFERENCE_UPDATE_PATTERN = /(?:这|此)(?:张|个)?才是|替换|更新|重新上传|正确的|作为.{0,8}(?:原型|kv)|(?:这是|用这张).{0,8}(?:原型|kv)/i

export function planAgentTurn(session, payload, providedIntent) {
  const prompt = String(payload.question || '').trim()
  rememberComponentRequest(session, prompt, payload.history)
  const referenceUpdate = mergeReferences(session, payload.uploads ?? [], prompt)
  const intent = providedIntent ?? routeAgentIntent({ prompt, session, editScope: payload.editScope })
  if (!validateAgentIntent(intent)) throw new TypeError('Agent Intent 不符合版本 1 协议。')
  session.lastIntent = intent
  if (
    payload.editScope?.type === 'component-instance' &&
    payload.editScope.locked === true &&
    (DESIGN_REVISION_PATTERN.test(prompt) || SHORT_REVISION_PATTERN.test(prompt))
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
    beginRun(session, createComponentSlotEditPlan())
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'component-slot-edit' }
  }
  if (intent.action === 'revise-page-shell') {
    session.goal = prompt
    session.taskKind = 'page-shell-edit'
    session.editScope = { ...payload.editScope }
    session.status = 'ready'
    beginRun(session, createPageShellEditPlan())
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'page-shell-edit' }
  }
  const designRevision = ['revise-page', 'revise-component'].includes(intent.action)
  const explicitGeneration = [
    'create-page', 'create-component', 'create-assets', 'create-image', 'revise-page', 'revise-component',
  ].includes(intent.action)
  const continuation = intent.action === 'continue'
  const correction = referenceUpdate.changed && REFERENCE_UPDATE_PATTERN.test(prompt)

  if (explicitGeneration) {
    session.goal = prompt
    const componentInstanceRevision = designRevision && payload.editScope?.type === 'component-instance'
    if (componentInstanceRevision) {
      session.componentRequest ||= payload.editScope.componentName
      session.editScope = { ...payload.editScope }
    } else {
      delete session.editScope
    }
    session.taskKind = intent.taskKind === 'chat' || intent.taskKind === 'unknown'
      ? (componentInstanceRevision ? 'component-design' : 'design-image')
      : intent.taskKind
    session.status = 'ready'
    beginRun(session, createTaskPlan(session.taskKind))
    clearFailure(session)
    touch(session)
    return { action: 'run', reason: 'explicit-generation' }
  }

  if (continuation) {
    recoverGoalFromHistory(session, payload.history)
    if (isPageDesignRequest(session.goal, session.componentRequest)) {
      session.taskKind = 'page-design'
    }
    if (session.goal && ['ready', 'failed', 'collecting', 'completed', 'cancelled', 'awaiting-confirmation', 'waiting-user'].includes(session.status)) {
      const resumingBlueprintConfirmation = session.status === 'awaiting-confirmation' && session.taskKind === 'page-design'
      if (
        session.componentRequest &&
        session.taskKind !== 'component-slot-edit' &&
        session.taskKind !== 'page-design'
      ) {
        session.taskKind = 'component-design'
      }
      session.status = 'ready'
      resumeRun(session, createTaskPlan(session.taskKind))
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

  const taskReferenceUpdate = referenceUpdate.changed && session.goal && /原型|\bkv\b|主视觉|参考图/i.test(prompt)
  if (correction || taskReferenceUpdate) {
    if (
      session.componentRequest &&
      session.taskKind !== 'component-slot-edit' &&
      session.taskKind !== 'page-design'
    ) {
      session.taskKind = 'component-design'
    }
    session.status = session.goal ? 'ready' : 'collecting'
    if (session.goal) beginRun(session, createTaskPlan(session.taskKind))
    clearFailure(session)
    touch(session)
    return {
      action: 'reply',
      text: session.goal
        ? `${referenceUpdate.summary}，任务已更新并可以继续执行。`
        : `${referenceUpdate.summary}。请继续说明需要完成的设计目标。`,
    }
  }

  touch(session)
  return { action: 'chat' }
}

function resetPageConfirmationSteps(session) {
  const withoutGeneratedComponents = session.plan.filter((step) => ![
    'page.generate-component',
  ].includes(step.tool))
  const confirmationIndex = withoutGeneratedComponents.findIndex((step) => step.tool === 'page.confirm-blueprint')
  session.plan = withoutGeneratedComponents.map((step, index) => index >= confirmationIndex
    ? {
        id: step.id,
        title: step.title,
        tool: step.tool,
        status: 'pending',
        input: step.input,
      }
    : step)
}

export function createImagePlan() {
  return [
    createStep('prepare-references', '准备参考图', 'reference.prepare'),
    createStep('create-blueprint', '规划设计结构', 'design.blueprint'),
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

export function createComponentDesignPlan() {
  return [
    createStep('prepare-references', '准备设计参考', 'reference.prepare'),
    createStep('resolve-component', '解析组件设计契约', 'component.resolve'),
    createStep('create-component-blueprint', '生成组件原型结构', 'component.blueprint'),
    createStep('plan-component-assets', '规划组件素材槽位', 'component.plan-assets'),
    createStep('generate-component-assets', '生成组件独立素材', 'component.generate-assets'),
    createStep('validate-component-assets', '验证组件独立素材', 'component.validate-assets'),
    createStep('compose-component-preview', '合成组件设计预览', 'component.compose'),
    createStep('present-component', '交付组件设计到画布', 'canvas.present-component'),
  ]
}

export function createComponentSlotEditPlan() {
  return [
    createStep('prepare-references', '准备局部设计参考', 'reference.prepare'),
    createStep('regenerate-component-slot', '重新生成组件素材', 'component.regenerate-slot'),
    createStep('validate-component-slot', '验证组件素材', 'component.validate-slot'),
    createStep('present-component-slot', '替换组件素材', 'canvas.present-slot'),
  ]
}

export function createPageShellEditPlan() {
  return [
    createStep('prepare-references', '准备页面视觉参考', 'reference.prepare'),
    createStep('regenerate-page-shell', '重新生成页面视觉外壳', 'page.regenerate-shell'),
    createStep('validate-page-shell', '验证页面视觉外壳', 'page.validate-shell'),
    createStep('present-page-shell', '替换页面视觉外壳', 'canvas.present-page-shell'),
  ]
}

export function createPageDesignPlan() {
  return [
    createStep('prepare-references', '准备页面设计参考', 'reference.prepare'),
    createStep('resolve-page-components', '解析页面组件', 'page.resolve-components'),
    createStep('create-page-blueprint', '规划页面结构', 'page.blueprint'),
    createStep('confirm-page-blueprint', '确认页面结构', 'page.confirm-blueprint'),
    createStep('extract-page-theme', '提取页面 KV 主题', 'page.extract-theme'),
    createStep('generate-page-shell', '生成页面视觉外壳', 'page.generate-shell'),
    createStep('review-page', '审查完整页面', 'page.review'),
    createStep('present-page', '交付完整页面到画布', 'canvas.present-page'),
  ]
}

function createTaskPlan(taskKind) {
  if (taskKind === 'page-shell-edit') return createPageShellEditPlan()
  if (taskKind === 'component-slot-edit') return createComponentSlotEditPlan()
  if (taskKind === 'page-design') return createPageDesignPlan()
  if (taskKind === 'component-design') return createComponentDesignPlan()
  return taskKind === 'asset-set' ? createAssetSetPlan() : createImagePlan()
}

function isPageDesignRequest(prompt, componentRequest) {
  const value = `${prompt}\n${componentRequest || ''}`
  return PAGE_DESIGN_PATTERN.test(value) && COMPONENT_SELECTOR_PATTERN.test(value)
}

function isComponentSlotEdit(editScope, prompt) {
  return Boolean(
    editScope?.type === 'component-region' &&
    typeof editScope.elementId === 'string' &&
    typeof editScope.slotId === 'string' &&
    typeof editScope.propPath === 'string' &&
    /重新|再生成|重做|替换|改成|改为|调整|换成|换个|风格|颜色|素材|按钮|图标|背景/i.test(prompt),
  )
}

function isExecutableDesignRevision(session, editScope, prompt) {
  if (
    ADVICE_REQUEST_PATTERN.test(prompt) ||
    (!DESIGN_REVISION_PATTERN.test(prompt) && !SHORT_REVISION_PATTERN.test(prompt))
  ) return false
  return Boolean(
    session.goal ||
    session.componentRequest ||
    editScope?.type === 'component-instance',
  )
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
  session.plan = session.plan.map((step) => (
    step.status === 'failed' || step.status === 'running' || step.status === 'cancelled' || step.partialFailure
      ? { ...step, status: 'pending', error: undefined, partialFailure: undefined, outputHash: undefined }
      : step
  ))
  if (session.taskKind === 'page-design') session.confirmedPageRunId = session.runId
}

function mergeReferences(session, uploads, prompt) {
  let changed = false
  const updatedRoles = []
  const candidates = []
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index]
    if (typeof upload?.data !== 'string' || !upload.data.startsWith('data:image/')) continue
    const name = String(upload.name || `参考图 ${index + 1}`)
    let role = inferUploadRole(name, String(upload.context || ''), prompt)
    // 设计任务中未标注名称的用户图片默认作为 KV，避免随机文件名被误判为无主题参考。
    if (role === 'unknown' && isVisualDesignPrompt(prompt)) role = 'kv'
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
      session.references = session.references.filter((reference) => reference.role !== candidate.role)
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

function isVisualDesignPrompt(prompt) {
  return /(?:生成|设计|制作|输出|绘制|完善|优化).{0,40}(?:页面|界面|ui|设计稿|视觉稿|组件|素材|图片)|(?:页面|界面|ui|设计稿|视觉稿|组件|素材|图片).{0,40}(?:生成|设计|制作|输出)/i.test(prompt)
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

function recoverGoalFromHistory(session, history = []) {
  if (session.goal) return
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (
      item?.role === 'user' &&
      (
        IMAGE_OUTPUT_PATTERN.test(String(item.text || '')) ||
        COMPONENT_ACTION_PATTERN.test(String(item.text || ''))
      )
    ) {
      session.goal = String(item.text).trim()
      session.taskKind = isPageDesignRequest(session.goal, session.componentRequest)
        ? 'page-design'
        : COMPONENT_DESIGN_PATTERN.test(session.goal) || session.componentRequest
        ? 'component-design'
        : ASSET_SET_PATTERN.test(session.goal)
          ? 'asset-set'
          : 'design-image'
      session.status = 'ready'
      return
    }
  }
}

function rememberComponentRequest(session, prompt, history = []) {
  if (COMPONENT_SELECTOR_PATTERN.test(prompt)) {
    session.componentRequest = prompt
    return
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    const text = String(item?.text || '').trim()
    if (item?.role === 'user' && COMPONENT_SELECTOR_PATTERN.test(text)) {
      session.componentRequest = text
      return
    }
  }
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
