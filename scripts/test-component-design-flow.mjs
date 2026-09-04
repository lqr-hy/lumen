import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { runDesignWorkflow } from '../electron/runtime/agent.mjs'
import { configureAgentSessionStore } from '../electron/runtime/agent-session-store.mjs'
import { normalizeComponentBlueprint } from '../electron/runtime/pi/structured-results.mjs'
import { normalizeDesignTree } from '../electron/runtime/component-design-tree.mjs'
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
  const relativeTree = normalizeDesignTree({
    width: 375,
    height: 812,
    nodes: [
      { id: 'list', type: 'list', bounds: { x: 20, y: 400, width: 335, height: 300 } },
      {
        id: 'item',
        parentId: 'list',
        type: 'list-item',
        bounds: { x: 0, y: 40, width: 335, height: 100 },
      },
      {
        id: 'title',
        parentId: 'item',
        type: 'text',
        bounds: { x: 16, y: 12, width: 180, height: 24 },
        content: '任务标题',
      },
    ],
  })
  assert(
    relativeTree.nodes.find((node) => node.id === 'item')?.bounds.y === 440,
    '父级局部坐标没有转换为绝对坐标',
  )
  assert(
    relativeTree.nodes.find((node) => node.id === 'title')?.bounds.y === 452,
    '嵌套局部坐标没有递归转换',
  )
  assert(
    relativeTree.diagnostics.some(
      (item) => item.code === 'DESIGN_TREE_PARENT_COORDINATES_NORMALIZED',
    ),
    '坐标转换没有写入诊断',
  )

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

  const schemaContract = await executeSkillTool('component-design-assets.resolve-contract', {
    component: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Schema Task List',
      'x-component-name': 'SchemaTaskList',
      properties: {
        width: { type: 'number', title: '宽度', 'x-design-kind': 'width', default: 375 },
        background: { type: 'string', title: '背景色', format: 'color', default: '#fff7d6' },
        items: {
          type: 'array',
          title: '任务列表',
          'x-design': {
            role: 'repeat-list',
            itemRole: 'task-item',
            controller: 'ExampleController@ListController',
          },
          items: { type: 'object', properties: { title: { type: 'string', title: '任务标题' } } },
        },
      },
    },
    source: 'schema-fixture',
  })
  assert(schemaContract.componentName === 'SchemaTaskList', 'JSON Schema 组件名称没有适配')
  assert(schemaContract.sourceFormat === 'json-schema', 'JSON Schema 来源类型没有记录')
  assert(
    schemaContract.designProperties.some((property) => property.path === 'width'),
    'JSON Schema 尺寸字段没有进入 Contract',
  )
  assert(
    schemaContract.designProperties.some((property) => property.path === 'background'),
    'JSON Schema 颜色字段没有进入 Contract',
  )
  const schemaRepeater = schemaContract.repeaters.find((repeater) => repeater.path === 'items')
  assert(schemaRepeater, 'JSON Schema 数组没有进入 Repeaters')
  assert(schemaRepeater.role === 'repeat-list', '重复列表没有使用通用 role')
  assert(schemaRepeater.itemRole === 'task-item', '重复项没有保留通用 itemRole')
  assert(
    schemaRepeater.controller === 'ExampleController@ListController',
    '自定义控制器没有降级为元数据',
  )

  const normalizedBlueprint = normalizeComponentBlueprint({
    version: '1',
    componentName: 'EraLottery',
    profile: 'style-config',
    width: '375',
    height: '600',
    regions: [
      {
        id: 'runtime',
        role: '抽奖运行区域',
        bounds: { x: '-2', y: '0', width: '377', height: '620' },
        renderMode: 'runtime',
      },
    ],
  })
  assert(normalizedBlueprint.version === 1, 'Blueprint 数字字符串没有归一化')
  assert(normalizedBlueprint.regions[0].bounds.x === 0, 'Blueprint 负坐标没有裁切')
  assert(normalizedBlueprint.height === 620, 'Blueprint 画布没有扩展到包含 Region')
  assert(Array.isArray(normalizedBlueprint.regions[0].propBindings), '缺省 propBindings 没有补齐')
  assert(normalizedBlueprint.regions[0].renderMode === 'runtime', '缺省 renderMode 没有安全降级')
  assert(normalizedBlueprint.regions[0].confidence === 0.5, '缺省 confidence 没有补齐')

  const normalizedPreviewBlueprint = normalizeComponentBlueprint({
    ...createLotteryBlueprint(),
    regions: [
      {
        id: 'preview-list',
        role: '中奖名单',
        bounds: { x: 12, y: 300, width: 351, height: 120 },
        renderMode: 'runtime',
        preview: { variant: 'list', items: ['用户 A 获得奖品', '用户 B 获得奖品'] },
      },
    ],
  })
  assert(
    normalizedPreviewBlueprint.regions[0].preview.items.length === 2,
    'Prototype Fixture 没有归一化',
  )

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

  const lottery = await executeComponentFlow('EraLottery', createLotteryBlueprint, {
    acknowledgeCanvas: true,
  })
  assert(lottery.result.componentDesign?.componentName === 'EraLottery', 'EraLottery 组件结果缺失')
  assert(
    lottery.result.componentDesign?.packId === 'test-components',
    '组件结果缺少 Component Pack 来源',
  )
  assert(
    lottery.result.componentDesign?.designTree?.nodes.length >= 4,
    '结构树没有作为组件元数据保留',
  )
  assert(
    lottery.result.componentDesign?.deliveryMode === 'hybrid-component',
    '组件没有切换到视觉外壳 + 可编辑前景模式',
  )
  assert(
    lottery.result.componentDesign?.blueprint.regions[0].id === 'component-backdrop',
    '混合模式缺少氛围底图节点',
  )
  assert(
    lottery.result.componentDesign?.blueprint.regions.length > 1,
    '混合模式没有交付可编辑前景节点',
  )
  assert(
    lottery.result.componentDesign?.blueprint.regions[0].renderMode === 'generated-asset',
    '完整组件没有交付为图片 Region',
  )
  assert(
    lottery.result.componentDesign?.blueprint.regions.some((region) =>
      ['text', 'button', 'runtime'].includes(region.renderMode),
    ),
    '混合模式缺少可编辑文字、按钮或图片节点',
  )
  assert(
    lottery.result.agent.plan.length === 6,
    '组件 Plan 应收敛为参考准备和五个通用 Source/Scene 阶段',
  )
  assert(lottery.assetCalls === 4, 'EraLottery 首次设计应生成一张氛围底图和三个 Props 图片素材')
  assert(lottery.result.componentDesign.assetTasks.length === 4, '抽奖组件缺少独立 Props 图片任务')
  assert(
    lottery.result.componentDesign.assetTasks[0].id === 'component-backdrop',
    '氛围底图任务 ID 错误',
  )
  assert(
    lottery.result.componentDesign.assetTasks.slice(1).every((task) => task.propPath),
    'Props 图片任务缺少准确绑定路径',
  )
  assert(
    lottery.result.componentDesign.blueprint.regions.filter(
      (region) => region.renderMode === 'generated-asset',
    ).length === 4,
    'Props 图片 Slot 没有编译成独立 Image Region',
  )
  assert(lottery.result.canvasDelivered === true, '组件没有通过统一 Canvas Deliverable 交付')
  assert(
    lottery.result.agent.canvasObservations?.length === 1,
    '组件 Canvas ACK 没有保存到 Session',
  )
  const runtimeLottery = await executeComponentFlow('EraLottery', createLotteryBlueprint, {
    acknowledgeCanvas: true,
    runtimeSceneGraph: createRuntimeSceneGraph('EraLottery'),
  })
  assert(runtimeLottery.assetCalls === 4, 'Runtime Scene 模式没有生成氛围底图和独立 Props 图片')
  assert(
    runtimeLottery.result.componentDesign?.sourceSceneGraph?.mode === 'editable-scene',
    'Runtime Scene 没有保存在组件设计结果中',
  )
  assert(
    runtimeLottery.result.componentDesign.blueprint.regions.some(
      (region) => region.renderMode === 'generated-asset' && !region.designOnly,
    ),
    'Runtime 图片 Slot 没有替换为生成素材',
  )
  assert(
    runtimeLottery.result.componentDesign.blueprint.regions.some(
      (region) => region.renderMode === 'button',
    ),
    'Runtime Button 节点没有进入混合前景',
  )
  assert(
    runtimeLottery.result.componentDesign.blueprint.regions.some(
      (region) =>
        region.slotId === 'style-config-draw-one-pic' && region.renderMode === 'generated-asset',
    ),
    '图片 Slot 被错误降级为原生 Button',
  )
  const runtimeTitle = runtimeLottery.result.componentDesign.blueprint.regions.find(
    (region) => region.id === 'runtime-title',
  )
  assert(
    runtimeTitle?.style?.color && runtimeTitle.style.color !== '#7a3500',
    '混合前景没有按当前主题重新计算可读文字色',
  )
  assert(
    runtimeLottery.result.componentDesign.blueprint.regions.find(
      (region) => region.id === 'runtime-submit-button',
    )?.style?.fill === 'rgba(35, 211, 250, 1)',
    '混合按钮没有使用主题主色',
  )
  assert(
    !runtimeLottery.result.componentDesign.blueprint.regions.some(
      (region) => region.id === 'runtime-root',
    ),
    '全画布 Runtime 根 Surface 不应覆盖 AI 氛围底图',
  )
  assert(
    runtimeLottery.result.componentDesign.blueprint.regions.some(
      (region) => region.id === 'runtime-card' && region.renderMode === 'color',
    ),
    '内部 Runtime Surface 没有作为原生 Shape 交付',
  )
  assert(
    runtimeLottery.result.componentDesign.designTree.nodes.every(
      (node) => node.id !== 'contract-extra',
    ),
    'Runtime Scene 仍混入 Contract 可见节点',
  )
  assert(
    !('config' in lottery.result.componentDesign.propsPatch),
    '业务 config 不得进入 Props Patch',
  )
  const runtimeImagePayload = runtimeLottery.providerPayloads.find(
    (payload) => payload.type === 'generate_image',
  )
  assert(runtimeImagePayload.imageTasks.length === 1, 'Runtime 组件生图请求不是单任务')
  assert(
    runtimeImagePayload.uploads.every((upload) => ['kv', 'visual'].includes(upload.role)),
    '视觉外壳不应携带 Runtime 或 thumbnail 图片',
  )
  assert(
    !runtimeImagePayload.question.includes('权威结构摘要'),
    '氛围底图不应携带需要像素对齐的 Runtime 结构摘要',
  )
  assert(
    runtimeImagePayload.question.includes('背景图中严禁出现任何文字'),
    '视觉外壳没有禁止生成业务文字',
  )

  const directLottery = await executeComponentFlow('EraLottery', createLotteryBlueprint, {
    question: '现在只生成 EraLottery',
  })
  assert(
    directLottery.result.componentDesign?.componentName === 'EraLottery',
    '直接组件名称没有进入组件生成 Run',
  )
  assert(
    directLottery.result.componentDesign.deliveryMode === 'hybrid-component',
    '直接组件生成没有采用混合模式',
  )

  await expectRejects(
    () => executeComponentFlow('EraLottery', createLotteryBlueprint, { failAllImageTasks: true }),
    /COMPONENT_SLOT_IMAGE_FAILED|模拟 component-slot-1 生图失败/,
    'Props 图片全部生成失败时不应伪造组件配置素材',
  )
  const timeoutBackdrop = await executeComponentFlow('EraLottery', createLotteryBlueprint, {
    timeoutBackdrop: true,
    acknowledgeCanvas: true,
  })
  assert(timeoutBackdrop.result.canvasDelivered === true, '氛围底图超时后没有继续交付画布')
  assert(timeoutBackdrop.assetCalls === 4, '氛围底图超时不应跳过后续 Props 图片素材')
  assert(
    timeoutBackdrop.result.componentDesign.blueprint.regions[0].id === 'component-backdrop',
    '超时回退丢失稳定氛围底图节点',
  )
  assert(
    timeoutBackdrop.result.componentDesign.diagnostics.some(
      (item) => item.code === 'COMPONENT_BACKDROP_TIMEOUT_FALLBACK',
    ),
    '氛围底图超时没有写入明确诊断',
  )
  const repairedBackdrop = await executeComponentFlow('EraLottery', createLotteryBlueprint, {
    contaminateBackdrop: true,
  })
  assert(
    repairedBackdrop.result.componentDesign.qualityReview.repairCount === 1,
    '污染氛围底图没有执行一次自动修复',
  )
  assert(
    repairedBackdrop.result.componentDesign.assetTasks[0].slotId === 'component-backdrop',
    '修复后丢失氛围底图稳定 Slot',
  )

  const contextual = await executeContextualComponentFlow()
  assert(contextual.result.componentDesign?.componentName === 'EraLottery', '跨轮组件约束没有恢复')
  assert(
    contextual.loadedPrompt.includes('EraLottery'),
    `组件解析没有使用结构化组件目标：${contextual.loadedPrompt}`,
  )
  assert(
    contextual.revisionResult.componentDesign?.componentName === 'EraLottery',
    '完善设计稿追问没有进入组件 Run',
  )
  assert(
    contextual.revisionResult.editScope?.type === 'component-instance',
    '组件整体修订范围没有保留',
  )

  const slotEdit = await executeSlotEdit()
  assert(slotEdit.result.agent.plan.length === 4, '局部 Slot Plan 应包含 4 个步骤')
  assert(slotEdit.assetCalls === 1, '局部 Slot 只能调用一次素材生成')
  assert(slotEdit.result.editScope.elementId === 'element-draw-one', '局部结果缺少原 elementId')
  assert(slotEdit.result.artifact?.kind === 'svg', '局部 Slot 没有返回替换素材')

  const tasklist = await executeComponentFlow('EraTasklist', createTasklistBlueprint)
  assert(
    tasklist.result.componentDesign?.componentName === 'EraTasklist',
    'EraTasklist 组件结果缺失',
  )
  assert(tasklist.assetCalls === 1, 'EraTasklist 应只生成一次氛围底图')
  assert(
    tasklist.result.componentDesign.blueprint.regions[0].id === 'component-backdrop',
    'EraTasklist 缺少氛围底图节点',
  )
  assert(
    tasklist.result.componentDesign.blueprint.regions.some(
      (region) => region.renderMode === 'text',
    ),
    'EraTasklist 缺少可编辑文字节点',
  )
  assert(tasklist.result.componentDesign.propsPatch.style.width === 350, '尺寸 Patch 缺失')
  assert(tasklist.result.componentDesign.qualityReview?.passed, '组件缺少结构化质量报告')
  assert(
    tasklist.result.componentDesign.qualityReview.evalVersion === 1,
    '组件缺少统一 Design Eval 版本',
  )
  assert(
    Number.isFinite(tasklist.result.componentDesign.qualityReview.overall),
    '组件缺少 Design Eval 总分',
  )
  assert(
    Number.isFinite(tasklist.result.componentDesign.qualityReview.dimensions.editableCoverage),
    '组件缺少可编辑覆盖率评分',
  )

  const styledTasklist = await executeComponentFlow('EraTasklist', createTasklistBlueprint, {
    stylePack: {
      id: 'festival-red',
      name: '节庆红',
      description: '红金活动主题',
      colors: {
        primary: '#e11d48',
        background: '#7f1d1d',
        text: '#ffffff',
      },
      constraints: ['保持红金主色'],
    },
  })
  assert(
    styledTasklist.result.componentDesign.blueprint.visualTheme.source === 'style-pack',
    '未提供 KV 时没有使用选定 Style Pack',
  )
  assert(
    styledTasklist.result.componentDesign.propsPatch.style.themeColor === '#e11d48',
    'Style Pack 主色没有传播到组件 Props',
  )
  assert(styledTasklist.assetCalls === 1, 'Style Pack 组件应只调用一次完整生图')
  assert(
    styledTasklist.result.componentDesign?.designTree?.nodes.length >= 4,
    '无图片组件仍应保留 thumbnail 视觉树',
  )

  const yellowTasklist = await executeComponentFlow('EraTasklist', createYellowTasklistBlueprint, {
    question: '将 @7-ShmsN8 作为 KV，设计 EraTasklist 组件',
    forceFirstThemeMismatch: true,
    uploads: [
      {
        ...thumbnailUpload,
        name: '7-ShmsN8.jpg',
        data: createSolidPngDataUri(255, 191, 31, 255, 138, 0),
        role: undefined,
      },
    ],
  })
  assert(
    yellowTasklist.result.componentDesign.propsPatch.style.themeColor === '#ffbf1f',
    'KV 主色没有覆盖组件默认主题色',
  )
  assert(yellowTasklist.assetCalls === 1, '带 KV 的组件应只生成一张氛围底图')
  const yellowImageTask = yellowTasklist.result.componentDesign.assetTasks[0]
  assert(yellowImageTask.role === 'component-backdrop', 'KV 组件没有生成氛围底图任务')
  assert(yellowImageTask.propPath === undefined, '氛围底图不得伪造组件图片 Prop 绑定')
  const yellowImageRegion = yellowTasklist.result.componentDesign.blueprint.regions[0]
  assert(yellowImageRegion.designOnly === true, '氛围底图应标记为设计层图片')
  assert(yellowImageRegion.renderMode === 'generated-asset', '氛围底图没有编译为图片节点')
  assert(
    yellowTasklist.result.componentDesign.qualityReview.repairCount === 0,
    '颜色驱动组件不应执行图片主题修订',
  )
  assert(
    yellowTasklist.result.componentDesign.propsPatch.style.bgColor === '#fff7d6',
    'KV 背景色没有按 Surface/Background Token 覆盖组件默认背景色',
  )
  assert(
    yellowTasklist.result.componentDesign.propsPatch.style.mainTxtColor !==
      yellowTasklist.result.componentDesign.propsPatch.style.bgColor,
    '主文案不能与背景使用同一个颜色',
  )
  assert(
    yellowTasklist.providerQuestions.some((question) =>
      question.includes('后续 KV/视觉图片只负责最终配色'),
    ),
    '组件请求没有限制 KV 只负责视觉主题',
  )
  assert(
    yellowTasklist.providerQuestions.some((question) =>
      question.includes('为 EraTasklist 提取视觉主题'),
    ),
    '颜色驱动组件仍应提前提取 Theme',
  )

  const yellowThemeRequest = yellowTasklist.providerPayloads.find(
    (payload) => payload.type === 'extract_visual_theme',
  )
  assert(yellowThemeRequest.uploads.length === 1, '组件主题提取不应混入 thumbnail')
  assert(yellowThemeRequest.uploads[0].name === '7-ShmsN8.jpg', '组件主题提取没有只使用用户 KV')
  assert(
    yellowTasklist.result.componentDesign.blueprint.visualTheme.referenceImageIndex === 1,
    '主题附件序号应相对主题提取请求，而不是 thumbnail 合并列表',
  )

  const calibratedTasklist = await executeComponentFlow(
    'EraTasklist',
    createYellowTasklistBlueprint,
    {
      question: '使用 @pink-kv 作为 KV 设计 EraTasklist',
      uploads: [
        {
          ...thumbnailUpload,
          name: 'pink-kv.png',
          data: createSolidPngDataUri(240, 32, 96, 196, 18, 74),
          role: 'kv',
        },
      ],
    },
  )
  const calibratedTheme = calibratedTasklist.result.componentDesign.blueprint.visualTheme
  assert(calibratedTheme.evidence?.calibrated === true, '错误模型色板没有被 KV 像素证据校准')
  assert(calibratedTheme.referenceImageIndex === 1, '校准主题没有保留主题请求内附件序号')
  assert(
    calibratedTheme.colors.some((color) => /^#(?:f|e)[0-9a-f]{5}$/i.test(color)),
    '校准主题没有使用玫红 KV 的本地像素色板',
  )
  assert(
    calibratedTasklist.result.componentDesign.diagnostics.some(
      (diagnostic) => diagnostic.code === 'COMPONENT_VISUAL_THEME_PIXEL_CALIBRATED',
    ),
    '主题校准没有输出可诊断信息',
  )

  await expectRejects(
    () =>
      executeComponentFlow('EraLottery', createLotteryBlueprint, {
        question: '根据 KV 设计 EraLottery 组件',
        failTheme: true,
        uploads: [{ ...thumbnailUpload, name: 'campaign-kv.png', role: undefined }],
      }),
    /COMPONENT_VISUAL_THEME_REQUIRED|无法从指定 KV 提取有效视觉主题/,
    'KV 主题提取失败时不应静默回退组件默认色',
  )

  console.log(
    JSON.stringify(
      {
        lottery: {
          steps: lottery.result.agent.plan.length,
          assets: lottery.result.artifacts.length,
          visualShell: Boolean(lottery.result.visualShellArtifact),
          profile: lottery.result.componentDesign.profile,
        },
        runtimeScene: {
          nodes: runtimeLottery.result.componentDesign.sourceSceneGraph.nodes.length,
          assetCalls: runtimeLottery.assetCalls,
          visualShell: Boolean(runtimeLottery.result.visualShellArtifact),
          deliveryMode: runtimeLottery.result.componentDesign.sourceSceneGraph.mode,
        },
        rasterDelivery: {
          regions: lottery.result.componentDesign.blueprint.regions.length,
          assets: lottery.result.componentDesign.assetTasks.length,
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
      },
      null,
      2,
    ),
  )
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
  const result = await runDesignWorkflow(
    {
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
    },
    {},
    {
      executeSkillTool,
      invokeProvider: async (payload) => {
        if (payload.type !== 'generate_assets') {
          throw new Error(`未预期的 Provider 请求：${payload.type}`)
        }
        assetCalls += 1
        return { artifacts: [createAsset(0)] }
      },
    },
  )
  return { result, assetCalls }
}

async function executeComponentFlow(componentName, createBlueprint, options = {}) {
  const source = await fs.readFile(
    path.join(appRoot, 'componentsJson', `${componentName}.json`),
    'utf8',
  )
  const component = JSON.parse(source)
  let assetCalls = 0
  const failedTaskAttempts = new Map()
  const providerQuestions = []
  const providerPayloads = []
  const agentEvents = []
  const canvasDeliveries = []
  const result = await runDesignWorkflow(
    {
      type: 'agent_run',
      sessionId: `component-${componentName}-${Date.now()}`,
      provider: 'codex',
      model: 'test',
      question: options.question ?? `根据 ${componentName} 组件 JSON 生成设计预览和配置`,
      uploads: options.uploads ?? [],
      stylePack: options.stylePack,
      canvasTarget: {
        artboardId: `board-${componentName}`,
        createdForThread: true,
        width: 375,
        height: 812,
        placementMode: 'append-section',
        placementSource: 'default',
      },
    },
    {
      onAgentEvent: (event) => agentEvents.push(event),
      onDeliverable: options.acknowledgeCanvas
        ? async (deliverable) => {
            canvasDeliveries.push(deliverable)
            assert(deliverable.kind === 'component', '组件交付类型错误')
            return {
              status: 'success',
              summary: `${deliverable.componentDesign.componentName} 已写入测试画板。`,
              data: {
                artboardId: deliverable.target.artboardId,
                rootElementId: 'component-root-test',
                instanceId: 'component-instance-test',
                elementCount: 6,
                componentCount: 1,
              },
            }
          }
        : undefined,
    },
    {
      executeSkillTool,
      loadComponentFromPrompt: async () => ({
        component,
        source,
        fileName: `${componentName}.json`,
        thumbnailUpload,
        pack: componentPackFixture(),
      }),
      inspectRuntimeSource: options.runtimeSceneGraph
        ? async () => ({
            status: 'passed',
            designTree: undefined,
            sceneGraph: options.runtimeSceneGraph,
            runtimeSnapshot: {
              ...thumbnailUpload,
              name: `${componentName}-runtime.png`,
              role: 'prototype',
            },
            diagnostics: [],
          })
        : undefined,
      invokeProvider: async (payload) => {
        providerQuestions.push(payload.question)
        providerPayloads.push(payload)
        if (payload.type === 'extract_visual_theme') {
          if (options.failTheme) throw new Error('模拟 KV 主题提取失败')
          return { visualTheme: createBlueprint().visualTheme }
        }
        if (payload.type === 'extract_design_tree') {
          return { designTree: createThumbnailDesignTree(componentName) }
        }
        if (payload.type === 'vision_review') {
          return { visionReview: createBackdropPurityReview(options.contaminateBackdrop) }
        }
        if (payload.type === 'generate_image') {
          assetCalls += 1
          const task = payload.imageTasks[0]
          if (options.timeoutBackdrop && task.role === 'component-backdrop') {
            const error = new Error('模拟 component-backdrop 生图超时')
            error.code = 'COMPONENT_ASSET_TIMEOUT'
            throw error
          }
          if (options.failAllImageTasks || options.failImageTask === task.id) {
            const attempts = (failedTaskAttempts.get(task.id) ?? 0) + 1
            failedTaskAttempts.set(task.id, attempts)
            if (attempts <= 2) throw new Error(`模拟 ${task.id} 生图失败`)
          }
          const question =
            options.forceFirstThemeMismatch && assetCalls === 1
              ? payload.question.replaceAll('#ffbf1f', '#2563eb').replaceAll('#ff8a00', '#0f172a')
              : payload.question
          return { artifact: createArtifactForTask(task, question) }
        }
        throw new Error(`未预期的 Provider 请求：${payload.type}`)
      },
    },
  )
  assert(
    agentEvents.some((event) => event.type === 'design.eval.completed'),
    '组件质量评审没有发送 Design Eval 事件',
  )
  assert(result.agent.designEvaluations.length > 0, '组件 Session 没有保存 Design Eval 摘要')
  return { result, assetCalls, providerQuestions, providerPayloads, canvasDeliveries }
}

async function executeContextualComponentFlow() {
  const componentName = 'EraLottery'
  const source = await fs.readFile(
    path.join(appRoot, 'componentsJson', `${componentName}.json`),
    'utf8',
  )
  const component = JSON.parse(source)
  let loadedPrompt = ''
  const sessionId = `component-context-${Date.now()}`
  const dependencies = {
    executeSkillTool,
    loadComponentFromPrompt: async (prompt) => {
      loadedPrompt = prompt
      return {
        component,
        source,
        fileName: `${componentName}.json`,
        thumbnailUpload,
        pack: componentPackFixture(),
      }
    },
    invokeProvider: async (payload) => {
      if (payload.type === 'extract_design_tree') {
        return { designTree: createThumbnailDesignTree(componentName) }
      }
      if (payload.type === 'extract_visual_theme') {
        return { visualTheme: createLotteryBlueprint().visualTheme }
      }
      if (payload.type === 'vision_review') {
        return { visionReview: createBackdropPurityReview() }
      }
      if (payload.type === 'generate_image') {
        return { artifact: createArtifactForTask(payload.imageTasks[0], payload.question) }
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
  const result = await runDesignWorkflow(
    {
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
      workflowDecision: {
        version: 2,
        action: 'create-component',
        taskKind: 'component-design',
        confidence: 1,
        reason: 'test-structured-component-decision',
        source: 'pi-agent-core',
        target: { componentName },
        placement: {
          operation: 'insert',
          scope: 'artboard',
          targetArtboardId: target.artboardId,
          reason: 'test',
          confidence: 1,
        },
      },
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
      question: '完善一下整体设计稿，现在只有 props',
      history: [
        { role: 'user', text: '请使用 EraLottery.json，严格按照这个组件的字段和缩略图设计' },
        { role: 'agent', text: result.text },
      ],
      uploads: [],
      editScope: {
        type: 'component-instance',
        scopeId: 'scope-component-existing',
        elementId: 'component-root-existing',
        artboardId: target.artboardId,
        documentRevision: 0,
        targetHash: 'hash-component-existing',
        targetElementIds: ['component-root-existing'],
        instanceId: 'component-instance-existing',
        componentName: 'EraLottery',
        profile: 'style-config',
      },
      canvasTarget: { ...target, createdForThread: false },
      workflowDecision: {
        version: 2,
        action: 'revise-component',
        taskKind: 'component-design',
        confidence: 1,
        reason: 'test-structured-component-revision',
        source: 'pi-agent-core',
        target: { componentName },
        placement: {
          operation: 'revise',
          scope: 'selection',
          targetElementIds: ['component-root-existing'],
          reason: 'test',
          confidence: 1,
        },
      },
    },
    {},
    dependencies,
  )
  return { result, revisionResult, loadedPrompt }
}

function createThumbnailDesignTree(componentName) {
  return {
    version: 1,
    componentName,
    width: 375,
    height: 456,
    nodes: [
      {
        id: 'thumbnail-title',
        type: 'heading',
        role: '标题',
        bounds: { x: 24, y: 24, width: 327, height: 36 },
        content: '活动任务',
        confidence: 0.92,
      },
      {
        id: 'thumbnail-list',
        type: 'list',
        role: '任务列表',
        bounds: { x: 16, y: 84, width: 343, height: 220 },
        confidence: 0.88,
      },
      {
        id: 'thumbnail-item-1',
        type: 'list-item',
        role: '任务项',
        parentId: 'thumbnail-list',
        bounds: { x: 24, y: 92, width: 327, height: 92 },
        content: '完成任务',
        confidence: 0.86,
      },
      {
        id: 'thumbnail-item-2',
        type: 'list-item',
        role: '任务项',
        parentId: 'thumbnail-list',
        bounds: { x: 24, y: 192, width: 327, height: 92 },
        content: '邀请好友',
        confidence: 0.86,
      },
      {
        id: 'thumbnail-action',
        type: 'button',
        role: '操作按钮',
        bounds: { x: 120, y: 340, width: 135, height: 44 },
        content: '立即参与',
        confidence: 0.9,
      },
      {
        id: 'thumbnail-divider',
        type: 'divider',
        role: '装饰分割线',
        bounds: { x: 24, y: 400, width: 327, height: 1 },
        confidence: 0.78,
      },
    ],
  }
}

function createBackdropPurityReview(contaminated = false) {
  return {
    status: 'completed',
    scores: { theme: 1, readability: 1, hierarchy: 1, referenceSimilarity: 1 },
    issues: contaminated
      ? [
          {
            scope: 'component',
            targetId: 'component-backdrop',
            severity: 'error',
            message: '检测到卡片和骨架占位条。',
          },
        ]
      : [],
    message: contaminated ? '氛围底图包含 UI 结构。' : '氛围底图不包含 UI 结构。',
  }
}

function createRuntimeSceneGraph(componentName) {
  return {
    version: 1,
    id: `scene:runtime-dom:${componentName}`,
    rootNodeId: 'runtime-root',
    mode: 'editable-scene',
    surface: { kind: 'mobile', width: 375, height: 456, originX: 0, originY: 0 },
    nodes: [
      {
        id: 'runtime-root',
        type: 'frame',
        name: '组件根节点',
        bounds: { x: 0, y: 0, width: 375, height: 456 },
        zIndex: 1,
        style: { fill: '#fff7d6', shape: 'rect' },
        source: {
          adapterId: 'runtime-dom',
          sourceNodeId: `${componentName}:root`,
          confidence: 0.98,
        },
        ownership: { regionId: 'runtime-root', role: 'structure' },
      },
      {
        id: 'runtime-title',
        type: 'text',
        parentId: 'runtime-root',
        name: '标题',
        content: '幸运抽奖',
        bounds: { x: 24, y: 24, width: 327, height: 40 },
        zIndex: 2,
        style: { color: '#7a3500', fontSize: 24, textAlign: 'center' },
        source: {
          adapterId: 'runtime-dom',
          sourceNodeId: `${componentName}:title`,
          confidence: 0.98,
        },
        ownership: { regionId: 'runtime-title', role: 'structure' },
      },
      {
        id: 'runtime-card',
        type: 'frame',
        parentId: 'runtime-root',
        name: '内容卡片',
        bounds: { x: 16, y: 88, width: 343, height: 300 },
        zIndex: 2,
        style: { fill: '#ffffff', radius: 16 },
        source: {
          adapterId: 'runtime-dom',
          sourceNodeId: `${componentName}:card`,
          confidence: 0.98,
        },
        ownership: { regionId: 'runtime-card', role: 'structure' },
      },
      {
        id: 'runtime-action-image',
        type: 'image',
        parentId: 'runtime-root',
        name: '抽一次按钮底图',
        bounds: { x: 16, y: 168, width: 160, height: 48 },
        zIndex: 3,
        asset: { source: thumbnailUpload.data, fit: 'contain' },
        style: { borderRadius: 12 },
        source: {
          adapterId: 'runtime-dom',
          sourceNodeId: `${componentName}:action-image`,
          confidence: 0.98,
        },
        ownership: { regionId: 'runtime-action-image', role: 'structure' },
      },
      {
        id: 'runtime-action-text',
        type: 'text',
        parentId: 'runtime-root',
        name: '抽一次按钮文案',
        content: '抽一次',
        bounds: { x: 50, y: 178, width: 92, height: 28 },
        zIndex: 4,
        style: { color: '#ffffff', fontSize: 18, fontWeight: 700, textAlign: 'center' },
        source: {
          adapterId: 'runtime-dom',
          sourceNodeId: `${componentName}:action-text`,
          confidence: 0.98,
        },
        ownership: { regionId: 'runtime-action-text', role: 'structure' },
      },
      {
        id: 'runtime-submit-button',
        type: 'button',
        parentId: 'runtime-root',
        name: '去领奖',
        content: '去领奖',
        bounds: { x: 220, y: 178, width: 110, height: 42 },
        zIndex: 5,
        style: { fill: '#2563eb', color: '#ffffff', radius: 8 },
        source: {
          adapterId: 'runtime-dom',
          sourceNodeId: `${componentName}:submit`,
          confidence: 0.98,
        },
        ownership: { regionId: 'runtime-submit-button', role: 'structure' },
      },
    ],
    diagnostics: [],
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
      createRegion('draw-one', '抽一次按钮', 24, 380, 150, 64, 'style-config-draw-one-pic', [
        'styleConfig.draw_one_pic',
      ]),
      createRegion('draw-ten', '抽十次按钮', 201, 380, 150, 64, 'style-config-draw-ten-pic', [
        'styleConfig.draw_ten_pic',
      ]),
      createRegion('thanks', '谢谢参与', 112, 470, 150, 56, 'style-config-thanks-pic', [
        'styleConfig.thanks_pic',
      ]),
      createRegion(
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
      createRegion(
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

function createRegion(
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

function createArtifactForTask(task, question) {
  void question
  return createSizedAsset(task.targetSize.width, task.targetSize.height)
}

function createSizedAsset(width, height) {
  return {
    kind: 'svg',
    name: 'component-slot.png',
    content: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" rx="12" fill="#2563eb"/>`,
      `<rect x="6" y="6" width="${Math.max(1, width - 12)}" height="${Math.max(1, height - 12)}" rx="8" fill="none" stroke="#ffffff" opacity="0.5"/>`,
      '<circle cx="18" cy="18" r="5" fill="#ffffff" opacity="0.7"/>',
      '</svg>',
    ].join(''),
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function createSolidPngDataUri(r1, g1, b1, r2, g2, b2) {
  const png = new PNG({ width: 32, height: 32 })
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4
      const first = x < png.width / 2
      png.data[offset] = first ? r1 : r2
      png.data[offset + 1] = first ? g1 : g2
      png.data[offset + 2] = first ? b1 : b2
      png.data[offset + 3] = 255
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

function componentPackFixture() {
  return {
    id: 'test-components',
    label: '测试组件包',
    version: 1,
    skill: {
      name: 'component-design-assets',
      tools: {
        extractFacts: 'component-design-assets.extract-facts',
        resolveContract: 'component-design-assets.resolve-contract',
      },
    },
  }
}

async function expectRejects(run, pattern, message) {
  try {
    await run()
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw error
  }
  throw new Error(message)
}
