import assert from 'node:assert/strict'
import path from 'node:path'
import {
  configureSkillRuntime,
  loadComponentsFromPrompt,
} from '../electron/runtime/skills.mjs'
import {
  createPageCompositionBlueprint,
  validatePageCompositionBlueprint,
} from '../electron/runtime/page-composition.mjs'
import {
  listComponentRuntimeAdapters,
  registerComponentRuntimeAdapter,
  validateComponentRuntime,
  compareRuntimeLayout,
} from '../electron/runtime/component-runtime-adapters.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
configureSkillRuntime({ appRoot, resourcesPath: appRoot, isPackaged: false })
const originalFetch = globalThis.fetch

try {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
  })
  const components = await loadComponentsFromPrompt(
    '使用 EraLottery.json 和 EraTasklist.json 生成一个活动页面',
  )
  assert.deepEqual(components.map((item) => item.component.name).sort(), ['EraLottery', 'EraTasklist'])

  const structuralComponents = await loadComponentsFromPrompt(
    '使用 EvaPage.json、EvaLayoutContainer.json、EraLottery.json 生成页面',
    { allowStructuralComponents: true },
  )
  assert(structuralComponents.some((item) => item.component.name === 'EvaPage' && !item.thumbnailUpload), 'EvaPage 应作为无 thumbnail 的页面根节点加载')
  assert(structuralComponents.some((item) => item.component.name === 'EvaLayoutContainer'), 'EvaLayoutContainer 应作为容器节点加载')

  const visualTheme = {
    source: 'kv',
    colors: ['#ffbf1f', '#ff8a00', '#fff7d6', '#7a3500'],
    visualStyle: '黄色促销活动',
  }
  const blueprint = createPageCompositionBlueprint(
    components.map((item) => ({ componentName: item.component.name, estimatedHeight: 480 })),
    visualTheme,
  )
  assert.equal(blueprint.width, 375)
  assert.equal(blueprint.sections.length, 2)
  assert.equal(new Set(blueprint.sections.map((section) => section.id)).size, 2)
  assert.equal(validatePageCompositionBlueprint(blueprint).length, 0)

  const structuredBlueprint = createPageCompositionBlueprint(
    components.map((item) => ({ componentName: item.component.name, estimatedHeight: 480 })),
    visualTheme,
    {
      pageRoot: { componentName: 'EvaPage', designPaths: ['backgroundColor', 'backgroundImage.src'] },
      containers: [{ componentName: 'EvaLayoutContainer', designPaths: ['size.width', 'background.color'] }],
    },
  )
  assert.equal(structuredBlueprint.pageRoot.componentName, 'EvaPage')
  assert.equal(structuredBlueprint.containers[0].componentName, 'EvaLayoutContainer')
  assert.equal(validatePageCompositionBlueprint(structuredBlueprint).length, 0)

  const unsupported = await validateComponentRuntime({
    componentName: 'EraLottery',
    sourceHash: 'unknown',
    profile: 'style-config',
    baseProps: {},
    propsPatch: {},
    assets: {},
  })
  assert.equal(unsupported.status, 'unsupported')

  const unregister = registerComponentRuntimeAdapter({
    id: 'test-runtime',
    supports: (componentName) => componentName === 'EraLottery',
    render: async () => ({ status: 'passed', message: '测试 Runtime 渲染通过。' }),
  })
  assert.deepEqual(listComponentRuntimeAdapters(), [{ id: 'test-runtime', mode: 'custom' }])
  const passed = await validateComponentRuntime({
    componentName: 'EraLottery',
    sourceHash: 'test',
    profile: 'style-config',
    baseProps: {},
    propsPatch: {},
    assets: {},
  })
  assert.equal(passed.status, 'passed')
  assert.equal(passed.adapterId, 'test-runtime')
  const comparison = compareRuntimeLayout(
    {
      width: 375,
      height: 500,
      regions: [{ id: 'content', bounds: { x: 10, y: 20, width: 355, height: 460 } }],
      propPaths: ['style.bgColor'],
    },
    {
      width: 375,
      height: 500,
      regions: [{ id: 'content', bounds: { x: 10, y: 20, width: 355, height: 460 } }],
    },
    ['style.bgColor'],
  )
  assert.equal(comparison.passed, true)
  assert.deepEqual(comparison.scores, { size: 1, structure: 1, props: 1 })
  unregister()

  console.log(JSON.stringify({
    multiComponentResolution: components.length,
    pageBlueprint: true,
    structuralNodes: true,
    uniqueComponentSections: true,
    unsupportedRuntimeIsExplicit: true,
    runtimeAdapterRegistry: true,
    runtimeDesignComparison: true,
  }, null, 2))
} finally {
  globalThis.fetch = originalFetch
}
