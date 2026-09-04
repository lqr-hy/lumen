import assert from 'node:assert/strict'
import { planAgentTurn } from '../electron/runtime/agent-planner.mjs'
import { createAgentToolRegistry } from '../electron/runtime/agent-tools.mjs'
import { campaignComponentPlugin } from '../electron/runtime/plugins/campaign-component-plugin.mjs'
import { createRuntimePluginRegistry } from '../electron/runtime/plugins/plugin-registry.mjs'

const dependencies = { invokeProvider: async () => ({}) }
const enabledRegistry = createAgentToolRegistry({
  ...dependencies,
  plugins: [campaignComponentPlugin],
})
const enabledTools = enabledRegistry.list()
assert.equal(
  enabledTools.some((tool) => tool.name === 'component.resolve'),
  false,
)
assert.equal(
  enabledTools.some((tool) => tool.name === 'page.blueprint'),
  false,
)
assert(
  enabledTools.some(
    (tool) => tool.name === 'page.generate-component' && tool.owner === 'campaign-component',
  ),
)
assert.equal(
  enabledTools.some((tool) => tool.name === 'ui.plan'),
  false,
)
assert(enabledTools.some((tool) => tool.name === 'source.inspect' && tool.owner === 'core'))

const disabledRegistry = createAgentToolRegistry({ ...dependencies, plugins: [] })
const disabledTools = disabledRegistry.list()
assert.equal(
  disabledTools.some((tool) => tool.name.startsWith('component.')),
  false,
)
assert.equal(
  disabledTools.some((tool) => tool.name.startsWith('page.')),
  false,
)
assert.equal(
  disabledTools.some((tool) => tool.name === 'ui.plan'),
  false,
)
assert(disabledTools.some((tool) => tool.name === 'design.generate' && tool.owner === 'core'))
await assert.rejects(
  disabledRegistry.execute('component.resolve', {}),
  (error) => error?.code === 'COMPONENT_PLUGIN_MISSING',
)
await assert.rejects(
  disabledRegistry.execute('ui.plan', {}),
  (error) => error?.code === 'AGENT_TOOL_PRIVATE',
)

const pluginRegistry = createRuntimePluginRegistry([campaignComponentPlugin])
assert.deepEqual(
  pluginRegistry.resolvePlan('component-design').map((step) => step.tool),
  [
    'reference.prepare',
    'source.inspect',
    'source.to-scene',
    'design.transform',
    'scene.validate',
    'canvas.commit',
  ],
)
assert.equal(
  pluginRegistry.resolveSourceAdapter('component-design')?.id,
  'campaign-component-source',
)
assert.equal(pluginRegistry.resolveSourceAdapter('page-design')?.id, 'campaign-page-source')
assert.equal(pluginRegistry.resolveSourceAdapter('generic-ui')?.id, 'prompt-design-spec-source')
assert.deepEqual(
  pluginRegistry.resolvePlan('page-design').map((step) => step.tool),
  [
    'reference.prepare',
    'source.inspect',
    'source.to-scene',
    'source.confirm',
    'design.transform',
    'scene.validate',
    'canvas.commit',
  ],
)
assert.deepEqual(
  createRuntimePluginRegistry([])
    .resolvePlan('generic-ui')
    .map((step) => step.tool),
  [
    'reference.prepare',
    'source.inspect',
    'source.to-scene',
    'design.transform',
    'scene.validate',
    'canvas.commit',
  ],
)
assert.equal(createRuntimePluginRegistry([]).resolvePlan('component-design'), undefined)

const genericSession = createSession('generic')
const genericTurn = planAgentTurn(
  genericSession,
  { question: '生成后台管理系统', uploads: [] },
  {
    version: 1,
    prompt: '生成后台管理系统',
    action: 'create-ui',
    taskKind: 'generic-ui',
    confidence: 1,
    reason: 'test',
    targetIds: [],
    source: 'test',
  },
  { plugins: [] },
)
assert.equal(genericTurn.action, 'run')
assert.deepEqual(
  genericSession.plan.map((step) => step.tool),
  [
    'reference.prepare',
    'source.inspect',
    'source.to-scene',
    'design.transform',
    'scene.validate',
    'canvas.commit',
  ],
)

const componentSession = createSession('component')
assert.throws(
  () =>
    planAgentTurn(
      componentSession,
      {
        question: '生成组件',
        uploads: [],
        componentReferences: [{ packId: 'campaign-components', componentName: 'EraLottery' }],
      },
      {
        version: 1,
        prompt: '生成组件',
        action: 'create-component',
        taskKind: 'component-design',
        confidence: 1,
        reason: 'test',
        targetIds: [],
        source: 'test',
      },
      { plugins: [] },
    ),
  (error) => error?.code === 'COMPONENT_PLUGIN_MISSING',
)

console.log('Component Plugin boundary tests passed.')

function createSession(id) {
  return {
    id,
    status: 'idle',
    taskKind: 'unknown',
    plan: [],
    references: [],
    artifacts: [],
  }
}
