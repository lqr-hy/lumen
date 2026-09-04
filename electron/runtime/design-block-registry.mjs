const definitions = {
  container: definition('容器', ['title', 'items'], 'container'),
  stack: definition('堆叠布局', ['items'], 'container'),
  grid: definition('网格布局', ['items'], 'container'),
  hero: definition('首屏区', ['title', 'items', 'actions'], 'hero'),
  text: definition('文本', ['title', 'items'], 'content'),
  image: definition('图片', ['title'], 'media'),
  'button-group': definition('按钮组', ['actions'], 'actions'),
  divider: definition('分隔线', [], 'primitive'),
  spacer: definition('留白', [], 'primitive'),
  sidebar: definition('导航', ['items'], 'navigation'),
  header: definition('页头', ['title', 'actions'], 'navigation'),
  'section-header': definition('区块标题栏', ['title', 'actions'], 'content'),
  tabs: definition('标签页', ['items'], 'navigation'),
  stats: definition('指标组', ['items'], 'data'),
  'filter-bar': definition('筛选栏', ['fields', 'actions'], 'form'),
  'data-table': definition('数据表格', ['columns', 'rows'], 'data'),
  form: definition('表单', ['fields', 'actions'], 'form'),
  'content-grid': definition('内容网格', ['items'], 'content'),
  chart: definition('图表', ['title', 'items'], 'data'),
  tree: definition('树形列表', ['items'], 'data'),
  'detail-panel': definition('详情面板', ['fields', 'actions'], 'content'),
  timeline: definition('时间线', ['items'], 'data'),
  kanban: definition('看板', ['items'], 'data'),
  calendar: definition('日历', ['items'], 'data'),
  map: definition('地图', ['items'], 'media'),
  modal: definition('弹窗', ['title', 'fields', 'actions'], 'overlay'),
  drawer: definition('抽屉', ['title', 'fields', 'actions'], 'overlay'),
  toast: definition('提示', ['title'], 'overlay'),
  pagination: definition('分页', ['items'], 'navigation'),
  footer: definition('页脚', ['items'], 'navigation'),
}

export const DESIGN_BLOCK_REGISTRY = Object.assign(Object.create(null), definitions)

export function isRegisteredDesignBlock(kind) {
  return Object.hasOwn(DESIGN_BLOCK_REGISTRY, kind)
}

export function registerDesignBlockDefinitions(entries, namespace = 'extension') {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new TypeError('Block Registry 扩展必须是对象。')
  }
  for (const [kind, value] of Object.entries(entries)) {
    if (!/^[a-z][a-z0-9-]*$/.test(kind) || isRegisteredDesignBlock(kind)) {
      throw new TypeError(`Block kind 无效或重复：${kind}`)
    }
    const label = typeof value?.label === 'string' && value.label.trim() ? value.label.trim() : kind
    const properties = Array.isArray(value?.properties)
      ? value.properties.filter((item) => typeof item === 'string').slice(0, 16)
      : []
    DESIGN_BLOCK_REGISTRY[kind] = definition(label, properties, value?.category || namespace)
  }
}

export function describeDesignBlockRegistry() {
  return Object.entries(DESIGN_BLOCK_REGISTRY)
    .map(
      ([kind, item]) => `${kind}（${item.label}：${item.properties.join('、') || '无内容字段'}）`,
    )
    .join('；')
}

function definition(label, properties, category) {
  return Object.freeze({ version: 1, label, category, properties: Object.freeze(properties) })
}
