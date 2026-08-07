import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runAgent } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { normalizeComponentBlueprint } from '../electron/runtime/request.mjs'
import {
  configureSkillRuntime,
  executeSkillTool,
  loadComponentFromPrompt,
} from '../electron/runtime/skills.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-campaign-component-flow-'))
configureAgentSessionStore(testRoot)
configureSkillRuntime({ appRoot, resourcesPath: appRoot, isPackaged: false })

const thumbnailUpload = {
  type: 'file',
  name: 'thumbnail.png',
  mime: 'image/png',
  role: 'prototype',
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
}
const originalFetch = globalThis.fetch

try {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
  })
  const bundled = await loadComponentFromPrompt('使用 EraLottery.json 生成组件设计')
  assert(bundled.component.name === 'EraLottery', '打包组件名称匹配失败')
  assert(bundled.thumbnailUpload?.data.startsWith('data:image/png;base64,'), 'thumbnail 加载失败')

  const normalizedBlueprint = normalizeComponentBlueprint({
    version: '1',
    componentName: 'EraLottery',
    profile: 'style-config',
    width: '375',
    height: '600',
    regions: [{
      id: 'runtime',
      role: '抽奖运行区域',
      bounds: { x: '-2', y: '0', width: '377', height: '620' },
      renderMode: 'runtime',
    }],
  })
  assert(normalizedBlueprint.version === 1, 'Blueprint 数字字符串没有归一化')
  assert(normalizedBlueprint.regions[0].bounds.x === 0, 'Blueprint 负坐标没有裁切')
  assert(normalizedBlueprint.height === 620, 'Blueprint 画布没有扩展到包含 Region')
  assert(Array.isArray(normalizedBlueprint.regions[0].propBindings), '缺省 propBindings 没有补齐')
  assert(normalizedBlueprint.regions[0].renderMode === 'runtime', '缺省 renderMode 没有安全降级')
  assert(normalizedBlueprint.regions[0].confidence === 0.5, '缺省 confidence 没有补齐')

  const normalizedThemeBlueprint = normalizeComponentBlueprint({
    ...createYellowTasklistBlueprint(),
    visualTheme: {
      source: 'kv',
      referenceImageIndex: 2,
      colors: ['#ffbf1f', '#ff8a00', '#fff7d6'],
      visualStyle: '黄色活动 KV',
    },
  })
  assert(normalizedThemeBlueprint.visualTheme.colorTokens.length === 3, '主题颜色 Token 没有补齐')
  assert(normalizedThemeBlueprint.visualTheme.typography.length >= 3, '主题字体 Token 没有补齐')
  assert(normalizedThemeBlueprint.visualTheme.surfaces.length >= 1, '主题 Surface Token 没有补齐')
  assert(normalizedThemeBlueprint.visualTheme.spacing.scale.length >= 4, '主题间距 Token 没有补齐')

  const lottery = await executeComponentFlow('EraLottery', createLotteryBlueprint)
  assert(lottery.result.componentDesign?.componentName === 'EraLottery', 'EraLottery 组件结果缺失')
  assert(lottery.result.agent.plan.length === 8, '组件 Plan 应包含 8 个步骤')
  assert(lottery.assetCalls === 1, 'EraLottery 应调用一次独立素材生成')
  assert(lottery.result.artifacts.length === 3, 'style-config 应生成 3 个主素材')
  assert(lottery.result.visualShellArtifact?.kind === 'svg', 'EraLottery 缺少设计级视觉外壳')
  const lotteryPatch = lottery.result.componentDesign.propsPatch.styleConfig
  assert(lotteryPatch.draw_one_pic.startsWith('data:image/svg+xml'), '抽一次素材未写入 Props Patch')
  assert(lotteryPatch.draw_ten_pic.startsWith('data:image/svg+xml'), '抽十次素材未写入 Props Patch')
  assert(!('config' in lottery.result.componentDesign.propsPatch), '业务 config 不得进入 Props Patch')

  const directLottery = await executeComponentFlow('EraLottery', createLotteryBlueprint, {
    question: '现在只生成 EraLottery',
  })
  assert(directLottery.result.componentDesign?.componentName === 'EraLottery', '直接组件名称没有进入组件生成 Run')
  assert(directLottery.result.visualShellArtifact?.kind === 'svg', '直接组件生成缺少可交付视觉外壳')

  const repairedLottery = await executeComponentFlow('EraLottery', createIncompleteLotteryBlueprint)
  const repairedThanks = repairedLottery.result.componentDesign.blueprint.regions.find(
    (region) => region.slotId === 'style-config-thanks-pic',
  )
  assert(repairedThanks?.renderMode === 'generated-asset', '缺失的 thanks_pic Slot 没有自动补全')
  const repairedTitle = repairedLottery.result.componentDesign.blueprint.regions.find(
    (region) => region.id === 'generic-title',
  )
  assert(repairedTitle?.role !== 'text' && repairedTitle?.content === '轮播抽奖', '通用文本占位没有修复')
  assert(
    repairedLottery.result.componentDesign.diagnostics.some(
      (diagnostic) => diagnostic.code === 'COMPONENT_SLOT_MAPPING_REPAIRED',
    ),
    'Slot 自动补全没有记录诊断信息',
  )
  assert(repairedLottery.result.artifacts.length === 3, 'Slot 补全后仍应生成全部三个独立素材')

  const contextual = await executeContextualComponentFlow()
  assert(contextual.result.componentDesign?.componentName === 'EraLottery', '跨轮组件约束没有恢复')
  assert(contextual.loadedPrompt.includes('EraLottery.json'), '组件解析没有使用历史 JSON 选择器')
  assert(contextual.revisionResult.componentDesign?.componentName === 'EraLottery', '完善设计稿追问没有进入组件 Run')
  assert(contextual.revisionResult.editScope?.type === 'component-instance', '组件整体修订范围没有保留')

  const slotEdit = await executeSlotEdit()
  assert(slotEdit.result.agent.plan.length === 4, '局部 Slot Plan 应包含 4 个步骤')
  assert(slotEdit.assetCalls === 1, '局部 Slot 只能调用一次素材生成')
  assert(slotEdit.result.editScope.elementId === 'element-draw-one', '局部结果缺少原 elementId')
  assert(slotEdit.result.artifact?.kind === 'svg', '局部 Slot 没有返回替换素材')

  const tasklist = await executeComponentFlow('EraTasklist', createTasklistBlueprint)
  assert(tasklist.result.componentDesign?.componentName === 'EraTasklist', 'EraTasklist 组件结果缺失')
  assert(tasklist.assetCalls === 1, '无图片 Slot 组件仍应生成一个视觉外壳')
  assert(tasklist.result.artifacts.length === 0, '无图片 Slot 组件不应返回独立素材')
  assert(tasklist.result.visualShellArtifact?.kind === 'svg', '无图片 Slot 组件缺少视觉外壳')
  assert(tasklist.result.artifact?.kind === 'svg', '无图片 Slot 组件仍应返回预览')
  assert(tasklist.result.componentDesign.propsPatch.style.width === 350, '尺寸 Patch 缺失')
  assert(tasklist.result.componentDesign.qualityReview?.passed, '组件缺少结构化质量报告')
  assert(
    tasklist.result.componentDesign.runtimeValidation?.status === 'unsupported',
    '没有真实组件 Bundle 时必须明确标记 Runtime unsupported',
  )

  const yellowTasklist = await executeComponentFlow(
    'EraTasklist',
    createYellowTasklistBlueprint,
    {
      question: '根据 7-ShmsN8 设计 EraTasklist 组件',
      forceFirstThemeMismatch: true,
      uploads: [{
        ...thumbnailUpload,
        name: '7-ShmsN8.jpg',
        data: 'data:image/png;base64,aGVsbG8=',
        role: undefined,
      }],
    },
  )
  assert(
    yellowTasklist.result.componentDesign.propsPatch.style.themeColor === '#ffbf1f',
    'KV 主色没有覆盖组件默认主题色',
  )
  assert(yellowTasklist.assetCalls === 2, '视觉外壳偏离 KV 时没有自动重试')
  assert(yellowTasklist.result.componentDesign.qualityReview.repairCount === 1, '主题自动修订次数没有记录')
  assert(
    yellowTasklist.result.componentDesign.propsPatch.style.bgColor === '#ff8a00',
    'KV 辅助色没有覆盖组件默认背景色',
  )
  assert(
    yellowTasklist.providerQuestions.some((question) => (
      question.includes('图片 2：7-ShmsN8.jpg') && question.includes('强制视觉来源')
    )),
    '组件请求没有明确标注用户视觉参考图',
  )
  assert(
    yellowTasklist.providerQuestions.some((question) => (
      question.includes('必须严格执行以下视觉主题契约') && question.includes('#ffbf1f')
    )),
    '素材阶段没有继承 Component Blueprint 的视觉主题',
  )

  console.log(JSON.stringify({
    lottery: {
      steps: lottery.result.agent.plan.length,
      assets: lottery.result.artifacts.length,
      visualShell: Boolean(lottery.result.visualShellArtifact),
      profile: lottery.result.componentDesign.profile,
    },
    slotMappingRepair: {
      repaired: Boolean(repairedThanks),
      assets: repairedLottery.result.artifacts.length,
    },
    tasklist: {
      assets: tasklist.result.artifacts.length,
      profile: tasklist.result.componentDesign.profile,
      preview: Boolean(tasklist.result.artifact),
      visualShell: Boolean(tasklist.result.visualShellArtifact),
    },
    kvThemeAlignment: {
      themeColor: yellowTasklist.result.componentDesign.propsPatch.style.themeColor,
      backgroundColor: yellowTasklist.result.componentDesign.propsPatch.style.bgColor,
      visualTheme: yellowTasklist.result.componentDesign.blueprint.visualTheme,
    },
    slotEdit: {
      steps: slotEdit.result.agent.plan.length,
      assets: slotEdit.assetCalls,
      elementId: slotEdit.result.editScope.elementId,
    },
    contextual: {
      componentName: contextual.result.componentDesign.componentName,
      steps: contextual.result.agent.plan.length,
      revisionExecuted: Boolean(contextual.revisionResult.componentDesign),
    },
  }, null, 2))
} finally {
  globalThis.fetch = originalFetch
  await fs.rm(testRoot, { recursive: true, force: true })
}

