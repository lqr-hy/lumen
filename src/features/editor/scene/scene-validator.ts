import type { SceneDiagnostic, SceneGraph, SceneNode } from './scene-graph'

const DEFAULT_MAX_NODES = 5_000
const FALLBACK_CONTENT = /^(?:text|button|node|layer|item|label)[-_ ]?\d+$/i

export interface SceneValidationResult {
  valid: boolean
  diagnostics: SceneDiagnostic[]
}

export class SceneGraphValidationError extends Error {
  readonly diagnostics: SceneDiagnostic[]

  constructor(diagnostics: SceneDiagnostic[]) {
    super(
      diagnostics.find((item) => item.severity === 'error')?.message ?? 'Scene Graph 校验失败。',
    )
    this.name = 'SceneGraphValidationError'
    this.diagnostics = diagnostics
  }
}

export function validateSceneGraph(
  graph: SceneGraph,
  options: { maxNodes?: number } = {},
): SceneValidationResult {
  const diagnostics = [...(graph.diagnostics ?? [])]
  const addError = (code: string, message: string, nodeId?: string, relatedNodeIds?: string[]) => {
    diagnostics.push({ code, severity: 'error', message, nodeId, relatedNodeIds })
  }

  if (graph.version !== 1)
    addError('SCENE_VERSION_UNSUPPORTED', `不支持 Scene Graph v${String(graph.version)}。`)
  if (!graph.id.trim()) addError('SCENE_ID_MISSING', 'Scene Graph 缺少稳定 ID。')
  if (!isPositiveFinite(graph.surface.width) || !isPositiveFinite(graph.surface.height)) {
    addError('SCENE_SURFACE_INVALID', 'Scene Graph Surface 宽高必须是有限正数。')
  }
  if (graph.nodes.length > (options.maxNodes ?? DEFAULT_MAX_NODES)) {
    addError('SCENE_NODE_LIMIT_EXCEEDED', `Scene Graph 节点数 ${graph.nodes.length} 超出限制。`)
  }

  const nodesById = new Map<string, SceneNode>()
  for (const node of graph.nodes) {
    if (!node.id.trim()) {
      addError('SCENE_NODE_ID_MISSING', 'Scene 节点缺少 ID。')
      continue
    }
    if (nodesById.has(node.id)) {
      addError('SCENE_NODE_ID_DUPLICATE', `Scene 节点 ID 重复：${node.id}`, node.id)
      continue
    }
    nodesById.set(node.id, node)
    if (!isFiniteBounds(node))
      addError('SCENE_BOUNDS_INVALID', `节点 ${node.id} 的边界非法。`, node.id)
    if (
      !node.source.adapterId.trim() ||
      !Number.isFinite(node.source.confidence) ||
      node.source.confidence < 0 ||
      node.source.confidence > 1
    ) {
      addError('SCENE_SOURCE_INVALID', `节点 ${node.id} 缺少有效 Source Owner。`, node.id)
    }
    if (!node.ownership.regionId.trim())
      addError('SCENE_OWNER_REGION_MISSING', `节点 ${node.id} 缺少视觉区域 Owner。`, node.id)
    if ((node.type === 'text' || node.type === 'button') && !isValidContent(node.content)) {
      addError('SCENE_CONTENT_INVALID', `节点 ${node.id} 包含空文案或内部占位文案。`, node.id)
    }
  }

  const root = nodesById.get(graph.rootNodeId)
  if (!root) addError('SCENE_ROOT_MISSING', `Scene Root 不存在：${graph.rootNodeId}`)
  else if (root.parentId)
    addError('SCENE_ROOT_HAS_PARENT', 'Scene Root 不能包含 parentId。', root.id)

  for (const node of nodesById.values()) {
    if (node.parentId && !nodesById.has(node.parentId)) {
      addError('SCENE_PARENT_MISSING', `节点 ${node.id} 的父节点不存在：${node.parentId}`, node.id)
    }
    if (node.id !== graph.rootNodeId && !node.parentId) {
      addError('SCENE_MULTIPLE_ROOTS', `节点 ${node.id} 未挂载到 Scene Root。`, node.id)
    }
  }
  detectCycles(nodesById, addError)
  validateDeliveryMode(graph, nodesById, addError)

  return {
    valid: diagnostics.every((item) => item.severity !== 'error'),
    diagnostics,
  }
}

