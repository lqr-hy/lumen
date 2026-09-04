import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveWorkflowDecision, runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { planAgentTurn } from '../electron/runtime/agent-planner.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { routeAgentIntent, validateAgentIntent } from '../electron/runtime/intent-router.mjs'
import { assembleRuntimeContext } from '../electron/runtime/pi/context-runtime.mjs'
import { getReadyWorkflowSteps } from '../electron/runtime/workflow-graph.mjs'
import { reviewPageVision } from '../electron/runtime/vision-review.mjs'
import {
  groupComponentRegionVisualTargets,
  inspectImageArtifact,
  repairFailedTextOverlaySiblings,
  shouldRegenerateAsTransparent,
} from '../electron/runtime/agent-tools.mjs'

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
const structuredComponentIntent = routeAgentIntent({
  prompt: '生成这个组件的设计稿',
  componentReferences: [{ packId: 'campaign-components', componentName: 'EraLottery' }],
  session: {},
})
assert.equal(structuredComponentIntent.action, 'create-component')
assert.equal(structuredComponentIntent.taskKind, 'component-design')

const pendingComponentSession = {
  id: 'pending-component',
  status: 'idle',
  plan: [],
  references: [],
}
planAgentTurn(
  pendingComponentSession,
  {
    question: '这是接下来要使用的组件',
    componentReferences: [
      { packId: 'campaign-components', componentName: 'EraLottery', label: 'EraLottery' },
    ],
    history: [],
    uploads: [],
  },
  {
    version: 1,
    prompt: '这是接下来要使用的组件',
    action: 'chat',
    taskKind: 'chat',
    confidence: 1,
    reason: 'test',
    targetIds: [],
    source: 'test',
  },
)
assert.equal(pendingComponentSession.pendingTask?.status, 'prepared')
const pendingTurn = planAgentTurn(
  pendingComponentSession,
  {
    question: '开始生成',
    history: [],
    uploads: [],
  },
  {
    version: 1,
    prompt: '开始生成',
    action: 'continue',
    taskKind: 'unknown',
    confidence: 1,
    reason: 'test',
    targetIds: [],
    source: 'test',
  },
)
assert.equal(pendingTurn.action, 'run')
assert.equal(pendingComponentSession.taskKind, 'component-design')
assert.deepEqual(
  pendingComponentSession.plan.map((step) => step.tool),
  [
    'reference.prepare',
    'source.inspect',
    'source.to-scene',
    'design.transform',
    'scene.validate',
    'canvas.commit',
  ],
)
const protectedContinueDecision = resolveWorkflowDecision(
  {
    question: '开始生成',
    workflowDecision: createWorkflowDecision('continue', 'component-design', {
      operation: 'resume',
      scope: 'artboard',
      targetArtboardId: 'pending-component-board',
      reason: 'resume-pending-component',
      confidence: 1,
    }),
  },
  {
    taskKind: 'component-design',
    pendingTask: { kind: 'component-design' },
  },
)
assert.equal(protectedContinueDecision.action, 'continue')
assert.equal(protectedContinueDecision.taskKind, 'component-design')

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
const readySteps = getReadyWorkflowSteps({
  plan: [
    { id: 'done', tool: 'reference.prepare', status: 'completed' },
    { id: 'ready', tool: 'page.generate-shell', status: 'pending' },
    { id: 'blocked', tool: 'page.review', status: 'pending' },
  ],
})
assert.deepEqual(
  readySteps.map((step) => step.id),
  ['ready'],
)
const runtimeContext = assembleRuntimeContext(
  {
    sessionId: 'context-session',
    projectId: 'context-project',
    question: '页面先别做了，只把抽奖部分放到当前画板',
    history: [],
    uploads: [],
    canvasTarget: {
      artboardId: 'board-current',
      width: 375,
      height: 812,
      placementMode: 'append-section',
    },
    canvasSnapshot: {
      artboardId: 'board-current',
      elementCount: 4,
      componentCount: 1,
      hasPageShell: true,
    },
  },
  {
    status: 'failed',
    taskKind: 'page-design',
    componentRequest: 'EraLottery EraTasklist',
  },
)
assert.equal(runtimeContext.canvas?.artboardId, 'board-current')
assert.equal(runtimeContext.session.taskKind, undefined)
assert.equal(runtimeContext.canvasSnapshot?.componentCount, 1)
assert.equal(adviceIntent.action, 'chat')

const isolatedReferenceSession = {
  id: 'reference-isolation',
  status: 'completed',
  taskKind: 'design-image',
  plan: [],
  references: [
    {
      id: 'old-reference',
      name: '历史 KV.png',
      role: 'kv',
      data: 'data:image/png;base64,old',
      mime: 'image/png',
    },
  ],
}
const isolatedReferencePrompt = '以 @图1 主题生成一个电商后台管理系统设计稿'
const isolatedReferenceIntent = routeAgentIntent({ prompt: isolatedReferencePrompt })
planAgentTurn(
  isolatedReferenceSession,
  {
    question: isolatedReferencePrompt,
    history: [],
    uploads: [
      {
        name: '图1.png',
        data: 'data:image/png;base64,current',
        mime: 'image/png',
        context: isolatedReferencePrompt,
      },
    ],
  },
  isolatedReferenceIntent,
)
assert.equal(isolatedReferenceSession.taskKind, 'generic-ui')
assert.deepEqual(
  isolatedReferenceSession.references.map((reference) => reference.data),
  ['data:image/png;base64,current'],
)

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