async function executeSlotEdit() {
  let assetCalls = 0
  const editScope = {
    type: 'component-region',
    elementId: 'element-draw-one',
    instanceId: 'instance-lottery',
    componentName: 'EraLottery',
    profile: 'style-config',
    regionId: 'draw-one',
    slotId: 'style-config-draw-one-pic',
    propPath: 'styleConfig.draw_one_pic',
    targetSize: { width: 150, height: 64 },
    exactText: '抽一次',
    currentImage: thumbnailUpload.data,
  }
  const result = await runAgent({
    type: 'agent_run',
    sessionId: `component-slot-${Date.now()}`,
    provider: 'codex',
    model: 'test',
    question: '把这个按钮换成金色科技风',
    uploads: [],
    editScope,
    canvasTarget: {
      artboardId: 'board-EraLottery',
      createdForThread: false,
      width: 375,
      height: 812,
      placementMode: 'append-section',
      placementSource: 'default',
    },
  }, {}, {
    executeSkillTool,
    invokeProvider: async (payload) => {
      if (payload.type !== 'generate_assets') {
        throw new Error(`未预期的 Provider 请求：${payload.type}`)
      }
      assetCalls += 1
      return { artifacts: [createAsset(0)] }
    },
  })
  return { result, assetCalls }
}

