import assert from 'node:assert/strict'
import {
  applyVisualThemeToDesignSpec,
  genericUiLogicalSize,
  inspectGenericUiSchema,
  normalizeGenericUiSchema,
} from '../electron/runtime/generic-ui.mjs'
import { routeAgentIntent, validateAgentIntent } from '../electron/runtime/intent-router.mjs'
import { createGenerationBrief } from '../electron/runtime/generation-brief.mjs'
import { resolveWorkflowDecision } from '../electron/runtime/agent.mjs'
import {
  DESIGN_BLOCK_CATALOG,
  normalizeDesignSpec,
  normalizeDesignSpecResult,
} from '../electron/runtime/design-catalog.mjs'
import { createAgentToolRegistry } from '../electron/runtime/agent-tools.mjs'
import { normalizeVisualTheme } from '../electron/runtime/pi/structured-results.mjs'
import { registerDesignBlockDefinitions } from '../electron/runtime/design-block-registry.mjs'
import {
  createStaticHtmlDocument,
  normalizeStaticBodyMarkup,
  validateStaticUiRuntimeDraft,
} from '../electron/runtime/component-runtime-inspector.mjs'

const intent = routeAgentIntent({ prompt: '生成订单管理后台 UI 设计稿' })
assert.equal(intent.action, 'create-ui')
assert.equal(intent.taskKind, 'generic-ui')
assert.equal(validateAgentIntent(intent), true)
assert.equal(routeAgentIntent({ prompt: '生成订单管理 Dashboard' }).action, 'create-ui')
const referencedAdminIntent = routeAgentIntent({
  prompt: '1TagNN9GEO 以 @图1 主题生成一个电商后台管理系统设计稿',
})
assert.equal(referencedAdminIntent.action, 'create-ui')
assert.equal(referencedAdminIntent.taskKind, 'generic-ui')
const piDomainDecision = resolveWorkflowDecision({
  question: '以 @图1 主题生成一个电商后台管理系统设计稿',
  workflowDecision: {
    version: 2,
    action: 'create-image',
    taskKind: 'design-image',
    confidence: 1,
    source: 'pi-agent-core',
    placement: {
      operation: 'create',
      scope: 'document',
      reason: 'pi-selected-image-workflow',
      confidence: 1,
    },
  },
})
assert.equal(piDomainDecision.action, 'create-image')
assert.equal(piDomainDecision.taskKind, 'design-image')
assert.equal(piDomainDecision.placement.reason, 'pi-selected-image-workflow')
const fullRedesignDecision = resolveWorkflowDecision({
  question: '参考这张图重新设计整个低代码页面',
  canvasSnapshot: { artboardId: 'existing-design-board', designSpec: { version: 1 } },
  workflowDecision: {
    version: 2,
    action: 'revise-ui-structure',
    taskKind: 'design-spec-patch',
    confidence: 1,
    reason: 'pi-misclassified-full-redesign',
    source: 'pi-agent-core',
    placement: {
      operation: 'revise',
      scope: 'artboard',
      targetArtboardId: 'existing-design-board',
      reason: 'pi-revise-existing',
      confidence: 1,
    },
    surfaceKind: 'desktop-web',
    designArchetype: 'low-code-editor',
  },
})
assert.equal(fullRedesignDecision.action, 'create-ui')
assert.equal(fullRedesignDecision.taskKind, 'generic-ui')
assert.equal(fullRedesignDecision.placement.operation, 'variant')
assert.equal(fullRedesignDecision.placement.targetArtboardId, 'existing-design-board')
const scopedStructureDecision = resolveWorkflowDecision({
  question: '修改侧边栏，新增物料入口',
  workflowDecision: {
    version: 2,
    action: 'revise-ui-structure',
    taskKind: 'design-spec-patch',
    confidence: 1,
    reason: 'pi-scoped-structure-edit',
    source: 'pi-agent-core',
    placement: {
      operation: 'revise',
      scope: 'artboard',
      targetArtboardId: 'existing-design-board',
      reason: 'scoped-edit',
      confidence: 1,
    },
  },
})
assert.equal(scopedStructureDecision.action, 'revise-ui-structure')
assert.equal(scopedStructureDecision.placement.operation, 'revise')
assert.equal(routeAgentIntent({ prompt: '设计一个完整的 H5 活动页面' }).action, 'create-ui')
assert.equal(routeAgentIntent({ prompt: '重新设计低代码页面' }).action, 'create-ui')
assert.equal(
  routeAgentIntent({ prompt: '生成完整页面，使用 EraLottery 和 EraTasklist' }).action,
  'create-page',
)
assert.equal(
  routeAgentIntent({ prompt: '根据 componentsJson/EraLottery.json 生成组件' }).action,
  'create-component',
)
assert.equal(routeAgentIntent({ prompt: '生成一张活动海报' }).action, 'create-image')
assert.deepEqual(
  validateStaticUiRuntimeDraft({ html: '<main>安全页面</main>', css: 'main{display:grid}' }),
  {
    html: '<main>安全页面</main>',
    css: 'main{display:grid}',
  },
)
assert.throws(
  () =>
    validateStaticUiRuntimeDraft({
      html: '<button onclick="run()">执行</button>',
      css: 'button{}',
    }),
  /不允许的动态内容/,
)
assert.deepEqual(
  normalizeStaticBodyMarkup(
    '<body class="app-shell"><header>顶部</header><main>内容</main></body>',
  ),
  { html: '<header>顶部</header><main>内容</main>', className: 'app-shell' },
)
const staticDocument = createStaticHtmlDocument(
  1440,
  '<body class="app-shell"><header>顶部</header><main>内容</main></body>',
  '.app-shell{display:grid}',
)
assert.match(staticDocument, /data-component-root class="app-shell"/)
assert.doesNotMatch(staticDocument, /<div id="app"[^>]*><body/)
assert.throws(
  () =>
    validateStaticUiRuntimeDraft({
      html: '<main>页面</main>',
      css: '@import url("https://example.com/a.css")',
    }),
  /不允许的动态内容/,
)

