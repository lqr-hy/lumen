/** Build a compact, generic semantic context for the selected editable subtree. */
export function buildDesignSelectionContext(snapshot, scope) {
  const all = Array.isArray(snapshot?.elements) ? snapshot.elements : []
  const allowedIds = new Set(Array.isArray(scope?.targetElementIds) ? scope.targetElementIds : [])
  if (scope?.elementId) allowedIds.add(scope.elementId)
  const nodes = all
    .filter((element) => allowedIds.has(element.id))
    .map((element) => ({
      id: element.id,
      parentId: element.parentId,
      type: element.type,
      name: element.name,
      role: inferNodeRole(element),
      bounds: element.bounds,
      content: element.properties?.content,
      style: element.properties?.style,
      visual: pickVisualProperties(element),
    }))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const tree = nodes.map((node) => ({
    ...node,
    children: nodes.filter((child) => child.parentId === node.id).map((child) => child.id),
  }))
  return {
    version: 1,
    artboardId: snapshot?.artboardId,
    documentRevision: snapshot?.documentRevision,
    scope: {
      type: scope?.type,
      rootId: scope?.elementId,
      writableNodeIds: [...allowedIds].filter((id) => nodeById.has(id)),
    },
    focusNodeId: resolveFocusNode(nodes, scope),
    nodes: tree,
  }
}

function resolveFocusNode(nodes, scope) {
  if (!nodes.length) return undefined
  const root = nodes.find((node) => node.id === scope?.elementId)
  const text = nodes.find((node) => node.type === 'text')
  return text?.id || root?.id || nodes[0].id
}

function inferNodeRole(element) {
  const value = `${element.name || ''} ${element.properties?.content || ''}`.toLowerCase()
  if (element.type === 'text') {
    if (/%|金额|数量|人数|金额|增长|转化|率/.test(value)) return 'metric-value-or-label'
    if (/标题|title|名称|name/.test(value)) return 'heading'
    return 'text'
  }
  if (element.type === 'button') return 'button'
  if (element.type === 'image') return 'image'
  if (element.type === 'shape')
    return /背景|卡片|容器|panel|card|background/i.test(value) ? 'surface' : 'shape'
  if (element.type === 'section') return 'container'
  return 'node'
}

function pickVisualProperties(element) {
  const properties = element.properties || {}
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) =>
      ['fill', 'stroke', 'borderRadius', 'opacity', 'layoutSizing', 'layoutConstraints'].includes(
        key,
      ),
    ),
  )
}