async function executeComponentFlow(componentName, createBlueprint, options = {}) {
  const source = await fs.readFile(path.join(appRoot, 'componentsJson', `${componentName}.json`), 'utf8')
  const component = JSON.parse(source)
  let assetCalls = 0
  const providerQuestions = []
  const result = await runAgent({
    type: 'agent_run',
    sessionId: `component-${componentName}-${Date.now()}`,
    provider: 'codex',
    model: 'test',
    question: options.question ?? `根据 ${componentName} 组件 JSON 生成设计预览和配置`,
    uploads: options.uploads ?? [],
    canvasTarget: {
      artboardId: `board-${componentName}`,
      createdForThread: true,
      width: 375,
      height: 812,
      placementMode: 'append-section',
      placementSource: 'default',
    },
  }, {}, {
    executeSkillTool,
    loadComponentFromPrompt: async () => ({
      component,
      source,
      fileName: `${componentName}.json`,
      thumbnailUpload,
    }),
    invokeProvider: async (payload) => {
      providerQuestions.push(payload.question)
      if (payload.type === 'generate_component_blueprint') {
        return { componentBlueprint: createBlueprint() }
      }
      if (payload.type === 'generate_assets') {
        assetCalls += 1
        const question = options.forceFirstThemeMismatch && assetCalls === 1
          ? payload.question.replaceAll('#ffbf1f', '#2563eb').replaceAll('#ff8a00', '#0f172a')
          : payload.question
        return { artifacts: createComponentArtifacts(question) }
      }
      throw new Error(`未预期的 Provider 请求：${payload.type}`)
    },
  })
  return { result, assetCalls, providerQuestions }
}

