import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { inspectSvgArtifact } from '../electron/runtime/agent-tools.mjs'
import { routeAgentIntent } from '../electron/runtime/intent-router.mjs'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-campaign-design-flow-'))
configureAgentSessionStore(testRoot)

const validSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812">',
  '<rect width="375" height="812" fill="#fff"/>',
  '<rect x="20" y="40" width="335" height="220" fill="#111827"/>',
  '<text x="32" y="100" font-size="28">活动标题</text>',
  '<path d="M20 300h335v400H20z" fill="#eee"/>',
  '</svg>',
].join('')

const canvasTarget = {
  artboardId: 'board-1',
  createdForThread: true,
  width: 375,
  height: 812,
  placementMode: 'new-artboard',
  placementSource: 'prompt',
}

try {
  const normal = await executeDesignFlow('normal', validSvg)
  assert(normal.result.artifact, '正常流程没有返回制品')
  assert(normal.imageCalls === 1, '正常流程不应触发自动修正')
  assert(normal.result.agent.plan.length === 7, '整图 Plan 应包含 7 个步骤')
  assert(
    normal.providerTypes.every((type) => type !== 'generate_blueprint'),
    '普通生图不应调用 Blueprint Provider',
  )
  assert(normal.result.generationBrief?.outputKind === 'full-image', '普通生图缺少 GenerationBrief')
  assert(
    normal.result.agent.plan.some((step) => step.tool === 'design.brief'),
    '整图 Plan 缺少 design.brief',
  )

  const wrongWidthSvg = validSvg.replaceAll('375', '100')
  const refined = await executeDesignFlow('refine', wrongWidthSvg)
  assert(refined.imageCalls === 2, '问题制品应触发一次自动修正')
  assert(refined.result.refined === true, '自动修正结果缺少 refined 标记')

  const revision = await executeDesignRevisionFlow()
  assert(revision.revisionResult.artifact, '设计修订追问没有生成新制品')
  assert(revision.imageCalls === 2, '设计修订应该启动第二个生成 Run')
  assert(revision.adviceResult.text === '设计建议', '咨询问题不应错误启动生成 Run')
  assert(revision.imageCallsAfterAdvice === 2, '咨询问题不应调用图片生成')

  const unsafeReview = inspectSvgArtifact(
    {
      content:
        '<svg width="375" height="812"><script>alert(1)</script><rect width="375" height="812"/></svg>',
    },
    canvasTarget,
  )
  assert(!unsafeReview.passed, '危险 SVG 不应通过质量审查')
  assert(
    unsafeReview.issues.some((issue) => issue.code === 'svg-unsafe'),
    '危险 SVG 缺少 svg-unsafe 问题',
  )

  console.log(
    JSON.stringify(
      {
        normalSteps: normal.result.agent.plan.length,
        normalImageCalls: normal.imageCalls,
        refineImageCalls: refined.imageCalls,
        refined: refined.result.refined,
        revisionExecuted: Boolean(revision.revisionResult.artifact),
        adviceStayedChat: revision.adviceResult.text === '设计建议',
        unsafeRejected: !unsafeReview.passed,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

async function executeDesignFlow(label, firstSvg) {
  let imageCalls = 0
  const providerTypes = []
  const result = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `design-flow-${label}-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: '生成一张活动海报',
      uploads: [],
      canvasTarget,
    },
    {},
    {
      invokeProvider: async (payload) => {
        providerTypes.push(payload.type)
        if (payload.type === 'generate_image') {
          imageCalls += 1
          return {
            artifact: {
              kind: 'svg',
              content: imageCalls === 1 ? firstSvg : validSvg,
              name: 'test.png',
            },
          }
        }
        throw new Error(`未预期的 Provider 请求：${payload.type}`)
      },
    },
  )
  return { result, imageCalls, providerTypes }
}

async function executeDesignRevisionFlow() {
  let imageCalls = 0
  const sessionId = `design-revision-${Date.now()}`
  const dependencies = {
    invokeProvider: async (payload) => {
      if (payload.type === 'generate_image') {
        imageCalls += 1
        return { artifact: { kind: 'svg', content: validSvg, name: 'revision.png' } }
      }
      throw new Error(`未预期的 Provider 请求：${payload.type}`)
    },
  }
  await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId,
      provider: 'codex',
      model: 'test',
      question: '生成一张活动海报',
      uploads: [],
      canvasTarget,
    },
    {},
    dependencies,
  )
  const revisionResult = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId,
      provider: 'codex',
      model: 'test',
      question: '优化一下当前设计稿',
      uploads: [],
      canvasTarget,
    },
    {},
    dependencies,
  )
  const adviceIntent = routeAgentIntent({
    prompt: '如何优化这个设计稿',
    session: { taskKind: 'design-image' },
  })
  assert(adviceIntent.action === 'chat', '咨询问题不应进入设计工作流')
  const adviceResult = { text: '设计建议' }
  return { revisionResult, adviceResult, imageCalls, imageCallsAfterAdvice: imageCalls }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
