import {
  inspectRemoteComponentRuntime,
  inspectRuntimeDomSource,
} from './component-runtime-inspector.mjs'

const MAX_SCENE_NODES = 192

export const runtimeDomSourceAdapter = {
  id: 'runtime-dom',
  supports(input) {
    return Boolean(
      (input?.component?.componentJs && input?.component?.componentCss) ||
      (input?.source?.scriptUrl && input?.source?.styleUrl),
    )
  },
  async inspect(input, context = {}) {
    return input?.component
      ? inspectRemoteComponentRuntime(
          {
            component: input.component,
            width: input.width,
            height: input.height,
          },
          context,
        )
      : inspectRuntimeDomSource(
          {
            ...input.source,
            width: input.width ?? input.source?.width,
            height: input.height ?? input.source?.height,
          },
          context,
        )
  },
  async toSceneGraph(inspection, context = {}) {
    return runtimeDomInspectionToSceneGraph(inspection, context)
  },
}

export async function inspectRuntimeDomToScene(input, options = {}) {
  if (!runtimeDomSourceAdapter.supports(input)) {
    return {
      status: 'unsupported',
      sceneGraph: undefined,
      diagnostics: [
        { code: 'RUNTIME_SOURCE_UNSUPPORTED', message: '输入不是可检查的 Runtime Source。' },
      ],
    }
  }
  const inspection = await runtimeDomSourceAdapter.inspect(input, options)
  if (!inspection?.designTree?.nodes?.length) return { ...inspection, sceneGraph: undefined }
  try {
    const sceneGraph = await runtimeDomSourceAdapter.toSceneGraph(inspection, {
      sourceId: input.component?.name || input.source?.id || input.source?.name,
      surfaceKind: options.surfaceKind,
    })
    return { ...inspection, sceneGraph }
  } catch (error) {
    return {
      ...inspection,
      status: 'failed',
      sceneGraph: undefined,
      diagnostics: [
        ...(inspection.diagnostics ?? []),
        {
          code: 'RUNTIME_SCENE_COMPILE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
}

export function runtimeDomInspectionToSceneGraph(inspection, context = {}) {
  const tree = inspection?.designTree
  if (!tree?.nodes?.length) throw new Error('Runtime DOM Inspection 没有可转换的节点。')
  const sourceId = stableToken(context.sourceId || tree.componentName || 'runtime')
  const maxNodes = Math.max(1, Math.min(Number(context.maxNodes) || MAX_SCENE_NODES, 1000))
  const sourceNodes = ensureRootAndParents(tree.nodes, maxNodes)
  const normalized = normalizeRuntimeNodes(sourceNodes, tree)
  const compressed = compressWrapperNodes(normalized)
  const root = compressed.find((node) => !node.parentId)
  if (!root) throw new Error('Runtime DOM Scene 缺少根节点。')
  const nodes = compressed.map((node, index) => toSceneNode(node, index, sourceId, root.id))
  const sceneGraph = {
    version: 1,
    id: 'scene:runtime-dom:' + sourceId,
    rootNodeId: root.id,
    mode: 'editable-scene',
    surface: {
      kind: normalizeSurfaceKind(context.surfaceKind),
      width: finitePositive(tree.width, 375),
      height: finitePositive(tree.height, 812),
      originX: 0,
      originY: 0,
    },
    nodes,
    diagnostics: [
      ...(tree.diagnostics ?? []).map((item) => ({
        code: item.code || 'RUNTIME_DOM_DIAGNOSTIC',
        severity: 'warning',
        message: item.message || String(item),
      })),
      ...(normalized.length > compressed.length
        ? [
            {
              code: 'RUNTIME_WRAPPERS_COMPRESSED',
              severity: 'warning',
              message:
                '已压缩 ' +
                (normalized.length - compressed.length) +
                ' 个无视觉职责的 Runtime 包装节点。',
            },
          ]
        : []),
    ],
  }
  assertRuntimeSceneGraph(sceneGraph)
  return sceneGraph
}

export function sceneGraphToComponentDesignTree(sceneGraph, componentName) {
  if (!sceneGraph?.nodes?.length) return undefined
  return {
    version: 1,
    componentName: componentName || sceneGraph.id,
    width: sceneGraph.surface.width,
    height: sceneGraph.surface.height,
    nodes: sceneGraph.nodes.map((node) => ({
      id: node.id,
      type: toDesignTreeType(node.type),
      role: node.name,
      parentId: node.parentId,
      bounds: { ...node.bounds },
      content: node.content,
      assetSource: node.asset?.source,
      bindingStatus: 'visual-only',
      source: 'runtime-inspect',
      confidence: node.source.confidence,
      editable: true,
      visible: node.visible !== false,
      style: {
        fill: node.style?.fill ?? node.style?.background,
        color: node.style?.color,
        radius: node.style?.borderRadius,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
        lineHeight: node.style?.lineHeight,
        textAlign: node.style?.textAlign,
        stroke: node.style?.stroke,
        strokeWidth: node.style?.strokeWidth,
        shadow: node.style?.shadow,
      },
    })),
    diagnostics: sceneGraph.diagnostics,
  }
}

function normalizeRuntimeNodes(rawNodes, tree) {
  const usedIds = new Set()
  const idMap = new Map()
  rawNodes.forEach((node, index) => {
    const base = stableToken(node?.id || 'runtime-node-' + (index + 1))
    let id = base
    let suffix = 2
    while (usedIds.has(id)) id = base + '-' + suffix++
    usedIds.add(id)
    idMap.set(node, id)
  })
  const rawById = new Map(rawNodes.map((node) => [node?.id, node]))
  return rawNodes.map((node, index) => {
    const parent = node?.parentId ? rawById.get(node.parentId) : undefined
    return {
      id: idMap.get(node),
      parentId: parent ? idMap.get(parent) : undefined,
      type: String(node?.type || 'container'),
      role: String(node?.role || node?.content || node?.type || '节点 ' + (index + 1)).slice(
        0,
        180,
      ),
      content: reliableContent(node),
      bounds: normalizeBounds(node?.bounds, tree.width, tree.height),
      style: node?.style && typeof node.style === 'object' ? { ...node.style } : {},
      domPath: typeof node?.domPath === 'string' ? node.domPath : undefined,
      assetSource: typeof node?.assetSource === 'string' ? node.assetSource : undefined,
      confidence: clampNumber(node?.confidence, 0.98, 0, 1),
    }
  })
}

function compressWrapperNodes(nodes) {
  const result = nodes.map((node) => ({ ...node }))
  let changed = true
  while (changed) {
    changed = false
    const rootId = result.find((node) => !node.parentId)?.id
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const node = result[index]
      if (node.id === rootId || !isPureWrapper(node)) continue
      const children = result.filter((candidate) => candidate.parentId === node.id)
      if (children.length > 1) continue
      for (const child of children) child.parentId = node.parentId
      result.splice(index, 1)
      changed = true
    }
  }
  return result
}

function isPureWrapper(node) {
  return (
    node.type === 'container' &&
    !node.content &&
    !node.style?.fill &&
    !node.style?.stroke &&
    !node.style?.shadow &&
    !(Number(node.style?.radius) > 0)
  )
}

function toSceneNode(node, index, sourceId, rootId) {
  const type = toCanonicalType(node.type, node.id === rootId, node.content)
  const fill = typeof node.style?.fill === 'string' ? node.style.fill : undefined
  return {
    id: node.id,
    type,
    parentId: node.id === rootId ? undefined : node.parentId,
    name: node.role,
    bounds: node.bounds,
    zIndex: index + 1,
    // CSS background-image buttons often keep their label as direct DOM text.
    // Preserve it as semantic metadata while the node remains an image on canvas.
    content: ['text', 'button', 'input', 'image'].includes(type) ? node.content : undefined,
    ...(type === 'image' && node.assetSource
      ? {
          asset: { source: node.assetSource, fit: 'cover' },
        }
      : {}),
    style: {
      fill,
      background: type === 'button' ? fill : undefined,
      color: typeof node.style?.color === 'string' ? node.style.color : undefined,
      borderRadius: finiteNonNegative(node.style?.radius),
      fontSize: finitePositive(node.style?.fontSize, undefined),
      fontWeight: finitePositive(node.style?.fontWeight, undefined),
      lineHeight: normalizeRuntimeLineHeight(node.style?.lineHeight, node.style?.fontSize),
      textAlign: ['left', 'center', 'right'].includes(node.style?.textAlign)
        ? node.style.textAlign
        : undefined,
      stroke: typeof node.style?.stroke === 'string' ? node.style.stroke : undefined,
      strokeWidth: finitePositive(node.style?.strokeWidth, undefined),
      shadow: parseCssShadow(node.style?.shadow),
      shape: 'rect',
    },
    source: {
      adapterId: 'runtime-dom',
      sourceNodeId: sourceId + ':' + node.id,
      confidence: node.confidence,
    },
    ownership: { regionId: node.id, role: 'structure' },
    bindings: {
      ...(node.domPath ? { 'runtime.domPath': node.domPath } : {}),
    },
  }
}

function toCanonicalType(type, root, content) {
  if (root) return 'frame'
  if (type === 'text' || type === 'heading') return 'text'
  if (type === 'button') return content ? 'button' : 'shape'
  if (type === 'input') return 'input'
  if (type === 'image' || type === 'icon') return 'image'
  if (['surface', 'progress', 'divider', 'badge'].includes(type)) return 'shape'
  if (['list', 'list-item'].includes(type)) return 'frame'
  return 'group'
}

function toDesignTreeType(type) {
  if (type === 'frame' || type === 'group') return 'container'
  return type
}

function reliableContent(node) {
  const content = String(node?.content || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  if (!content) return undefined
  const structural = [node?.id, node?.role, node?.type].map((value) =>
    String(value || '')
      .trim()
      .toLowerCase(),
  )
  return structural.includes(content.toLowerCase()) ? undefined : content
}

function normalizeBounds(bounds, surfaceWidth, surfaceHeight) {
  const width = finitePositive(surfaceWidth, 375)
  const height = finitePositive(surfaceHeight, 812)
  // 保留真实 DOM 的负坐标和越界尺寸，不能在适配阶段裁切；
  // 画布/质量门禁再决定如何提示或修复溢出。
  const x = finiteNumber(bounds?.x, 0)
  const y = finiteNumber(bounds?.y, 0)
  return {
    x,
    y,
    width: finitePositive(bounds?.width, Math.max(1, width - Math.max(0, x))),
    height: finitePositive(bounds?.height, Math.max(1, height - Math.max(0, y))),
  }
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function ensureRootAndParents(nodes, maxNodes) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : []
  if (list.length <= maxNodes) return list
  const root = list.find((node) => !node.parentId) || list[0]
  const selected = [root]
  for (const node of list) {
    if (selected.length >= maxNodes) break
    if (node !== root) selected.push(node)
  }
  const selectedIds = new Set(selected.map((node) => node.id))
  return selected.map((node) =>
    node.parentId && !selectedIds.has(node.parentId) ? { ...node, parentId: root.id } : node,
  )
}

function assertRuntimeSceneGraph(graph) {
  const ids = new Set()
  for (const node of graph.nodes) {
    if (!node.id || ids.has(node.id))
      throw new Error('Runtime Scene 节点 ID 无效：' + (node.id || 'empty') + '。')
    ids.add(node.id)
    const bounds = [node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height]
    if (!bounds.every(Number.isFinite) || node.bounds.width <= 0 || node.bounds.height <= 0) {
      throw new Error('Runtime Scene 节点边界无效：' + node.id + '。')
    }
    if (!node.source?.adapterId || !node.ownership?.regionId)
      throw new Error('Runtime Scene 节点缺少 Owner：' + node.id + '。')
    if (['text', 'button'].includes(node.type) && !node.content)
      throw new Error('Runtime Scene 节点缺少可靠文案：' + node.id + '。')
  }
  if (!ids.has(graph.rootNodeId)) throw new Error('Runtime Scene Root 不存在。')
  for (const node of graph.nodes) {
    if (node.parentId && !ids.has(node.parentId))
      throw new Error('Runtime Scene Parent 不存在：' + node.parentId + '。')
  }
}

/**
 * 解析 CSS box-shadow。
 *
 * 必须先摘掉颜色再取数字：Chrome 的 computed 值把颜色放在**最前面**
 * （`8px 8px 0 rgb(110,27,11)` → `rgb(110, 27, 11) 8px 8px 0px 0px`），
 * 若直接对整串取数字，会把 RGB 通道当成 x/y/blur —— 实测得到
 * `{x:110, y:27, blur:11}`，于是硬阴影变成大范围模糊、位置也整体偏移。
 *
 * 只取第一层阴影：画布的 shadow 模型是单层的，多层用逗号分隔时取首层。
 */
function parseCssShadow(value) {
  if (typeof value !== 'string' || !value || value === 'none') return undefined
  // 逗号分隔的多层阴影里，逗号也可能出现在 rgba(...) 内部，需按括号深度切分。
  const firstLayer = splitTopLevel(value)[0]
  if (!firstLayer) return undefined
  const colorPattern = /rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b(?=\s|$)/i
  const colorMatch = firstLayer.match(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}/i)
  const color = colorMatch?.[0]
  if (!color) return undefined
  // 摘掉颜色与 inset 关键字后，剩下的数字才是 offset-x / offset-y / blur / spread。
  const geometry = firstLayer.replace(colorPattern, ' ').replace(/\binset\b/i, ' ')
  const numbers = geometry.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (numbers.length < 2) return undefined
  return {
    x: numbers[0],
    y: numbers[1],
    blur: Math.max(0, numbers[2] ?? 0),
    spread: numbers[3] ?? 0,
    color,
  }
}

/** 按顶层逗号切分，忽略括号内的逗号（`rgba(0, 0, 0, .5)`）。 */
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function normalizeSurfaceKind(value) {
  return ['mobile', 'desktop-web', 'desktop-admin', 'custom'].includes(value) ? value : 'custom'
}

function stableToken(value) {
  return (
    String(value || 'runtime')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'runtime'
  )
}

function finitePositive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function normalizeRuntimeLineHeight(lineHeight, fontSize) {
  const resolvedLineHeight = finitePositive(lineHeight, undefined)
  const resolvedFontSize = finitePositive(fontSize, undefined)
  if (!resolvedLineHeight) return undefined
  if (!resolvedFontSize || resolvedLineHeight <= 4) return resolvedLineHeight
  return Math.round((resolvedLineHeight / resolvedFontSize) * 10000) / 10000
}

function finiteNonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
