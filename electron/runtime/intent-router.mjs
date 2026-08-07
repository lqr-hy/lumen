const CONTINUE_PATTERN = /^(?:请)?(?:继续|开始|执行|接着做|继续执行|开始生成|生成吧|就这样|允许|确认|确认执行|重试|再试一次)[吧。！!\s]*$/i
const ADVICE_PATTERN = /(?:怎么|如何|怎样|为什么|分析一下|是否|能否|可以吗|怎么办|缺少什么|还缺什么|(?:给|提供|说说|先).{0,8}(?:建议|方案|思路))/i
const REVISION_PATTERN = /(?:完善|优化|美化|丰富|改进|修改|调整|重做|重构|重新实现|重新设计|重新生成|再生成|重生成|补齐|补全|替换|改成|改为|换成|换个)/i
const GENERATION_PATTERN = /(?:生成|制作|输出|绘制|渲染|产出|新增|创建|设计).{0,32}(?:图片|设计图|设计稿|视觉稿|效果图|海报|页面|界面|ui|模块|区块|素材|按钮|背景|组件)|(?:图片|设计图|设计稿|页面|界面|ui|组件|素材).{0,24}(?:生成|制作|输出|设计|创建)/i
const PAGE_PATTERN = /(?:完整|整张|整个|活动|落地|长图|多组件|组合).{0,16}(?:页面|界面|ui|设计稿|视觉稿)|(?:页面|界面|ui|设计稿|视觉稿).{0,24}(?:完整|整张|整个|活动|落地|长图|多组件|组合|组件)/i
const COMPONENT_PATTERN = /(?:组件|component).{0,24}(?:json|设计|素材|props|配置|原型)|(?:componentsjson|component json|valuetypemap)|\bEra[A-Z][A-Za-z0-9_-]*\b/i
const DIRECT_COMPONENT_GENERATION_PATTERN = /(?:生成|设计|制作|创建|输出).{0,20}(?:\bEra[A-Z][A-Za-z0-9_-]*\b|[A-Za-z][A-Za-z0-9_-]*\.json\b)|(?:\bEra[A-Z][A-Za-z0-9_-]*\b|[A-Za-z][A-Za-z0-9_-]*\.json\b).{0,20}(?:生成|设计|制作|创建|输出)/i
const ASSET_SET_PATTERN = /(?:独立|单独|分别|逐个|每个).{0,24}(?:图片|素材|按钮|背景|装饰|元素)|素材槽位|多素材/i
const NEW_ARTBOARD_PATTERN = /(?:新建|新增|创建|增加).{0,8}(?:一个|一张|个)?\s*(?:画板|画布|面板)|添加(?:一个|一张|个)\s*(?:画板|画布|面板)|(?:画板|画布|面板).{0,8}(?:新建|新增|创建)/i
const PRESENT_TO_CANVAS_PATTERN = /(?:添加|放|放置|插入|应用)(?:到|至|入)(?:当前|这个|现有)?(?:画布|画板)/i

export function routeAgentIntent(input) {
  const prompt = String(input?.prompt || '').trim()
  const editScope = input?.editScope
  const contextTaskKind = input?.session?.taskKind
  const base = {
    version: 1,
    prompt,
    targetIds: collectTargetIds(editScope),
    source: 'deterministic-fallback',
  }

  if (!prompt) return { ...base, action: 'chat', taskKind: 'chat', confidence: 1, reason: 'empty-prompt' }
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
    const requestedComponent = prompt.match(/\bEra[A-Z][A-Za-z0-9_-]*\b/i)?.[0]
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
    return { ...base, action: 'create-artboard', taskKind: 'artboard', confidence: 0.99, reason: 'explicit-artboard-creation' }
  }
  if (editScope?.type === 'component-region' && REVISION_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'regenerate-slot',
      taskKind: 'component-slot-edit',
      confidence: 0.99,
      reason: 'selected-component-region',
    }
  }
  if (editScope?.type === 'page-shell' && REVISION_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'revise-page-shell',
      taskKind: 'page-shell-edit',
      confidence: 0.99,
      reason: 'selected-page-shell',
    }
  }
  if (editScope?.type === 'component-instance' && REVISION_PATTERN.test(prompt)) {
    return {
      ...base,
      action: 'revise-component',
      taskKind: 'component-design',
      confidence: 0.98,
      reason: 'selected-component-instance',
    }
  }
  if (GENERATION_PATTERN.test(prompt) && PAGE_PATTERN.test(prompt)) {
    return { ...base, action: 'create-page', taskKind: 'page-design', confidence: 0.94, reason: 'page-generation' }
  }
  if (
    (GENERATION_PATTERN.test(prompt) || DIRECT_COMPONENT_GENERATION_PATTERN.test(prompt)) &&
    (COMPONENT_PATTERN.test(prompt) || input?.session?.componentRequest)
  ) {
    return { ...base, action: 'create-component', taskKind: 'component-design', confidence: 0.95, reason: 'component-generation' }
  }
  if (GENERATION_PATTERN.test(prompt) && ASSET_SET_PATTERN.test(prompt)) {
    return { ...base, action: 'create-assets', taskKind: 'asset-set', confidence: 0.93, reason: 'asset-set-generation' }
  }
  if (GENERATION_PATTERN.test(prompt)) {
    return { ...base, action: 'create-image', taskKind: 'design-image', confidence: 0.86, reason: 'image-generation' }
  }
  if (REVISION_PATTERN.test(prompt) && contextTaskKind) {
    return {
      ...base,
      action: contextTaskKind === 'page-design' ? 'revise-page' : 'revise-component',
      taskKind: contextTaskKind,
      confidence: 0.72,
      reason: 'contextual-revision',
    }
  }
  return { ...base, action: 'chat', taskKind: 'chat', confidence: 0.65, reason: 'no-executable-intent' }
}

export function validateAgentIntent(intent) {
  const actions = new Set([
    'chat', 'continue', 'create-artboard', 'create-page', 'create-component', 'create-assets', 'create-image',
    'revise-page', 'revise-page-shell', 'revise-component', 'regenerate-slot',
  ])
  return Boolean(
    intent?.version === 1 &&
    actions.has(intent.action) &&
    typeof intent.taskKind === 'string' &&
    Number.isFinite(intent.confidence) &&
    intent.confidence >= 0 && intent.confidence <= 1,
  )
}

function collectTargetIds(editScope) {
  if (!editScope) return []
  return [editScope.elementId, editScope.instanceId, editScope.pageSectionId, editScope.slotId]
    .filter((value) => typeof value === 'string' && value.trim())
}
