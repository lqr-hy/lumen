import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runAgent } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { routeAgentIntent, validateAgentIntent } from '../electron/runtime/intent-router.mjs'
import {
  buildConversationContext,
  normalizeConversationDecision,
  parseConversationDecisionText,
} from '../electron/runtime/conversation-agent.mjs'
import {
  buildReactContext,
  getReadyAgentSteps,
  normalizeAgentNextAction,
  parseAgentNextActionText,
} from '../electron/runtime/react-loop.mjs'
import { composePageReviewSnapshot } from '../electron/runtime/vision-review.mjs'

const pageIntent = routeAgentIntent({
  prompt: '使用 EraLottery.json 和 EraTasklist.json 生成完整活动页面',
  session: {},
})
assert.equal(pageIntent.action, 'create-page')
assert.equal(pageIntent.taskKind, 'page-design')
assert.equal(validateAgentIntent(pageIntent), true)
const multiDesignIntent = routeAgentIntent({
  prompt: '以当前图片作为主视觉，添加EraLottery和EraTaskList组件生成完整的设计稿',
  session: {},
})
assert.equal(multiDesignIntent.action, 'create-page')
assert.equal(multiDesignIntent.taskKind, 'page-design')

const adviceIntent = routeAgentIntent({
  prompt: '分析一下现在还缺少什么能力',
  session: { taskKind: 'page-design' },
})
const artboardIntent = routeAgentIntent({ prompt: '新增一个画板', session: {} })
assert.equal(artboardIntent.action, 'create-artboard')
assert.equal(artboardIntent.taskKind, 'artboard')
const presentComponentIntent = routeAgentIntent({
  prompt: '把 EraLottery 设计稿添加到画布',
  session: { taskKind: 'page-design' },
})
assert.equal(presentComponentIntent.action, 'create-component')
const directComponentIntent = routeAgentIntent({
  prompt: '现在只生成 EraLottery',
  session: { taskKind: 'page-design' },
})
assert.equal(directComponentIntent.action, 'create-component')
const replayCurrentComponentIntent = routeAgentIntent({
  prompt: '添加到画布',
  session: {
    taskKind: 'component-design',
    componentDesign: { componentName: 'EraLottery' },
  },
})
assert.equal(replayCurrentComponentIntent.action, 'continue')
const naturalDecision = normalizeConversationDecision({
  version: 1,
  mode: 'execute',
  action: 'create-component',
  taskKind: 'component-design',
  confidence: 0.96,
  reason: '用户要求先只完成抽奖部分',
  target: { type: 'component', componentName: 'EraLottery' },
})
assert.equal(naturalDecision?.intent.action, 'create-component')
assert.equal(naturalDecision?.target?.componentName, 'EraLottery')
const apiDecision = parseConversationDecisionText(`\`\`\`json
{"version":1,"mode":"execute","action":"create-page","taskKind":"page-design","confidence":0.91,"reason":"用户要求组合页面"}
\`\`\``)
assert.equal(normalizeConversationDecision(apiDecision)?.action, 'create-page')
const readySteps = getReadyAgentSteps({
  plan: [
    { id: 'done', tool: 'reference.prepare', status: 'completed' },
    { id: 'ready', tool: 'page.generate-shell', status: 'pending' },
    { id: 'blocked', tool: 'page.review', status: 'pending' },
  ],
})
assert.deepEqual(readySteps.map((step) => step.id), ['ready'])
const nextAction = parseAgentNextActionText('```json\n{"version":1,"mode":"tool","tool":{"stepId":"ready","name":"page.generate-shell"},"confidence":0.94,"reason":"生成页面外壳"}\n```')
assert.equal(normalizeAgentNextAction(nextAction, readySteps)?.tool.stepId, 'ready')
const conversationContext = buildConversationContext({
  status: 'failed',
  taskKind: 'page-design',
  componentRequest: 'EraLottery EraTasklist',
  references: [],
  canvasSnapshot: {
    artboardId: 'board-current',
    elementCount: 4,
    componentCount: 1,
    hasPageShell: true,
  },
}, {
  question: '页面先别做了，只把抽奖部分放到当前画板',
  history: [],
  uploads: [],
  canvasTarget: { artboardId: 'board-current', width: 375, height: 812, placementMode: 'append-section' },
})
assert.equal(conversationContext.canvas?.artboardId, 'board-current')
assert.equal(conversationContext.session.taskKind, 'page-design')
assert.equal(conversationContext.canvasSnapshot?.hasPageShell, true)
const reactContext = buildReactContext({
  status: 'running',
  taskKind: 'page-design',
  observations: [],
  references: [],
  canvasSnapshot: conversationContext.canvasSnapshot,
}, { question: '继续' }, [])
assert.equal(reactContext.canvasSnapshot?.componentCount, 1)
assert.equal(adviceIntent.action, 'chat')

const shellIntent = routeAgentIntent({
  prompt: '重新生成这个页面背景',
  session: { taskKind: 'page-design' },
  editScope: { type: 'page-shell', elementId: 'shell', artboardId: 'board' },
})
assert.equal(shellIntent.action, 'revise-page-shell')

const slotIntent = routeAgentIntent({
  prompt: '把这个按钮换成黄色',
  session: {},
  editScope: {
    type: 'component-region',
    elementId: 'button',
    instanceId: 'lottery',
    slotId: 'draw-one',
  },
})
assert.equal(slotIntent.action, 'regenerate-slot')

