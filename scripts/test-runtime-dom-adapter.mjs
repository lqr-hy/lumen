import assert from 'node:assert/strict'
import {
  runtimeDomInspectionToSceneGraph,
  sceneGraphToComponentDesignTree,
} from '../electron/runtime/runtime-dom-adapter.mjs'
import {
  inlineRuntimeImageSources,
  isAllowedRuntimeUrl,
  resolveInspectorRemValue,
} from '../electron/runtime/component-runtime-inspector.mjs'
import {
  designTreeToBlueprintRegions,
  mergeComponentDesignTree,
} from '../electron/runtime/component-design-tree.mjs'

assert.equal(resolveInspectorRemValue(375), 50, '375 宽 H5 Runtime 应使用 50px rem 基准')
assert.equal(resolveInspectorRemValue(750), 100, '750 宽二倍 Runtime 应使用 100px rem 基准')
for (const url of [
  'https://cdn.example.com/component.js',
  'https://uat.example.com/component.css',
  'http://localhost:3000/assets/image.png',
  'http://127.0.0.1:4173/assets/image.png',
  'http://10.0.0.8:8080/assets/image.png',
  'https://192.168.1.20/assets/image.png',
]) {
  assert.equal(isAllowedRuntimeUrl(url), true, `Runtime 应允许任意 HTTP/HTTPS 域名：${url}`)
}
for (const url of [
  'file:///tmp/component.js',
  'javascript:alert(1)',
  'data:text/plain,hello',
  'not-a-url',
]) {
  assert.equal(isAllowedRuntimeUrl(url), false, `Runtime 不应接受非 HTTP/HTTPS 地址：${url}`)
}

const inspection = {
  designTree: {
    version: 1,
    componentName: 'ExampleRuntime',
    width: 375,
    height: 240,
    nodes: [
      node('root', 'container', '根节点', undefined, bounds(0, 0, 375, 240)),
      node('wrapper', 'container', '无视觉包装', 'root', bounds(12, 12, 351, 180)),
      node('card', 'surface', '内容卡片', 'wrapper', bounds(12, 12, 351, 180), undefined, {
        fill: '#ffffff',
        radius: 8,
      }),
      node('title', 'heading', '标题', 'card', bounds(28, 28, 180, 30), '活动标题', {
        color: '#111111',
        fontSize: 20,
        lineHeight: 28,
      }),
      node('action', 'button', '操作按钮', 'card', bounds(28, 120, 120, 40), '立即参与', {
        fill: '#ff6699',
        color: '#ffffff',
        radius: 8,
      }),
    ],
  },
}
inspection.designTree.nodes[3].domPath = 'section > h2'

const sceneGraph = runtimeDomInspectionToSceneGraph(inspection, {
  sourceId: 'example-runtime',
  surfaceKind: 'mobile',
})
assert.equal(sceneGraph.mode, 'editable-scene')
assert.equal(sceneGraph.nodes.length, 4)
assert.equal(
  sceneGraph.nodes.some((item) => item.id === 'wrapper'),
  false,
)
assert.equal(sceneGraph.nodes.find((item) => item.id === 'card').parentId, 'root')
assert.equal(
  sceneGraph.nodes.find((item) => item.id === 'title').bindings['runtime.domPath'],
  'section > h2',
)
assert.equal(sceneGraph.nodes.find((item) => item.id === 'title').style.lineHeight, 1.4)
assert.ok(sceneGraph.nodes.every((item) => item.source.adapterId === 'runtime-dom'))
assert.ok(sceneGraph.nodes.every((item) => item.ownership.role === 'structure'))
assert.equal(
  sceneGraph.diagnostics.some((item) => item.code === 'RUNTIME_WRAPPERS_COMPRESSED'),
  true,
)

