const CONTINUE_PATTERN =
  /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/i
const ADVICE_PATTERN =
  /(?:怎么|如何|怎样|为什么|分析一下|是否|能否|可以吗|怎么办|缺少什么|还缺什么|(?:给|提供|说说|先).{0,8}(?:建议|方案|思路))/i
const REVISION_PATTERN =
  /(?:完善|优化|美化|丰富|改进|修改|调整|重做|重构|重新实现|重新设计|重新生成|再生成|重生成|补齐|补全|替换|改成|改为|换成|换个|删除|移除|移动|上移|下移|放大|缩小|新增|添加)/i
const GENERATION_PATTERN =
  /(?:生成|制作|输出|绘制|渲染|产出|新增|创建|设计).{0,32}(?:图片|设计图|设计稿|视觉稿|效果图|海报|页面|界面|ui|模块|区块|素材|按钮|背景|组件)|(?:图片|设计图|设计稿|页面|界面|ui|组件|素材).{0,24}(?:生成|制作|输出|设计|创建)/i
const PAGE_PATTERN =
  /(?:完整|整张|整个|活动|落地|长图|多组件|组合).{0,16}(?:页面|界面|ui|设计稿|视觉稿)|(?:页面|界面|ui|设计稿|视觉稿).{0,24}(?:完整|整张|整个|活动|落地|长图|多组件|组合|组件)/i
const COMPONENT_PATTERN =
  /(?:组件|component).{0,24}(?:json|设计|素材|props|配置|原型)|(?:componentsjson|component json|valuetypemap)/i
const COMPONENT_FILE_SELECTOR_PATTERN = /[A-Za-z][A-Za-z0-9_.-]*\.json\b/gi
const COMPONENT_NAME_SELECTOR_PATTERN = /\b[A-Z][A-Za-z0-9_-]{2,}\b/g
const COMPONENT_GENERATION_ACTION_PATTERN = /(?:生成|设计|制作|创建|输出)/i
const ASSET_SET_PATTERN =
  /(?:独立|单独|分别|逐个|每个).{0,24}(?:图片|素材|按钮|背景|装饰|元素)|素材槽位|多素材/i
const NEW_ARTBOARD_PATTERN =
  /(?:新建|新增|创建|增加).{0,8}(?:一个|一张|个)?\s*(?:画板|画布|面板)|添加(?:一个|一张|个)\s*(?:画板|画布|面板)|(?:画板|画布|面板).{0,8}(?:新建|新增|创建)/i
const PRESENT_TO_CANVAS_PATTERN =
  /(?:添加|放|放置|插入|应用)(?:到|至|入)(?:当前|这个|现有)?(?:画布|画板)/i
const GENERIC_UI_PATTERN =
  /(?:后台|管理系统|dashboard|工作台|数据看板|订单管理|用户管理|运营平台|管理平台|通用\s*ui|web\s*ui|网页|网站|h5|app|移动端|手机端|桌面端)/i
const GENERIC_PAGE_PATTERN = /(?:页面|界面|ui|用户端|客户端|表单|列表|详情页|首页)/i
const DESIGN_SPEC_STRUCTURE_PATTERN =
  /(?:新增|添加|插入|删除|移除|移动|上移|下移|调整顺序|放到|移到|更新|修改).{0,24}(?:区块|模块|block|侧边栏|导航|页头|筛选|指标|表格|表单|卡片|分页|页脚)|(?:区块|模块|block|侧边栏|导航|页头|筛选|指标|表格|表单|卡片|分页|页脚).{0,24}(?:新增|添加|插入|删除|移除|移动|上移|下移|调整顺序|放到|移到|更新|修改)/i
const FULL_UI_REDESIGN_PATTERN =
  /(?:重新设计|重新实现|重新生成|整体重做|整体重构|整页改版|换一版).{0,32}(?:页面|界面|ui|设计稿|工作台|后台|管理系统|编辑器)|(?:页面|界面|ui|设计稿|工作台|后台|管理系统|编辑器).{0,32}(?:重新设计|重新实现|重新生成|整体重做|整体重构|整页改版|换一版)/i

