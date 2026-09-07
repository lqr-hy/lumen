const DEFAULT_THRESHOLDS = Object.freeze({
  themeAlignment: 0.75,
  layoutCompleteness: 0.9,
  componentIntegrity: 0.9,
  editableCoverage: 0.8,
  readability: 0.85,
})

const WEIGHTS = Object.freeze({
  themeAlignment: 0.25,
  layoutCompleteness: 0.25,
  componentIntegrity: 0.2,
  editableCoverage: 0.2,
  readability: 0.1,
})

export const MAX_GATE_REPAIR_ATTEMPTS = 2

export function createDesignEvalReport({
  scope,
  scores,
  issues = [],
  repairCount = 0,
  deliveryStatus,
  editableCoverage,
  targetIds = [],
  thresholds = DEFAULT_THRESHOLDS,
}) {
  const dimensions = {
    themeAlignment: score(scores.theme),
    layoutCompleteness: score(average([scores.structure, scores.completeness])),
    componentIntegrity: score(
      scores.componentIntegrity ?? average([scores.structure, scores.completeness]),
    ),
    editableCoverage: score(editableCoverage ?? scores.developmentReadiness),
    readability: score(scores.readability),
  }
  const normalizedThresholds = Object.fromEntries(
    Object.keys(DEFAULT_THRESHOLDS).map((key) => [
      key,
      score(thresholds[key] ?? DEFAULT_THRESHOLDS[key]),
    ]),
  )
  const evalIssues = [...issues]
  for (const [dimension, value] of Object.entries(dimensions)) {
    const threshold = normalizedThresholds[dimension]
    if (value >= threshold || hasMetricIssue(evalIssues, dimension)) continue
    evalIssues.push(createDimensionIssue(scope, dimension, value, threshold))
  }
  const overall = score(
    Object.entries(WEIGHTS).reduce((total, [key, weight]) => total + dimensions[key] * weight, 0),
  )
  const repairPlan = dedupeRepairPlan(evalIssues.map((issue) => classifyRepair(issue, scope)))
  return {
    version: 1,
    evalVersion: 1,
    scope: normalizeGateScope(scope),
    legacyScope: scope,
    passed: !evalIssues.some((issue) => issue.severity === 'error'),
    deliveryStatus,
    overall,
    score: overall,
    targetIds: [...new Set(targetIds.filter((id) => typeof id === 'string' && id.trim()))],
    dimensions,
    thresholds: normalizedThresholds,
    scores: {
      structure: score(scores.structure),
      theme: score(scores.theme),
      readability: score(scores.readability),
      completeness: score(scores.completeness),
      developmentReadiness: score(scores.developmentReadiness),
      editableCoverage: dimensions.editableCoverage,
    },
    issues: evalIssues,
    repairPlan,
    repairCount,
  }
}

function normalizeGateScope(scope) {
  if (scope === 'component' || scope === 'runtime' || scope === 'asset' || scope === 'props')
    return 'module'
  if (scope === 'page') return 'artboard'
  if (['operation', 'module', 'artboard', 'document'].includes(scope)) return scope
  return 'document'
}

export function calculateComponentEditableCoverage(blueprint) {
  const regions = Array.isArray(blueprint?.regions) ? blueprint.regions : []
  if (!regions.length) return 0
  const editable = regions.filter((region) => {
    if (['text', 'color', 'runtime'].includes(region.renderMode)) return true
    if (region.renderMode === 'generated-asset') {
      return Boolean(
        region.slotId && Array.isArray(region.propBindings) && region.propBindings.length,
      )
    }
    return false
  }).length
  return editable / regions.length
}

export function calculatePageEditableCoverage(components, hasPageShell = true) {
  const componentScores = (components ?? []).map(
    (component) =>
      component?.componentDesign?.qualityReview?.dimensions?.editableCoverage ??
      component?.componentDesign?.qualityReview?.scores?.editableCoverage ??
      component?.componentDesign?.qualityReview?.scores?.developmentReadiness ??
      0,
  )
  const values = [...componentScores, ...(hasPageShell ? [1] : [])]
  return values.length ? score(average(values)) : 0
}

export function selectAutomaticRepair(report) {
  return report?.repairPlan?.find((item) => item.automatic !== false)
}

function createDimensionIssue(scope, dimension, value, threshold) {
  return {
    code: `${scope.toUpperCase()}_${dimension.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_LOW`,
    severity: 'error',
    scope,
    metric: dimension,
    message: `${dimension} 评分 ${value}，低于交付门槛 ${threshold}。`,
    repairAction: repairActionForDimension(dimension),
  }
}

function classifyRepair(issue, defaultScope) {
  const code = String(issue.code || '')
  const scope = issue.scope || defaultScope
  if (scope === 'runtime' || code.includes('RUNTIME')) {
    return repairItem('runtime', issue, false)
  }
  if (issue.targetId) {
    return repairItem(defaultScope === 'page' ? 'page-component' : 'component-region', issue, true)
  }
  if (/THEME|VISUAL|REFERENCE/.test(code)) {
    return repairItem(defaultScope === 'page' ? 'page-shell' : 'component-shell', issue, true)
  }
  if (/ASSET|COMPLETE|INTEGRITY|EDITABLE/.test(code)) {
    return repairItem(
      defaultScope === 'page' ? 'failed-components' : 'component-assets',
      issue,
      true,
    )
  }
  if (/TEXT|READABILITY/.test(code)) {
    return repairItem(defaultScope === 'page' ? 'page-component' : 'component-region', issue, true)
  }
  return repairItem(defaultScope === 'page' ? 'page-layout' : 'component-layout', issue, true)
}

function repairItem(kind, issue, automatic) {
  return {
    kind,
    targetId: issue.targetId,
    issueCodes: [issue.code],
    reason: issue.message,
    action: issue.repairAction,
    automatic,
  }
}

function dedupeRepairPlan(items) {
  const grouped = new Map()
  for (const item of items) {
    const key = `${item.kind}:${item.targetId || ''}`
    const previous = grouped.get(key)
    if (!previous) {
      grouped.set(key, item)
      continue
    }
    previous.issueCodes.push(...item.issueCodes)
    previous.reason = `${previous.reason}；${item.reason}`
  }
  return Array.from(grouped.values())
}

function hasMetricIssue(issues, dimension) {
  const aliases = {
    themeAlignment: ['theme', 'themeAlignment'],
    layoutCompleteness: ['structure', 'completeness', 'layoutCompleteness'],
    componentIntegrity: ['completeness', 'componentIntegrity'],
    editableCoverage: ['developmentReadiness', 'editableCoverage'],
    readability: ['readability'],
  }
  return issues.some((issue) => aliases[dimension].includes(issue.metric))
}

function repairActionForDimension(dimension) {
  const actions = {
    themeAlignment: '只重新生成偏离 KV 主题的视觉外壳或素材。',
    layoutCompleteness: '修复越界、缺失或重叠的布局节点。',
    componentIntegrity: '只补齐缺失或失败的组件和素材 Slot。',
    editableCoverage: '将常用文字、颜色和图片拆为原生节点或 Props Slot。',
    readability: '调整文字层级、字号、行高和容器尺寸。',
  }
  return actions[dimension]
}

function average(values) {
  const normalized = values.map(Number).filter(Number.isFinite)
  return normalized.length
    ? normalized.reduce((total, value) => total + value, 0) / normalized.length
    : 0
}

function score(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100) / 100
}