const snapshot = composePageReviewSnapshot(
  {
    width: 375,
    estimatedHeight: 812,
    sections: [{ id: 'section-1', bounds: { x: 0, y: 100, width: 375, height: 400 } }],
  },
  { kind: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="375" height="812"/></svg>' },
  [{ index: 0, previewArtifact: { kind: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="375" height="400"/></svg>' } }],
)
assert.equal(snapshot.content.includes('data:image/svg+xml;base64,'), true)
assert.equal(snapshot.content.includes('width="375" height="812"'), true)

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-upgrades-'))
try {
  configureAgentSessionStore(testRoot)
  const nextActions = [
    {
      version: 1,
      mode: 'tool',
      tool: { stepId: 'inspect-agent-inspect-state', name: 'agent.inspect-state' },
      confidence: 0.9,
      reason: '先检查当前任务状态',
    },
    ...[
      ['prepare-references', 'reference.prepare'],
      ['regenerate-page-shell', 'page.regenerate-shell'],
      ['validate-page-shell', 'page.validate-shell'],
      ['present-page-shell', 'canvas.present-page-shell'],
    ].map(([stepId, name]) => ({
      version: 1,
      mode: 'tool',
      tool: { stepId, name },
      confidence: 0.95,
      reason: `执行 ${name}`,
    })),
    {
      version: 1,
      mode: 'finish',
      confidence: 0.99,
      reason: '所有必需步骤均已完成',
    },
  ]
  let nextActionIndex = 0
  const shellResult = await runAgent({
    type: 'agent_run',
    sessionId: 'page-shell-edit-test',
    provider: 'codex',
    model: 'test',
    question: '重新生成这个页面背景',
    uploads: [],
    editScope: {
      type: 'page-shell',
      elementId: 'page-shell-element',
      artboardId: 'board',
      targetSize: { width: 375, height: 812 },
    },
  }, {}, {
    decideIntent: async (payload) => {
      assert.equal(payload.type, 'decide_agent_action')
      return {
        conversationDecision: {
          version: 1,
          mode: 'execute',
          action: 'revise-page-shell',
          taskKind: 'page-shell-edit',
          confidence: 0.99,
          reason: '当前选择是页面外壳，用户要求重新生成背景',
        },
      }
    },
    decideNextAction: async (payload) => {
      assert.equal(payload.type, 'decide_agent_next_action')
      const agentNextAction = nextActions[nextActionIndex]
      nextActionIndex += 1
      assert(agentNextAction, 'ReAct Loop 不应超出预期决策次数')
      return { agentNextAction }
    },
    invokeProvider: async (payload) => {
      assert.equal(payload.type, 'generate_assets')
      return {
        artifacts: [{
          kind: 'svg',
          name: 'page-shell.svg',
          content: '<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812"><rect width="375" height="812" fill="#facc15"/><path d="M0 200h375v300H0z" fill="#fb923c"/><circle cx="190" cy="100" r="60" fill="#fff7d6"/></svg>',
        }],
      }
    },
  })
  assert.equal(shellResult.editScope.type, 'page-shell')
  assert.equal(shellResult.artifact.name, 'page-shell.svg')
  assert.equal(shellResult.agent.reactState.enabled, true)
  assert.equal(shellResult.agent.observations.length, 5)
  assert.equal(shellResult.agent.plan.some((step) => step.tool === 'agent.inspect-state'), true)
  assert.equal(nextActionIndex, nextActions.length)

  const retryActions = [
    ['prepare-references', 'reference.prepare'],
    ['regenerate-page-shell', 'page.regenerate-shell'],
    ['regenerate-page-shell', 'page.regenerate-shell'],
    ['validate-page-shell', 'page.validate-shell'],
    ['present-page-shell', 'canvas.present-page-shell'],
  ].map(([stepId, name]) => ({
    version: 1,
    mode: 'tool',
    tool: { stepId, name },
    confidence: 0.95,
    reason: `执行 ${name}`,
  }))
  retryActions.push({
    version: 1,
    mode: 'finish',
    confidence: 0.99,
    reason: '失败步骤已经恢复且交付完成',
  })
  let retryActionIndex = 0
  let generationAttempts = 0
  const recoveredResult = await runAgent({
    type: 'agent_run',
    sessionId: 'react-retry-test',
    provider: 'codex',
    model: 'test',
    question: '重新生成这个页面背景',
    uploads: [],
    editScope: {
      type: 'page-shell',
      elementId: 'page-shell-element',
      artboardId: 'board',
      targetSize: { width: 375, height: 812 },
    },
  }, {}, {
    decideIntent: async () => ({
      conversationDecision: {
        version: 1,
        mode: 'execute',
        action: 'revise-page-shell',
        taskKind: 'page-shell-edit',
        confidence: 0.99,
        reason: '修订页面背景',
      },
    }),
    decideNextAction: async () => ({ agentNextAction: retryActions[retryActionIndex++] }),
    invokeProvider: async () => {
      generationAttempts += 1
      if (generationAttempts === 1) {
        const error = new Error('临时生成失败')
        error.code = 'TEMPORARY_GENERATION_FAILURE'
        throw error
      }
      return {
        artifacts: [{
          kind: 'svg',
          name: 'recovered-page-shell.svg',
          content: '<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812"><rect width="375" height="812" fill="#facc15"/><path d="M0 200h375v300H0z" fill="#fb923c"/><circle cx="190" cy="100" r="60" fill="#fff7d6"/></svg>',
        }],
      }
    },
  })
  assert.equal(generationAttempts, 2)
  assert.equal(recoveredResult.agent.observations.some((item) => item.status === 'failed'), true)
  assert.equal(recoveredResult.agent.status, 'completed')
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

console.log(JSON.stringify({
  structuredIntentRouter: true,
  crossProviderDecisionParsing: true,
  canvasSnapshotContext: true,
  constrainedReactLoop: true,
  reactFailureRecovery: true,
  adviceDoesNotExecute: true,
  pageShellEditIntent: true,
  componentSlotIntent: true,
  visionReviewSnapshot: true,
  pageShellEditExecution: true,
}, null, 2))
