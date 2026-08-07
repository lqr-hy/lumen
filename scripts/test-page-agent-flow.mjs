import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runAgent } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import {
  configureSkillRuntime,
  executeSkillTool,
  loadComponentFromPrompt,
  loadComponentsFromPrompt,
} from '../electron/runtime/skills.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-campaign-page-agent-'))
const originalFetch = globalThis.fetch
configureAgentSessionStore(testRoot)
configureSkillRuntime({ appRoot, resourcesPath: appRoot, isPackaged: false })

try {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
  })
  const sessionId = `page-agent-${Date.now()}`
  const calls = { lotteryBlueprint: 0, tasklistBlueprint: 0, pageShell: 0, theme: 0 }
  const payload = {
    type: 'agent_run',
    sessionId,
    provider: 'codex',
    model: 'test',
    question: '使用 EraLottery.json 和 EraTasklist.json 生成完整活动页面',
    uploads: [{
      type: 'file',
      name: 'campaign-kv.png',
      mime: 'image/png',
      role: 'kv',
      data: 'data:image/png;base64,iVBORw0KGgo=',
    }],
    canvasTarget: {
      artboardId: 'page-board',
      createdForThread: true,
      width: 375,
      height: 812,
      placementMode: 'new-artboard',
      placementSource: 'prompt',
    },
  }
  const dependencies = {
    executeSkillTool,
    loadComponentFromPrompt,
    loadComponentsFromPrompt,
    invokeProvider: createPageProvider({ calls }),
  }
  const confirmation = await runAgent(payload, {}, dependencies)
  assert(confirmation.awaitingConfirmation?.type === 'blueprint-confirmation', '页面生成前没有暂停等待 Blueprint 确认')
  assert(confirmation.awaitingConfirmation.blueprint.sections.length === 2, '待确认 Blueprint 模块数量错误')
  assert(calls.lotteryBlueprint === 0 && calls.tasklistBlueprint === 0, '确认前不得生成组件 Blueprint 或素材')
  const reversedSections = [...confirmation.awaitingConfirmation.blueprint.sections].reverse().map((section, index) => ({
    ...section,
    bounds: { ...section.bounds, y: index * 544, height: index === 0 ? 520 : 500 },
  }))
  const blueprintOverride = {
    ...confirmation.awaitingConfirmation.blueprint,
    estimatedHeight: 1064,
    sections: reversedSections,
    constraints: [{ type: 'vertical-gap', from: reversedSections[0].id, to: reversedSections[1].id, value: 24 }],
  }
  const incrementalDeliveries = []
  const result = await runAgent({ ...payload, question: '确认执行', blueprintOverride }, {
    onDeliverable: async (deliverable) => {
      incrementalDeliveries.push(deliverable)
      if (deliverable.kind === 'page-shell') {
        return {
          status: 'success',
          summary: '页面外壳已写入测试画板。',
          data: {
            artboardId: deliverable.target.artboardId,
            shellElementId: 'page-shell-test',
            hasPageShell: true,
            elementCount: 1,
            componentCount: 0,
          },
        }
      }
      return {
        status: 'success',
        summary: `${deliverable.component.componentName} 已写入测试画板。`,
        data: {
          artboardId: deliverable.target.artboardId,
          rootElementId: `root-${deliverable.component.pageSectionId}`,
          instanceId: `instance-${deliverable.component.pageSectionId}`,
          pageSectionId: deliverable.component.pageSectionId,
          elementCount: 4,
        },
      }
    },
  }, dependencies)

  assert(result.pageDesign?.blueprint.sections.length === 2, '页面 Blueprint 应包含两个组件 Section')
  assert(result.pageDesign.blueprint.estimatedHeight === 1064, '确认后的 Blueprint 高度没有生效')
  assert(result.pageDesign.blueprint.sections[0].component.componentName === 'EraTasklist', '确认前排序没有生效')
  assert(result.pageComponents?.length === 2, '页面结果应包含两个独立组件实例')
  assert(result.pageShellArtifact?.kind === 'svg', '页面缺少独立视觉外壳')
  assert(result.pageDesign.qualityReview.passed, '页面质量门禁没有通过')
  assert(calls.pageShell === 1, '页面外壳应只生成一次')
  assert(calls.theme === 1, '页面 KV 应只提取一次共享主题')
  assert(
    result.agent.plan.filter((step) => step.tool === 'page.generate-component').length === 2,
    'Agent 没有插入独立页面组件 Step',
  )
  assert(result.agent.plan.length === 10, '双组件页面应包含 10 个可恢复步骤')
  assert(incrementalDeliveries.filter((item) => item.kind === 'page-shell').length === 1, '页面外壳应在组件前增量交付')
  assert(incrementalDeliveries.filter((item) => item.kind === 'page-component').length === 2, '每个页面组件完成后都应触发增量交付')
  assert(result.agent.canvasObservations.length === 3, 'Renderer 写入结果没有保存为 Canvas Observation')
  assert(result.agent.canvasObservations.every((item) => item.status === 'success'), '增量画布后置条件未通过')
  assert(result.agent.canvasSnapshot.hasPageShell === true, 'CanvasSnapshot 没有同步页面外壳状态')
  assert(result.agent.canvasSnapshot.componentCount === 2, 'CanvasSnapshot 没有同步页面组件数量')

  const recovery = await executeRecoveryFlow()
  assert(recovery.result.pageComponents.length === 1, '部分组件失败时仍应交付已完成组件')
  assert(recovery.calls.lotteryBlueprint === 1, '恢复失败组件时不应重跑已完成的 EraLottery')
  assert(recovery.calls.tasklistBlueprint === 2, '失败组件应在批量任务内按单组件重试')
  const deliveryGate = await executeCanvasDeliveryFailureFlow()
  assert(deliveryGate.failed, 'Renderer 写入失败后 Agent 不应继续完成页面')

  console.log(JSON.stringify({
    taskKind: 'page-design',
    independentComponentSteps: true,
    sections: result.pageDesign.blueprint.sections.length,
    pageShell: true,
    qualityGate: result.pageDesign.qualityReview.passed,
    blueprintConfirmation: true,
    editableBlueprintOverride: true,
    pageDecisionRepairLoop: true,
    partialComponentDelivery: true,
    incrementalCanvasDelivery: true,
    rendererCanvasObservation: true,
    incrementalPageShell: true,
    liveCanvasSnapshot: true,
    rendererDeliveryFailureGate: true,
  }, null, 2))
} finally {
  globalThis.fetch = originalFetch
  await fs.rm(testRoot, { recursive: true, force: true })
}