export function routeAgentIntent(input) {
  const prompt = String(input?.prompt || '').trim()
  const componentReferences = Array.isArray(input?.componentReferences)
    ? input.componentReferences.filter((item) => item?.packId && item?.componentName)
    : []
  const editScope = input?.editScope
  const contextTaskKind = input?.session?.taskKind
  const base = {
    version: 1,
    prompt,
    targetIds: collectTargetIds(editScope),
    source: 'deterministic-fallback',
  }

  if (!prompt)
    return { ...base, action: 'chat', taskKind: 'chat', confidence: 1, reason: 'empty-prompt' }
  if (ADVICE_PATTERN.test(prompt)) {
    return { ...base, action: 'chat', taskKind: 'chat', confidence: 0.92, reason: 'advice-request' }
  }
  if (CONTINUE_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'continue',
      taskKind: contextTaskKind || 'unknown',
      confidence: 0.98,
      reason: 'explicit-continuation',
    }
  }
  if (PRESENT_TO_CANVAS_PATTERN.test(prompt)) {
    const requestedComponent = prompt.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/)?.[0]
    const completedComponent = input?.session?.componentDesign?.componentName
    if (
      completedComponent &&
      (!requestedComponent || completedComponent.toLowerCase() === requestedComponent.toLowerCase())
    ) {
      return {
        ...base,
        action: 'continue',
        taskKind: 'component-design',
        confidence: 0.99,
        reason: 'present-current-session-component',
      }
    }
    if (requestedComponent || COMPONENT_PATTERN.test(prompt)) {
      return {
        ...base,
        action: 'create-component',
        taskKind: 'component-design',
        confidence: 0.97,
        reason: 'generate-component-for-canvas',
      }
    }
  }
  if (NEW_ARTBOARD_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'create-artboard',
      taskKind: 'artboard',
      confidence: 0.99,
      reason: 'explicit-artboard-creation',
    }
  }
  if (isFullUiRedesignRequest(prompt)) {
    return {
      ...base,
      action: 'create-ui',
      taskKind: 'generic-ui',
      confidence: 0.99,
      reason: 'full-ui-redesign',
    }
  }
  if (input?.session?.canvasSnapshot?.designSpec && DESIGN_SPEC_STRUCTURE_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'revise-ui-structure',
      taskKind: 'design-spec-patch',
      confidence: 0.99,
      reason: 'existing-design-spec-structure-revision',
    }
  }
  if (editScope && (REVISION_PATTERN.test(prompt) || GENERATION_PATTERN.test(prompt))) {
    return routeSelectionRevision(base, editScope)
  }
  const componentSelectors = collectComponentSelectors(prompt)
  if (
    componentReferences.length > 1 &&
    GENERATION_PATTERN.test(prompt) &&
    PAGE_PATTERN.test(prompt)
  ) {
    return {
      ...base,
      action: 'create-page',
      taskKind: 'page-design',
      confidence: 1,
      reason: 'structured-component-page',
    }
  }
  if (componentReferences.length === 1 && GENERATION_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'create-component',
      taskKind: 'component-design',
      confidence: 1,
      reason: 'structured-component-reference',
    }
  }
  if (
    GENERATION_PATTERN.test(prompt) &&
    componentSelectors.length > 1 &&
    PAGE_PATTERN.test(prompt)
  ) {
    return {
      ...base,
      action: 'create-page',
      taskKind: 'page-design',
      confidence: 0.98,
      reason: 'explicit-component-page-generation',
    }
  }
  if (
    GENERIC_UI_PATTERN.test(prompt) &&
    (GENERATION_PATTERN.test(prompt) || COMPONENT_GENERATION_ACTION_PATTERN.test(prompt))
  ) {
    return {
      ...base,
      action: 'create-ui',
      taskKind: 'generic-ui',
      confidence: 0.97,
      reason: 'generic-ui-generation',
    }
  }
  if (
    (GENERATION_PATTERN.test(prompt) || isDirectComponentGeneration(prompt, componentSelectors)) &&
    componentSelectors.length
  ) {
    return {
      ...base,
      action: 'create-component',
      taskKind: 'component-design',
      confidence: 0.98,
      reason: 'explicit-component-generation',
    }
  }
  if (
    GENERATION_PATTERN.test(prompt) &&
    (PAGE_PATTERN.test(prompt) || GENERIC_PAGE_PATTERN.test(prompt))
  ) {
    return {
      ...base,
      action: 'create-ui',
      taskKind: 'generic-ui',
      confidence: 0.95,
      reason: 'generic-page-generation',
    }
  }
  if (
    (GENERATION_PATTERN.test(prompt) || isDirectComponentGeneration(prompt, componentSelectors)) &&
    ((COMPONENT_PATTERN.test(prompt) && componentSelectors.length) ||
      (input?.session?.componentRequest && isContextualComponentGeneration(prompt)))
  ) {
    return {
      ...base,
      action: 'create-component',
      taskKind: 'component-design',
      confidence: 0.95,
      reason: 'component-generation',
    }
  }
  if (GENERATION_PATTERN.test(prompt) && ASSET_SET_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'create-assets',
      taskKind: 'asset-set',
      confidence: 0.93,
      reason: 'asset-set-generation',
    }
  }
  if (GENERATION_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'create-image',
      taskKind: 'design-image',
      confidence: 0.86,
      reason: 'image-generation',
    }
  }
  if (REVISION_PATTERN.test(prompt) && contextTaskKind) {
    return {
      ...base,
      action:
        contextTaskKind === 'generic-ui'
          ? 'create-ui'
          : contextTaskKind === 'page-design'
            ? 'revise-page'
            : 'revise-component',
      taskKind: contextTaskKind,
      confidence: 0.72,
      reason: 'contextual-revision',
    }
  }
  return {
    ...base,
    action: 'chat',
    taskKind: 'chat',
    confidence: 0.65,
    reason: 'no-executable-intent',
  }
}

