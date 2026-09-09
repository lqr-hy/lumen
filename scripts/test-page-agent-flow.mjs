import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { runtimeDomInspectionToSceneGraph } from '../electron/runtime/runtime-dom-adapter.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import {
  configureSkillRuntime,
  executeSkillTool,
  loadComponentFromPrompt,
  loadComponentsFromPrompt,
} from '../electron/runtime/skills.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-page-agent-'))

// 每个组件的真实渲染高度。Blueprint 必须用这些值而不是固定估算值。
const RUNTIME_HEIGHTS = { EraLottery: 742, EraTasklist: 528 }
const inspectorWidths = []

function createRuntimeInspectorStub() {
  return async (input) => {
    const componentName = String(input?.component?.name || '')
    const height = RUNTIME_HEIGHTS[componentName]
    inspectorWidths.push({ componentName, width: input?.width })
    if (!height) return { status: 'unsupported', sceneGraph: undefined, diagnostics: [] }
    const width = input?.width ?? 375
    // 走生产转换器构造 SceneGraph，保证节点形状与真实 Runtime Inspect 一致。
    const designTree = {
      version: 1,
      componentName,
      width,
      height,
      nodes: [
        {
          id: `${componentName}-root`,
          type: 'container',
          role: componentName,
          bounds: { x: 0, y: 0, width, height },
          style: { background: '#7a3500' },
          visible: true,
        },
        {
          id: `${componentName}-title`,
          type: 'text',
          role: '标题',
          parentId: `${componentName}-root`,
          bounds: { x: 16, y: 16, width: width - 32, height: 28 },
          content: componentName,
          style: { color: '#fff7d6', fontSize: 18, fontWeight: 600 },
          visible: true,
        },
      ],
      diagnostics: [],
    }
    return {
      status: 'completed',
      diagnostics: [],
      designTree,
      sceneGraph: runtimeDomInspectionToSceneGraph({ designTree }, { sourceId: componentName }),
    }
  }
}
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
  const calls = {
    lotteryBlueprint: 0,
    tasklistBlueprint: 0,
    pageShell: 0,
    theme: 0,
    vision: 0,
    snapshot: 0,
  }
  const payload = {
    type: 'agent_run',
    sessionId,
    provider: 'codex',
    model: 'test',
    question: '使用 EraLottery.json 和 EraTasklist.json 生成完整活动页面',
    uploads: [
      {
        type: 'file',
        name: 'campaign-kv.png',
        mime: 'image/png',
        role: 'kv',
        data: 'data:image/png;base64,iVBORw0KGgo=',
      },
    ],
    canvasTarget: {
      artboardId: 'page-board',
      createdForThread: true,
      width: 375,
      height: 812,
      placementMode: 'new-artboard',
      placementSource: 'prompt',
    },
    enableVisionReview: true,
  }
  const dependencies = {
    executeSkillTool,
    loadComponentFromPrompt,
    loadComponentsFromPrompt,
    invokeProvider: createPageProvider({ calls }),
    inspectRuntimeSource: createRuntimeInspectorStub(),
  }
  const confirmation = await runDesignWorkflow(payload, {}, dependencies)
  assert(
    confirmation.awaitingConfirmation?.type === 'blueprint-confirmation',
    '页面生成前没有暂停等待 Blueprint 确认',
  )
  const pendingSections = confirmation.awaitingConfirmation.blueprint.sections
  const pendingComponentSections = pendingSections.filter(
    (section) => section.kind === 'component-instance',
  )
  assert(pendingComponentSections.length === 2, '待确认 Blueprint 模块数量错误')
  const pendingHero = pendingSections.find((section) => section.kind === 'page-hero')
  assert(
    pendingHero && pendingHero.bounds.y === 0 && pendingHero.bounds.height > 0,
    '有 KV 时 Blueprint 必须在页面顶部预留主视觉区',
  )
  assert(
    pendingComponentSections.every(
      (section) => section.bounds.y >= pendingHero.bounds.height,
    ),
    '组件 Section 不得压在 KV 预留区上',
  )
  assert(
    pendingComponentSections.map((section) => section.bounds.height).join(',') ===
      `${RUNTIME_HEIGHTS.EraLottery},${RUNTIME_HEIGHTS.EraTasklist}`,
    '组件 Section 高度应来自真实渲染量测，而不是固定的 520',
  )
  // 量测必须按 Section 实际宽度（375 - 16*2）进行，否则量到的高度对不上真实排版。
  assert(
    inspectorWidths.length === 2 && inspectorWidths.every((item) => item.width === 343),
    '组件高度量测没有使用 Section 实际宽度',
  )
  assert(
    calls.lotteryBlueprint === 0 && calls.tasklistBlueprint === 0,
    '确认前不得生成组件 Blueprint 或素材',
  )
  const reversedSections = [...pendingComponentSections].reverse().map((section, index) => ({
    ...section,
    bounds: { ...section.bounds, y: index * 544, height: index === 0 ? 520 : 500 },
  }))
  const blueprintOverride = {
    ...confirmation.awaitingConfirmation.blueprint,
    estimatedHeight: 1064,
    sections: reversedSections,
    constraints: [
      { type: 'vertical-gap', from: reversedSections[0].id, to: reversedSections[1].id, value: 24 },
    ],
  }
  const incrementalDeliveries = []
  const result = await runDesignWorkflow(
    { ...payload, question: '确认执行', blueprintOverride },
    {
      onCanvasSnapshotRequest: async (request) => {
        calls.snapshot += 1
        assert(
          request.artboardId === payload.canvasTarget.artboardId,
          'Vision Review 请求了错误画板',
        )
        return {
          status: 'ready',
          snapshot: {
            data: 'data:image/png;base64,iVBORw0KGgo=',
            mime: 'image/png',
            width: 375,
            height: blueprintOverride.estimatedHeight,
          },
        }
      },
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
        if (deliverable.kind === 'page-finalize') {
          return {
            status: 'success',
            summary: '完整页面已通过测试画布终态校验。',
            data: {
              artboardId: deliverable.target.artboardId,
              shellElementId: 'page-shell-test',
              hasPageShell: true,
              elementCount: 9,
              componentCount: deliverable.expectedComponentCount,
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
    },
    dependencies,
  )

  const deliveredComponentSections = result.pageDesign?.blueprint.sections.filter(
    (section) => section.kind === 'component-instance',
  )
  assert(deliveredComponentSections?.length === 2, '页面 Blueprint 应包含两个组件 Section')
  assert(result.pageDesign.blueprint.estimatedHeight === 1064, '确认后的 Blueprint 高度没有生效')
  assert(
    deliveredComponentSections[0].component.componentName === 'EraTasklist',
    '确认前排序没有生效',
  )
  assert(result.pageComponents?.length === 2, '页面结果应包含两个独立组件实例')
  const embeddedSurfaces = result.pageComponents.map(
    (component) => component.previewArtifact?.content ?? '',
  )
  assert(
    embeddedSurfaces.every((content) => content.includes('component-surface')),
    '页面组件缺少 Tonal Surface',
  )
  assert(
    embeddedSurfaces.every((content) => !content.includes('radialGradient')),
    '页面组件 Surface 不得重复放射构图',
  )
  assert(
    embeddedSurfaces.every((content) => /fill-opacity="0\.88"/.test(content)),
    '页面组件 Surface 覆盖率应为 0.88',
  )
  const visualDirection = await executeSkillTool('page-visual-direction.compile', {
    goal: '根据指定组件生成页面',
    componentNames: ['EraLottery', 'EraTasklist'],
    componentCount: 2,
    visualTheme: { colors: ['#ffbf1f', '#ff8a00'] },
  })
  assert(visualDirection.pageKind === 'campaign', '活动组件类别没有驱动页面类型识别')
  assert(visualDirection.regions[1].role === 'content-bed', '页面视觉方向缺少低密度内容区')
  assert(visualDirection.surfaceTreatment.opacity >= 0.8, '页面组件 Surface 覆盖率过低')
  assert(result.pageShellArtifact?.kind === 'svg', '页面缺少独立视觉外壳')
  assert(result.pageDesign.qualityReview.passed, '页面质量门禁没有通过')
  assert(result.pageDesign.qualityReview.evalVersion === 1, '页面缺少统一 Design Eval 版本')
  assert(Number.isFinite(result.pageDesign.qualityReview.overall), '页面缺少 Design Eval 总分')
  assert(
    Number.isFinite(result.pageDesign.qualityReview.dimensions.componentIntegrity),
    '页面缺少组件完整性评分',
  )
  assert(calls.pageShell === 1, '页面外壳应只生成一次')
  assert(calls.theme === 1, '页面 KV 应只提取一次共享主题')
  assert((calls.componentBackdrop ?? 0) === 0, '页面内嵌组件不应重复调用高饱和背景生图')
  assert(calls.snapshot === 1, '页面评审应只请求一次 Renderer PNG 快照')
  assert(calls.vision === 1, '页面评审应只请求一次 Vision Provider')
  assert(
    result.agent.plan.filter((step) => step.tool === 'page.generate-component').length === 2,
    'Agent 没有插入独立页面组件 Step',
  )
  assert(result.agent.plan.length === 9, '双组件页面应包含 7 个统一阶段和 2 个可恢复组件子任务')
  assert(
    incrementalDeliveries.filter((item) => item.kind === 'page-shell').length === 1,
    '页面外壳应在组件前增量交付',
  )
  assert(
    incrementalDeliveries.filter((item) => item.kind === 'page-component').length === 2,
    '每个页面组件完成后都应触发增量交付',
  )
  const deliveredComponentNames = incrementalDeliveries
    .filter((item) => item.kind === 'page-component')
    .map((item) => item.component.componentDesign.componentName)
    .sort()
  assert(
    deliveredComponentNames.join(',') === 'EraLottery,EraTasklist',
    '页面组件子任务错误复用了第一个组件引用',
  )
  assert(
    incrementalDeliveries.filter((item) => item.kind === 'page-finalize').length === 1,
    '页面完成后应触发最终画布校验',
  )
  const finalDelivery = incrementalDeliveries.find((item) => item.kind === 'page-finalize')
  assert(finalDelivery.expectedPageSectionIds.length === 2, '最终交付缺少成功组件 Section ID')
  assert(
    finalDelivery.expectedPageSectionIds.join(',') ===
      reversedSections.map((section) => section.id).join(','),
    '最终交付的成功组件 Section ID 与确认后 Blueprint 不一致',
  )
  assert(
    result.agent.canvasObservations.length === 4,
    'Renderer 写入结果没有保存为 Canvas Observation',
  )
  assert(
    result.agent.canvasObservations.every((item) => item.status === 'success'),
    '增量画布后置条件未通过',
  )
  assert(result.agent.canvasSnapshot.hasPageShell === true, 'CanvasSnapshot 没有同步页面外壳状态')
  assert(result.agent.canvasSnapshot.componentCount === 2, 'CanvasSnapshot 没有同步页面组件数量')

  const recovery = await executeRecoveryFlow()
  assert(recovery.result.pageComponents.length === 1, '限流组件失败后应继续交付其他成功组件')
  assert(recovery.result.text.includes('生成失败：EraLottery'), '限流组件没有进入页面失败清单')
  assert(recovery.calls.lotteryBackdrop === undefined, '页面内嵌组件不应请求独立氛围底图')
  assert(recovery.calls.lotterySlot === 3, '429 限流后不应立即重复请求同一 Props 素材')
  const deliveryGate = await executeCanvasDeliveryFailureFlow()
  assert(deliveryGate.failed, 'Renderer 写入失败后 Agent 不应继续完成页面')

  console.log(
    JSON.stringify(
      {
        taskKind: 'page-design',
        independentComponentSteps: true,
        sections: result.pageDesign.blueprint.sections.length,
        pageShell: true,
        qualityGate: result.pageDesign.qualityReview.passed,
        blueprintConfirmation: true,
        editableBlueprintOverride: true,
        pageDecisionRepairLoop: true,
        pageEmbeddedComponentSurface: true,
        imageRateLimitPartialDelivery: true,
        incrementalCanvasDelivery: true,
        rendererCanvasObservation: true,
        incrementalPageShell: true,
        liveCanvasSnapshot: true,
        rendererPngVisionReview: true,
        rendererDeliveryFailureGate: true,
      },
      null,
      2,
    ),
  )
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
    invokeProvider: createPageProvider({ calls, lotteryFailures: 1 }),
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
  const confirmation = await runDesignWorkflow(payload, {}, dependencies)
  assert(confirmation.awaitingConfirmation, '故障恢复流程没有先等待 Blueprint 确认')
  const result = await runDesignWorkflow({ ...payload, question: '确认执行' }, {}, dependencies)
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
    question: '使用 EraLottery.json 和 EraTasklist.json 生成完整活动页面',
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
  const confirmation = await runDesignWorkflow(payload, {}, dependencies)
  assert(confirmation.awaitingConfirmation, '交付失败门禁流程没有等待 Blueprint 确认')
  try {
    await runDesignWorkflow(
      { ...payload, question: '确认执行' },
      {
        onDeliverable: async (deliverable) =>
          deliverable.kind === 'page-shell'
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
      },
      dependencies,
    )
  } catch (error) {
    assert(error.code === 'TEST_CANVAS_WRITE_FAILED', 'Renderer 失败错误码没有传播到 Agent Step')
    return { failed: true }
  }
  return { failed: false }
}

function createPageProvider(options = {}) {
  let lotteryFailures = options.lotteryFailures ?? 0
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
    if (payload.type === 'generate_image') {
      const task = payload.imageTasks[0]
      const lottery = /生成 EraLottery 的/.test(payload.question)
      if (lottery) options.calls && (options.calls.lotteryBlueprint += 1)
      else options.calls && (options.calls.tasklistBlueprint += 1)
      if (options.calls && task.role === 'component-backdrop') {
        options.calls.componentBackdrop = (options.calls.componentBackdrop ?? 0) + 1
      } else if (options.calls && task.kind === 'component-slot') {
        options.calls.componentSlot = (options.calls.componentSlot ?? 0) + 1
      }
      if (options.calls && lottery && task.role === 'component-backdrop') {
        options.calls.lotteryBackdrop = (options.calls.lotteryBackdrop ?? 0) + 1
      } else if (options.calls && lottery && task.kind === 'component-slot') {
        options.calls.lotterySlot = (options.calls.lotterySlot ?? 0) + 1
      }
      if (lottery && task.id === 'component-slot-3' && lotteryFailures > 0) {
        lotteryFailures -= 1
        const error = new Error('生图服务请求失败：429：rate limit exceeded')
        error.code = 'IMAGE_UPSTREAM_REQUEST_FAILED'
        error.details = { status: 429 }
        throw error
      }
      return { artifact: createComponentArtifactForTask(task, payload.question) }
    }
    if (payload.type === 'generate_assets') {
      if (payload.question.includes('只生成一个完整页面')) {
        const size = payload.question.match(/输出尺寸必须为 (\d+)x(\d+)/)
        options.calls && (options.calls.pageShell += 1)
        const colors = extractThemeColors(payload.question)
        return {
          artifacts: [
            createShell(Number(size?.[1] || 375), Number(size?.[2] || 812), colors[0] ?? '#0f172a'),
          ],
        }
      }
      throw new Error('组件 Editable Scene 不应请求完整组件素材集合')
    }
    if (payload.type === 'vision_review') {
      options.calls && (options.calls.vision += 1)
      const reviewImage = payload.uploads.at(-1)
      assert(reviewImage.mime === 'image/png', 'Vision Provider 没有收到 PNG 画板快照')
      assert(
        reviewImage.data.startsWith('data:image/png;base64,'),
        'Vision Provider 收到的快照不是 PNG Data URI',
      )
      assert(
        !payload.uploads.some((upload) => upload.mime === 'image/svg+xml'),
        'Vision Provider 不应收到 SVG',
      )
      return {
        visionReview: {
          scores: { theme: 1, readability: 1, hierarchy: 1, referenceSimilarity: 1 },
          issues: [],
          message: '页面视觉评审通过。',
        },
      }
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
      region('draw-one', '抽一次按钮', 24, 380, 150, 64, 'style-config-draw-one-pic', [
        'styleConfig.draw_one_pic',
      ]),
      region('draw-ten', '抽十次按钮', 201, 380, 150, 64, 'style-config-draw-ten-pic', [
        'styleConfig.draw_ten_pic',
      ]),
      region('thanks', '谢谢参与', 112, 470, 150, 56, 'style-config-thanks-pic', [
        'styleConfig.thanks_pic',
      ]),
      region(
        'runtime',
        '抽奖运行区域',
        24,
        24,
        327,
        320,
        undefined,
        ['styleConfig.bgColor'],
        'runtime',
      ),
    ],
    propertyValues: { 'styleConfig.bgColor': '#1e293b', 'styleConfig.majorTextColor': '#ffffff' },
    visualTheme: {
      source: 'kv',
      referenceImageIndex: 1,
      colors: ['#ffbf1f', '#ff8a00'],
      visualStyle: '黄色活动',
    },
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
      region(
        'task-list',
        '任务列表运行区域',
        12,
        12,
        351,
        496,
        undefined,
        ['style.width', 'style.bgColor'],
        'runtime',
      ),
    ],
    propertyValues: {
      'style.width': 350,
      'style.bgColor': '#1e293b',
      'style.themeColor': '#2563eb',
    },
    visualTheme: {
      source: 'kv',
      referenceImageIndex: 1,
      colors: ['#ffbf1f', '#ff8a00'],
      visualStyle: '黄色活动',
    },
    diagnostics: [],
  }
}

function region(
  id,
  role,
  x,
  y,
  width,
  height,
  slotId,
  propBindings,
  renderMode = 'generated-asset',
) {
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

function createComponentArtifactForTask(task, question) {
  const colors = extractThemeColors(question)
  const { width, height } = task.targetSize
  return {
    kind: 'svg',
    name: `${task.id}.svg`,
    content: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" rx="12" fill="${colors[0] ?? '#2563eb'}"/>`,
      `<rect x="6" y="6" width="${Math.max(1, width - 12)}" height="${Math.max(1, height - 12)}" rx="8" fill="none" stroke="${colors[2] ?? '#ffffff'}"/>`,
      `<circle cx="18" cy="18" r="5" fill="${colors[1] ?? '#93c5fd'}"/>`,
      '</svg>',
    ].join(''),
  }
}

function extractThemeColors(question) {
  return (
    question.match(/"colors"\s*:\s*\[([^\]]+)\]/)?.[1].match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) ??
    []
  )
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