const runtimeTree = sceneGraphToComponentDesignTree(sceneGraph, 'ExampleRuntime')
const contract = {
  componentName: 'ExampleRuntime',
  designProperties: [],
  structuralControls: [],
  repeaters: [],
}
const profile = { id: 'default' }
const blueprint = {
  width: 375,
  height: 240,
  visualTheme: {
    source: 'kv',
    colors: ['#e60046', '#ffe0e8', '#fff5f8', '#4a0016'],
    colorTokens: [
      { role: 'primary', value: '#e60046' },
      { role: 'surface', value: '#ffe0e8' },
      { role: 'background', value: '#fff5f8' },
      { role: 'text', value: '#4a0016' },
    ],
  },
  regions: [
    {
      id: 'contract-background',
      role: '内容卡片',
      bounds: bounds(12, 12, 351, 180),
      propBindings: [],
      renderMode: 'color',
      confidence: 1,
    },
    {
      id: 'contract-action',
      role: '立即参与按钮',
      exactText: '立即参与',
      bounds: bounds(28, 120, 120, 40),
      slotId: 'action-image',
      propBindings: ['style.action.image'],
      renderMode: 'generated-asset',
      confidence: 1,
    },
    {
      id: 'contract-extra',
      role: '契约额外节点',
      bounds: bounds(0, 200, 100, 30),
      propBindings: [],
      renderMode: 'color',
      confidence: 1,
    },
  ],
}
const merged = mergeComponentDesignTree({
  contract,
  profile,
  blueprint,
  visionTree: runtimeTree,
  sourceOwnsStructure: true,
})
assert.equal(
  merged.nodes.some((item) => item.id === 'contract-extra'),
  false,
)
assert.equal(
  merged.nodes.some((item) => item.id === 'action'),
  true,
)
assert.equal(merged.nodes.find((item) => item.id === 'card').style.fill, '#ffe0e8')
assert.equal(merged.nodes.find((item) => item.id === 'action').style.fill, '#e60046')
assert.equal(merged.nodes.find((item) => item.id === 'title').style.color, '#4a0016')
const regions = designTreeToBlueprintRegions(merged, blueprint.regions)
assert.equal(
  regions.some((item) => item.id === 'contract-extra'),
  false,
)
assert.equal(
  regions.some((item) => item.content === '立即参与'),
  true,
)
assert.equal(regions.find((item) => item.id === 'card').renderMode, 'color')
assert.equal(regions.find((item) => item.content === '立即参与').slotId, 'action-image')
assert.equal(regions.find((item) => item.content === '立即参与').renderMode, 'generated-asset')

const splitButtonBlueprint = {
  ...blueprint,
  regions: [
    {
      id: 'contract-draw-one',
      role: '抽一次按钮',
      exactText: '抽一次',
      bounds: bounds(24, 170, 120, 44),
      slotId: 'draw-one-image',
      propBindings: ['style.drawOne.image'],
      renderMode: 'generated-asset',
      confidence: 1,
    },
  ],
}
const splitButtonTree = {
  version: 1,
  componentName: 'ExampleRuntime',
  width: 375,
  height: 240,
  nodes: [
    node('root', 'container', '根节点', undefined, bounds(0, 0, 375, 240)),
    node('reward-image', 'image', '奖品图片', 'root', bounds(28, 40, 120, 100)),
    node('action-row', 'container', '操作区', 'root', bounds(20, 164, 335, 52)),
    node('draw-one-bg', 'image', '按钮底图', 'action-row', bounds(24, 170, 120, 44)),
    node('draw-one-text', 'text', '按钮文案', 'action-row', bounds(48, 180, 72, 24), '抽一次'),
  ],
}
const splitMerged = mergeComponentDesignTree({
  contract,
  profile,
  blueprint: splitButtonBlueprint,
  visionTree: splitButtonTree,
  sourceOwnsStructure: true,
})
const splitRegions = designTreeToBlueprintRegions(splitMerged, splitButtonBlueprint.regions)
assert.equal(splitRegions.find((item) => item.id === 'draw-one-bg')?.slotId, 'draw-one-image')
assert.equal(splitRegions.find((item) => item.id === 'draw-one-bg')?.renderMode, 'generated-asset')
assert.equal(splitRegions.find((item) => item.id === 'reward-image')?.slotId, undefined)
assert.equal(
  splitRegions.find((item) => item.id === 'draw-one-text'),
  undefined,
)