let visionPayload
const visionReview = await reviewPageVision({
  invokeProvider: async (payload) => {
    visionPayload = payload
    return {
      visionReview: {
        scores: { theme: 1, readability: 1, hierarchy: 1, referenceSimilarity: 1 },
        issues: [],
        message: '通过',
      },
    }
  },
  payload: {
    enableVisionReview: true,
    provider: 'codex',
    sessionId: 'vision-session',
    canvasTarget: { artboardId: 'board-vision' },
  },
  blueprint: { width: 375, estimatedHeight: 812 },
  references: [],
  callbacks: {
    onCanvasSnapshotRequest: async () => ({
      status: 'ready',
      snapshot: {
        data: 'data:image/png;base64,iVBORw0KGgo=',
        mime: 'image/png',
        width: 375,
        height: 812,
      },
    }),
  },
})
assert.equal(visionReview.status, 'completed')
assert.equal(visionPayload.uploads.at(-1).mime, 'image/png')
assert.equal(
  visionPayload.uploads.some((upload) => upload.mime === 'image/svg+xml'),
  false,
)
const fakeTransparencyReview = inspectImageArtifact(
  {
    kind: 'raster',
    mime: 'image/png',
    content: 'iVBORw0KGgo=',
    width: 96,
    height: 96,
    analysis: {
      checkerboardCoverage: 0.7,
      source: { checkerboardCoverage: 0.7, checkerboardScale: 8 },
    },
  },
  { transparent: true, width: 96, height: 96 },
)
assert.equal(fakeTransparencyReview.passed, false)
assert.equal(
  fakeTransparencyReview.issues.some((issue) => issue.code === 'image-fake-transparency'),
  true,
)
const opaqueTransparencyReview = inspectImageArtifact(
  {
    kind: 'raster',
    mime: 'image/png',
    content: 'iVBORw0KGgo=',
    width: 180,
    height: 64,
    analysis: {
      alphaCoverage: 1,
      transparentCoverage: 0,
      source: { alphaCoverage: 1, transparentCoverage: 0 },
    },
  },
  { transparent: true, width: 180, height: 64 },
)
assert.equal(opaqueTransparencyReview.passed, false)
assert.equal(
  opaqueTransparencyReview.issues.some((issue) => issue.code === 'image-source-alpha-missing'),
  true,
)
const realTransparencyReview = inspectImageArtifact(
  {
    kind: 'raster',
    mime: 'image/png',
    content: 'iVBORw0KGgo=',
    width: 180,
    height: 64,
    analysis: {
      alphaCoverage: 0.94,
      transparentCoverage: 0.06,
      source: { alphaCoverage: 0.94, transparentCoverage: 0.06 },
    },
  },
  { transparent: true, width: 180, height: 64 },
)
assert.equal(realTransparencyReview.passed, true)
assert.equal(shouldRegenerateAsTransparent('重新生成按钮'), false)
assert.equal(shouldRegenerateAsTransparent('重新生成按钮', true), true)
assert.equal(shouldRegenerateAsTransparent('按钮大小改成 130/40'), false)
assert.equal(shouldRegenerateAsTransparent('不要透明背景', true), false)
assert.equal(shouldRegenerateAsTransparent('生成透明按钮'), true)
assert.equal(shouldRegenerateAsTransparent('不要透明背景'), false)

const visualGroups = groupComponentRegionVisualTargets([
  createRegionScope('draw-one', '抽一次', 100, 48),
  createRegionScope('draw-ten', '抽10次', 100, 48),
  createRegionScope('rule-title', '活动规则', 100, 48),
  { ...createRegionScope('draw-wide', '抽百次', 120, 48), slotId: 'draw-wide' },
])
assert.equal(visualGroups.length, 4)
assert.equal(
  visualGroups.every((group) => group.shared === false),
  true,
)

