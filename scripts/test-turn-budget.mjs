import assert from 'node:assert/strict'
import {
  assertTurnBudget,
  consumeTurnBudget,
  createTurnBudget,
} from '../electron/runtime/pi/turn-budget.mjs'

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
    { turnIterations: true, toolAttempts: true, modelRequests: true, nonRetryable: true },
    null,
    2,
  ),
)