const cssBackgroundButtonInspection = {
  designTree: {
    version: 1,
    componentName: 'CssBackgroundButton',
    width: 375,
    height: 120,
    nodes: [
      node('css-root', 'container', '根节点', undefined, bounds(0, 0, 375, 120)),
      {
        ...node('draw-ten-bg', 'image', 'image', 'css-root', bounds(200, 36, 150, 48), '抽十次'),
        assetSource: 'https://example.com/draw-ten.png',
      },
    ],
  },
}
const cssBackgroundScene = runtimeDomInspectionToSceneGraph(cssBackgroundButtonInspection, {
  sourceId: 'css-background-button',
  surfaceKind: 'mobile',
})
assert.equal(cssBackgroundScene.nodes.find((item) => item.id === 'draw-ten-bg')?.type, 'image')
assert.equal(cssBackgroundScene.nodes.find((item) => item.id === 'draw-ten-bg')?.content, '抽十次')
const cssBackgroundTree = sceneGraphToComponentDesignTree(cssBackgroundScene, 'CssBackgroundButton')
assert.equal(
  cssBackgroundTree.nodes.find((item) => item.id === 'draw-ten-bg')?.assetSource,
  'https://example.com/draw-ten.png',
)
const cssBackgroundBlueprint = {
  width: 375,
  height: 120,
  regions: [
    {
      id: 'contract-draw-ten',
      role: '抽十次按钮',
      exactText: '抽十次',
      bounds: bounds(200, 36, 150, 48),
      slotId: 'draw-ten-image',
      propBindings: ['style.drawTen.image'],
      renderMode: 'generated-asset',
      confidence: 1,
    },
  ],
}
const cssBackgroundMerged = mergeComponentDesignTree({
  contract: {
    componentName: 'CssBackgroundButton',
    designProperties: [],
    structuralControls: [],
    repeaters: [],
  },
  profile,
  blueprint: cssBackgroundBlueprint,
  visionTree: cssBackgroundTree,
  sourceOwnsStructure: true,
})
const cssBackgroundRegions = designTreeToBlueprintRegions(
  cssBackgroundMerged,
  cssBackgroundBlueprint.regions,
)
assert.equal(
  cssBackgroundRegions.find((item) => item.id === 'draw-ten-bg')?.slotId,
  'draw-ten-image',
)
assert.equal(
  cssBackgroundRegions.find((item) => item.id === 'draw-ten-bg')?.renderMode,
  'generated-asset',
)
assert.equal(
  cssBackgroundRegions.find((item) => item.id === 'draw-ten-bg')?.assetSource,
  'https://example.com/draw-ten.png',
)

const variantLabelTree = {
  ...cssBackgroundTree,
  nodes: cssBackgroundTree.nodes.map((item) =>
    item.id === 'draw-ten-bg' ? { ...item, content: '十连抽' } : item,
  ),
}
const variantLabelMerged = mergeComponentDesignTree({
  contract: {
    componentName: 'CssBackgroundButton',
    designProperties: [],
    structuralControls: [],
    repeaters: [],
  },
  profile,
  blueprint: cssBackgroundBlueprint,
  visionTree: variantLabelTree,
  sourceOwnsStructure: true,
})
const variantLabelRegions = designTreeToBlueprintRegions(
  variantLabelMerged,
  cssBackgroundBlueprint.regions,
)
assert.equal(
  variantLabelRegions.find((item) => item.id === 'draw-ten-bg')?.slotId,
  'draw-ten-image',
)

const missingCarrierMerged = mergeComponentDesignTree({
  contract: {
    componentName: 'CssBackgroundButton',
    designProperties: [],
    structuralControls: [],
    repeaters: [],
  },
  profile,
  blueprint: cssBackgroundBlueprint,
  visionTree: {
    version: 1,
    componentName: 'CssBackgroundButton',
    width: 375,
    height: 120,
    nodes: [
      node('fallback-root', 'container', '根节点', undefined, bounds(0, 0, 375, 120)),
      node(
        'fallback-label',
        'text',
        '普通说明',
        'fallback-root',
        bounds(24, 12, 160, 24),
        '请选择抽奖方式',
      ),
    ],
  },
  sourceOwnsStructure: true,
})
const missingCarrierRegions = designTreeToBlueprintRegions(
  missingCarrierMerged,
  cssBackgroundBlueprint.regions,
)
const fallbackCarrier = missingCarrierRegions.find((item) => item.slotId === 'draw-ten-image')
assert.equal(fallbackCarrier?.renderMode, 'generated-asset')
assert.equal(fallbackCarrier?.bounds.x, 200)
assert.equal(
  missingCarrierRegions.some((item) => item.id === 'contract-draw-ten'),
  false,
)