async function executeRecoveryFlow() {
  const sessionId = `page-agent-recovery-${Date.now()}`
  const calls = { lotteryBlueprint: 0, tasklistBlueprint: 0, pageShell: 0 }
  const dependencies = {
    executeSkillTool,
    loadComponentFromPrompt,
    loadComponentsFromPrompt,
    invokeProvider: createPageProvider({ calls, tasklistFailures: 2 }),
  }
  const payload = {
    type: 'agent_run',
    sessionId,
    provider: 'codex',
    model: 'test',
    question: '使用 EraLottery.json 和 EraTasklist.json 生成完整活动页面',
    uploads: [],
    canvasTarget: {
      artboardId: 'recovery-board',
      createdForThread: true,
      width: 375,
      height: 812,
      placementMode: 'new-artboard',
      placementSource: 'prompt',
    },
  }
  const confirmation = await runAgent(payload, {}, dependencies)
  assert(confirmation.awaitingConfirmation, '故障恢复流程没有先等待 Blueprint 确认')
  const firstResult = await runAgent({ ...payload, question: '确认执行' }, {}, dependencies)
  assert(firstResult.pageComponents.length === 1, '单组件失败时首次执行应交付已完成组件')
  const result = await runAgent({ ...payload, question: '继续' }, {}, dependencies)
  return { result, calls }
}

async function executeCanvasDeliveryFailureFlow() {
  const calls = { lotteryBlueprint: 0, tasklistBlueprint: 0, pageShell: 0, theme: 0 }
  const dependencies = {
    executeSkillTool,
    loadComponentFromPrompt,
    loadComponentsFromPrompt,
    invokeProvider: createPageProvider({ calls }),
  }
  const payload = {
    type: 'agent_run',
    sessionId: `page-agent-delivery-gate-${Date.now()}`,
    provider: 'codex',
    model: 'test',
    question: '使用 EraLottery.json 生成完整活动页面',
    uploads: [],
    canvasTarget: {
      artboardId: 'delivery-gate-board',
      createdForThread: true,
      width: 375,
      height: 812,
      placementMode: 'new-artboard',
      placementSource: 'prompt',
    },
  }
  const confirmation = await runAgent(payload, {}, dependencies)
  assert(confirmation.awaitingConfirmation, '交付失败门禁流程没有等待 Blueprint 确认')
  try {
    await runAgent({ ...payload, question: '确认执行' }, {
      onDeliverable: async (deliverable) => deliverable.kind === 'page-shell'
        ? {
            status: 'success',
            summary: '测试页面外壳写入成功。',
            data: {
              artboardId: deliverable.target.artboardId,
              shellElementId: 'delivery-gate-shell',
              hasPageShell: true,
              elementCount: 1,
              componentCount: 0,
            },
          }
        : {
            status: 'failed',
            summary: '测试 Renderer 拒绝写入组件。',
            errorCode: 'TEST_CANVAS_WRITE_FAILED',
          },
    }, dependencies)
  } catch (error) {
    assert(error.code === 'TEST_CANVAS_WRITE_FAILED', 'Renderer 失败错误码没有传播到 Agent Step')
    return { failed: true }
  }
  return { failed: false }
}