const schema = normalizeGenericUiSchema(
  {
    surfaceKind: 'desktop-admin',
    blocks: [
      { kind: 'header', title: '订单管理' },
      { kind: 'data-table', columns: ['订单号', '状态'] },
    ],
  },
  '生成订单管理后台',
)
assert.equal(schema.viewport.width, 1440)
assert.equal(schema.viewport.height, 900)
assert.deepEqual(inspectGenericUiSchema(schema), [])
assert.deepEqual(genericUiLogicalSize('desktop-admin'), {
  width: 1440,
  initialHeight: 900,
  autoHeight: false,
})
assert.equal(normalizeDesignSpec({ surfaceKind: 'desktop-admin' }, '运营后台').version, 1)
assert.equal(DESIGN_BLOCK_CATALOG['data-table'].label, '数据表格')
assert.equal(normalizeDesignSpecResult({}, '运营后台').status, 'invalid')
const duplicateStructureResult = normalizeDesignSpecResult(
  {
    version: 1,
    surfaceKind: 'desktop-admin',
    title: '低代码平台',
    viewport: { width: 1440, height: 900 },
    theme: { colors: ['#ffffff', '#f5f7fa', '#182230'] },
    blocks: [
      { id: 'workspace-header', kind: 'header', title: '工作台' },
      { id: 'recent-apps-header', kind: 'header', title: '最近应用', actions: ['查看全部'] },
      { id: 'recent-apps', kind: 'data-table', columns: ['应用', '状态'] },
    ],
  },
  '低代码平台后台',
)
assert.equal(duplicateStructureResult.status, 'repaired')
assert.deepEqual(
  duplicateStructureResult.spec.blocks.map((block) => block.kind),
  ['header', 'section-header', 'data-table'],
)
assert.deepEqual(duplicateStructureResult.spec.blocks[1].actions, ['查看全部'])
assert.ok(duplicateStructureResult.diagnostics.some((item) => item.includes('重复全局结构')))
assert.deepEqual(inspectGenericUiSchema(duplicateStructureResult.spec), [])
const openSchema = normalizeGenericUiSchema(
  {
    surfaceKind: 'desktop-web',
    designArchetype: 'marketing-site',
    blocks: [
      { kind: 'hero', title: '产品名称', items: ['核心价值'], actions: ['立即开始'] },
      {
        kind: 'grid',
        label: '能力',
        children: [
          { kind: 'text', title: '能力一' },
          { kind: 'image', title: '产品截图' },
        ],
      },
    ],
  },
  '产品官网',
)
assert.deepEqual(
  openSchema.blocks.map((block) => block.kind),
  ['hero', 'grid'],
)
assert.equal(openSchema.blocks[1].children.length, 2)
registerDesignBlockDefinitions(
  { 'domain-panel': { label: '领域面板', properties: ['title', 'items'] } },
  'test',
)
assert.equal(
  normalizeGenericUiSchema({ blocks: [{ kind: 'domain-panel', title: '扩展' }] }).blocks[0].kind,
  'domain-panel',
)
const orangeVisualTheme = {
  source: 'kv',
  colors: ['#ff9f1a', '#f4c04d', '#fff4cc', '#5b2600', '#fffdf5'],
  colorTokens: [
    { role: 'primary', value: '#ff9f1a' },
    { role: 'background', value: '#fff4cc' },
    { role: 'surface', value: '#fffdf5' },
    { role: 'text', value: '#5b2600' },
  ],
  surfaces: [{ role: 'surface', fill: '#fffdf5', radius: 10, border: '#f4c04d' }],
  spacing: { density: 'compact' },
}
const themedSchema = applyVisualThemeToDesignSpec(schema, orangeVisualTheme)
assert.deepEqual(themedSchema.theme.colors.slice(0, 5), [
  '#fffdf5',
  '#fff4cc',
  '#5b2600',
  '#ff9f1a',
  '#f4c04d',
])
assert.equal(themedSchema.theme.radius, 10)
assert.equal(themedSchema.theme.density, 'compact')
assert.equal(themedSchema.theme.colors[3], '#ff9f1a')
assert.equal(
  normalizeDesignSpecResult({}, '运营后台', { visualTheme: orangeVisualTheme }).spec.theme
    .colors[3],
  '#ff9f1a',
)
const tolerantTheme = normalizeVisualTheme({
  theme: {
    palette: ['#ff6b9d'],
    colorTokens: { primary: '#ff6b9d', background: '#fff0f5', text: '#572136' },
  },
})
assert.equal(tolerantTheme.visualStyle, 'reference-derived')
assert.equal(tolerantTheme.colorTokens.find((token) => token.role === 'primary').value, '#ff6b9d')
const fallbackRegistry = createAgentToolRegistry({
  invokeProvider: async () => {
    const error = new Error('模型没有返回有效视觉主题。')
    error.code = 'VISUAL_THEME_INVALID'
    throw error
  },
})
const fallbackThemeStep = await fallbackRegistry.execute('source.inspect', {
  session: { goal: '根据参考图生成电商后台', taskKind: 'generic-ui' },
  payload: {},
  providerCallbacks: {},
  memory: new Map([
    [
      'reference.prepare',
      {
        data: {
          uploads: [
            {
              name: 'kv.png',
              role: 'unknown',
              mime: 'image/png',
              data: 'data:image/png;base64,AA==',
            },
          ],
        },
      },
    ],
  ]),
})
assert.equal(fallbackThemeStep.data.fallback, 'design-spec-direct-vision')
const prototypeOnlyRegistry = createAgentToolRegistry({
  invokeProvider: async () => {
    throw new Error('原型图不应触发主题提取。')
  },
})
const prototypeOnlyTheme = await prototypeOnlyRegistry.execute('source.inspect', {
  session: { goal: '根据原型重做编辑器', taskKind: 'generic-ui' },
  payload: {},
  providerCallbacks: {},
  memory: new Map([
    [
      'reference.prepare',
      {
        data: {
          uploads: [
            {
              name: 'editor-prototype.png',
              role: 'prototype',
              mime: 'image/png',
              data: 'data:image/png;base64,AA==',
            },
          ],
        },
      },
    ],
  ]),
})
assert.match(prototypeOnlyTheme.summary, /1 张原型图仍会用于页面结构和 Runtime 设计/)
const runtimeRegistry = createAgentToolRegistry({
  invokeProvider: async (payload) => {
    assert.equal(payload.type, 'generate_ui_runtime')
    return {
      data: {
        version: 1,
        title: '低代码工作台',
        viewport: { width: 1440, height: 900 },
        html: '<main><aside>导航</aside><header>低代码工作台</header><input placeholder="搜索组件"><button>发布</button></main>',
        css: 'main{width:1440px;height:900px;display:grid;grid-template-columns:240px 1fr}aside{background:#111827;color:white}header{font-size:20px}input,button{height:36px}',
      },
    }
  },
  inspectStaticRuntime: async () => ({
    status: 'passed',
    designTree: {
      componentName: '低代码工作台',
      width: 1440,
      height: 900,
      nodes: [
        runtimeNode('root', 'container', undefined, { x: 0, y: 0, width: 1440, height: 900 }),
        runtimeNode('sidebar', 'surface', 'root', { x: 0, y: 0, width: 240, height: 900 }),
        runtimeNode(
          'nav-label',
          'text',
          'sidebar',
          { x: 24, y: 24, width: 100, height: 24 },
          '页面管理',
        ),
        runtimeNode('header', 'surface', 'root', { x: 240, y: 0, width: 1200, height: 64 }),
        runtimeNode(
          'title',
          'heading',
          'header',
          { x: 264, y: 20, width: 180, height: 28 },
          '低代码工作台',
        ),
        runtimeNode(
          'search',
          'input',
          'header',
          { x: 900, y: 14, width: 260, height: 36 },
          '搜索组件',
        ),
        runtimeNode(
          'publish',
          'button',
          'header',
          { x: 1180, y: 14, width: 96, height: 36 },
          '发布',
        ),
        runtimeNode('workspace', 'surface', 'root', { x: 240, y: 64, width: 1200, height: 836 }),
      ],
    },
    diagnostics: [],
  }),
})
const runtimeContext = {
  session: { goal: '生成低代码工作台', taskKind: 'generic-ui', designSpec: schema },
  payload: {},
  providerCallbacks: {},
  memory: new Map([['ui.plan', { data: { designSpec: schema, uiSchema: schema } }]]),
}
const transformedRuntime = await runtimeRegistry.execute('design.transform', runtimeContext)
runtimeContext.memory.set('design.transform', transformedRuntime)
const validatedRuntime = await runtimeRegistry.execute('scene.validate', runtimeContext)
runtimeContext.memory.set('scene.validate', validatedRuntime)
const presentedRuntime = await runtimeRegistry.execute('canvas.commit', runtimeContext)
assert.equal(transformedRuntime.data.deliveryMode, 'runtime-dom-scene')
assert.equal(validatedRuntime.nextSteps, undefined)
assert.equal(presentedRuntime.data.expectedNodeCount, 8)
assert.ok(presentedRuntime.data.sceneGraph.nodes.some((node) => node.type === 'input'))
const shallowRuntimeRegistry = createAgentToolRegistry({
  invokeProvider: runtimeRegistryInvoke,
  inspectStaticRuntime: async () => ({
    status: 'passed',
    diagnostics: [],
    designTree: {
      componentName: '局部顶栏',
      width: 1440,
      height: 56,
      nodes: [
        runtimeNode('root', 'surface', undefined, { x: 0, y: 0, width: 1440, height: 56 }),
        ...Array.from({ length: 7 }, (_, index) =>
          runtimeNode(
            `header-item-${index + 1}`,
            'button',
            'root',
            { x: 16 + index * 120, y: 10, width: 96, height: 36 },
            `操作 ${index + 1}`,
          ),
        ),
      ],
    },
  }),
})
const shallowContext = {
  session: { goal: '生成低代码工作台', taskKind: 'generic-ui', designSpec: schema },
  payload: {},
  providerCallbacks: {},
  memory: new Map([['ui.plan', { data: { designSpec: schema, uiSchema: schema } }]]),
}
const shallowTransform = await shallowRuntimeRegistry.execute('design.transform', shallowContext)
assert.equal(shallowTransform.data.deliveryMode, 'design-spec-fallback')
assert.match(shallowTransform.data.fallbackReason, /6% 高度/)
assert.equal(
  normalizeDesignSpecResult(
    {
      blocks: [{ kind: 'header', title: '标题' }, { kind: 'unknown' }],
    },
    '运营后台',
  ).status,
  'repaired',
)
const aliasedAdminSpec = normalizeDesignSpecResult(
  {
    version: 1,
    title: '项目后台',
    viewport: { width: 1440, height: 900 },
    theme: { colors: ['#ffffff', '#f5f7fa', '#182230'] },
    blocks: [
      { id: 'nav', kind: 'navigation', items: ['项目'] },
      { id: 'metrics', kind: 'metric-card', items: ['进行中 12'] },
      { id: 'projects', kind: 'project-list', columns: ['项目'], rows: [['官网改版']] },
    ],
  },
  '项目管理后台',
)
assert.equal(aliasedAdminSpec.status, 'repaired')
assert.deepEqual(
  aliasedAdminSpec.spec.blocks.map((block) => block.kind),
  ['sidebar', 'stats', 'data-table'],
)
let invalidPlanCalls = 0
const invalidPlanRegistry = createAgentToolRegistry({
  invokeProvider: async () => {
    invalidPlanCalls += 1
    return { uiSchema: { surfaceKind: 'desktop-web', blocks: [] } }
  },
})
await assert.rejects(
  () =>
    invalidPlanRegistry.execute('source.to-scene', {
      session: {
        goal: '生成产品官网',
        taskKind: 'generic-ui',
        surfaceKind: 'desktop-web',
        designArchetype: 'marketing-site',
      },
      payload: {},
      providerCallbacks: {},
      memory: new Map(),
    }),
  /DesignSpec\.blocks 为空或缺失/,
)
assert.equal(invalidPlanCalls, 2)
const customResponsiveSchema = normalizeGenericUiSchema(
  {
    surfaceKind: 'desktop-admin',
    responsive: {
      breakpoints: [
        {
          id: 'wide',
          label: '宽屏',
          viewport: { width: 1920, height: 1080 },
          overrides: {
            theme: { radius: 12, colors: ['#ffffff', '#f5f7fa', '#182230', '#7c3aed', '#d9dee8'] },
            layout: { contentPadding: 32, blockGap: 20, sidebarMode: 'expanded' },
          },
        },
      ],
    },
    blocks: [{ kind: 'header', title: '标题' }],
  },
  '宽屏运营后台',
)
assert.deepEqual(
  customResponsiveSchema.responsive.breakpoints.find((item) => item.id === 'wide'),
  {
    id: 'wide',
    label: '宽屏',
    viewport: { width: 1920, height: 1080 },
    overrides: {
      theme: { colors: ['#ffffff', '#f5f7fa', '#182230', '#7c3aed', '#d9dee8'], radius: 12 },
      layout: { contentPadding: 32, blockGap: 20, sidebarMode: 'expanded' },
    },
  },
)
const brief = createGenerationBrief({
  goal: '根据原型和 KV 生成活动海报',
  canvasTarget: { width: 375, height: 812, placementMode: 'new-artboard' },
  references: [
    { id: 'prototype', name: 'wireframe.png', role: 'prototype' },
    { id: 'kv', name: 'campaign-kv.png', role: 'kv' },
  ],
})
assert.equal(brief.outputKind, 'full-image')
assert.equal(
  createGenerationBrief({ goal: '不包含素材关键词', outputKind: 'asset' }).outputKind,
  'asset',
)
assert.equal(brief.references[0].responsibility, 'structure')
assert.equal(brief.references[1].responsibility, 'visual-theme')
console.log('Generic UI workflow contract passed.')

function runtimeNode(id, type, parentId, bounds, content) {
  return {
    id,
    type,
    parentId,
    bounds,
    content,
    role: id,
    style: type === 'surface' ? { fill: '#ffffff' } : { color: '#111827', fontSize: 14 },
    confidence: 0.98,
  }
}

async function runtimeRegistryInvoke(payload) {
  assert.equal(payload.type, 'generate_ui_runtime')
  return {
    data: {
      version: 1,
      title: '低代码工作台',
      viewport: { width: 1440, height: 900 },
      html: '<main><header>低代码工作台</header></main>',
      css: 'main{width:1440px;height:900px}',
    },
  }
}
