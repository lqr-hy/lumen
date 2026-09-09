import assert from 'node:assert/strict'
import {
  assertTurnBudget,
  consumeTurnBudget,
  createTurnBudget,
  TURN_BUDGET_DEFAULTS,
} from '../electron/runtime/pi/turn-budget.mjs'

// 
const MAX_COMPONENT_ASSET_TASKS = 15
assert(
  TURN_BUDGET_DEFAULTS.maxImageRequests >= MAX_COMPONENT_ASSET_TASKS * 2,
  `maxImageRequests(${TURN_BUDGET_DEFAULTS.maxImageRequests}) 必须覆盖 ${MAX_COMPONENT_ASSET_TASKS} 个素材任务的重试`,
)
const imagePayload = { turnBudget: createTurnBudget() }
for (let index = 0; index < MAX_COMPONENT_ASSET_TASKS; index += 1) {
  assert.doesNotThrow(() => consumeTurnBudget({ ...imagePayload }, 'image'))
}

const payload = {
  turnBudget: createTurnBudget({ maxIterations: 2, maxToolAttempts: 2, maxModelRequests: 1 }),
}
consumeTurnBudget(payload, 'iteration')
consumeTurnBudget(payload, 'iteration')
assert.throws(
  () => consumeTurnBudget(payload, 'iteration'),
  (error) => error.code === 'TURN_BUDGET_EXCEEDED',
)

const toolPayload = { turnBudget: createTurnBudget({ maxToolAttempts: 1 }) }
consumeTurnBudget(toolPayload, 'tool')
assert.throws(
  () => consumeTurnBudget(toolPayload, 'tool'),
  (error) => error.code === 'TURN_BUDGET_EXCEEDED',
)

const modelPayload = { turnBudget: createTurnBudget({ maxModelRequests: 1 }) }
consumeTurnBudget(modelPayload, 'model')
assert.throws(
  () => consumeTurnBudget(modelPayload, 'model'),
  (error) => error.code === 'TURN_BUDGET_EXCEEDED',
)
assert.doesNotThrow(() => assertTurnBudget(modelPayload))

console.log(
  JSON.stringify(
    {
      turnIterations: true,
      toolAttempts: true,
      modelRequests: true,
      nonRetryable: true,
      imageBudgetCoversAssetTasks: true,
    },
    null,
    2,
  ),
)
