const DEFAULTS = Object.freeze({
  maxWallTimeMs: 15 * 60 * 1000,
  maxIterations: 32,
  maxToolAttempts: 48,
  maxModelRequests: 40,
  // 单个组件最多 15 个素材任务（见 agent-tools.mjs component.plan-assets），
  // 每个任务最多重试 2 次，再为页面外壳和后续修订留余量。
  // 这个值必须大于素材任务上限，否则会在跑到一半时抛非重试性的预算错误。
  maxImageRequests: 36,
})

export function createTurnBudget(overrides = {}) {
  const limits = Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, value]) => {
      const candidate = Number(overrides[key])
      return [key, Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : value]
    }),
  )
  return {
    ...limits,
    startedAt: Date.now(),
    iterations: 0,
    toolAttempts: 0,
    modelRequests: 0,
    imageRequests: 0,
  }
}

export function ensureTurnBudget(payload, overrides = {}) {
  if (payload && payload.turnBudget && typeof payload.turnBudget === 'object')
    return payload.turnBudget
  const budget = createTurnBudget({
    ...overrides,
    ...(payload?.budget && typeof payload.budget === 'object' ? payload.budget : {}),
  })
  if (payload && typeof payload === 'object') payload.turnBudget = budget
  return budget
}

export function consumeTurnBudget(payload, kind, amount = 1) {
  const budget = ensureTurnBudget(payload)
  if (Date.now() - budget.startedAt > budget.maxWallTimeMs) {
    throw budgetError(
      'TURN_TIME_BUDGET_EXCEEDED',
      '本轮设计任务超过最大执行时间，已保留已完成结果。',
    )
  }
  const field =
    kind === 'image'
      ? 'imageRequests'
      : kind === 'model'
        ? 'modelRequests'
        : kind === 'tool'
          ? 'toolAttempts'
          : 'iterations'
  budget[field] += Math.max(1, Number(amount) || 1)
  const limit = budget[`max${field[0].toUpperCase()}${field.slice(1)}`]
  if (budget[field] > limit) {
    throw budgetError(
      'TURN_BUDGET_EXCEEDED',
      `本轮设计任务超过${budgetLabel(kind)}预算，已保留已完成结果。`,
      {
        kind,
        used: budget[field],
        limit,
      },
    )
  }
  return budget
}

export function assertTurnBudget(payload) {
  const budget = ensureTurnBudget(payload)
  if (Date.now() - budget.startedAt > budget.maxWallTimeMs) {
    throw budgetError(
      'TURN_TIME_BUDGET_EXCEEDED',
      '本轮设计任务超过最大执行时间，已保留已完成结果。',
    )
  }
  return budget
}

function budgetLabel(kind) {
  return (
    { image: '生图请求', model: '模型请求', tool: '工具重试', iteration: '执行步骤' }[kind] ||
    '执行'
  )
}

function budgetError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = { ...details, retryable: false }
  return error
}

export { DEFAULTS as TURN_BUDGET_DEFAULTS }