async function executeContextualComponentFlow() {
  const componentName = 'EraLottery'
  const source = await fs.readFile(path.join(appRoot, 'componentsJson', `${componentName}.json`), 'utf8')
  const component = JSON.parse(source)
  let loadedPrompt = ''
  const sessionId = `component-context-${Date.now()}`
  const dependencies = {
    executeSkillTool,
    loadComponentFromPrompt: async (prompt) => {
      loadedPrompt = prompt
      return { component, source, fileName: `${componentName}.json`, thumbnailUpload }
    },
    invokeProvider: async (payload) => {
      if (payload.type === 'generate_component_blueprint') {
        return { componentBlueprint: createLotteryBlueprint() }
      }
      if (payload.type === 'generate_assets') {
        return { artifacts: createComponentArtifacts(payload.question) }
      }
      throw new Error(`未预期的 Provider 请求：${payload.type}`)
    },
  }
  const target = {
    artboardId: 'board-contextual-EraLottery',
    createdForThread: true,
    width: 375,
    height: 812,
    placementMode: 'append-section',
    placementSource: 'default',
  }
  const result = await runAgent({
    type: 'agent_run',
    sessionId,
    provider: 'codex',
    model: 'test',
    question: '生成设计稿',
    history: [
      { role: 'user', text: '请使用 EraLottery.json，严格按照这个组件的字段和缩略图设计' },
      { role: 'agent', text: '已理解组件配置。' },
    ],
    uploads: [],
    canvasTarget: target,
  }, {}, dependencies)
  const revisionResult = await runAgent({
    type: 'agent_run',
    sessionId,
    provider: 'codex',
    model: 'test',
    question: '完善一下整体设计稿，现在只有 props',
    history: [
      { role: 'user', text: '请使用 EraLottery.json，严格按照这个组件的字段和缩略图设计' },
      { role: 'agent', text: result.text },
    ],
    uploads: [],
    editScope: {
      type: 'component-instance',
      elementId: 'component-root-existing',
      instanceId: 'component-instance-existing',
      componentName: 'EraLottery',
      profile: 'style-config',
    },
    canvasTarget: { ...target, createdForThread: false },
  }, {}, dependencies)
  return { result, revisionResult, loadedPrompt }
}

