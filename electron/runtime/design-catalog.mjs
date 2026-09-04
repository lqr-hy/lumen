import {
  applyVisualThemeToDesignSpec,
  assertGenericUiSchema,
  genericUiLogicalSize,
  inspectGenericUiSchema,
  normalizeGenericUiSchema,
} from './generic-ui.mjs'
import { DESIGN_BLOCK_REGISTRY, describeDesignBlockRegistry } from './design-block-registry.mjs'

export const DESIGN_BLOCK_CATALOG = DESIGN_BLOCK_REGISTRY
export { describeDesignBlockRegistry }

export const normalizeDesignSpec = normalizeGenericUiSchema
export const inspectDesignSpec = inspectGenericUiSchema
export const assertDesignSpec = assertGenericUiSchema
export const designLogicalSize = genericUiLogicalSize
export { applyVisualThemeToDesignSpec }

const DESIGN_BLOCK_ALIASES = Object.freeze({
  navigation: 'sidebar',
  navbar: 'header',
  'top-navigation': 'header',
  'metric-card': 'stats',
  'metrics-card': 'stats',
  'stat-card': 'stats',
  table: 'data-table',
  'project-list': 'data-table',
  'list-table': 'data-table',
  section: 'container',
  panel: 'container',
  buttons: 'button-group',
  actions: 'button-group',
  filters: 'filter-bar',
})

export function createDesignSpecExample(surfaceKind = 'desktop-admin') {
  const mobile = surfaceKind === 'mobile'
  const admin = surfaceKind === 'desktop-admin'
  return {
    version: 1,
    surfaceKind,
    designArchetype: admin
      ? 'project-management-admin'
      : mobile
        ? 'mobile-product-page'
        : 'product-marketing-site',
    title: admin ? '项目管理' : mobile ? '移动端产品页' : '产品官网',
    viewport: admin
      ? { width: 1440, height: 900 }
      : mobile
        ? { width: 375, height: 812 }
        : { width: 1440, height: 960 },
    theme: {
      mode: 'light',
      colors: ['#ffffff', '#f5f7fa', '#182230', '#2563eb', '#d9dee8'],
      radius: 8,
      density: 'compact',
    },
    blocks: admin
      ? [
          { id: 'sidebar', kind: 'sidebar', label: '主导航', items: ['概览', '项目', '成员'] },
          { id: 'header', kind: 'header', label: '页头', title: '项目管理', actions: ['新建项目'] },
          { id: 'stats', kind: 'stats', label: '项目指标', items: ['进行中 12', '已完成 48'] },
          {
            id: 'projects',
            kind: 'data-table',
            label: '项目列表',
            columns: ['项目', '负责人', '状态'],
            rows: [['官网改版', '张三', '进行中']],
          },
        ]
      : mobile
        ? [
            { id: 'header', kind: 'header', label: '页头', title: '产品名称', actions: ['菜单'] },
            {
              id: 'content',
              kind: 'content-grid',
              label: '主要内容',
              items: ['核心内容', '推荐内容'],
            },
            { id: 'footer', kind: 'footer', label: '底部导航', items: ['首页', '发现', '我的'] },
          ]
        : [
            {
              id: 'hero',
              kind: 'hero',
              label: '首屏',
              title: '产品名称',
              items: ['清晰的产品价值'],
              actions: ['立即开始'],
            },
            {
              id: 'features',
              kind: 'content-grid',
              label: '核心能力',
              items: ['能力一', '能力二', '能力三'],
            },
          ],
  }
}

export function normalizeDesignSpecResult(input, goal = '', options = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : undefined
  const aliased = source ? applyDesignBlockAliases(source) : source
  const spec = normalizeDesignSpec(aliased, goal, options)
  const sourceBlocks = Array.isArray(source?.blocks) ? source.blocks : []
  const aliasedBlocks = Array.isArray(aliased?.blocks) ? aliased.blocks : []
  const supportedBlocks = aliasedBlocks.filter((block) =>
    Object.hasOwn(DESIGN_BLOCK_CATALOG, block?.kind),
  )
  const unknownKinds = [
    ...new Set(
      sourceBlocks
        .map((block) => block?.kind)
        .filter(
          (kind) =>
            typeof kind === 'string' &&
            !Object.hasOwn(DESIGN_BLOCK_CATALOG, DESIGN_BLOCK_ALIASES[kind] || kind),
        ),
    ),
  ]
  if (!source || !sourceBlocks.length || !supportedBlocks.length) {
    return {
      spec,
      status: 'invalid',
      diagnostics: [
        !source ? '模型没有返回 JSON 对象。' : undefined,
        !sourceBlocks.length ? 'DesignSpec.blocks 为空或缺失。' : undefined,
        unknownKinds.length ? `不支持的 Block kind：${unknownKinds.join('、')}。` : undefined,
        sourceBlocks.length && !supportedBlocks.length
          ? '模型未返回可用 Registry Block。'
          : undefined,
      ].filter(Boolean),
    }
  }
  const aliasKinds = sourceBlocks
    .filter((block) => DESIGN_BLOCK_ALIASES[block?.kind])
    .map((block) => `${block.kind}->${DESIGN_BLOCK_ALIASES[block.kind]}`)
  const duplicateStructuralKinds = findDuplicateStructuralKinds(aliasedBlocks)
  const repaired =
    sourceBlocks.length !== supportedBlocks.length ||
    aliasKinds.length > 0 ||
    duplicateStructuralKinds.length > 0 ||
    source.version !== 1 ||
    typeof source.title !== 'string' ||
    !source.viewport ||
    !source.theme
  return {
    spec,
    status: repaired ? 'repaired' : 'valid',
    diagnostics: repaired
      ? [
          aliasKinds.length
            ? `已映射 Block 别名：${[...new Set(aliasKinds)].join('、')}。`
            : undefined,
          duplicateStructuralKinds.length
            ? `已将重复全局结构转换为内容 Block：${duplicateStructuralKinds.join('、')}。`
            : undefined,
          unknownKinds.length ? `已移除不受支持的 Block：${unknownKinds.join('、')}。` : undefined,
          '已补全 DesignSpec 缺失字段。',
        ].filter(Boolean)
      : [],
  }
}

function findDuplicateStructuralKinds(blocks) {
  const counts = new Map()
  for (const block of blocks) {
    if (!['sidebar', 'header', 'footer'].includes(block?.kind)) continue
    counts.set(block.kind, (counts.get(block.kind) ?? 0) + 1)
  }
  return [...counts].filter(([, count]) => count > 1).map(([kind]) => kind)
}

function applyDesignBlockAliases(source) {
  return {
    ...source,
    blocks: Array.isArray(source.blocks) ? source.blocks.map(applyBlockAlias) : source.blocks,
  }
}

function applyBlockAlias(block) {
  if (!block || typeof block !== 'object') return block
  return {
    ...block,
    kind: DESIGN_BLOCK_ALIASES[block.kind] || block.kind,
    ...(Array.isArray(block.children) ? { children: block.children.map(applyBlockAlias) } : {}),
  }
}