const siblingRepair = repairFailedTextOverlaySiblings(
  [
    { artifact: { kind: 'svg', content: '<svg>fallback</svg>' }, fallback: true, attempts: 2 },
    { artifact: { kind: 'svg', content: '<svg>generated</svg>' }, fallback: false, attempts: 1 },
    { artifact: { kind: 'svg', content: '<svg>decoration</svg>' }, fallback: false, attempts: 1 },
  ],
  [
    {
      slotId: 'draw-one',
      role: 'action',
      exactText: '抽一次',
      targetSize: { width: 160, height: 48 },
      transparent: true,
    },
    {
      slotId: 'draw-ten',
      role: 'action',
      exactText: '抽十次',
      targetSize: { width: 160, height: 48 },
      transparent: true,
    },
    {
      slotId: 'thanks',
      role: 'decoration',
      targetSize: { width: 160, height: 48 },
      transparent: true,
    },
  ],
)
assert.equal(siblingRepair[0].fallback, true)
assert.equal(siblingRepair[0].reusedFromSlotId, undefined)
assert.equal(siblingRepair[0].artifact.content, '<svg>fallback</svg>')
assert.equal(siblingRepair[2].reusedFromSlotId, undefined)
assert.deepEqual(
  visualGroups.map((group) => group.entries[0].scope.regionId),
  ['draw-one', 'draw-ten', 'rule-title', 'draw-wide'],
)

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-upgrades-'))
try {
  configureAgentSessionStore(testRoot)
  const shellResult = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: 'page-shell-edit-test',
      provider: 'codex',
      model: 'test',
      question: '重新生成这个页面背景',
      workflowDecision: createWorkflowDecision('revise-page-shell', 'page-shell-edit'),
      uploads: [],
      editScope: {
        type: 'page-shell',
        scopeId: 'scope-page-shell-edit',
        elementId: 'page-shell-element',
        artboardId: 'board',
        documentRevision: 0,
        targetHash: 'hash-page-shell-edit',
        targetElementIds: ['page-shell-element'],
        targetSize: { width: 375, height: 812 },
      },
    },
    {},
    {
      invokeProvider: async (payload) => {
        assert.equal(payload.type, 'generate_assets')
        return {
          artifacts: [
            {
              kind: 'svg',
              name: 'page-shell.svg',
              content:
                '<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812"><rect width="375" height="812" fill="#facc15"/><path d="M0 200h375v300H0z" fill="#fb923c"/><circle cx="190" cy="100" r="60" fill="#fff7d6"/></svg>',
            },
          ],
        }
      },
    },
  )
  assert.equal(shellResult.editScope.type, 'page-shell')
  assert.equal(shellResult.artifact.name, 'page-shell.svg')
  assert.equal(shellResult.agent.workflowState.iteration, 4)
  assert.equal(shellResult.agent.observations.length, 4)
  assert.equal(
    shellResult.agent.plan.some((step) => step.tool === 'agent.inspect-state'),
    false,
  )

  let generationAttempts = 0
  const retryEvents = []
  const recoveredResult = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: 'react-retry-test',
      provider: 'codex',
      model: 'test',
      question: '重新生成这个页面背景',
      workflowDecision: createWorkflowDecision('revise-page-shell', 'page-shell-edit'),
      uploads: [],
      editScope: {
        type: 'page-shell',
        scopeId: 'scope-page-shell-retry',
        elementId: 'page-shell-element',
        artboardId: 'board',
        documentRevision: 0,
        targetHash: 'hash-page-shell-retry',
        targetElementIds: ['page-shell-element'],
        targetSize: { width: 375, height: 812 },
      },
    },
    { onAgentEvent: (event) => retryEvents.push(event.type) },
    {
      invokeProvider: async () => {
        generationAttempts += 1
        if (generationAttempts === 1) {
          const error = new Error('临时生成失败')
          error.code = 'TEMPORARY_GENERATION_FAILURE'
          throw error
        }
        return {
          artifacts: [
            {
              kind: 'svg',
              name: 'recovered-page-shell.svg',
              content:
                '<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812"><rect width="375" height="812" fill="#facc15"/><path d="M0 200h375v300H0z" fill="#fb923c"/><circle cx="190" cy="100" r="60" fill="#fff7d6"/></svg>',
            },
          ],
        }
      },
    },
  )
  assert.equal(generationAttempts, 2)
  assert.equal(retryEvents.includes('step.retrying'), true)
  assert.equal(
    recoveredResult.agent.observations.some((item) => item.status === 'failed'),
    false,
  )
  assert.equal(recoveredResult.agent.status, 'completed')
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

function createRegionScope(regionId, exactText, width, height) {
  return {
    type: 'component-region',
    componentName: 'EraLottery',
    profile: 'default',
    regionId,
    slotId: `${regionId}-slot`,
    propPath: `styleConfig.${regionId}.image`,
    elementId: `${regionId}-element`,
    exactText,
    targetSize: { width, height },
  }
}

console.log(
  JSON.stringify(
    {
      structuredIntentRouter: true,
      structuredComponentMention: true,
      pendingComponentResume: true,
      canvasSnapshotContext: true,
      deterministicWorkflowGraph: true,
      toolRetryRecovery: true,
      adviceDoesNotExecute: true,
      pageShellEditIntent: true,
      componentSlotIntent: true,
      visionReviewSnapshot: true,
      pageShellEditExecution: true,
    },
    null,
    2,
  ),
)

function createWorkflowDecision(
  action,
  taskKind,
  placement = {
    operation: 'create',
    scope: 'document',
    reason: 'test-create',
    confidence: 1,
  },
) {
  return {
    version: 2,
    mode: 'execute',
    action,
    taskKind,
    confidence: 1,
    reason: 'pi-native-tool-call',
    source: 'pi-agent-core',
    placement,
  }
}