export function assertSceneGraph(graph: SceneGraph, options: { maxNodes?: number } = {}) {
  const result = validateSceneGraph(graph, options)
  if (!result.valid) throw new SceneGraphValidationError(result.diagnostics)
  return result
}

function detectCycles(
  nodesById: Map<string, SceneNode>,
  addError: (code: string, message: string, nodeId?: string, relatedNodeIds?: string[]) => void,
) {
  const complete = new Set<string>()
  for (const node of nodesById.values()) {
    if (complete.has(node.id)) continue
    const path: string[] = []
    const positions = new Map<string, number>()
    let current: SceneNode | undefined = node
    while (current && !complete.has(current.id)) {
      const seenAt = positions.get(current.id)
      if (seenAt !== undefined) {
        const cycle = path.slice(seenAt)
        addError(
          'SCENE_PARENT_CYCLE',
          `Scene 节点存在父子循环：${cycle.join(' -> ')}`,
          current.id,
          cycle,
        )
        break
      }
      positions.set(current.id, path.length)
      path.push(current.id)
      current = current.parentId ? nodesById.get(current.parentId) : undefined
    }
    path.forEach((id) => complete.add(id))
  }
}

function validateDeliveryMode(
  graph: SceneGraph,
  nodesById: Map<string, SceneNode>,
  addError: (code: string, message: string, nodeId?: string, relatedNodeIds?: string[]) => void,
) {
  const fullFrameRaster = graph.nodes.filter(
    (node) =>
      node.type === 'image' && node.ownership.role !== 'structure' && coversSurface(node, graph),
  )
  const editableLeaves = graph.nodes.filter(
    (node) => node.type === 'text' || node.type === 'button' || node.type === 'input',
  )

  if (graph.mode === 'editable-scene') {
    for (const node of graph.nodes) {
      if (node.ownership.role === 'snapshot') {
        addError(
          'SCENE_SNAPSHOT_IN_EDITABLE_MODE',
          'Editable Scene 不能包含 Runtime Snapshot Owner。',
          node.id,
        )
      }
    }
    if (fullFrameRaster.length && editableLeaves.length) {
      addError(
        'SCENE_FULL_FRAME_RASTER_CONFLICT',
        '全画布 Raster 与可编辑结构同时拥有同一视觉画面。',
        fullFrameRaster[0].id,
        [...fullFrameRaster, ...editableLeaves].map((node) => node.id),
      )
    }
  }

  if (graph.mode === 'raster-composition') {
    const rasterNodes = graph.nodes.filter((node) => node.ownership.role === 'raster')
    if (rasterNodes.length !== 1 || editableLeaves.length) {
      addError('SCENE_RASTER_MODE_INVALID', 'Raster Composition 必须且只能由一个 Raster 节点交付。')
    }
  }

  if (graph.mode === 'runtime-snapshot') {
    const snapshots = graph.nodes.filter((node) => node.ownership.role === 'snapshot')
    if (snapshots.length !== 1 || editableLeaves.length) {
      addError(
        'SCENE_SNAPSHOT_MODE_INVALID',
        'Runtime Snapshot 必须且只能由一个 Snapshot 节点交付。',
      )
    }
  }

  for (const node of nodesById.values()) {
    if (node.parentId === node.id)
      addError('SCENE_SELF_PARENT', `节点 ${node.id} 不能引用自身为父节点。`, node.id)
  }
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0
}

function isFiniteBounds(node: SceneNode) {
  const { x, y, width, height } = node.bounds
  const validSize =
    node.visible === false
      ? Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0
      : isPositiveFinite(width) && isPositiveFinite(height)
  return Number.isFinite(x) && Number.isFinite(y) && validSize
}

function isValidContent(content: string | undefined) {
  const value = content?.trim() ?? ''
  return (
    Boolean(value) &&
    !FALLBACK_CONTENT.test(value) &&
    !['未命名', 'placeholder'].includes(value.toLowerCase())
  )
}

function coversSurface(node: SceneNode, graph: SceneGraph) {
  const originX = graph.surface.originX ?? 0
  const originY = graph.surface.originY ?? 0
  const intersectionWidth = Math.max(
    0,
    Math.min(node.bounds.x + node.bounds.width, originX + graph.surface.width) -
      Math.max(node.bounds.x, originX),
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(node.bounds.y + node.bounds.height, originY + graph.surface.height) -
      Math.max(node.bounds.y, originY),
  )
  return (
    (intersectionWidth * intersectionHeight) / (graph.surface.width * graph.surface.height) >= 0.9
  )
}