const unsafeSiblingMerged = mergeComponentDesignTree({
  contract: {
    componentName: 'UnsafeSibling',
    designProperties: [],
    structuralControls: [],
    repeaters: [],
  },
  profile,
  blueprint: cssBackgroundBlueprint,
  visionTree: {
    version: 1,
    componentName: 'UnsafeSibling',
    width: 375,
    height: 240,
    nodes: [
      node('unsafe-root', 'container', '根节点', undefined, bounds(0, 0, 375, 240)),
      node('unrelated-prize', 'image', '奖品图片', 'unsafe-root', bounds(28, 36, 100, 84)),
      node(
        'draw-ten-label-only',
        'text',
        '按钮文案',
        'unsafe-root',
        bounds(210, 174, 120, 24),
        '抽十次',
      ),
    ],
  },
  sourceOwnsStructure: true,
})
const unsafeSiblingRegions = designTreeToBlueprintRegions(
  unsafeSiblingMerged,
  cssBackgroundBlueprint.regions,
)
assert.equal(unsafeSiblingRegions.find((item) => item.id === 'unrelated-prize')?.slotId, undefined)
assert.equal(
  unsafeSiblingRegions
    .find((item) => item.slotId === 'draw-ten-image')
    ?.id.includes('slot-fallback'),
  true,
)

const textOnlyButtonMerged = mergeComponentDesignTree({
  contract: {
    componentName: 'TextOnlyButtons',
    designProperties: [],
    structuralControls: [],
    repeaters: [],
  },
  profile,
  blueprint: {
    width: 375,
    height: 240,
    regions: [
      {
        id: 'contract-draw-one',
        role: '抽一次按钮',
        exactText: '抽一次',
        bounds: bounds(16, 168, 160, 48),
        slotId: 'draw-one-image',
        propBindings: ['style.drawOne.image'],
        renderMode: 'generated-asset',
        confidence: 1,
      },
      {
        id: 'contract-draw-ten',
        role: '抽十次按钮',
        exactText: '抽十次',
        bounds: bounds(199, 168, 160, 48),
        slotId: 'draw-ten-image',
        propBindings: ['style.drawTen.image'],
        renderMode: 'generated-asset',
        confidence: 1,
      },
    ],
  },
  visionTree: {
    version: 1,
    componentName: 'TextOnlyButtons',
    width: 375,
    height: 240,
    nodes: [
      node('runtime-root', 'container', '根节点', undefined, bounds(0, 0, 375, 240)),
      node('large-content', 'surface', '内容区', 'runtime-root', bounds(12, 45, 350, 180)),
      node('top-header', 'surface', '顶部栏', 'runtime-root', bounds(12, 5, 350, 40)),
      node(
        'draw-one-text-only',
        'text',
        '按钮文案',
        'large-content',
        bounds(28, 177, 155, 36),
        '抽一次',
      ),
      node(
        'draw-ten-text-only',
        'text',
        '按钮文案',
        'large-content',
        bounds(191, 177, 155, 36),
        '抽十次',
      ),
    ],
  },
  sourceOwnsStructure: true,
})
const textOnlyButtonRegions = designTreeToBlueprintRegions(textOnlyButtonMerged, [])
const drawOneCarrier = textOnlyButtonRegions.find((item) => item.slotId === 'draw-one-image')
const drawTenCarrier = textOnlyButtonRegions.find((item) => item.slotId === 'draw-ten-image')
assert.equal(drawOneCarrier?.id.includes('slot-fallback'), true)
assert.equal(drawTenCarrier?.id.includes('slot-fallback'), true)
assert.equal(drawOneCarrier?.renderMode, 'generated-asset')
assert.equal(drawTenCarrier?.renderMode, 'generated-asset')
assert.equal(textOnlyButtonRegions.find((item) => item.id === 'large-content')?.slotId, undefined)
assert.equal(textOnlyButtonRegions.find((item) => item.id === 'top-header')?.slotId, undefined)
assert.equal(
  textOnlyButtonRegions.find((item) => item.id === 'draw-one-text-only'),
  undefined,
)
assert.equal(
  textOnlyButtonRegions.find((item) => item.id === 'draw-ten-text-only'),
  undefined,
)

const inlinedTree = await inlineRuntimeImageSources(
  {
    version: 1,
    componentName: 'InlineImage',
    width: 100,
    height: 100,
    nodes: [{ id: 'remote-image', type: 'image', assetSource: 'https://example.com/prize.png' }],
  },
  {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/prize.png',
      headers: new Headers({ 'content-type': 'image/png', 'content-length': '4' }),
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
    }),
  },
)
assert.equal(inlinedTree.nodes[0].assetSource, 'data:image/png;base64,iVBORw==')