export function isFullUiRedesignRequest(prompt) {
  return FULL_UI_REDESIGN_PATTERN.test(String(prompt || ''))
}

function collectComponentSelectors(prompt) {
  const value = String(prompt || '')
  return [
    ...new Set([
      ...(value.match(COMPONENT_FILE_SELECTOR_PATTERN) ?? []),
      ...(value.match(COMPONENT_NAME_SELECTOR_PATTERN) ?? []),
    ]),
  ]
}

function isDirectComponentGeneration(prompt, selectors) {
  return selectors.length > 0 && COMPONENT_GENERATION_ACTION_PATTERN.test(prompt)
}

function isContextualComponentGeneration(prompt) {
  const value = String(prompt || '').trim()
  return (
    value.length <= 18 &&
    /(?:生成|设计|制作|输出|预览)/i.test(value) &&
    /(?:设计稿|预览|组件|效果)/i.test(value) &&
    !/(?:页面|h5|web|app|后台|海报|kv|图片|素材)/i.test(value)
  )
}

export function validateAgentIntent(intent) {
  const actions = new Set([
    'chat',
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
    'regenerate-slots',
  ])
  return Boolean(
    (intent?.version === 1 || intent?.version === 2) &&
    actions.has(intent.action) &&
    typeof intent.taskKind === 'string' &&
    Number.isFinite(intent.confidence) &&
    intent.confidence >= 0 &&
    intent.confidence <= 1 &&
    (intent.version === 1 ||
      (['create', 'insert', 'revise', 'variant', 'assets', 'resume'].includes(
        intent.placement?.operation,
      ) &&
        ['document', 'artboard', 'selection', 'asset-board'].includes(intent.placement?.scope))),
  )
}

export function inferFallbackSurfaceKind(question, fallback = 'desktop-web') {
  const value = String(question || '')
  if (/(?:移动端|手机|mobile|h5|app)/i.test(value)) return 'mobile'
  if (/(?:后台|管理系统|dashboard|工作台|控制台|管理平台)/i.test(value)) return 'desktop-admin'
  return fallback
}

function collectTargetIds(editScope) {
  if (!editScope) return []
  return [
    ...(Array.isArray(editScope.elementIds) ? editScope.elementIds : []),
    ...(Array.isArray(editScope.targetElementIds) ? editScope.targetElementIds : []),
    editScope.elementId,
    editScope.instanceId,
    editScope.pageSectionId,
    editScope.slotId,
  ].filter((value) => typeof value === 'string' && value.trim())
}

function routeSelectionRevision(base, editScope) {
  if (editScope.type === 'component-region') {
    return {
      ...base,
      action: 'regenerate-slot',
      taskKind: 'component-slot-edit',
      confidence: 1,
      reason: 'selection-component-region',
    }
  }
  if (editScope.type === 'page-shell') {
    return {
      ...base,
      action: 'revise-page-shell',
      taskKind: 'page-shell-edit',
      confidence: 1,
      reason: 'selection-page-shell',
    }
  }
  if (editScope.type === 'component-instance') {
    return {
      ...base,
      action: 'revise-component',
      taskKind: 'component-design',
      confidence: 1,
      reason: 'selection-component-instance',
    }
  }
  if (['generic-node', 'multi-node', 'text-range', 'image-region'].includes(editScope.type)) {
    return {
      ...base,
      action: 'revise-design',
      taskKind: 'design-patch',
      confidence: 1,
      reason: `selection-${editScope.type}`,
    }
  }
  return {
    ...base,
    action: 'chat',
    taskKind: 'chat',
    confidence: 1,
    reason: 'unsupported-selection-scope',
  }
}