function createLotteryBlueprint() {
  return {
    version: 1,
    componentName: 'EraLottery',
    profile: 'style-config',
    width: 375,
    height: 600,
    regions: [
      createRegion('draw-one', '抽一次按钮', 24, 380, 150, 64, 'style-config-draw-one-pic', ['styleConfig.draw_one_pic']),
      createRegion('draw-ten', '抽十次按钮', 201, 380, 150, 64, 'style-config-draw-ten-pic', ['styleConfig.draw_ten_pic']),
      createRegion('thanks', '谢谢参与', 112, 470, 150, 56, 'style-config-thanks-pic', ['styleConfig.thanks_pic']),
      createRegion('runtime', '抽奖运行区域', 24, 24, 327, 320, undefined, ['styleConfig.bgColor'], 'runtime'),
    ],
    propertyValues: {
      'styleConfig.bgColor': 'rgba(12, 24, 72, 1)',
      'styleConfig.majorTextColor': '#ffffff',
      'styleConfig.open_lottery_ten_btn': true,
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
      createRegion('task-list', '任务列表运行区域', 12, 12, 351, 496, undefined, ['style.width', 'style.bgColor'], 'runtime'),
    ],
    propertyValues: {
      'style.width': 350,
      'style.bgColor': 'rgba(0, 20, 60, 1)',
      'style.themeColor': '#23d3fa',
    },
    diagnostics: [],
  }
}

function createYellowTasklistBlueprint() {
  return {
    ...createTasklistBlueprint(),
    visualTheme: {
      source: 'visual',
      referenceImageIndex: 2,
      colors: ['#ffbf1f', '#ff8a00', '#fff7d6', '#7a3500'],
      visualStyle: '高饱和黄色活动 KV，橙色阴影，放射状促销装饰',
    },
  }
}

function createIncompleteLotteryBlueprint() {
  const blueprint = createLotteryBlueprint()
  return {
    ...blueprint,
    regions: [
      ...blueprint.regions.filter((region) => region.slotId !== 'style-config-thanks-pic'),
      {
        id: 'generic-title',
        role: 'text',
        content: 'text',
        bounds: { x: 24, y: 540, width: 327, height: 40 },
        propBindings: ['styleConfig.majorTextColor'],
        renderMode: 'text',
        confidence: 0.9,
      },
    ],
  }
}

function createRegion(id, role, x, y, width, height, slotId, propBindings, renderMode = 'generated-asset') {
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

function createAsset(index) {
  const width = 150
  const height = index === 2 ? 56 : 64
  return {
    kind: 'svg',
    name: `asset-${index + 1}.png`,
    content: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" rx="16" fill="#2563eb"/>`,
      `<path d="M8 ${height / 2}H${width - 8}" stroke="#93c5fd" stroke-width="2"/>`,
      '<circle cx="20" cy="20" r="6" fill="#ffffff" opacity="0.7"/>',
      '</svg>',
    ].join(''),
  }
}

function createComponentArtifacts(question) {
  const shellSize = question.match(/component-visual-shell[^\n]*size=(\d+)x(\d+)/)
  if (!shellSize) throw new Error('组件素材请求缺少 visual-shell 尺寸')
  const slotCount = Array.from(question.matchAll(/^\d+\. component-asset-/gm)).length
  return [
    createVisualShell(
      Number(shellSize[1]),
      Number(shellSize[2]),
      question.includes('#ffbf1f') ? ['#ff8a00', '#ffbf1f'] : undefined,
    ),
    ...Array.from({ length: slotCount }, (_, index) => createAsset(index)),
  ]
}

function createVisualShell(width, height, colors = ['#0f172a', '#1e293b']) {
  return {
    kind: 'svg',
    name: 'component-visual-shell.png',
    content: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" fill="${colors[0]}"/>`,
      `<rect x="16" y="16" width="${Math.max(1, width - 32)}" height="${Math.max(1, height - 32)}" rx="24" fill="${colors[1]}" stroke="${colors[0]}"/>`,
      '</svg>',
    ].join(''),
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