// box-shadow 解析：Chrome 的 computed 值把颜色放在最前面，
// 若对整串取数字会把 RGB 通道当成 x/y/blur，硬阴影会退化成大范围模糊且位置偏移。
// 这里的输入全部取自 Chrome 真实 computed 输出。
const shadowCases = [
  // 硬阴影：设计稿最常用的形态
  { css: 'rgb(110, 27, 11) 8px 8px 0px 0px', want: { x: 8, y: 8, blur: 0, spread: 0 } },
  // 带透明度与模糊
  { css: 'rgba(51, 65, 85, 0.25) 0px 4px 6px 0px', want: { x: 0, y: 4, blur: 6, spread: 0 } },
  // 带 spread
  { css: 'rgba(250, 79, 135, 0.2) 0px 4px 14px 2px', want: { x: 0, y: 4, blur: 14, spread: 2 } },
  // 负偏移
  { css: 'rgb(16, 42, 86) -6px 10px 0px 0px', want: { x: -6, y: 10, blur: 0, spread: 0 } },
  // inset 关键字不应被当作数字来源
  { css: 'rgb(170, 187, 204) 2px 3px 4px 0px inset', want: { x: 2, y: 3, blur: 4, spread: 0 } },
  // 多层阴影取首层；rgba 内部的逗号不能当作层分隔符
  {
    css: 'rgba(51, 65, 85, 0.25) 0px 4px 6px 0px, rgba(0, 0, 0, 0.1) 0px 2px 4px 0px',
    want: { x: 0, y: 4, blur: 6, spread: 0 },
  },
]
for (const { css, want } of shadowCases) {
  const graph = runtimeDomInspectionToSceneGraph(
    {
      designTree: {
        version: 1,
        componentName: 'ShadowProbe',
        width: 100,
        height: 100,
        nodes: [
          node('root', 'container', '根节点', undefined, bounds(0, 0, 100, 100)),
          node('card', 'container', '卡片', 'root', bounds(10, 10, 80, 80), undefined, {
            fill: '#ffffff',
            shadow: css,
          }),
        ],
      },
    },
    { surfaceKind: 'mobile' },
  )
  const card = graph.nodes.find((item) => item.id.includes('card'))
  assert.ok(card?.style?.shadow, `阴影应被解析：${css}`)
  assert.deepEqual(
    {
      x: card.style.shadow.x,
      y: card.style.shadow.y,
      blur: card.style.shadow.blur,
      spread: card.style.shadow.spread,
    },
    want,
    `阴影几何解析错误：${css}`,
  )
  // 颜色必须保留原样，不能被数字提取破坏。
  assert.match(card.style.shadow.color, /^(rgb|rgba|#)/, `阴影颜色应保留：${css}`)
}
// 无颜色或非法值不应产出半成品阴影。
for (const invalid of ['none', '', 'inherit']) {
  const graph = runtimeDomInspectionToSceneGraph(
    {
      designTree: {
        version: 1,
        componentName: 'ShadowProbe',
        width: 100,
        height: 100,
        nodes: [
          node('root', 'container', '根节点', undefined, bounds(0, 0, 100, 100)),
          node('card', 'container', '卡片', 'root', bounds(10, 10, 80, 80), undefined, {
            fill: '#ffffff',
            shadow: invalid,
          }),
        ],
      },
    },
    { surfaceKind: 'mobile' },
  )
  const card = graph.nodes.find((item) => item.id.includes('card'))
  assert.equal(card?.style?.shadow, undefined, `非法阴影值应被丢弃：${JSON.stringify(invalid)}`)
}

console.log(
  JSON.stringify(
    {
      runtimeDomSourceAdapter: true,
      wrapperCompression: true,
      domPathBinding: true,
      canonicalOwnership: true,
      runtimeExclusiveStructure: true,
      contractBindingWithoutDuplicateStructure: true,
      kvThemeMappedToRuntimeNodes: true,
      runtimeImageSlotTextOwnership: true,
      runtimeSplitButtonSlotRebinding: true,
      runtimeCssBackgroundButtonSlotRebinding: true,
      runtimeVariantButtonLabelRebinding: true,
      runtimeMissingSlotCarrierFallback: true,
      runtimeUnrelatedSiblingRejected: true,
      runtimeRemoteImageInlined: true,
      cssShadowGeometryParsed: true,
    },
    null,
    2,
  ),
)

function node(id, type, role, parentId, nodeBounds, content, style = {}) {
  return {
    id,
    type,
    role,
    parentId,
    bounds: nodeBounds,
    content,
    style,
    source: 'runtime-inspect',
    confidence: 0.98,
  }
}

function bounds(x, y, width, height) {
  return { x, y, width, height }
}