function createPageProvider(options = {}) {
  let tasklistFailures = options.tasklistFailures ?? 0
  return async (payload) => {
    if (payload.type === 'extract_visual_theme') {
      options.calls && (options.calls.theme += 1)
      return {
        visualTheme: {
          source: 'kv',
          referenceImageIndex: 1,
          colors: ['#ffbf1f', '#ff8a00', '#fff7d6', '#7a3500'],
          visualStyle: '黄色活动 KV',
        },
      }
    }
    if (payload.type === 'generate_component_blueprint') {
      const lottery = payload.question.startsWith('根据 thumbnail 为 EraLottery')
      if (lottery) options.calls && (options.calls.lotteryBlueprint += 1)
      else {
        options.calls && (options.calls.tasklistBlueprint += 1)
        if (tasklistFailures > 0) {
          tasklistFailures -= 1
          throw new Error('模拟 Tasklist Blueprint 失败')
        }
      }
      return { componentBlueprint: lottery ? createLotteryBlueprint() : createTasklistBlueprint() }
    }
    if (payload.type === 'generate_assets') {
      if (payload.question.includes('只生成一个完整页面')) {
        const size = payload.question.match(/输出尺寸必须为 (\d+)x(\d+)/)
        options.calls && (options.calls.pageShell += 1)
        return { artifacts: [createShell(Number(size?.[1] || 375), Number(size?.[2] || 812), '#ffbf1f')] }
      }
      return { artifacts: createComponentArtifacts(payload.question) }
    }
    throw new Error(`未预期的 Provider 请求：${payload.type}`)
  }
}

function createLotteryBlueprint() {
  return {
    version: 1,
    componentName: 'EraLottery',
    profile: 'style-config',
    width: 375,
    height: 600,
    regions: [
      region('draw-one', '抽一次按钮', 24, 380, 150, 64, 'style-config-draw-one-pic', ['styleConfig.draw_one_pic']),
      region('draw-ten', '抽十次按钮', 201, 380, 150, 64, 'style-config-draw-ten-pic', ['styleConfig.draw_ten_pic']),
      region('thanks', '谢谢参与', 112, 470, 150, 56, 'style-config-thanks-pic', ['styleConfig.thanks_pic']),
      region('runtime', '抽奖运行区域', 24, 24, 327, 320, undefined, ['styleConfig.bgColor'], 'runtime'),
    ],
    propertyValues: { 'styleConfig.bgColor': '#1e293b', 'styleConfig.majorTextColor': '#ffffff' },
    visualTheme: { source: 'kv', referenceImageIndex: 1, colors: ['#ffbf1f', '#ff8a00'], visualStyle: '黄色活动' },
    diagnostics: [],
  }
}

function createTasklistBlueprint() {
  return {
    version: 1,
    componentName: 'EraTasklist',
    profile: 'style',
    width: 375,
    height: 520,
    regions: [
      region('task-list', '任务列表运行区域', 12, 12, 351, 496, undefined, ['style.width', 'style.bgColor'], 'runtime'),
    ],
    propertyValues: { 'style.width': 350, 'style.bgColor': '#1e293b', 'style.themeColor': '#2563eb' },
    visualTheme: { source: 'kv', referenceImageIndex: 1, colors: ['#ffbf1f', '#ff8a00'], visualStyle: '黄色活动' },
    diagnostics: [],
  }
}

function region(id, role, x, y, width, height, slotId, propBindings, renderMode = 'generated-asset') {
  return {
    id,
    role,
    bounds: { x, y, width, height },
    slotId,
    propBindings,
    renderMode,
    confidence: 0.95,
  }
}

function createComponentArtifacts(question) {
  const shellSize = question.match(/component-visual-shell[^\n]*size=(\d+)x(\d+)/)
  if (!shellSize) throw new Error('组件素材请求缺少 visual-shell 尺寸')
  const slotCount = Array.from(question.matchAll(/^\d+\. component-asset-/gm)).length
  return [
    createShell(Number(shellSize[1]), Number(shellSize[2]), '#ffbf1f'),
    ...Array.from({ length: slotCount }, (_, index) => createAsset(index)),
  ]
}

function createShell(width, height, color = '#0f172a') {
  return {
    kind: 'svg',
    name: 'visual-shell.svg',
    content: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" fill="${color}"/>`,
      `<rect x="12" y="12" width="${Math.max(1, width - 24)}" height="${Math.max(1, height - 24)}" fill="${color}"/>`,
      '</svg>',
    ].join(''),
  }
}

function createAsset(index) {
  const width = 150
  const height = index === 2 ? 56 : 64
  return {
    kind: 'svg',
    name: `asset-${index + 1}.svg`,
    content: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" rx="16" fill="#2563eb"/>`,
      `<path d="M8 ${height / 2}H${width - 8}" stroke="#93c5fd" stroke-width="2"/>`,
      '<circle cx="20" cy="20" r="6" fill="#ffffff" opacity="0.7"/>',
      '</svg>',
    ].join(''),
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
